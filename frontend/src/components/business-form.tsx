"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/api";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/categories";
import { HelpTip, Spinner } from "@/components/ui";

// One form for onboarding (/onboard) and profile editing (/profile).

const PROMPTS = [
  "What kind of business is it, and how many people work there?",
  "What eats your time each week, or slips through the cracks?",
  "What software or apps do you already use?",
  "Roughly how much could you spend per month on tools?",
  "How comfortable are you with technology?",
];
export const BUDGETS = ["under $50", "about $100", "about $200", "about $300", "$500+"];
export const MUST_HAVES = [
  { id: "no_training", label: "No training on our data" },
  { id: "soc2", label: "SOC 2" },
];
export const GOALS = ["Save time", "Win more customers", "Get paid faster", "Look professional online"];

export type FormDetails = {
  category: string; // general category id (see lib/categories)
  typeLabel?: string; // legacy specific label kept only so template text stays identical (LLM cache)
  team: string;
  budget: string;
  comfort: number;
  tools: string;
  must: string[];
  goals: string[];
};
export type FormValue = { name: string; location: string; description: string; details: FormDetails };
export const EMPTY_FORM: FormValue = { name: "", location: "", description: "", details: { category: "", team: "", budget: "", comfort: 0, tools: "", must: [], goals: [] } };

export type BusinessPayload = {
  name: string;
  location: string;
  description: string; // composed: owner's text + quick details as sentences
  details: {
    business_category: string | null;
    business_type: string | null;
    team_size: number | null;
    budget: string | null;
    tech_comfort: number | null;
    current_tools: string[];
    security_must_haves: string[];
    goals: string[];
  };
};

// Fixed example text, so repeat runs hit the LLM cache (instant and free). Keep descriptions + typeLabel unchanged.
export const TEMPLATES: { label: string; value: FormValue }[] = [
  {
    label: "Food & drink example",
    value: {
      name: "Daily Grind Café",
      location: "Hyattsville, MD",
      description:
        "We're a busy café with 8 part-time baristas. I lose about 5 hours a week building the schedule and covering call-outs by text. Our Google reviews sit unanswered and we haven't posted on Instagram in two months. Mornings are packed but sales drop by half after 1pm.",
      details: { category: "food_drink", typeLabel: "Café / coffee shop", team: "8", budget: "about $100", comfort: 3, tools: "Square, Instagram", must: [], goals: ["Save time", "Win more customers"] },
    },
  },
  {
    label: "Home services example",
    value: {
      name: "Precision Heating & Air",
      location: "Rockville, MD",
      description:
        "Family HVAC business with 6 technicians. The office manager can't keep up with calls in a heat wave, so we miss maybe 10 calls a week worth about $400 each. Techs write invoices on paper and customers take 30+ days to pay. Maintenance-plan renewals get forgotten.",
      details: { category: "home_field", typeLabel: "HVAC", team: "7", budget: "about $300", comfort: 3, tools: "QuickBooks, Google Calendar", must: ["soc2"], goals: ["Win more customers", "Get paid faster"] },
    },
  },
  {
    label: "Outdoor services example",
    value: {
      name: "Evergreen Lawn Co.",
      location: "Bowie, MD",
      description:
        "Lawn care and mowing with 2 crews of 3. We have about 120 weekly customers and I spend Sunday nights texting schedule changes when it rains. Billing is a spreadsheet and I chase about $3,000 in late payments every month. New leads come through Facebook and I'm slow to reply.",
      details: { category: "home_field", typeLabel: "Landscaping", team: "7", budget: "about $200", comfort: 2, tools: "Spreadsheet, Facebook", must: [], goals: ["Save time", "Get paid faster"] },
    },
  },
  {
    label: "Beauty & wellness example",
    value: {
      name: "Bright Smile Salon",
      location: "Laurel, MD",
      description:
        "Hair salon with 5 chairs. No-shows are killing us, about 8 a week at $60 each, and I spend hours on the phone rebooking. Bookings come by phone and Instagram DMs and go into a paper book. I'd like to post more on Instagram but never have time.",
      details: { category: "beauty_wellness", typeLabel: "Salon / spa", team: "5", budget: "about $100", comfort: 3, tools: "Instagram", must: ["no_training"], goals: ["Save time", "Win more customers"] },
    },
  },
  {
    label: "Restaurant example",
    value: {
      name: "Casa Verde Kitchen",
      location: "Takoma Park, MD",
      description:
        "Neighborhood Mexican restaurant with 14 staff. During dinner rush nobody answers the phone, so we lose takeout orders, maybe 15 a week at $35 each. Food costs went up and I don't know which dishes still make money. Reviews on Google and Yelp go unanswered.",
      details: { category: "food_drink", typeLabel: "Restaurant", team: "14", budget: "about $200", comfort: 2, tools: "Toast, Google Business Profile", must: [], goals: ["Win more customers", "Save time"] },
    },
  },
];

