"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Check, Clock, ExternalLink, Footprints, PlayCircle, RotateCcw, Sparkles, Zap } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Pain, Scenario, Stack, Tool, User } from "@/lib/types";
import { StackFlow } from "@/components/stack-flow";
import { AppHeader, Spinner, Stat, VERTICAL_LABEL } from "@/components/ui";

type Task = { id: number; week: number; tool_id: string | null; text: string; owner: string; minutes: number; done: boolean };
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
  tasks: Task[];
  runs: { id: string; status: string; mode: string; created_at: string }[];
};

export default function Dashboard() {
  const router = useRouter();
  const [d, setD] = useState<Dash | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});

  useEffect(() => {
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
  }, []);

  useEffect(() => {
    api<Dash>("/dashboard")
      .then((x) => {
        if (!x.business && !x.user.is_demo) router.replace("/onboard");
        else setD(x);
      })
      .catch((e) => setErr(e.message));
  }, [router]);

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
        <div className="grid place-items-center py-32 text-stone-500">{err ? <p role="alert">{err}</p> : <Spinner />}</div>
      </div>
    );

  const { user, business: b, latest } = d;
  const profile = b?.profile;
  const done = d.tasks.filter((t) => t.done).length;
  const pct = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
  const weeks = Array.from(new Set(d.tasks.map((t) => t.week))).sort();
  const firstName = user.name.split(" ")[0];

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={b?.name} isDemo={user.is_demo} />
      <main className="mx-auto max-w-6xl px-4 pt-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="eyebrow">Welcome back, {firstName}</p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">{b?.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-600">
              {b?.vertical && <span className="chip">{VERTICAL_LABEL[b.vertical] || b.vertical}</span>}
              {b?.location && <span>{b.location}</span>}
              {profile && <span>· {profile.employees} people · budget {money(profile.monthly_budget)}/mo</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {user.is_demo ? (
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
                <Link href="/onboard" className="btn-secondary">
                  Edit business
                </Link>
                <button onClick={() => start("live")} disabled={!!starting || d.live_runs_left <= 0 || !d.budget_ok} className="btn-primary">
                  {starting ? <Spinner /> : <Sparkles size={18} />} New analysis
                </button>
              </>
            )}
          </div>
        </div>
        {err && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </p>
        )}

        {!latest ? (
          <div className="card mt-8 p-10 text-center">
            <h2 className="font-display text-xl font-bold">No recommendation yet</h2>
            <p className="mt-2 text-stone-600">Run your first analysis to meet your advisors.</p>
          </div>
        ) : (
          <>
            <section className="card mt-8 grid grid-cols-2 gap-6 p-6 sm:grid-cols-4">
              <Stat label="Net gain / month" value={money(latest.stack.net_monthly, { sign: true })} tone="good" sub="value minus tool costs" />
              <Stat label="Hours saved / month" value={`${Math.round(latest.stack.hours_saved_per_month)}h`} sub="owner + staff time" />
              <Stat
                label="Tool cost / month"
                value={money(latest.stack.monthly_cost)}
                sub={latest.stack.within_budget ? `within ${money(latest.stack.budget)} budget` : "over budget"}
                tone={latest.stack.within_budget ? "default" : "warn"}
              />
              <Stat label="Plan progress" value={`${pct}%`} sub={`${done} of ${d.tasks.length} steps`} />
            </section>

            {latest.scenarios?.length > 0 && (
              <section className="mt-6">
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <p className="eyebrow">Stack in action</p>
                    <h2 className="font-display text-xl font-bold">Your AI tools, working together</h2>
                  </div>
                  <Link href={`/war-room/${latest.run_id}`} className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                    Open the War Room <ArrowRight size={14} />
                  </Link>
                </div>
                <StackFlow scenarios={latest.scenarios} catalog={catalog} approved={latest.approved.map((a) => a.id)} />
              </section>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
              <section className="space-y-6">
                <div className="card p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-semibold">Your AI stack</h2>
                    <Link href={`/war-room/${latest.run_id}`} className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                      Full analysis <ArrowRight size={14} />
                    </Link>
                  </div>
                  {latest.summary && <p className="mt-2 text-sm leading-relaxed text-stone-600">{latest.summary}</p>}
                  <ul className="mt-4 divide-y divide-stone-100">
                    {latest.approved.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium text-stone-900 hover:underline">
                            {t.name} <ExternalLink size={12} className="text-stone-400" />
                          </a>
                          <div className="text-xs text-stone-500">
                            Solves:{" "}
                            {Object.entries(latest.stack.picks)
                              .filter(([, tid]) => tid === t.id)
                              .map(([pid]) => latest.pains?.find((p) => p.id === pid)?.title || pid)
                              .join(" · ")}
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{t.price === 0 ? "Free" : `${money(t.price)}/mo`}</span>
                      </li>
                    ))}
                  </ul>
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
                    {done}/{d.tasks.length}
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
                  <motion.div className="h-full rounded-full bg-emerald-600" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} />
                </div>
                <div className="mt-5 space-y-5">
                  {weeks.map((w) => (
                    <div key={w}>
                      <h3 className="eyebrow">Week {w}</h3>
                      <ul className="mt-2 space-y-1">
                        {d.tasks
                          .filter((t) => t.week === w)
                          .map((t) => (
                            <li key={t.id}>
                              <button
                                onClick={() => toggle(t)}
                                className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-stone-50"
                                aria-pressed={t.done}
                              >
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
                                    {t.owner} <Clock size={11} /> {t.minutes} min
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
