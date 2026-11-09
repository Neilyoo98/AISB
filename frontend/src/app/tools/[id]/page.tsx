"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, ExternalLink, Scale, ShieldQuestion, Sparkles } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, ReviewAgg, Risk, RiskLevel, Tool, TrustFact, User } from "@/lib/types";
import { CATEGORY_LABEL, isForAnyBusiness, toolCategories } from "@/lib/categories";
import { CAPABILITY_LABEL, ToolIcon, toolType } from "@/lib/tool-icons";
import { AdoptButton } from "@/components/adopt-button";
import { pricePlain } from "@/components/tool-quickview";
import { AppHeader, Ease, HelpTip, PAIN_LABEL, PageState, Spinner, Stars, useTitle } from "@/components/ui";

type Review = { id: number; role: string; output_quality: number; reliability: number; support: number; text: string; verified_use: boolean; is_demo: boolean; business_name: string | null; vertical: string | null; created_at: string };
type Detail = { tool: Tool; aggregate: ReviewAgg | null; reviews: Review[]; can_review: boolean; my_review: boolean; verified_eligible: boolean; risk?: Risk };

const TRUST_LABEL: Record<string, string> = {
  soc2: "SOC 2 report",
  hipaa: "HIPAA",
  gdpr: "GDPR",
  iso27001: "ISO 27001",
  no_training_on_customer_data: "Doesn't train AI on your data",
  retention: "Data retention policy",
  data_residency: "Where data is stored",
  opt_out: "Can opt out of data use",
};
const RISK_LABEL: Record<string, string> = {
  hallucination: "Makes things up",
  bias: "Unfair or biased output",
  prompt_injection: "Can be tricked by outside text",
  data_exfiltration: "Could leak your data",
};
const LEVEL_STYLE: Record<RiskLevel, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800",
  not_assessed: "border-stone-200 bg-stone-50 text-stone-500",
};

