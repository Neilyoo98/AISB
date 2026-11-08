"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Clock, Scale, Search, Sparkles, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { AppHeader, Ease, PAIN_LABEL, PageHeader, PageState, Stars, VERTICAL_LABEL, useTitle } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;
const PRICE = [
  { id: "any", label: "Any price", ok: () => true },
  { id: "free", label: "Has free plan", ok: (t: Tool) => t.free_tier || t.price_monthly_min === 0 },
  { id: "50", label: "Under $50/mo", ok: (t: Tool) => t.price_monthly_typical <= 50 },
  { id: "150", label: "Under $150/mo", ok: (t: Tool) => t.price_monthly_typical <= 150 },
];
const PROBLEMS = ["missed_calls", "reviews", "social_media", "email_sms_marketing", "appointment_booking", "no_shows", "staff_scheduling",
  "quoting", "invoicing_payments", "bookkeeping", "dispatch_routing", "online_ordering", "menu_costing", "inventory", "customer_chat", "website", "admin_writing"];
const TYPES = ["cafe", "restaurant", "hvac", "landscaping", "home_services", "salon", "retail"];
const EXAMPLES = ["answer my phone when I'm busy", "pull tables out of messy PDFs", "get more Google reviews", "stop no-shows"];

function DiscoverInner() {
  useTitle("Discover tools");
  const router = useRouter();
  const params = useSearchParams();
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [me, setMe] = useState<{ user: User; business: Business | null } | null | undefined>(undefined);
  const [q, setQ] = useState(params.get("q") || "");
  const [ranked, setRanked] = useState<Record<string, number> | null>(null);
  const [searching, setSearching] = useState(false);
  const [type, setType] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(params.get("problem"));
  const [price, setPrice] = useState("any");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    api<Tool[]>("/catalog").then(setTools).catch(() => setTools([]));
    // public page: a 401 just means "logged out"
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        if (m?.business?.vertical && TYPES.includes(m.business.vertical)) setType(m.business.vertical);
      })
      .catch(() => setMe(null));
  }, []);

  // Semantic search (debounced): ranks the catalog by meaning; filters still apply on top.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setRanked(null);
      return;
    }
    setSearching(true);
    const id = setTimeout(() => {
      api<{ id: string; score: number }[]>(`/catalog/search?q=${encodeURIComponent(query)}`)
        .then((rs) => setRanked(Object.fromEntries(rs.map((r, i) => [r.id, i]))))
        .catch(() => setRanked(null))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(id);
  }, [q]);

  const profile = me?.business?.profile;
  const goodFit = (t: Tool) =>
    !!profile && (t.verticals.includes(profile.vertical) || t.verticals.includes("all")) && t.price_monthly_typical <= profile.monthly_budget && t.tech_comfort_min <= profile.tech_comfort;

  const shown = useMemo(() => {
    if (!tools) return [];
    const p = PRICE.find((x) => x.id === price)!;
    const list = tools
      .filter((t) => !type || t.verticals.includes(type) || t.verticals.includes("all"))
      .filter((t) => !problem || t.solves.includes(problem))
      .filter(p.ok);
    if (ranked) return list.filter((t) => t.id in ranked).sort((a, b) => ranked[a.id] - ranked[b.id]);
    return list.sort(
      (a, b) => Number(goodFit(b)) - Number(goodFit(a)) || (b.reviews?.overall ?? 0) - (a.reviews?.overall ?? 0) || a.price_monthly_typical - b.price_monthly_typical,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, ranked, type, problem, price, profile]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));
  const byId = Object.fromEntries((tools || []).map((t) => [t.id, t]));

  return (
    <div className="min-h-dvh pb-32">
      {me !== undefined && <AppHeader loggedOut={!me} businessName={me?.business?.name} isDemo={me?.user.is_demo} />}
      <main className="mx-auto max-w-6xl px-4 pt-8">
        <PageHeader
          eyebrow="Discover"
          title="Find AI tools for your business"
          help={
            <>
              Every tool here is real and hand-checked. Search in plain words: we match by meaning, not keywords. Filter by business type, problem or price, then tick up to 4 tools to
              compare side by side.{profile && <> Tools that fit <b>{me?.business?.name}</b> are listed first.</>}
            </>
          }
        />

        <div className="mt-6 space-y-3">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400" />
            <input className="input pl-10 pr-10" placeholder="Describe what you need, e.g. “answer my phone when I'm busy”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tools" />
            {q && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700" onClick={() => setQ("")} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </div>
          {!q && (
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
              <span className="text-stone-500">Try:</span>
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => setQ(e)} className="text-emerald-700 hover:underline">“{e}”</button>
              ))}
            </div>
          )}
          <FilterRow label="Business" value={type} onChange={setType} options={TYPES.map((t) => [t, VERTICAL_LABEL[t]])} />
          <FilterRow label="Problem" value={problem} onChange={setProblem} options={PROBLEMS.map((p) => [p, PAIN_LABEL(p)])} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-20 shrink-0 text-xs font-semibold text-stone-500">Price</span>
            {PRICE.map((p) => (
              <button key={p.id} onClick={() => setPrice(p.id)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", price === p.id ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 text-sm text-stone-500" aria-live="polite">
          {searching ? "Searching…" : `${shown.length} tools${ranked ? " · best matches first" : ""}`}
        </div>
        {!tools ? (
          <PageState kind="loading" />
        ) : shown.length === 0 ? (
          <PageState kind="empty" message="No tools match those filters. Try clearing one." />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((t) => {
              const on = picked.includes(t.id);
              return (
                <div key={t.id} className={cn("card flex flex-col p-5 transition-[border-color,box-shadow]", on && "border-emerald-500 ring-2 ring-emerald-500/20")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/tools/${t.id}`} className="font-semibold leading-snug hover:underline">{t.name}</Link>
                      <div className="mt-0.5 text-xs capitalize text-stone-500">{t.category.replace(/_/g, " ")}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold tabular-nums">{t.price_monthly_typical === 0 ? "Free" : `${money(t.price_monthly_typical)}/mo`}</div>
                      {t.free_tier && t.price_monthly_typical > 0 && <div className="text-[11px] font-medium text-emerald-700">free plan</div>}
                    </div>
                  </div>
                  {t.reviews ? (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-stone-500">
                      <Stars value={t.reviews.overall} size={12} /> {t.reviews.overall.toFixed(1)} · {t.reviews.count} review{t.reviews.count > 1 ? "s" : ""}
                    </div>
                  ) : (
                    <div className="mt-1.5 text-xs text-stone-400">No reviews yet</div>
                  )}
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-stone-600">{t.description}</p>
                  <ul className="mt-3 space-y-1 text-xs text-stone-700">
                    {t.ai_features.slice(0, 2).map((a) => (
                      <li key={a} className="flex gap-1.5"><Sparkles size={12} className="mt-0.5 shrink-0 text-emerald-600" /> {a}</li>
                    ))}
                  </ul>
                  {goodFit(t) && <div className="mt-3 w-fit rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">Good fit for you</div>}
                  <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-stone-500">
                    <span className="flex items-center gap-3">
                      <span className="flex items-center gap-1"><Clock size={12} /> {t.setup_hours}h</span>
                      <Ease n={t.tech_comfort_min} />
                    </span>
                    <span className="flex items-center gap-1">
                      <Link href={`/tools/${t.id}`} className="btn-ghost px-2 py-1 text-xs">Details</Link>
                      <button onClick={() => toggle(t.id)} disabled={!on && picked.length >= 4} aria-pressed={on}
                        className={cn("btn px-2.5 py-1 text-xs", on ? "bg-emerald-700 text-white" : "border border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
                        {on ? <Check size={13} /> : <Scale size={13} />} {on ? "Added" : "Compare"}
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 rounded-2xl bg-stone-900 p-6 text-white sm:flex sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold">Not sure which to pick?</h2>
            <p className="mt-1 text-sm text-stone-300">Let the advisor agents diagnose your business and pick for you.</p>
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
                {picked.map((id) => (
                  <span key={id} className="chip">
                    {byId[id]?.name.replace(/ \(.*\)$/, "")}
                    <button onClick={() => toggle(id)} aria-label={`Remove ${byId[id]?.name}`}><X size={12} /></button>
                  </span>
                ))}
                {picked.length < 2 && <span className="text-xs text-stone-500">Pick at least 2</span>}
              </div>
              <button className="btn-primary shrink-0" disabled={picked.length < 2} onClick={() => router.push(`/compare?ids=${picked.join(",")}`)}>
                <Scale size={16} /> Compare {picked.length}
              </button>
            </div>
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
          <button key={v} onClick={() => onChange(value === v ? null : v)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", value === v ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400")}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Discover() {
  return (
    <Suspense>
      <DiscoverInner />
    </Suspense>
  );
}
