"use client";
import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeDollarSign, BookOpen, Calculator, Check, ChevronDown, ClipboardList, Hand, Search, ShieldAlert, ShieldCheck, UserCheck, Users,
} from "lucide-react";
import { cn, money } from "@/lib/api";
import type { MeshMsg, Pain, Pick, Plan, Profile, Scored, Stack, Tool } from "@/lib/types";
import type { AgentKey, AgentStatus, RunView } from "@/hooks/useRunStream";
import { HelpTip, PAIN_LABEL, VERTICAL_LABEL } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;

export const AGENTS: { key: AgentKey; name: string; role: string; icon: typeof Search }[] = [
  { key: "intake", name: "Intake Analyst", role: "Understands your business", icon: BookOpen },
  { key: "memory", name: "Memory", role: "Recalls your Constitution", icon: ClipboardList },
  { key: "diagnoser", name: "Pain Diagnostician", role: "Puts a $ figure on problems", icon: BadgeDollarSign },
  { key: "scout", name: "Tool Scouts", role: "Search the verified catalog", icon: Search },
  { key: "mesh", name: "Advisor Panel", role: "Challenges every pick", icon: Users },
  { key: "roi", name: "ROI Calculator", role: "Deterministic math", icon: Calculator },
  { key: "approval", name: "You", role: "Approve the stack", icon: Hand },
  { key: "planner", name: "Adoption Coach", role: "30-day rollout plan", icon: UserCheck },
];