export default function ToolPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ user: User; business: Business | null } | null | undefined>(undefined);
  const [tab, setTab] = useState<"overview" | "trust" | "reviews">("overview");
  const [alts, setAlts] = useState<string[]>([]);
  useTitle(d?.tool.name || "Tool");

  const load = () =>
    api<Detail>(`/tools/${id}`)
      .then((x) => {
        setD(x);
        api<Tool[]>("/catalog").then((all) =>
          setAlts(all.filter((t) => t.id !== id && t.solves.some((s) => x.tool.solves[0] === s)).slice(0, 2).map((t) => t.id)),
        );
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    load();
    fetch("/api/me", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const t = d?.tool;
  return (
    <div className="min-h-dvh pb-16">
      {me !== undefined && <AppHeader loggedOut={!me} businessName={me?.business?.name} isDemo={me?.user.is_demo} />}
      <main className="page-wrap pt-6">
        <nav className="text-sm text-stone-500" aria-label="Breadcrumb">
          <Link href="/tools" className="hover:underline">Discover</Link> <span aria-hidden>/</span> <span className="text-stone-800">{t?.name || "…"}</span>
        </nav>
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !d || !t ? (
          <PageState kind="loading" />
        ) : (
          <>
            {/* Concise summary first: what it is, who it's for, price, link */}
            <section className="card mt-4 p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-4">
                  <ToolIcon category={t.category} size={56} />
                  <div className="min-w-0">
                    <h1 className="font-display text-3xl font-bold tracking-tight">{t.name}</h1>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="chip">{toolType(t.category).label}</span>
                      {t.capability && <span className="chip">{CAPABILITY_LABEL[t.capability] || t.capability}</span>}
                      {t.free_tier && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800">Free plan</span>}
                      {d.aggregate && (
                        <span className="flex items-center gap-1 text-stone-600"><Stars value={d.aggregate.overall} size={13} /> ({d.aggregate.count})</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  <a href={t.url} target="_blank" rel="noopener noreferrer" className="btn-primary">
                    Visit {t.name.replace(/ \(.*\)$/, "")} <ExternalLink size={14} />
                  </a>
                  <AdoptButton toolId={t.id} />
                </div>
              </div>
              <p className="mt-5 text-lg leading-relaxed text-stone-800">{t.description}</p>
              <dl className="mt-5 grid gap-4 border-t border-stone-100 pt-5 text-sm sm:grid-cols-3">
                <div>
                  <dt className="eyebrow">Best for</dt>
                  <dd className="mt-1 font-medium">{isForAnyBusiness(t) ? "Any business" : toolCategories(t).map((c) => CATEGORY_LABEL[c]).join(", ")}</dd>
                </div>
                <div>
                  <dt className="eyebrow flex items-center gap-1">Price <HelpTip>Typical list price as of Nov 2026. Check the vendor&apos;s site before buying.</HelpTip></dt>
                  <dd className="mt-1 font-medium">{pricePlain(t)}</dd>
                </div>
                <div>
                  <dt className="eyebrow">Setup</dt>
                  <dd className="mt-1 flex items-center gap-2 font-medium">about {t.setup_hours} hour{t.setup_hours === 1 ? "" : "s"} <Ease n={t.tech_comfort_min} /></dd>
                </div>
              </dl>
            </section>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-stone-200">
              <div role="tablist" className="flex gap-1">
                {([["overview", "Overview"], ["trust", "Trust & risk"], ["reviews", d.aggregate ? `Reviews (${d.aggregate.count})` : "Reviews"]] as const).map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === k ? "border-emerald-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800")}>
                    {l}
                  </button>
                ))}
              </div>
              {alts.length > 0 && (
                <Link href={`/compare?ids=${[t.id, ...alts].join(",")}`} className="mb-2 flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                  <Scale size={14} /> Compare with similar tools
                </Link>
              )}
            </div>

            {tab === "overview" && (
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <section>
                  <h2 className="eyebrow">What the AI does</h2>
                  <ul className="mt-2 space-y-1.5">{t.ai_features.map((a) => <li key={a} className="flex gap-2 text-sm"><Sparkles size={14} className="mt-0.5 shrink-0 text-emerald-600" /> {a}</li>)}</ul>
                </section>
                <section>
                  <h2 className="eyebrow">Helps with</h2>
                  <div className="mt-2 flex flex-wrap gap-1.5">{t.solves.map((s) => <span key={s} className="chip">{PAIN_LABEL(s)}</span>)}</div>
                  {t.integrates_with.length > 0 && (
                    <>
                      <h2 className="eyebrow mt-4">Works with</h2>
                      <p className="mt-1 text-sm capitalize text-stone-700">{t.integrates_with.join(", ").replace(/-/g, " ")}</p>
                    </>
                  )}
                </section>
                <section>
                  <h2 className="eyebrow">Pros</h2>
                  <ul className="mt-2 space-y-1 text-sm text-emerald-800">{t.pros.map((p) => <li key={p}>+ {p}</li>)}</ul>
                </section>
                <section>
                  <h2 className="eyebrow">Watch out</h2>
                  <ul className="mt-2 space-y-1 text-sm text-amber-800">{t.cons.map((p) => <li key={p}>− {p}</li>)}</ul>
                </section>
              </div>
            )}

            {tab === "trust" && (
              <div className="mt-6 space-y-6">
                <section>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">Security & privacy facts</h2>
                    <HelpTip>We only mark a fact when it comes from the vendor&apos;s own documents, with a link and date. &ldquo;Unknown&rdquo; means we haven&apos;t verified it yet, not that the vendor fails it.</HelpTip>
                  </div>
                  <div className="card mt-3 divide-y divide-stone-100">
                    {Object.entries(t.trust || {}).map(([k, v]) => <TrustRow key={k} k={k} v={v} />)}
                    <div className="flex items-center justify-between gap-4 p-4 text-sm"><span className="font-medium">Hosting</span><span className="text-stone-600">{t.deployment === "saas" ? "Cloud (SaaS)" : t.deployment === "vpc" ? "Your private cloud" : t.deployment === "on_prem" ? "On your own servers" : "—"}</span></div>
                    <div className="flex items-center justify-between gap-4 p-4 text-sm"><span className="font-medium">Public API</span><span className="text-stone-600">{t.api_available ? "Yes" : "No"}</span></div>
                  </div>
                </section>
                <section>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">AI risk check</h2>
                    <HelpTip>Levels come from what the tool is allowed to do (e.g. does it read emails, act on its own, store customer data), not from benchmark scores. &ldquo;Not assessed&rdquo; means we don&apos;t have enough facts.</HelpTip>
                  </div>
                  {d.risk && Object.keys(d.risk).length ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {Object.entries(d.risk).map(([k, r]) => r && (
                        <div key={k} className="card p-4">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{RISK_LABEL[k] || k}</span>
                            <span className={cn("chip capitalize", LEVEL_STYLE[r.level])}>{r.level.replace("_", " ")}</span>
                          </div>
                          <p className="mt-2 text-sm text-stone-700">{r.reason}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-stone-500">Not assessed yet.</p>
                  )}
                </section>
              </div>
            )}

            {tab === "reviews" && <Reviews d={d} onPosted={load} />}
          </>
        )}
      </main>
    </div>
  );
}

function TrustRow({ k, v }: { k: string; v: TrustFact }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{TRUST_LABEL[k] || k.replace(/_/g, " ")}</div>
        {v.status === "unknown" ? (
          <span className="chip text-stone-500"><ShieldQuestion size={12} /> Unknown</span>
        ) : (
          <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800">{v.status === "verified" ? "Verified" : "Vendor says yes"}{v.as_of ? ` · ${v.as_of}` : ""}</span>
        )}
      </div>
      {v.status !== "unknown" && (v.quote || v.source_url) && (
        <div className="mt-2 text-xs text-stone-600">
          {v.quote && <q className="italic">{v.quote}</q>}{" "}
          {v.source_url && <a href={v.source_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">Source ↗</a>}
        </div>
      )}
    </div>
  );
}

function Reviews({ d, onPosted }: { d: Detail; onPosted: () => void }) {
  const [form, setForm] = useState({ output_quality: 0, reliability: 0, support: 0, role: "Owner", text: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = d.aggregate;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.output_quality || !form.reliability || !form.support) return setErr("Please rate all three.");
    setBusy(true);
    setErr(null);
    try {
      await api(`/tools/${d.tool.id}/reviews`, { method: "POST", json: form });
      onPosted();
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[260px_1fr] [&>*]:min-w-0">
      <aside className="space-y-3">
        {a ? (
          <div className="card p-5">
            <div className="font-display text-4xl font-bold">{a.overall.toFixed(1)}<span className="text-base font-normal text-stone-500"> / 5</span></div>
            <Stars value={a.overall} />
            <div className="mt-1 text-xs text-stone-500">{a.count} review{a.count > 1 ? "s" : ""}</div>
            <dl className="mt-4 space-y-1.5 text-sm">
              {([["Output quality", a.output_quality], ["Reliability", a.reliability], ["Support", a.support]] as const).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between"><dt className="text-stone-600">{k}</dt><dd className="flex items-center gap-1.5"><Stars value={v} size={12} /> {v.toFixed(1)}</dd></div>
              ))}
            </dl>
          </div>
        ) : (
          <div className="card p-5 text-sm text-stone-600">No reviews yet. Owners who adopt this tool can share how it went.</div>
        )}
        <p className="flex items-start gap-1 text-xs text-stone-500">
          About &ldquo;verified use&rdquo;
          <HelpTip>A review is marked <b>Verified use</b> when the reviewer&apos;s business had this tool in its StackSmith stack for at least 14 days.</HelpTip>
        </p>
      </aside>
      <div className="space-y-4">
        {d.can_review && (
          <form onSubmit={submit} className="card space-y-3 p-5">
            <h2 className="font-semibold">{d.my_review ? "Update your review" : "Review this tool"}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["output_quality", "reliability", "support"] as const).map((k) => (
                <div key={k}>
                  <div className="text-xs font-medium capitalize text-stone-600">{k.replace("_", " ")} (1–5)</div>
                  <div className="mt-1 flex gap-1" role="radiogroup" aria-label={k.replace("_", " ")}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button type="button" key={n} role="radio" aria-checked={form[k] === n} onClick={() => setForm({ ...form, [k]: n })}
                        className={cn("h-8 w-8 rounded-lg border text-sm font-semibold", form[k] >= n ? "border-amber-400 bg-amber-50 text-amber-800" : "border-stone-200 text-stone-400")}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <textarea className="input min-h-[80px]" maxLength={1500} placeholder="What changed for your business? (optional)" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            {!d.verified_eligible && <p className="text-xs text-stone-500">Your review shows without the &ldquo;Verified use&rdquo; badge until this tool has been in your stack for 14 days.</p>}
            {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner /> : "Post review"}</button>
          </form>
        )}
        {d.reviews.map((r) => (
          <article key={r.id} className="card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Stars value={(r.output_quality + r.reliability + r.support) / 3} size={13} />
              <span className="text-sm font-semibold">{r.role}{r.business_name ? `, ${r.business_name}` : ""}</span>
              {r.verified_use && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800"><BadgeCheck size={12} /> Verified use</span>}
              {r.is_demo && <span className="chip border-amber-200 bg-amber-50 text-amber-800">From a sample business account</span>}
            </div>
            {r.text && <p className="mt-2 text-sm leading-relaxed text-stone-700">{r.text}</p>}
            <div className="mt-2 text-xs text-stone-400">
              {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
