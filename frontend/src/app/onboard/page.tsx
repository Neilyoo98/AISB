"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, FlowStepper, HelpTip, Spinner, useTitle } from "@/components/ui";

const PROMPTS = [
  "What kind of business is it, and how many people work there?",
  "What eats your time each week, or slips through the cracks?",
  "What software or apps do you already use?",
  "Roughly how much could you spend per month on tools?",
  "How comfortable are you with technology?",
];

const TYPES = ["Café / coffee shop", "Restaurant", "HVAC", "Landscaping", "Plumbing / home services", "Salon / spa", "Retail shop", "Other"];
const BUDGETS = ["under $50", "about $100", "about $200", "about $300", "$500+"];
const MUST_HAVES = [
  { id: "no_training", label: "No training on our data" },
  { id: "soc2", label: "SOC 2" },
];
const GOALS = ["Save time", "Win more customers", "Get paid faster", "Look professional online"];

type Details = { type: string; team: string; budget: string; comfort: number; tools: string; must: string[]; goals: string[] };
const EMPTY: Details = { type: "", team: "", budget: "", comfort: 0, tools: "", must: [], goals: [] };

// Fixed template text, so repeat runs hit the LLM cache (instant and free).
const TEMPLATES: { label: string; name: string; location: string; description: string; details: Details }[] = [
  {
    label: "Coffee shop",
    name: "Daily Grind Café",
    location: "Hyattsville, MD",
    description:
      "We're a busy café with 8 part-time baristas. I lose about 5 hours a week building the schedule and covering call-outs by text. Our Google reviews sit unanswered and we haven't posted on Instagram in two months. Mornings are packed but sales drop by half after 1pm.",
    details: { type: "Café / coffee shop", team: "8", budget: "about $100", comfort: 3, tools: "Square, Instagram", must: [], goals: ["Save time", "Win more customers"] },
  },
  {
    label: "HVAC",
    name: "Precision Heating & Air",
    location: "Rockville, MD",
    description:
      "Family HVAC business with 6 technicians. The office manager can't keep up with calls in a heat wave, so we miss maybe 10 calls a week worth about $400 each. Techs write invoices on paper and customers take 30+ days to pay. Maintenance-plan renewals get forgotten.",
    details: { type: "HVAC", team: "7", budget: "about $300", comfort: 3, tools: "QuickBooks, Google Calendar", must: ["soc2"], goals: ["Win more customers", "Get paid faster"] },
  },
  {
    label: "Landscaping",
    name: "Evergreen Lawn Co.",
    location: "Bowie, MD",
    description:
      "Lawn care and mowing with 2 crews of 3. We have about 120 weekly customers and I spend Sunday nights texting schedule changes when it rains. Billing is a spreadsheet and I chase about $3,000 in late payments every month. New leads come through Facebook and I'm slow to reply.",
    details: { type: "Landscaping", team: "7", budget: "about $200", comfort: 2, tools: "Spreadsheet, Facebook", must: [], goals: ["Save time", "Get paid faster"] },
  },
  {
    label: "Salon",
    name: "Bright Smile Salon",
    location: "Laurel, MD",
    description:
      "Hair salon with 5 chairs. No-shows are killing us, about 8 a week at $60 each, and I spend hours on the phone rebooking. Bookings come by phone and Instagram DMs and go into a paper book. I'd like to post more on Instagram but never have time.",
    details: { type: "Salon / spa", team: "5", budget: "about $100", comfort: 3, tools: "Instagram", must: ["no_training"], goals: ["Save time", "Win more customers"] },
  },
  {
    label: "Restaurant",
    name: "Casa Verde Kitchen",
    location: "Takoma Park, MD",
    description:
      "Neighborhood Mexican restaurant with 14 staff. During dinner rush nobody answers the phone, so we lose takeout orders, maybe 15 a week at $35 each. Food costs went up and I don't know which dishes still make money. Reviews on Google and Yelp go unanswered.",
    details: { type: "Restaurant", team: "14", budget: "about $200", comfort: 2, tools: "Toast, Google Business Profile", must: [], goals: ["Win more customers", "Save time"] },
  },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        on ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400",
      )}
    >
      {on && <Check size={12} strokeWidth={3} />} {children}
    </button>
  );
}