export function Pipeline({ agents }: { agents: Record<AgentKey, AgentStatus> }) {
  return (
    <ol className="space-y-1">
      {AGENTS.map((a, i) => {
        const s = agents[a.key];
        return (
          <li key={a.key} className="relative flex gap-3 py-1.5">
            {i < AGENTS.length - 1 && (
              <span className={cn("absolute left-[17px] top-10 h-[calc(100%-24px)] w-px", s === "done" ? "bg-emerald-300" : "bg-stone-200")} aria-hidden />
            )}
            <span
              className={cn(
                "relative grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition-colors duration-300",
                s === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700",
                s === "working" && "border-emerald-500 bg-white text-emerald-700",
                s === "idle" && "border-stone-200 bg-stone-50 text-stone-400",
              )}
            >
              {s === "done" ? <Check size={16} strokeWidth={2.5} /> : <a.icon size={16} />}
              {s === "working" && <span className="absolute inset-0 animate-ping rounded-xl border-2 border-emerald-400 opacity-40" aria-hidden />}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className={cn("block text-sm font-semibold", s === "idle" ? "text-stone-400" : "text-stone-900")}>{a.name}</span>
              <span className="block text-xs text-stone-500">{s === "working" ? "working…" : a.role}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Section({ title, eyebrow, children, id, help }: { title: string; eyebrow: string; children: React.ReactNode; id?: string; help?: React.ReactNode }) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="scroll-mt-24"
    >
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-1 flex items-center gap-2 font-display text-xl font-bold tracking-tight sm:text-2xl">
        <span>{title}</span>
        {help && <HelpTip label={`About: ${title}`}>{help}</HelpTip>}
      </h2>
      <div className="mt-4">{children}</div>
    </motion.section>
  );
}

export function ProfileCard({ profile, memory, facts }: { profile: Profile; memory?: RunView["memory"]; facts?: RunView["facts"] }) {
  return (
    <div className="card p-5">
      <p className="text-stone-800">{profile.summary}</p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="eyebrow">Type</dt>
          <dd className="mt-1 text-sm font-medium">{VERTICAL_LABEL[profile.vertical] || profile.vertical}</dd>
        </div>
        <div>
          <dt className="eyebrow">Team</dt>
          <dd className="mt-1 text-sm font-medium">{profile.employees} people</dd>
        </div>
        <div>
          <dt className="eyebrow">Budget</dt>
          <dd className="mt-1 text-sm font-medium">{money(profile.monthly_budget)}/mo</dd>
        </div>
        <div>
          <dt className="eyebrow">Tech comfort</dt>
          <dd className="mt-1.5 flex gap-1" aria-label={`${profile.tech_comfort} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className={cn("h-2 w-5 rounded-full", n <= profile.tech_comfort ? "bg-emerald-600" : "bg-stone-200")} />
            ))}
          </dd>
        </div>
      </dl>
      {profile.current_tools.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-stone-500">Already uses:</span>
          {profile.current_tools.map((t) => (
            <span key={t} className="chip">{t.replace(/-/g, " ")}</span>
          ))}
        </div>
      )}
      {memory && (
        <div className="mt-4 rounded-xl bg-stone-50 p-3 text-sm text-stone-700">
          <span className="font-semibold">Memory: </span>
          {memory.prior_facts > 0 ? `recalled ${memory.prior_facts} facts from your Business Constitution` : "first visit, starting a new Business Constitution"}
          {facts?.length ? `; learned ${facts.length} new facts` : ""}.
          {memory.own_episodes?.length > 0 && <span> Previously adopted: {memory.own_episodes.map((e) => e.text.split(" adopted ")[1]?.split(" for ")[0]).filter(Boolean).join(", ")}.</span>}
          {memory.similar_businesses?.length > 0 && (
            <span> Similar businesses chose: {memory.similar_businesses.map((e) => e.text.split(" adopted ")[1]?.split(" for ")[0]).filter(Boolean).join(", ")}.</span>
          )}
        </div>
      )}
    </div>
  );
}

export function PainCards({ pains }: { pains: Pain[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {pains.map((p, i) => (
        <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.3, ease: EASE }} className="card flex flex-col p-5">
          <span className="chip w-fit">{PAIN_LABEL(p.tag)}</span>
          <h3 className="mt-3 font-semibold leading-snug">{p.title}</h3>
          <div className="mt-3 font-display text-3xl font-bold tabular-nums text-red-700">
            {money(p.monthly_cost_of_pain)}
            <span className="ml-1 font-sans text-sm font-medium text-stone-500">/month</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">{p.impact_explanation}</p>
          {p.evidence_quote && <blockquote className="mt-auto border-l-2 border-stone-200 pl-3 pt-3 text-xs italic text-stone-500">&ldquo;{p.evidence_quote}&rdquo;</blockquote>}
        </motion.div>
      ))}
    </div>
  );
}

export function ScoutGrid({
  pains, scouts, dropped, security = [], catalog,
}: { pains: Pain[]; scouts: RunView["scouts"]; dropped: RunView["dropped"]; security?: RunView["security"]; catalog: Record<string, Tool> }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {pains.map((p) => {
        const s = scouts[p.id];
        const drop = dropped.filter((d) => d.pain_id === p.id).flatMap((d) => d.tool_ids);
        const sec = security.find((g) => g.pain_id === p.id);
        return (
          <div key={p.id} className="card p-4">
            <div className="text-xs font-semibold text-stone-500">For: {p.title}</div>
            {!s || s.status === "working" ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Search size={14} className="animate-pulse" /> Searching the catalog…
                </div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-lg bg-stone-100" />
                ))}
              </div>
            ) : (
              <>
                <div className="mt-1 text-xs text-stone-400">Compared {s.searched.length} verified tools</div>
                <ul className="mt-3 space-y-2">
                  {s.picks.map((pk: Pick) => (
                    <li key={pk.tool_id} className="rounded-lg bg-stone-50 p-2.5">
                      <div className="text-sm font-semibold">{catalog[pk.tool_id]?.name || pk.tool_id}</div>
                      <div className="mt-0.5 text-xs leading-relaxed text-stone-600">{pk.why_fit}</div>
                    </li>
                  ))}
                </ul>
                {drop.length > 0 && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0" /> Blocked {drop.length} suggestion{drop.length > 1 ? "s" : ""} not in the verified catalog.
                  </div>
                )}
                {sec &&
                  (sec.unverified ? (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                      <ShieldAlert size={14} className="mt-0.5 shrink-0" />
                      {sec.required.join(" / ")}: no confirmed tools in our catalog yet. Picks are flagged; verify with the vendor.
                    </div>
                  ) : (
                    <div className="mt-3 flex items-start gap-2 rounded-lg bg-emerald-50 p-2 text-xs text-emerald-900">
                      <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                      Kept {sec.confirmed.length} tool{sec.confirmed.length === 1 ? "" : "s"} that confirm {sec.required.join(" / ")}.
                    </div>
                  ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const PERSONA_STYLE: Record<string, { bg: string; ring: string; initials: string }> = {
  budget_hawk: { bg: "bg-amber-100 text-amber-900", ring: "border-amber-200", initials: "BH" },
  ease_coach: { bg: "bg-sky-100 text-sky-900", ring: "border-sky-200", initials: "EC" },
  integration_checker: { bg: "bg-violet-100 text-violet-900", ring: "border-violet-200", initials: "IC" },
};
const SEV: Record<string, string> = { high: "bg-red-100 text-red-800", medium: "bg-amber-100 text-amber-800", low: "bg-stone-100 text-stone-700" };

export function MeshPanel({ mesh, catalog, waiting }: { mesh: MeshMsg[]; catalog: Record<string, Tool>; waiting: boolean }) {
  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {mesh.map((m) => {
          const st = PERSONA_STYLE[m.key] || PERSONA_STYLE.budget_hawk;
          return (
            <motion.div key={m.key} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease: EASE }} className="flex gap-3">
              <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold", st.bg)}>{st.initials}</span>
              <div className={cn("card min-w-0 flex-1 rounded-tl-md p-4", st.ring)}>
                <div className="text-sm font-semibold">{m.persona}</div>
                <p className="mt-1 text-sm leading-relaxed text-stone-800">{m.headline}</p>
                {m.critiques.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {m.critiques.map((c, i) => (
                      <li key={i} className="text-sm">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{catalog[c.tool_id]?.name || c.tool_id}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase", SEV[c.severity])}>{c.severity}</span>
                        </span>
                        <span className="mt-0.5 block text-stone-600">{c.concern}</span>
                        <span className="mt-0.5 block text-xs text-stone-500">→ {c.suggestion}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {waiting && mesh.length < 3 && (
        <div className="flex items-center gap-3 pl-1 text-sm text-stone-500">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-stone-400" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </span>
          {3 - mesh.length} advisor{3 - mesh.length > 1 ? "s" : ""} still weighing in
        </div>
      )}
    </div>
  );
}

export function StackPanel({
  pains, scored, stack, verdicts, catalog, mesh, selectable, selected, onToggle,
}: {
  pains: Pain[];
  scored: Scored[];
  stack: Stack;
  verdicts?: RunView["verdicts"];
  catalog: Record<string, Tool>;
  mesh: MeshMsg[];
  selectable: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const critiques = mesh.flatMap((m) => m.critiques);
  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-2 gap-5 p-5 sm:grid-cols-4">
        <Metric label="Net gain / month" value={money(stack.net_monthly, { sign: true })} good />
        <Metric label="Value / month" value={money(stack.monthly_value)} />
        <Metric label="Tool cost / month" value={money(stack.monthly_cost)} sub={stack.within_budget ? `budget ${money(stack.budget)}` : "over budget"} />
        <Metric label="Hours saved / month" value={`${Math.round(stack.hours_saved_per_month)}h`} />
        {verdicts?.summary && <p className="col-span-full border-t border-stone-100 pt-4 text-sm leading-relaxed text-stone-700">{verdicts.summary}</p>}
      </div>

      {pains.map((p) => {
        const rows = scored.filter((s) => s.pain_id === p.id).sort((a, b) => b.fit_score - a.fit_score);
        const compareIds = Array.from(new Set(rows.map((r) => r.tool_id))).slice(0, 4);
        return (
          <div key={p.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stone-100 bg-stone-50/60 px-4 py-3">
              <h3 className="font-semibold">{p.title}</h3>
              <span className="flex items-center gap-3 text-xs text-stone-500">
                costs you ~{money(p.monthly_cost_of_pain)}/mo
                {compareIds.length >= 2 && (
                  <Link href={`/compare?ids=${compareIds.join(",")}`} className="font-semibold text-emerald-700 hover:underline">
                    Compare
                  </Link>
                )}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-stone-500">
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-2 py-2 text-right font-medium">Price</th>
                    <th className="px-2 py-2 text-right font-medium">Value/mo</th>
                    <th className="px-2 py-2 text-right font-medium">Net/mo</th>
                    <th className="px-2 py-2 text-right font-medium">Payback</th>
                    <th className="px-4 py-2 font-medium">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const t = catalog[s.tool_id];
                    const rec = stack.picks[p.id] === s.tool_id;
                    const key = `${p.id}:${s.tool_id}`;
                    const concerns = critiques.filter((c) => c.tool_id === s.tool_id);
                    return (
                      <FragmentRow key={key}>
                        <tr className={cn("border-t border-stone-100", rec && "bg-emerald-50/50")}>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {selectable && (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 accent-emerald-700"
                                  checked={selected.has(s.tool_id)}
                                  onChange={() => onToggle(s.tool_id)}
                                  aria-label={`Include ${t?.name}`}
                                />
                              )}
                              <button onClick={() => setOpen(open === key ? null : key)} className="flex items-center gap-1 text-left font-medium hover:underline">
                                {t?.name || s.tool_id}
                                <ChevronDown size={14} className={cn("text-stone-400 transition-transform", open === key && "rotate-180")} />
                              </button>
                              {rec && <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-semibold text-white">Recommended</span>}
                            </div>
                            {(s as Scored & { security_note?: string | null }).security_note && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-800">
                                <ShieldAlert size={11} /> {(s as Scored & { security_note?: string | null }).security_note}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-3 text-right tabular-nums">{s.monthly_cost === 0 ? "Free" : money(s.monthly_cost)}</td>
                          <td className="px-2 py-3 text-right tabular-nums">{money(s.monthly_value)}</td>
                          <td className={cn("px-2 py-3 text-right font-semibold tabular-nums", s.net_monthly > 0 ? "text-emerald-700" : "text-red-700")}>{money(s.net_monthly, { sign: true })}</td>
                          <td className="px-2 py-3 text-right tabular-nums">{s.payback_days === null ? "—" : s.payback_days < 1 ? "<1 day" : `${Math.round(s.payback_days)} ${Math.round(s.payback_days) === 1 ? "day" : "days"}`}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-100">
                                <div className={cn("h-full rounded-full", s.fit_score >= 80 ? "bg-emerald-600" : s.fit_score >= 60 ? "bg-amber-500" : "bg-stone-400")} style={{ width: `${s.fit_score}%` }} />
                              </div>
                              <span className="tabular-nums text-stone-600">{s.fit_score}</span>
                            </div>
                          </td>
                        </tr>
                        {open === key && (
                          <tr className="bg-stone-50/70">
                            <td colSpan={6} className="px-4 pb-4 pt-1">
                              <div className="grid gap-4 text-sm md:grid-cols-3">
                                <div>
                                  <div className="eyebrow">Why this tool</div>
                                  <p className="mt-1 text-stone-700">{s.why_fit}</p>
                                  {verdicts?.by_tool[s.tool_id] && <p className="mt-2 text-stone-700">{verdicts.by_tool[s.tool_id]}</p>}
                                </div>
                                <div>
                                  <div className="eyebrow">How we estimated it</div>
                                  <p className="mt-1 text-stone-700">{s.estimate_reasoning}</p>
                                  <p className="mt-2 text-xs text-stone-500">
                                    Removes ~{Math.round(s.pct_time_saved * 100)}% of the time and ~{Math.round(s.pct_revenue_recovered * 100)}% of the lost revenue → {s.hours_saved_per_month}h +{" "}
                                    {money(s.revenue_recovered_monthly)} a month. Setup ≈ {t?.setup_hours}h.
                                  </p>
                                </div>
                                <div>
                                  <div className="eyebrow">Fit score breakdown</div>
                                  <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                                    {Object.entries(s.fit_breakdown).map(([k, v]) => (
                                      <li key={k} className="flex justify-between gap-2">
                                        <span className="capitalize">{k.replace("_", " ")}</span>
                                        <span className="tabular-nums">{v}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  {concerns.length > 0 && (
                                    <ul className="mt-2 space-y-1 text-xs text-stone-600">
                                      {concerns.map((c, i) => (
                                        <li key={i}>
                                          <b>{c.persona}:</b> {c.concern}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  {t && (
                                    <a href={t.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs font-semibold text-emerald-700 hover:underline">
                                      Visit {t.name} ↗
                                    </a>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      <p className="flex items-center gap-1.5 text-xs text-stone-500">
        <ShieldCheck size={14} /> Numbers from a deterministic calculator
        <HelpTip>
          Every number above comes from a deterministic calculator; the AI only estimates what share of each problem a tool removes. Prices are typical list prices as of Nov 2026. Verify before buying.
        </HelpTip>
      </p>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Metric({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-bold tabular-nums", good && "text-emerald-700")}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function PlanView({ plan, catalog }: { plan: Plan; catalog: Record<string, Tool> }) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="text-sm font-semibold text-emerald-900">Do this today</div>
        <p className="mt-1 text-emerald-950">{plan.first_step_today}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {plan.weeks.map((w) => (
          <div key={w.week} className="card p-5">
            <div className="eyebrow">Week {w.week}</div>
            <h3 className="mt-0.5 font-semibold">{w.theme}</h3>
            <ul className="mt-3 space-y-2.5">
              {w.tasks.map((t, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" />
                  <span>
                    {t.text}
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {t.owner} · {t.minutes} min{t.tool_id && catalog[t.tool_id] ? ` · ${catalog[t.tool_id].name}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {plan.success_metrics.length > 0 && (
        <div className="card p-5">
          <div className="eyebrow">How you&apos;ll know it&apos;s working</div>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {plan.success_metrics.map((m, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{m.metric}</span> <span className="text-stone-500">→ {m.target}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
