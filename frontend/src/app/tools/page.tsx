"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Clock, ExternalLink, Scale, Search, Sparkles, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { AppHeader, PAIN_LABEL, VERTICAL_LABEL } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;
const PRICE = [
  { id: "any", label: "Any price", ok: () => true },
  { id: "free", label: "Has free plan", ok: (t: Tool) => t.free_tier || t.price_monthly_min === 0 },
  { id: "50", label: "Under $50/mo", ok: (t: Tool) => t.price_monthly_typical <= 50 },
  { id: "150", label: "Under $150/mo", ok: (t: Tool) => t.price_monthly_typical <= 150 },
];
const PROBLEMS = [
  "missed_calls", "reviews", "social_media", "email_sms_marketing", "appointment_booking", "no_shows", "staff_scheduling",
  "quoting", "invoicing_payments", "bookkeeping", "dispatch_routing", "online_ordering", "menu_costing", "inventory",
  "customer_chat", "website", "admin_writing",
];
const TYPES = ["cafe", "restaurant", "hvac", "landscaping", "home_services", "salon", "retail"];

function Ease({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`needs tech comfort ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-1.5 w-3 rounded-full", i <= n ? "bg-stone-700" : "bg-stone-200")} />
      ))}
    </span>
  );
}

export default function Discover() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [me, setMe] = useState<{ user: User; business: Business | null } | null | undefined>(undefined);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [price, setPrice] = useState("any");
  const [picked, setPicked] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    api<Tool[]>("/catalog").then(setTools);
    // public page: a 401 just means "logged out"
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        if (m?.business?.vertical && TYPES.includes(m.business.vertical)) setType(m.business.vertical);
      })
      .catch(() => setMe(null));
  }, []);

  const profile = me?.business?.profile;
  const fit = (t: Tool) => {
    if (!profile) return null;
    const reasons: string[] = [];
    const links = t.integrates_with.filter((i) => profile.current_tools.includes(i));
    const checks: [boolean, string][] = [
      [t.verticals.includes(profile.vertical) || t.verticals.includes("all"), `made for ${VERTICAL_LABEL[profile.vertical]?.toLowerCase() || "your type"}`],
      [t.price_monthly_typical <= profile.monthly_budget, "fits your budget"],
      [t.tech_comfort_min <= profile.tech_comfort, "easy enough for you"],
      [links.length > 0, `connects to ${links.join(", ").replace(/-/g, " ")}`],
    ];
    for (const [ok, why] of checks) if (ok) reasons.push(why);
    const score = reasons.length;
    return { score, reasons };
  };

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const p = PRICE.find((x) => x.id === price)!;
    return tools
      .filter((t) => !type || t.verticals.includes(type) || t.verticals.includes("all"))
      .filter((t) => !problem || t.solves.includes(problem))
      .filter(p.ok)
      .filter((t) => !ql || [t.name, t.description, t.category, ...t.ai_features, ...t.solves].join(" ").toLowerCase().includes(ql))
      .sort((a, b) => (fit(b)?.score ?? 0) - (fit(a)?.score ?? 0) || a.price_monthly_typical - b.price_monthly_typical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, q, type, problem, price, profile]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  const pickedTools = picked.map((id) => tools.find((t) => t.id === id)!).filter(Boolean);

  return (
    <div className="min-h-dvh pb-32">
      {me !== undefined && <AppHeader loggedOut={!me} businessName={me?.business?.name} isDemo={me?.user.is_demo} />}
      <main className="mx-auto max-w-6xl px-4 pt-8">
        <p className="eyebrow">Discover</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">Browse {tools.length || ""} verified AI tools for small business</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          Filter by your type of business and the problem you want solved, then pick up to 3 tools to compare side by side.
          {profile && <> Tools are ranked by fit for <b>{me?.business?.name}</b>.</>}
        </p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input className="input pl-10" placeholder="Search: “answer my phone”, “reviews”, “invoices”…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tools" />
          </div>
          <FilterRow label="Business" value={type} onChange={setType} options={TYPES.map((t) => [t, VERTICAL_LABEL[t]])} />
          <FilterRow label="Problem" value={problem} onChange={setProblem} options={PROBLEMS.map((p) => [p, PAIN_LABEL(p)])} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-semibold text-stone-500">Price</span>
            {PRICE.map((p) => (
              <button key={p.id} onClick={() => setPrice(p.id)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", price === p.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 text-sm text-stone-500">{shown.length} tools</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((t) => {
            const f = fit(t);
            const on = picked.includes(t.id);
            return (
              <div key={t.id} className={cn("card flex flex-col p-5 transition-[border-color,box-shadow]", on && "border-emerald-500 ring-2 ring-emerald-500/20")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold leading-snug">{t.name}</h2>
                    <div className="mt-0.5 text-xs capitalize text-stone-500">{t.category.replace(/_/g, " ")}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums">{t.price_monthly_typical === 0 ? "Free" : `${money(t.price_monthly_typical)}/mo`}</div>
                    {t.free_tier && t.price_monthly_typical > 0 && <div className="text-[11px] font-medium text-emerald-700">free plan</div>}
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{t.description}</p>
                <ul className="mt-3 space-y-1 text-xs text-stone-700">
                  {t.ai_features.slice(0, 3).map((a) => (
                    <li key={a} className="flex gap-1.5">
                      <Sparkles size={12} className="mt-0.5 shrink-0 text-emerald-600" /> {a}
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-1">
                  {t.solves.slice(0, 4).map((s) => (
                    <span key={s} className="chip">{PAIN_LABEL(s)}</span>
                  ))}
                </div>
                {f && f.score >= 3 && <div className="mt-3 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">Good fit: {f.reasons.join(" · ")}</div>}
                <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-stone-500">
                  <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><Clock size={12} /> {t.setup_hours}h setup</span>
                    <Ease n={t.tech_comfort_min} />
                  </span>
                  <span className="flex items-center gap-1">
                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="btn-ghost px-2 py-1 text-xs" aria-label={`Visit ${t.name}`}>
                      <ExternalLink size={13} />
                    </a>
                    <button onClick={() => toggle(t.id)} disabled={!on && picked.length >= 3} className={cn("btn px-2.5 py-1 text-xs", on ? "bg-emerald-700 text-white" : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
                      {on ? <Check size={13} /> : <Scale size={13} />} {on ? "Added" : "Compare"}
                    </button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-10 rounded-2xl bg-stone-900 p-6 text-white sm:flex sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Not sure which to pick?</h2>
            <p className="mt-1 text-sm text-stone-300">Describe your business and a team of AI advisors will diagnose, compare and plan for you.</p>
          </div>
          <Link href={me ? "/war-room" : "/login"} className="btn mt-4 shrink-0 bg-white text-stone-900 hover:bg-stone-100 sm:mt-0">
            Ask the advisors <ArrowRight size={16} />
          </Link>
        </div>
      </main>

      <AnimatePresence>
        {picked.length > 0 && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} className="fixed inset-x-0 bottom-4 z-30 px-4">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-stone-200 bg-white/95 p-3 pl-4 shadow-xl backdrop-blur">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {pickedTools.map((t) => (
                  <span key={t.id} className="chip">
                    {t.name.replace(/ \(.*\)$/, "")}
                    <button onClick={() => toggle(t.id)} aria-label={`Remove ${t.name}`}><X size={12} /></button>
                  </span>
                ))}
                {picked.length < 2 && <span className="text-xs text-stone-500">Pick at least 2</span>}
              </div>
              <button className="btn-primary shrink-0" disabled={picked.length < 2} onClick={() => setComparing(true)}>
                <Scale size={16} /> Compare {picked.length}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {comparing && pickedTools.length >= 2 && (
          <motion.div className="fixed inset-0 z-40 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setComparing(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Compare tools"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90dvh] w-full max-w-5xl overflow-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
            >
              <CompareTable tools={pickedTools} fit={fit} onClose={() => setComparing(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterRow({ label, value, onChange, options }: { label: string; value: string | null; onChange: (v: string | null) => void; options: [string, string][] }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="w-20 shrink-0 pt-1 text-xs font-semibold text-stone-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onChange(null)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", !value ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>All</button>
        {options.map(([v, l]) => (
          <button key={v} onClick={() => onChange(value === v ? null : v)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", value === v ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

function CompareTable({ tools, fit, onClose }: { tools: Tool[]; fit: (t: Tool) => { score: number; reasons: string[] } | null; onClose: () => void }) {
  const minPrice = Math.min(...tools.map((t) => t.price_monthly_typical));
  const minSetup = Math.min(...tools.map((t) => t.setup_hours));
  const minEase = Math.min(...tools.map((t) => t.tech_comfort_min));
  const best = (on: boolean) => (on ? "bg-emerald-50 font-semibold text-emerald-900" : "");
  const hasFit = tools.some((t) => fit(t));
  const rows: { label: string; cell: (t: Tool) => React.ReactNode; cls?: (t: Tool) => string }[] = [
    { label: "Typical price", cell: (t) => (t.price_monthly_typical === 0 ? "Free" : `${money(t.price_monthly_typical)}/mo`), cls: (t) => best(t.price_monthly_typical === minPrice) },
    { label: "Free plan", cell: (t) => (t.free_tier ? "Yes" : "No") },
    { label: "Setup time", cell: (t) => `~${t.setup_hours} ${t.setup_hours === 1 ? "hour" : "hours"}`, cls: (t) => best(t.setup_hours === minSetup) },
    { label: "Tech comfort needed", cell: (t) => <Ease n={t.tech_comfort_min} />, cls: (t) => best(t.tech_comfort_min === minEase) },
    ...(hasFit ? [{ label: "Fit for your business", cell: (t: Tool) => { const f = fit(t); return f ? <span><b>{f.score}/4</b> <span className="text-xs text-stone-500">{f.reasons.join(" · ")}</span></span> : "—"; } }] : []),
    { label: "Best for", cell: (t) => t.verticals.map((v) => (v === "all" ? "Any business" : VERTICAL_LABEL[v])).join(", ") },
    { label: "Solves", cell: (t) => t.solves.map(PAIN_LABEL).join(", ") },
    { label: "AI features", cell: (t) => <ul className="space-y-0.5">{t.ai_features.map((a) => <li key={a}>• {a}</li>)}</ul> },
    { label: "Connects with", cell: (t) => t.integrates_with.join(", ").replace(/-/g, " ") },
    { label: "Pros", cell: (t) => <ul className="space-y-0.5 text-emerald-800">{t.pros.map((a) => <li key={a}>+ {a}</li>)}</ul> },
    { label: "Watch out", cell: (t) => <ul className="space-y-0.5 text-amber-800">{t.cons.map((a) => <li key={a}>− {a}</li>)}</ul> },
  ];
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-5 py-4">
        <h2 className="font-display text-xl font-bold">Side-by-side comparison</h2>
        <button className="btn-ghost px-2" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              <th className="w-40" />
              {tools.map((t) => (
                <th key={t.id} className="px-4 py-3 text-left align-bottom">
                  <div className="font-semibold">{t.name}</div>
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">Visit site ↗</a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-stone-100 align-top">
                <th className="px-5 py-3 text-left text-xs font-semibold text-stone-500">{r.label}</th>
                {tools.map((t) => (
                  <td key={t.id} className={cn("px-4 py-3 text-stone-800", r.cls?.(t))}>{r.cell(t)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-5 py-4 text-xs text-stone-500">Green = best in this comparison. Prices as of Nov 2026, verify before buying.</p>
    </div>
  );
}