export default function Onboard() {
  useTitle("Describe your business");
  const router = useRouter();
  const [me, setMe] = useState<{ user: User; business: Business | null } | null>(null);
  const [form, setForm] = useState({ name: "", location: "", description: "" });
  const [details, setDetails] = useState<Details>(EMPTY);
  const [template, setTemplate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User; business: Business | null }>("/me").then((m) => {
      if (m.user.is_demo) return router.replace("/dashboard");
      setMe(m);
      if (m.business) setForm({ name: m.business.name, location: m.business.location || "", description: m.business.description || "" });
    });
  }, [router]);

  const toggleIn = (key: "must" | "goals", v: string) =>
    setDetails((d) => ({ ...d, [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] }));

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setTemplate(t.label);
    setForm({ name: t.name, location: t.location, description: t.description });
    setDetails(t.details);
    setErr(null);
  };

  const extra = [
    details.type && `Type of business: ${details.type}.`,
    details.team && `Team size: ${details.team} people.`,
    details.budget && `Monthly budget for software: ${details.budget}.`,
    details.comfort && `Comfort with technology: ${details.comfort} out of 5.`,
    details.tools.trim() && `Tools we already use: ${details.tools.trim()}.`,
    details.goals.length > 0 && `Goals: ${details.goals.join(", ")}.`,
    details.must.length > 0 && `Must-haves: ${details.must.map((m) => MUST_HAVES.find((x) => x.id === m)?.label).join(", ")}.`,
  ].filter(Boolean).join(" ");
  const fullDescription = [form.description.trim(), extra].filter(Boolean).join(" ");
  const MIN = 40;
  const tooShort = fullDescription.length < MIN;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setErr("Please add your business name.");
    if (tooShort) return setErr("Tell us a little more: a sentence or two about what slows you down (or pick a template / fill in the quick details).");
    setBusy(true);
    setErr(null);
    const team = parseInt(details.team, 10);
    const structured = {
      business_type: details.type || null,
      team_size: Number.isFinite(team) && team > 0 ? team : null,
      budget: details.budget || null,
      tech_comfort: details.comfort || null,
      current_tools: details.tools.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
      security_must_haves: details.must,
      goals: details.goals,
    };
    try {
      await api("/businesses", { method: "POST", json: { ...form, description: fullDescription, details: structured } });
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode: "live", raw_input: fullDescription } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader businessName={me?.business?.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <FlowStepper step={0} />
        <h1 className="mt-6 flex items-center gap-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Tell us about your business
          <HelpTip label="How this works">
            Write it like you&apos;d explain it to a friend. Rough numbers are fine. Your advisors turn it into a dollar figure for each problem, compare real tools, and you approve
            everything before a plan is saved.
          </HelpTip>
        </h1>

        <section className="mt-6" aria-label="Templates">
          <div className="text-sm font-medium text-stone-700">Start from a template</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <Chip key={t.label} on={template === t.label} onClick={() => applyTemplate(t)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </section>

        <form onSubmit={submit} className="card mt-5 space-y-5 p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="bname">Business name</label>
              <input id="bname" className="input" maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="loc">Town / city</label>
              <input id="loc" className="input" maxLength={120} placeholder="College Park, MD" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1">
              <label className="text-sm font-medium text-stone-700" htmlFor="desc">How does your business run?</label>
              <HelpTip label="What to include">
                <ul className="space-y-1">
                  {PROMPTS.map((p) => (
                    <li key={p}>• {p}</li>
                  ))}
                </ul>
              </HelpTip>
            </div>
            <textarea
              id="desc"
              className="input min-h-[160px] resize-y leading-relaxed"
              maxLength={2500}
              placeholder="e.g. We're a 4-person HVAC shop. When the techs are on a job nobody answers the phone, and I spend evenings writing quotes by hand…"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
            <div className="flex items-center gap-1 text-sm font-medium text-stone-700">
              Quick details <span className="font-normal text-stone-500">(optional)</span>
              <HelpTip>These answers are passed to the advisors as facts. Security must-haves are enforced strictly: tools we can&apos;t confirm are flagged for you to verify.</HelpTip>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label text-xs" htmlFor="type">Type of business</label>
                <select id="type" className="input" value={details.type} onChange={(e) => setDetails({ ...details, type: e.target.value })}>
                  <option value="">Choose…</option>
                  {TYPES.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs" htmlFor="team">Team size</label>
                <input id="team" type="number" min={1} max={500} inputMode="numeric" className="input" value={details.team} onChange={(e) => setDetails({ ...details, team: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs" htmlFor="budget">Monthly budget for tools</label>
                <select id="budget" className="input" value={details.budget} onChange={(e) => setDetails({ ...details, budget: e.target.value })}>
                  <option value="">Choose…</option>
                  {BUDGETS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <span className="label text-xs">Comfort with technology</span>
                <div className="flex gap-1" role="radiogroup" aria-label="Comfort with technology">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button type="button" key={n} role="radio" aria-checked={details.comfort === n} onClick={() => setDetails({ ...details, comfort: n })}
                      className={cn("h-10 flex-1 rounded-lg border text-sm font-semibold transition-colors", details.comfort === n ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
                      {n}
                    </button>
                  ))}
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-stone-500"><span>avoid computers</span><span>power user</span></div>
              </div>
              <div>
                <label className="label text-xs" htmlFor="tools">Tools you already use</label>
                <input id="tools" className="input" placeholder="Square, QuickBooks, Google Calendar…" value={details.tools} onChange={(e) => setDetails({ ...details, tools: e.target.value })} />
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <span className="label text-xs">Goals</span>
                <div className="flex flex-wrap gap-1.5">
                  {GOALS.map((g) => <Chip key={g} on={details.goals.includes(g)} onClick={() => toggleIn("goals", g)}>{g}</Chip>)}
                </div>
              </div>
              <div>
                <span className="label text-xs">Security must-haves</span>
                <div className="flex flex-wrap gap-1.5">
                  {MUST_HAVES.map((m) => <Chip key={m.id} on={details.must.includes(m.id)} onClick={() => toggleIn("must", m.id)}>{m.label}</Chip>)}
                </div>
              </div>
            </div>
          </div>

          {err && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {err}
            </p>
          )}
          <div className={cn("text-xs", tooShort ? "text-stone-500" : "text-emerald-700")}>
            {tooShort ? `${Math.max(0, MIN - fullDescription.length)} more characters and your advisors are ready.` : "✓ Enough detail. Your advisors are ready."}
          </div>
          <button className="btn-primary w-full py-3 text-base" disabled={busy}>
            {busy ? <Spinner /> : <Sparkles size={18} />} Meet your advisors
          </button>
          <p className="text-center text-xs text-stone-500">About 30–60 seconds. You approve everything.</p>
        </form>
      </main>
    </div>
  );
}
