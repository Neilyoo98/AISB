"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Check, Clock, Compass, ExternalLink, Footprints, Network, PlayCircle, RotateCcw, Sparkles, Zap } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Pain, Scenario, Stack, Tool, User } from "@/lib/types";
import { ToolsGraph } from "@/components/agent-graph";
import { ToolIcon } from "@/lib/tool-icons";
import { CATEGORY_LABEL, categoryOfVertical } from "@/lib/categories";
import { useAdoptions } from "@/hooks/useAdoptions";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, Stat, useTitle } from "@/components/ui";

type Task = { id: number; week: number | null; tool_id: string | null; text: string; owner: string; minutes: number; done: boolean };
type AdoptedTool = { id: string; name: string; url: string; category: string; price: number; source: "plan" | "manual" };
type Dash = {
  user: User;
  business: Business | null;
  live_runs_left: number;
  budget_ok: boolean;
  latest: null | {
    run_id: string;
    created_at: string;
    stack: Stack;
    summary: string;
    pains: Pain[];
    approved: { id: string; name: string; url: string; category: string; price: number }[];
    first_step_today: string;
    scenarios: Scenario[];
    current_tools: string[];
  };
  adopted?: AdoptedTool[];
  tasks: Task[];
  runs: { id: string; status: string; mode: string; created_at: string }[];
};

