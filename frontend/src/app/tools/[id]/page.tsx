"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BadgeCheck, ExternalLink, Scale, ShieldQuestion, Sparkles } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, ReviewAgg, Tool, User } from "@/lib/types";
import { AppHeader, Ease, HelpTip, PAIN_LABEL, PageState, Spinner, Stars, VERTICAL_LABEL, useTitle } from "@/components/ui";

type Review = { id: number; role: string; output_quality: number; reliability: number; support: number; text: string; verified_use: boolean; is_demo: boolean; business_name: string | null; vertical: string | null; created_at: string };
type Detail = { tool: Tool; aggregate: ReviewAgg | null; reviews: Review[]; can_review: boolean; my_review: boolean; verified_eligible: boolean };

const TRUST_LABEL: Record<string, string> = { no_training_on_customer_data: "Does not train AI on your data", soc2: "SOC 2 report" };

export default function ToolPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<{ user: User; business: Business | null } | null | undefined>(undefined);
  const [tab, setTab] = useState<"overview" | "reviews" | "trust">("overview");
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
      <main className="mx-auto max-w-5xl px-4 pt-6">
        <nav className="text-sm text-stone-500" aria-label="Breadcrumb">
          <Link href="/tools" className="hover:underline">Discover</Link> <span aria-hidden>/</span> <span className="text-stone-800">{t?.name || "…"}</span>
        </nav>
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !d || !t ? (
          <PageState kind="loading" />
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t.name}</h1>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
                  <span className="chip capitalize">{t.category.replace(/_/g, " ")}</span>
                  {t.capability && <span className="chip capitalize">{t.capability.replace(/_/g, " ")}</span>}
                  {d.aggregate ? <span className="flex items-center gap-1.5"><Stars value={d.aggregate.overall} /> {d.aggregate.overall.toFixed(1)} ({d.aggregate.count})</span> : <span className="text-stone-400">No reviews yet</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`/compare?ids=${[t.id, ...alts].join(",")}`} className="btn-secondary"><Scale size={16} /> Compare with similar</Link>
                <a href={t.url} target="_blank" rel="noopener noreferrer" className="btn-primary">Visit site <ExternalLink size={14} /></a>
              </div>
            </div>

            <div role="tablist" className="mt-6 flex gap-1 border-b border-stone-200">
              {([["overview", "Overview"], ["reviews", `Reviews${d.aggregate ? ` (${d.aggregate.count})` : ""}`], ["trust", "Trust & security"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === k ? "border-emerald-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800")}>
                  {l}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <div className="mt-6 grid gap-6 md:grid-cols-[1fr_280px]">
                <div className="space-y-5">
                  <p className="text-lg leading-relaxed text-stone-800">{t.description}</p>
                  <section>
                    <h2 className="eyebrow">What the AI does</h2>
                    <ul className="mt-2 space-y-1.5">{t.ai_features.map((a) => <li key={a} className="flex gap-2 text-sm"><Sparkles size={14} className="mt-0.5 shrink-0 text-emerald-600" /> {a}</li>)}</ul>
                  </section>
                  {t.workflows && (
                    <section>
                      <h2 className="eyebrow">Jobs it takes off your plate</h2>
                      <div className="mt-2 flex flex-wrap gap-1.5">{t.workflows.map((w) => <span key={w} className="chip">{w}</span>)}</div>
                    </section>
                  )}
                  <section className="grid gap-4 sm:grid-cols-2">
                    <div><h2 className="eyebrow">Pros</h2><ul className="mt-2 space-y-1 text-sm text-emerald-800">{t.pros.map((p) => <li key={p}>+ {p}</li>)}</ul></div>
                    <div><h2 className="eyebrow">Watch out</h2><ul className="mt-2 space-y-1 text-sm text-amber-800">{t.cons.map((p) => <li key={p}>− {p}</li>)}</ul></div>
                  </section>
                </div>
                <aside className="card h-fit divide-y divide-stone-100 text-sm">
                  <Fact k="Typical price" v={t.price_monthly_typical === 0 ? "Free" : `${money(t.price_monthly_typical)}/mo`} help="Typical list price as of Nov 2026. Verify on the vendor's site before buying." />
                  <Fact k="Pricing" v={t.pricing_model === "per_seat" ? `${money(t.unit_price)} per extra seat` : t.pricing_model === "usage" ? `${t.units_included} ${t.unit}s included, then $${(t.unit_price ?? 0).toFixed(2)}/${t.unit}` : "Flat monthly"} />
                  <Fact k="Free plan" v={t.free_tier ? "Yes" : "No"} />
                  <Fact k="Setup" v={`~${t.setup_hours} hours`} />
                  <Fact k="Tech comfort" v={<Ease n={t.tech_comfort_min} />} />
                  <Fact k="Best for" v={t.verticals.map((v) => (v === "all" ? "Any business" : VERTICAL_LABEL[v])).join(", ")} />
                  <Fact k="Solves" v={t.solves.map(PAIN_LABEL).join(", ")} />
                  <Fact k="Connects with" v={t.integrates_with.join(", ").replace(/-/g, " ")} />
                  <Fact k="Works with" v={`${(t.modalities_in || []).join(", ")} → ${(t.modalities_out || []).join(", ")}`} />
                </aside>
              </div>
            )}

            {tab === "reviews" && <Reviews d={d} onPosted={load} />}

            {tab === "trust" && (
              <div className="mt-6 space-y-4">
                <div className="card divide-y divide-stone-100">
                  {Object.entries(t.trust || {}).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 p-4">
                      <div className="text-sm font-medium">{TRUST_LABEL[k] || k}</div>
                      {v.status === "unknown" ? (
                        <span className="chip text-stone-500"><ShieldQuestion size={12} /> Unknown</span>
                      ) : (
                        <a href={v.source_url || "#"} target="_blank" rel="noopener noreferrer" className="chip border-emerald-200 bg-emerald-50 text-emerald-800">
                          {v.status === "verified" ? "Verified" : "Vendor claims"} · {v.as_of}
                        </a>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-4 p-4 text-sm"><span className="font-medium">Deployment</span><span className="uppercase text-stone-600">{t.deployment}</span></div>
                  <div className="flex items-center justify-between gap-4 p-4 text-sm"><span className="font-medium">Public API</span><span className="text-stone-600">{t.api_available ? "Yes" : "No"}</span></div>
                </div>
                <p className="flex items-start gap-2 text-sm text-stone-600">
                  We only show security facts we can source from the vendor&apos;s own documents, with a link and date.
                  <HelpTip>&ldquo;Unknown&rdquo; means we haven&apos;t verified it yet, not that the vendor fails it. Ask the vendor for their SOC 2 report and data-use policy before sharing customer data.</HelpTip>
                </p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Fact({ k, v, help }: { k: string; v: React.ReactNode; help?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5">
      <span className="flex items-center gap-1 text-stone-500">{k}{help && <HelpTip align="right">{help}</HelpTip>}</span>
      <span className="text-right font-medium text-stone-800">{v}</span>
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
    <div className="mt-6 grid gap-6 md:grid-cols-[280px_1fr]">
      <aside className="space-y-4">
        <div className="card p-5">
          {a ? (
            <>
              <div className="font-display text-4xl font-bold">{a.overall.toFixed(1)}</div>
              <Stars value={a.overall} />
              <div className="mt-1 text-xs text-stone-500">{a.count} review{a.count > 1 ? "s" : ""} · {a.verified} verified use</div>
              <dl className="mt-4 space-y-1.5 text-sm">
                {([["Output quality", a.output_quality], ["Reliability", a.reliability], ["Support", a.support]] as const).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between"><dt className="text-stone-600">{k}</dt><dd className="flex items-center gap-1.5"><Stars value={v} size={12} /> {v.toFixed(1)}</dd></div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-sm text-stone-500">No reviews yet.</p>
          )}
        </div>
        <p className="flex items-start gap-1 text-xs text-stone-500">
          About “verified use”
          <HelpTip>A review is marked <b>Verified use</b> when the reviewer&apos;s business approved this tool in a StackSmith plan at least 14 days earlier.</HelpTip>
        </p>
      </aside>
      <div className="space-y-4">
        {d.can_review && (
          <form onSubmit={submit} className="card space-y-3 p-5">
            <h2 className="font-semibold">{d.my_review ? "Update your review" : "Review this tool"}</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["output_quality", "reliability", "support"] as const).map((k) => (
                <div key={k}>
                  <div className="text-xs font-medium capitalize text-stone-600">{k.replace("_", " ")}</div>
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
            {!d.verified_eligible && <p className="text-xs text-stone-500">Your review will show without the “Verified use” badge until you&apos;ve had this tool in an approved plan for 14 days.</p>}
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
              {r.is_demo && <span className="chip border-amber-200 bg-amber-50 text-amber-800">Sample review (demo data)</span>}
            </div>
            {r.text && <p className="mt-2 text-sm leading-relaxed text-stone-700">{r.text}</p>}
            <div className="mt-2 text-xs text-stone-400">
              Quality {r.output_quality}/5 · Reliability {r.reliability}/5 · Support {r.support}/5 · {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