const EXTRA_PREFIXES = ["Type of business:", "Team size:", "Monthly budget for software:", "Comfort with technology:", "Tools we already use:", "Goals:", "Must-haves:"];

/** Remove the quick-detail sentences we append on save, so editing doesn't duplicate them. */
export function stripComposed(description: string): string {
  let out = description;
  for (const p of EXTRA_PREFIXES) {
    const i = out.indexOf(` ${p}`);
    if (i !== -1) out = out.slice(0, i);
    else if (out.startsWith(p)) out = "";
  }
  return out.trim();
}

/** Build form state from a saved business (/api/me). */
export function formFromBusiness(b: {
  name: string;
  location: string | null;
  description: string | null;
  details?: Record<string, unknown> | null;
}): FormValue {
  const d = (b.details || {}) as Record<string, unknown>;
  const cat = (d.business_category as string) || "";
  return {
    name: b.name,
    location: b.location || "",
    description: stripComposed(b.description || ""),
    details: {
      category: cat,
      typeLabel: !cat && d.business_type ? (d.business_type as string) : undefined,
      team: d.team_size ? String(d.team_size) : "",
      budget: (d.budget as string) || "",
      comfort: (d.tech_comfort as number) || 0,
      tools: ((d.current_tools as string[]) || []).join(", "),
      must: (d.security_must_haves as string[]) || [],
      goals: (d.goals as string[]) || [],
    },
  };
}