export default function Dashboard() {
  useTitle("Dashboard");
  const router = useRouter();
  const [d, setD] = useState<Dash | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const { data: adoptions } = useAdoptions();

  const load = () => {
    setErr(null);
    api<Dash>("/dashboard")
      .then((x) => {
        if (!x.business && !x.user.is_demo) router.replace("/onboard");
        else setD(x);
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (mode: "replay" | "live") => {
    setStarting(mode);
    setErr(null);
    try {
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setErr((e as Error).message);
      setStarting(null);
    }
  };

  const toggle = async (t: Task) => {
    setD((p) => p && { ...p, tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)) });
    try {
      await api(`/plan-tasks/${t.id}`, { method: "PATCH", json: { done: !t.done } });
    } catch {
      setD((p) => p && { ...p, tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, done: t.done } : x)) });
    }
  };

  if (!d)
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 pt-8">{err ? <PageState kind="error" message={err} onRetry={load} /> : <PageState kind="loading" />}</main>
      </div>
    );

  const { user, business: b, latest } = d;
  const profile = b?.profile;
  const done = d.tasks.filter((t) => t.done).length;
  const pct = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
  // Adoption setup tasks have no week: show them first under "Setup".
  const weekOf = (t: Task) => (t.week && t.week > 0 ? t.week : 0);
  const weeks = Array.from(new Set(d.tasks.map(weekOf))).sort((a, b) => a - b);
  const adoptedTools: AdoptedTool[] = d.adopted ?? (latest?.approved.map((a) => ({ ...a, source: "plan" as const })) || []);
  const scenarios = adoptions?.scenarios?.length ? adoptions.scenarios : latest?.scenarios || [];
  const category = (b?.details as { business_category?: string } | null | undefined)?.business_category || (b?.vertical ? categoryOfVertical(b.vertical) : null);
  const firstName = user.name.split(" ")[0];
  const cardLink = "card group flex flex-col items-start p-5 text-left transition-[border-color,box-shadow] hover:border-emerald-300 hover:shadow-md";

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={b?.name} isDemo={user.is_demo} />
      <main className="mx-auto max-w-6xl px-4 pt-8">
        <PageHeader
          eyebrow={`Welcome back, ${firstName}`}
          title={b?.name}
          actions={
            user.is_demo ? (
              <>
                <button onClick={() => start("replay")} disabled={!!starting} className="btn-primary">
                  {starting === "replay" ? <Spinner /> : <PlayCircle size={18} />} Watch the advisors work
                </button>
                <button
                  onClick={() => start("live")}
                  disabled={!!starting || d.live_runs_left <= 0 || !d.budget_ok}
                  className="btn-secondary"
                  title="Runs the real AI agents on this business (limited per visitor)"
                >
                  {starting === "live" ? <Spinner /> : <Zap size={16} className="text-amber-600" />} Run live with AI
                  <span className="text-xs font-normal text-stone-500">({d.live_runs_left} left)</span>
                </button>
              </>
            ) : (
              <>
                <Link href="/profile" className="btn-secondary">
                  Edit profile
                </Link>
                <button onClick={() => start("live")} disabled={!!starting || d.live_runs_left <= 0 || !d.budget_ok} className="btn-primary">
                  {starting ? <Spinner /> : <Sparkles size={18} />} New analysis
                </button>
              </>
            )
          }
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
          {category && <span className="chip">{CATEGORY_LABEL[category] || category}</span>}
          {b?.location && <span>{b.location}</span>}
          {profile && (
            <span>
              · team of {profile.employees} · tool budget {money(profile.monthly_budget)}/month
            </span>
          )}
        </div>
        {err && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </p>
        )}

        {!latest ? (
          <section className="mt-8">
            <h2 className="font-display text-xl font-bold">Get started</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <button onClick={() => (b && !user.is_demo ? start("live") : router.push("/onboard"))} disabled={!!starting} className={cardLink}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">{starting ? <Spinner /> : <Sparkles size={20} />}</span>
                <span className="mt-3 font-semibold">Run your first analysis</span>
                <span className="mt-1 text-sm text-stone-600">Advisors diagnose your business and pick tools.</span>
              </button>
              <Link href="/tools" className={cardLink}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Compass size={20} />
                </span>
                <span className="mt-3 font-semibold">Browse AI tools</span>
                <span className="mt-1 text-sm text-stone-600">Search, filter and compare real tools.</span>
              </Link>
              <Link href="/agents" className={cardLink}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <Network size={20} />
                </span>
                <span className="mt-3 font-semibold">See how agents work</span>
                <span className="mt-1 text-sm text-stone-600">Watch AI agents hand work to each other.</span>
              </Link>
            </div>
          </section>
        ) : (
          <>
            <section className="card relative mt-8 grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
              <div className="absolute right-3 top-3">
                <HelpTip align="right">
                  <b>Net gain</b> is estimated monthly value minus tool costs. <b>Hours saved</b> counts owner and staff time. Every number comes from a deterministic
                  calculator; the AI only estimates how much of each problem a tool removes.
                </HelpTip>
              </div>
              <Stat label="Net gain / month" value={money(latest.stack.net_monthly, { sign: true })} tone="good" sub="estimated, after tool costs" />
              <Stat label="Hours saved / month" value={`${Math.round(latest.stack.hours_saved_per_month)} h`} sub="owner + staff time" />
              <Stat
                label="Tool cost / month"
                value={money(latest.stack.monthly_cost)}
                sub={latest.stack.within_budget ? `within ${money(latest.stack.budget)} budget` : "over budget"}
                tone={latest.stack.within_budget ? "default" : "warn"}
              />
              <Stat label="Plan progress" value={`${pct}%`} sub={`${done} of ${d.tasks.length} steps done`} />
            </section>

            {scenarios.length > 0 && (
              <section className="mt-6">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="eyebrow">Stack in action</p>
                    <h2 className="font-display text-xl font-bold">Your AI tools, working together</h2>
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Link href="/agents" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                      Full view on Agents page <ArrowRight size={14} />
                    </Link>
                    <Link href={`/war-room/${latest.run_id}`} className="flex items-center gap-1 text-sm font-semibold text-stone-600 hover:underline">
                      Open the War Room <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
                <ToolsGraph
                  key={scenarios.map((x) => x.title).join("|")}
                  compact
                  scenarios={scenarios}
                  catalog={catalog}
                  approved={adoptedTools.map((a) => a.id)}
                  note={adoptions?.scenarios_status === "updating" ? "Updating with your new tool…" : null}
                />
              </section>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
              <section className="space-y-6">
                <div className="card p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-1 font-semibold">
                      Your AI stack
                      {latest.summary && <HelpTip>{latest.summary}</HelpTip>}
                    </h2>
                    <Link href={`/war-room/${latest.run_id}`} className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                      Full analysis <ArrowRight size={14} />
                    </Link>
                  </div>
                  <ul className="mt-4 divide-y divide-stone-100">
                    {adoptedTools.map((t) => {
                      const solves = Object.entries(latest.stack.picks)
                        .filter(([, tid]) => tid === t.id)
                        .map(([pid]) => latest.pains?.find((p) => p.id === pid)?.title || pid);
                      return (
                        <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                              <ToolIcon category={t.category} size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Link href={`/tools/${t.id}`} className="font-medium text-stone-900 hover:underline">
                                  {t.name}
                                </Link>
                                <a href={t.url} target="_blank" rel="noopener noreferrer" className="inline-flex text-stone-400 hover:text-stone-700" aria-label={`Visit ${t.name}`}>
                                  <ExternalLink size={12} />
                                </a>
                                <span className={cn("chip", t.source === "manual" && "border-sky-200 bg-sky-50 text-sky-800")}>{t.source === "manual" ? "Adopted" : "From plan"}</span>
                              </div>
                              {solves.length > 0 && <div className="text-xs text-stone-500">Solves: {solves.join(" · ")}</div>}
                            </div>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{t.price === 0 ? "Free" : `${money(t.price)}/month`}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <Link href="/tools" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                    Adopt another tool <ArrowRight size={14} />
                  </Link>
                </div>

                {latest.first_step_today && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                      <Footprints size={16} /> Your next step
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed text-emerald-950">{latest.first_step_today}</p>
                  </div>
                )}

                <div className="card p-6">
                  <h2 className="font-semibold">Past analyses</h2>
                  <ul className="mt-3 space-y-1">
                    {d.runs.map((r) => (
                      <li key={r.id}>
                        <Link href={`/war-room/${r.id}`} className="flex items-center justify-between rounded-lg px-2 py-2 text-sm hover:bg-stone-50">
                          <span className="flex items-center gap-2">
                            <RotateCcw size={14} className="text-stone-400" />
                            {new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                            <span className="chip">{r.mode === "live" ? "live AI" : "replay"}</span>
                          </span>
                          <span className={cn("text-xs", r.status === "complete" ? "text-emerald-700" : "text-stone-500")}>{r.status.replace("_", " ")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>

              <section className="card p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">30-day adoption plan</h2>
                  <span className="text-sm tabular-nums text-stone-500">
                    {done} of {d.tasks.length} done
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
                  <motion.div className="h-full rounded-full bg-emerald-600" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} />
                </div>
                <div className="mt-5 space-y-5">
                  {weeks.map((w) => (
                    <div key={w}>
                      <h3 className="eyebrow">{w === 0 ? "Setup" : `Week ${w}`}</h3>
                      <ul className="mt-2 space-y-1">
                        {d.tasks
                          .filter((t) => weekOf(t) === w)
                          .map((t) => (
                            <li key={t.id}>
                              <button onClick={() => toggle(t)} className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-stone-50" aria-pressed={t.done}>
                                <span
                                  className={cn(
                                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                                    t.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-stone-300 bg-white",
                                  )}
                                >
                                  {t.done && <Check size={14} strokeWidth={3} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className={cn("block text-sm leading-snug", t.done && "text-stone-400 line-through")}>{t.text}</span>
                                  <span className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                                    {t.owner} <Clock size={11} /> about {t.minutes} min
                                  </span>
                                </span>
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
