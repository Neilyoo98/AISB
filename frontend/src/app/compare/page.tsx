"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Plus, Save, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { AppHeader, Ease, HelpTip, PageHeader, PageState, Stars, useTitle } from "@/components/ui";

type Crit = { score: number; no_data: boolean; why: string };
type TCO = { monthly: number; subscription: number; usage: number; setup: number; hosting: number; total: number; months: number };
type Result = {
  id: string;
  score: { criteria: Record<string, Crit>; total: number; integration: { links: { tool: string; status: string }[]; native: number; via_zapier_or_make: number; none: number; total: number; missing: string[] } };
  tco_12: TCO;
  tco_36: TCO;
};
type Eval = { results: Result[]; weights: Record<string, number>; personalized: boolean; business_name: string | null; current_tools: string[]; hourly_cost: number };

const CRIT_LABEL: Record<string, string> = { cost: "Cost", ease: "Ease of use", fit: "Fit with your tools", security: "Security", scalability: "Scalability", support: "Support" };
const PRESET_LABEL: Record<string, string> = { balanced: "Balanced", budget_first: "Budget first", security_first: "Security first" };
const TRUST_LABEL: Record<string, string> = { no_training_on_customer_data: "No training on your data", soc2: "SOC 2" };

function CompareInner() {
  useTitle("Compare tools");
  const router = useRouter();
  const ids = (useSearchParams().get("ids") || "").split(",").filter(Boolean).slice(0, 4);
  const idKey = ids.join(",");
  const [tools, setTools] = useState<Record<string, Tool> | null>(null);
  const [me, setMe] = useState<{ user: User; business: Business | null } | null | undefined>(undefined);
  const [presets, setPresets] = useState<Record<string, Record<string, number>>>({});
  const [criteria, setCriteria] = useState<string[]>([]);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [seats, setSeats] = useState(1);
  const [usage, setUsage] = useState(0);
  const [horizon, setHorizon] = useState<12 | 36>(12);
  const [ev, setEv] = useState<Eval | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (ids.length) api<Record<string, Tool>>(`/catalog?ids=${idKey}`).then(setTools);
    fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
    api<{ saved: Record<string, number> | null; presets: Record<string, Record<string, number>>; criteria: string[] }>("/businesses/me/weights").then((w) => {
      setPresets(w.presets);
      setCriteria(w.criteria);
      setWeights(w.saved || w.presets.balanced);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  useEffect(() => {
    if (!weights || ids.length < 1) return;
    const id = setTimeout(() => {
      api<Eval>("/evaluate", { method: "POST", json: { ids, weights, seats, usage_per_month: usage } }).then(setEv);
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, weights, seats, usage]);

  const res = useMemo(() => Object.fromEntries((ev?.results || []).map((r) => [r.id, r])), [ev]);
  const list = ids.filter((i) => tools?.[i]);
  const best = (vals: number[], high = true) => (high ? Math.max(...vals) : Math.min(...vals));
  const remove = (id: string) => router.replace(`/compare?ids=${ids.filter((x) => x !== id).join(",")}`);
  const hasUsage = list.some((i) => tools?.[i]?.pricing_model === "usage");
  const hasSeats = list.some((i) => tools?.[i]?.pricing_model === "per_seat");

  const saveWeights = async () => {
    if (!weights) return;
    await api("/businesses/me/weights", { method: "PUT", json: { weights } });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  if (ids.length < 2)
    return (
      <div className="min-h-dvh">
        {me !== undefined && <AppHeader loggedOut={!me} />}
        <PageState kind="empty" message="Pick 2 to 4 tools to compare.">
          <Link href="/tools" className="btn-primary mt-4">Browse tools</Link>
        </PageState>
      </div>
    );

  const totals = list.map((i) => res[i]?.score.total ?? 0);
  const tcoKey = horizon === 12 ? "tco_12" : "tco_36";
  const tcos = list.map((i) => res[i]?.[tcoKey]?.total ?? 0);
  const maxTco = Math.max(1, ...tcos);

  return (
    <div className="min-h-dvh pb-16">
      {me !== undefined && <AppHeader loggedOut={!me} businessName={me?.business?.name} isDemo={me?.user.is_demo} />}
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Compare"
          title="Side-by-side comparison"
          help={
            <>
              Scores come from catalog facts and reviews through a fixed formula, not AI guesses. Move the sliders to weight what matters to you.
              Weights are rebalanced to total 100%. Grey &ldquo;no data&rdquo; scores are neutral placeholders until we can verify the fact.
              {ev?.personalized ? <> Personalized for <b>{ev.business_name}</b>.</> : <> Log in to personalize fit and cost to your business.</>}
            </>
          }
          actions={list.length < 4 && <Link href="/tools" className="btn-secondary"><Plus size={16} /> Add a tool</Link>}
        />

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:h-fit">
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">What matters to you</h2>
                <HelpTip align="right">Each criterion is scored 0–10. Your weights decide how much each one counts toward the overall score.</HelpTip>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.keys(presets).map((k) => (
                  <button key={k} onClick={() => setWeights(presets[k])} className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium hover:border-stone-400">{PRESET_LABEL[k] || k}</button>
                ))}
              </div>
              <div className="mt-4 space-y-3">
                {criteria.map((c) => (
                  <label key={c} className="block">
                    <span className="flex justify-between text-xs font-medium text-stone-700">
                      {CRIT_LABEL[c]} <span className="tabular-nums text-stone-500">{ev?.weights[c] ?? weights?.[c] ?? 0}%</span>
                    </span>
                    <input type="range" min={0} max={100} step={5} value={weights?.[c] ?? 0} onChange={(e) => setWeights({ ...(weights || {}), [c]: Number(e.target.value) })} className="mt-1 w-full accent-emerald-700" />
                  </label>
                ))}
              </div>
              {me?.business && (
                <button onClick={saveWeights} className="btn-secondary mt-4 w-full py-2 text-xs">{saved ? <><Check size={14} /> Saved</> : <><Save size={14} /> Save as my default</>}</button>
              )}
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Total cost of ownership</h2>
                <HelpTip align="right">Subscription (plus extra seats or usage beyond the plan) + one-time setup time at {money(ev?.hourly_cost ?? 25)}/hour. Prices are typical list prices as of Nov 2026; verify before buying.</HelpTip>
              </div>
              <div className="mt-3 grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-xs font-semibold">
                {([12, 36] as const).map((h) => (
                  <button key={h} onClick={() => setHorizon(h)} className={cn("rounded-md py-1.5", horizon === h ? "bg-white shadow-sm" : "text-stone-500")}>{h} months</button>
                ))}
              </div>
              {hasSeats && (
                <label className="mt-3 block text-xs font-medium text-stone-700">
                  People using it
                  <input type="number" min={1} max={500} value={seats} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} className="input mt-1" />
                </label>
              )}
              {hasUsage && (
                <label className="mt-3 block text-xs font-medium text-stone-700">
                  Calls / units per month
                  <input type="number" min={0} value={usage} onChange={(e) => setUsage(Math.max(0, Number(e.target.value) || 0))} className="input mt-1" />
                </label>
              )}
            </div>
          </aside>

          {!tools || !ev ? (
            <PageState kind="loading" />
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-stone-100">
                    <th className="w-44" />
                    {list.map((i) => (
                      <th key={i} className="px-4 py-4 text-left align-top">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/tools/${i}`} className="font-semibold hover:underline">{tools[i].name}</Link>
                          <button onClick={() => remove(i)} className="text-stone-400 hover:text-stone-700" aria-label={`Remove ${tools[i].name}`}><X size={14} /></button>
                        </div>
                        <div className="mt-1 text-xs font-normal capitalize text-stone-500">{tools[i].category.replace(/_/g, " ")}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Overall score" help="Weighted average of the six criteria below, out of 10.">
                    {list.map((i, k) => (
                      <td key={i} className={cell(totals[k] === best(totals))}>
                        <span className="font-display text-2xl font-bold tabular-nums">{res[i]?.score.total.toFixed(1)}</span><span className="text-xs text-stone-500"> /10</span>
                      </td>
                    ))}
                  </Row>
                  {criteria.map((c) => {
                    const vals = list.map((i) => res[i]?.score.criteria[c]?.score ?? 0);
                    return (
                      <Row key={c} label={CRIT_LABEL[c]} sub>
                        {list.map((i, k) => {
                          const cr = res[i]?.score.criteria[c];
                          return (
                            <td key={i} className={cell(!cr?.no_data && vals[k] === best(vals))}>
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100"><div className={cn("h-full rounded-full", cr?.no_data ? "bg-stone-300" : "bg-emerald-600")} style={{ width: `${(cr?.score ?? 0) * 10}%` }} /></div>
                                <span className={cn("tabular-nums", cr?.no_data && "text-stone-400")}>{cr?.score.toFixed(1)}</span>
                              </div>
                              <div className={cn("mt-0.5 text-xs", cr?.no_data ? "italic text-stone-400" : "text-stone-500")}>{cr?.no_data ? `no data · ${cr.why}` : cr?.why}</div>
                            </td>
                          );
                        })}
                      </Row>
                    );
                  })}
                  <Row label={`Cost over ${horizon} months`} help="Subscription + extra seats/usage + one-time setup time.">
                    {list.map((i, k) => {
                      const t = res[i]?.[tcoKey];
                      return (
                        <td key={i} className={cell(tcos[k] === best(tcos, false))}>
                          <div className="font-semibold tabular-nums">{money(t?.total)}</div>
                          <div className="mt-1.5 flex h-2 w-full max-w-[160px] overflow-hidden rounded-full bg-stone-100" aria-hidden>
                            <span className="bg-emerald-600" style={{ width: `${((t?.subscription ?? 0) / maxTco) * 100}%` }} />
                            <span className="bg-amber-500" style={{ width: `${((t?.usage ?? 0) / maxTco) * 100}%` }} />
                            <span className="bg-sky-400" style={{ width: `${((t?.setup ?? 0) / maxTco) * 100}%` }} />
                          </div>
                          <div className="mt-1 text-[11px] text-stone-500">{money(t?.subscription)} plan{t?.usage ? ` · ${money(t.usage)} usage` : ""} · {money(t?.setup)} setup</div>
                        </td>
                      );
                    })}
                  </Row>
                  <Row label="Price">
                    {list.map((i) => {
                      const t = tools[i];
                      return (
                        <td key={i} className={cell(false)}>
                          {t.price_monthly_typical === 0 ? "Free" : `${money(t.price_monthly_typical)}/mo`}
                          <div className="text-xs text-stone-500">
                            {t.pricing_model === "per_seat" ? `${money(t.unit_price)}/extra seat` : t.pricing_model === "usage" ? `${t.units_included} ${t.unit}s incl., then $${(t.unit_price ?? 0).toFixed(2)}/${t.unit}` : "flat"}
                            {t.free_tier ? " · free plan" : ""}
                          </div>
                        </td>
                      );
                    })}
                  </Row>
                  <Row label="Works with your tools" help="Native = built-in connection. Via Zapier/Make = possible with an automation tool. Missing = you'd re-type data.">
                    {list.map((i) => {
                      const g = res[i]?.score.integration;
                      return (
                        <td key={i} className={cell(false)}>
                          {!g || g.total === 0 ? (
                            <span className="text-xs text-stone-400">{ev.personalized ? "No current tools on file" : "Log in to check"}</span>
                          ) : (
                            <>
                              <span className={cn("chip", g.none === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800")}>{g.native}/{g.total} native</span>
                              <ul className="mt-1.5 space-y-0.5 text-xs">
                                {g.links.map((l) => (
                                  <li key={l.tool} className={l.status === "native" ? "text-emerald-800" : l.status === "none" ? "text-stone-400" : "text-amber-800"}>
                                    {l.status === "native" ? "✓" : l.status === "none" ? "✗" : "~"} {l.tool.replace(/-/g, " ")}
                                  </li>
                                ))}
                              </ul>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </Row>
                  <Row label="Reviews">
                    {list.map((i) => {
                      const r = tools[i].reviews;
                      return <td key={i} className={cell(false)}>{r ? <span className="flex items-center gap-1.5"><Stars value={r.overall} size={12} /> <span className="text-xs text-stone-500">{r.overall.toFixed(1)} ({r.count})</span></span> : <span className="text-xs text-stone-400">none yet</span>}</td>;
                    })}
                  </Row>
                  <Row label="Trust" help="Shown only when sourced from the vendor's own documents. “Unknown” means we haven't verified it yet, not that it's false.">
                    {list.map((i) => (
                      <td key={i} className={cell(false)}>
                        <ul className="space-y-0.5 text-xs">
                          {Object.entries(tools[i].trust || {}).map(([k, v]) => (
                            <li key={k} className={v.status === "unknown" ? "text-stone-400" : "text-emerald-800"}>{TRUST_LABEL[k] || k}: {v.status.replace("_", " ")}</li>
                          ))}
                        </ul>
                      </td>
                    ))}
                  </Row>
                  <Row label="Setup & ease">
                    {list.map((i) => <td key={i} className={cell(false)}><div className="flex items-center gap-2">~{tools[i].setup_hours}h <Ease n={tools[i].tech_comfort_min} /></div></td>)}
                  </Row>
                  <Row label="Deployment · API">
                    {list.map((i) => <td key={i} className={cell(false)}><span className="uppercase">{tools[i].deployment}</span> · {tools[i].api_available ? "API available" : "no public API"}</td>)}
                  </Row>
                  <Row label="Watch out">
                    {list.map((i) => <td key={i} className={cell(false)}><ul className="space-y-0.5 text-xs text-amber-800">{tools[i].cons.map((c) => <li key={c}>− {c}</li>)}</ul></td>)}
                  </Row>
                </tbody>
              </table>
              <p className="border-t border-stone-100 px-5 py-3 text-xs text-stone-500">Green = best in this comparison.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const cell = (best: boolean) => cn("px-4 py-3 align-top text-stone-800", best && "bg-emerald-50/70");

function Row({ label, help, sub, children }: { label: string; help?: string; sub?: boolean; children: React.ReactNode }) {
  return (
    <tr className="border-t border-stone-100">
      <th className={cn("px-5 py-3 text-left align-top text-xs font-semibold", sub ? "pl-8 font-medium text-stone-500" : "text-stone-600")}>
        <span className="inline-flex items-center gap-1">{label}{help && <HelpTip>{help}</HelpTip>}</span>
      </th>
      {children}
    </tr>
  );
}

export default function ComparePage() {
  return (
    <Suspense>
      <CompareInner />
    </Suspense>
  );
}