export function composePayload(v: FormValue): BusinessPayload {
  const d = v.details;
  const typeText = d.typeLabel || (d.category ? CATEGORY_LABEL[d.category] : "");
  const extra = [
    typeText && `Type of business: ${typeText}.`,
    d.team && `Team size: ${d.team} people.`,
    d.budget && `Monthly budget for software: ${d.budget}.`,
    d.comfort && `Comfort with technology: ${d.comfort} out of 5.`,
    d.tools.trim() && `Tools we already use: ${d.tools.trim()}.`,
    d.goals.length > 0 && `Goals: ${d.goals.join(", ")}.`,
    d.must.length > 0 && `Must-haves: ${d.must.map((m) => MUST_HAVES.find((x) => x.id === m)?.label).join(", ")}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const team = parseInt(d.team, 10);
  return {
    name: v.name.trim(),
    location: v.location.trim(),
    description: [v.description.trim(), extra].filter(Boolean).join(" "),
    details: {
      business_category: d.category || null,
      business_type: typeText || null,
      team_size: Number.isFinite(team) && team > 0 ? team : null,
      budget: d.budget || null,
      tech_comfort: d.comfort || null,
      current_tools: d.tools.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20),
      security_must_haves: d.must,
      goals: d.goals,
    },
  };
}

export const MIN_DESCRIPTION = 40;

function Chip({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
        on ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400",
      )}
    >
      {on && <Check size={12} strokeWidth={3} />} {children}
    </button>
  );
}

export function BusinessForm({
  value,
  onChange,
  onSubmit,
  submitLabel,
  submitIcon,
  busy,
  error,
  readOnly,
  showTemplates,
  footnote,
  secondaryAction,
}: {
  value: FormValue;
  onChange: (v: FormValue) => void;
  onSubmit: (payload: BusinessPayload) => void;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  busy?: boolean;
  error?: string | null;
  readOnly?: boolean;
  showTemplates?: boolean;
  footnote?: React.ReactNode;
  secondaryAction?: React.ReactNode;
}) {
  const [template, setTemplate] = useState<string | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const d = value.details;
  const setD = (patch: Partial<FormDetails>) => onChange({ ...value, details: { ...d, ...patch } });
  const toggleIn = (key: "must" | "goals", v: string) => setD({ [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v] });
  const payload = composePayload(value);
  const tooShort = payload.description.length < MIN_DESCRIPTION;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly) return;
    if (!value.name.trim()) return setLocalErr("Please add your business name.");
    if (tooShort) return setLocalErr("Tell us a little more: a sentence or two about what slows you down (or pick an example / fill in the quick details).");
    setLocalErr(null);
    onSubmit(payload);
  };
  const err = localErr || error;

  return (
    <>
      {showTemplates && !readOnly && (
        <section className="mt-6" aria-label="Examples">
          <div className="flex items-center gap-1 text-sm font-medium text-stone-700">
            Start from an example
            <HelpTip>Fills in a realistic sample business so you can see the advisors work right away. You can edit anything before running.</HelpTip>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <Chip
                key={t.label}
                on={template === t.label}
                onClick={() => {
                  setTemplate(t.label);
                  setLocalErr(null);
                  onChange(t.value);
                }}
              >
                {t.label}
              </Chip>
            ))}
          </div>
        </section>
      )}

      <form onSubmit={submit} className="card mt-5 space-y-5 p-6 sm:p-8">
        <fieldset disabled={readOnly} className="space-y-5 disabled:opacity-75">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="bname">Business name</label>
              <input id="bname" className="input" maxLength={120} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="loc">Town / city</label>
              <input id="loc" className="input" maxLength={120} placeholder="College Park, MD" value={value.location} onChange={(e) => onChange({ ...value, location: e.target.value })} />
            </div>
          </div>

          <div>
            <span className="label">Type of business</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type of business">
              {CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  role="radio"
                  aria-checked={d.category === c.id}
                  onClick={() => setD({ category: c.id, typeLabel: undefined })}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
                    d.category === c.id ? "border-emerald-700 bg-emerald-50 text-emerald-900" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400",
                  )}
                >
                  <c.icon size={15} /> {c.label}
                </button>
              ))}
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
              className="input min-h-[150px] resize-y leading-relaxed"
              maxLength={2200}
              placeholder="e.g. When my techs are on a job nobody answers the phone, and I spend evenings writing quotes by hand…"
              value={value.description}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
            />
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4">
            <div className="flex items-center gap-1 text-sm font-medium text-stone-700">
              Quick details <span className="font-normal text-stone-500">(optional)</span>
              <HelpTip>These answers are passed to the advisors as facts. Security must-haves are enforced strictly: tools we can&apos;t confirm are flagged for you to verify.</HelpTip>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label text-xs" htmlFor="team">People on your team</label>
                <input id="team" type="number" min={1} max={500} inputMode="numeric" className="input" value={d.team} onChange={(e) => setD({ team: e.target.value })} />
              </div>
              <div>
                <label className="label text-xs" htmlFor="budget">Monthly budget for tools</label>
                <select id="budget" className="input" value={d.budget} onChange={(e) => setD({ budget: e.target.value })}>
                  <option value="">Choose…</option>
                  {BUDGETS.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="label text-xs" htmlFor="tools">Tools you already use</label>
                <input id="tools" className="input" placeholder="Square, QuickBooks…" value={d.tools} onChange={(e) => setD({ tools: e.target.value })} />
              </div>
            </div>
            <div className="mt-3">
              <span className="label text-xs">Comfort with technology</span>
              <div className="flex max-w-sm gap-1" role="radiogroup" aria-label="Comfort with technology">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    role="radio"
                    aria-checked={d.comfort === n}
                    onClick={() => setD({ comfort: n })}
                    className={cn("h-10 flex-1 rounded-lg border text-sm font-semibold transition-colors", d.comfort === n ? "border-emerald-700 bg-emerald-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="mt-1 flex max-w-sm justify-between text-[11px] text-stone-500"><span>1 = avoid computers</span><span>5 = power user</span></div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <span className="label text-xs">Goals</span>
                <div className="flex flex-wrap gap-1.5">
                  {GOALS.map((g) => <Chip key={g} on={d.goals.includes(g)} onClick={() => toggleIn("goals", g)} disabled={readOnly}>{g}</Chip>)}
                </div>
              </div>
              <div>
                <span className="label text-xs">Security must-haves</span>
                <div className="flex flex-wrap gap-1.5">
                  {MUST_HAVES.map((m) => <Chip key={m.id} on={d.must.includes(m.id)} onClick={() => toggleIn("must", m.id)} disabled={readOnly}>{m.label}</Chip>)}
                </div>
              </div>
            </div>
          </div>
        </fieldset>

        {err && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </p>
        )}
        {!readOnly && (
          <>
            <div className={cn("text-xs", tooShort ? "text-stone-500" : "text-emerald-700")}>
              {tooShort ? `Add ${Math.max(0, MIN_DESCRIPTION - payload.description.length)} more characters so the advisors have enough to work with.` : "✓ Enough detail for the advisors."}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button className="btn-primary flex-1 py-3 text-base" disabled={busy}>
                {busy ? <Spinner /> : submitIcon} {submitLabel}
              </button>
              {secondaryAction}
            </div>
          </>
        )}
        {footnote}
      </form>
    </>
  );
}
