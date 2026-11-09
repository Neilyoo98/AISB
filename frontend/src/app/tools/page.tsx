"use client";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Scale, Search, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { CATEGORIES, categoryOfVertical, toolCategories } from "@/lib/categories";
import { CAPABILITY_LABEL, TOOL_TYPES, ToolIcon, toolType } from "@/lib/tool-icons";
import { AdoptButton } from "@/components/adopt-button";
import { ToolQuickView } from "@/components/tool-quickview";
import { AppHeader, PAIN_LABEL, PageHeader, PageState, Stars, useTitle } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;
const PRICE = [
  { id: "any", label: "Any price", ok: () => true },
  { id: "free", label: "Has free plan", ok: (t: Tool) => t.free_tier || t.price_monthly_min === 0 },
  { id: "50", label: "Under $50/mo", ok: (t: Tool) => t.price_monthly_typical <= 50 },
  { id: "150", label: "Under $150/mo", ok: (t: Tool) => t.price_monthly_typical <= 150 },
];
const HELPS_WITH = ["missed_calls", "reviews", "social_media", "email_sms_marketing", "appointment_booking", "no_shows", "staff_scheduling",
  "quoting", "invoicing_payments", "bookkeeping", "dispatch_routing", "online_ordering", "inventory", "customer_chat", "website", "admin_writing"];
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
  const [biz, setBiz] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(params.get("type"));
  const [helps, setHelps] = useState<string | null>(params.get("problem"));
  const [moreFilters, setMoreFilters] = useState(false);
  const [price, setPrice] = useState("any");
  const [picked, setPicked] = useState<string[]>([]);
  const [quick, setQuick] = useState<Tool | null>(null);
  const closeQuick = useCallback(() => setQuick(null), []);

  useEffect(() => {
    api<Tool[]>("/catalog").then(setTools).catch(() => setTools([]));
    // public page: a 401 just means "logged out"
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        setMe(m);
        const c = m?.business?.details?.business_category || categoryOfVertical(m?.business?.vertical);
        if (c && CATEGORIES.some((x) => x.id === c)) setBiz(c);
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
  const goodFit = (t: Tool) => !!profile && t.price_monthly_typical <= profile.monthly_budget && t.tech_comfort_min <= profile.tech_comfort;

  const types = useMemo(() => Array.from(new Set((tools || []).map((t) => t.category))).filter((c) => TOOL_TYPES[c]), [tools]);

  const shown = useMemo(() => {
    if (!tools) return [];
    const p = PRICE.find((x) => x.id === price)!;
    const list = tools
      .filter((t) => !biz || toolCategories(t).includes(biz as never))
      .filter((t) => !type || t.category === type)
      .filter((t) => !helps || t.solves.includes(helps))
      .filter(p.ok);
    if (ranked) return list.filter((t) => t.id in ranked).sort((a, b) => ranked[a.id] - ranked[b.id]);
    return list.sort((a, b) => Number(goodFit(b)) - Number(goodFit(a)) || a.price_monthly_typical - b.price_monthly_typical);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tools, ranked, biz, type, helps, price, profile]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 4 ? p : [...p, id]));
  const byId = Object.fromEntries((tools || []).map((t) => [t.id, t]));
  const anyFilter = biz || type || helps || price !== "any";

  return (
    <div className="min-h-dvh pb-32">
      {me !== undefined && <AppHeader loggedOut={!me} businessName={me?.business?.name} isDemo={me?.user.is_demo} />}
      <main className="page-wrap pt-8">
        <PageHeader
          eyebrow="Discover"
          title="Find AI tools for your business"
          help={
            <>
              Real products we checked by hand. Search in plain words, then compare up to 4 or adopt one into your workflow.{profile && <> Tools that fit <b>{me?.business?.name}</b> come first.</>}
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

          <FilterRow label="Business" value={biz} onChange={setBiz} allLabel="Any business"
            options={CATEGORIES.filter((c) => c.id !== "other").map((c) => ({ id: c.id, label: c.label, icon: <c.icon size={13} /> }))} />
          {(moreFilters || type || helps) ? (
            <>
              <FilterRow label="Tool type" value={type} onChange={setType}
                options={types.map((c) => {
                  const m = toolType(c);
                  return { id: c, label: m.label, icon: <m.icon size={13} /> };
                })} />
              <FilterRow label="Helps with" value={helps} onChange={setHelps} options={HELPS_WITH.map((p) => ({ id: p, label: PAIN_LABEL(p) }))} />
            </>
          ) : (
            <button type="button" onClick={() => setMoreFilters(true)} className="text-xs font-semibold text-emerald-700 hover:underline">
              + More filters (tool type, what it helps with)
            </button>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 shrink-0 text-xs font-semibold text-stone-500">Price</span>
            {PRICE.map((p) => (
              <button key={p.id} onClick={() => setPrice(p.id)} className={chip(price === p.id)}>{p.label}</button>
            ))}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between text-sm text-stone-500" aria-live="polite">
          <span>{searching ? "Searching…" : ranked ? "Best matches first" : `${shown.length} tool${shown.length === 1 ? "" : "s"}`}</span>
          {anyFilter && (
            <button className="text-xs font-semibold text-emerald-700 hover:underline" onClick={() => { setBiz(null); setType(null); setHelps(null); setPrice("any"); }}>
              Clear filters
            </button>
          )}
        </div>
        {!tools ? (
          <PageState kind="loading" />
        ) : shown.length === 0 ? (
          <PageState kind="empty" message="No tools match those filters. Try clearing one." />
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {shown.map((t) => {
              const on = picked.includes(t.id);
              const m = toolType(t.category);
              return (
                <div key={t.id} className={cn("card flex flex-col p-5 transition-[border-color,box-shadow]", on && "border-emerald-500 ring-2 ring-emerald-500/20")}>
                  <div className="flex items-start gap-3">
                    <ToolIcon category={t.category} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <button onClick={() => setQuick(t)} className="text-left font-semibold leading-snug hover:underline">{t.name}</button>
                        <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                          {t.price_monthly_typical === 0 ? "Free" : <>{money(t.price_monthly_typical)}<span className="text-xs font-normal text-stone-500">/mo</span></>}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-stone-500">{m.label}</div>
                    </div>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-stone-600">{t.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {t.capability && <span className="chip">{CAPABILITY_LABEL[t.capability] || t.capability}</span>}
                    {t.free_tier && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800">Free plan</span>}
                    {goodFit(t) && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800">Fits your budget</span>}
                  </div>
                  {t.reviews && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-stone-500">
                      <Stars value={t.reviews.overall} size={12} /> ({t.reviews.count})
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4 text-xs text-stone-500">
                    <button onClick={() => setQuick(t)} className="btn-ghost px-2 py-1 text-xs">Details</button>
                    <span className="flex flex-wrap items-center justify-end gap-1">
                      <button onClick={() => toggle(t.id)} disabled={!on && picked.length >= 4} aria-pressed={on}
                        className={cn("btn px-2 py-1 text-xs", on ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")} title="Add to comparison">
                        {on ? <Check size={13} /> : <Scale size={13} />} {on ? "Comparing" : "Compare"}
                      </button>
                      <AdoptButton toolId={t.id} compact />
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

      <ToolQuickView tool={quick} onClose={closeQuick} />
    </div>
  );
}

const chip = (on: boolean) =>
  cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-400");

function FilterRow({ label, value, onChange, options, allLabel = "All" }: {
  label: string; value: string | null; onChange: (v: string | null) => void; options: { id: string; label: string; icon?: React.ReactNode }[]; allLabel?: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="w-24 shrink-0 pt-1 text-xs font-semibold text-stone-500">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => onChange(null)} className={chip(!value)}>{allLabel}</button>
        {options.map((o) => (
          <button key={o.id} onClick={() => onChange(value === o.id ? null : o.id)} className={chip(value === o.id)}>
            {o.icon}
            {o.label}
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
