"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, Check, ChevronDown, Compass, ExternalLink, Footprints, Network, PlayCircle, Plus, Sparkles, X, Zap } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import type { Business, Pain, Scenario, Stack, Tool, User } from "@/lib/types";
import { ToolsGraph } from "@/components/agent-graph";
import { ToolIcon } from "@/lib/tool-icons";
import { CATEGORY_LABEL, categoryOfVertical } from "@/lib/categories";
import { useAdoptions } from "@/hooks/useAdoptions";
import { AdoptButton } from "@/components/adopt-button";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, Stat, useTitle } from "@/components/ui";

type Suggestion = { tool_id: string; reason: string };
type Task = {
  id: number;
  week: number | null;
  tool_id: string | null;
  text: string;
  owner: string | null;
  minutes: number | null;
  done: boolean;
  source?: string | null;
  suggestions?: Suggestion[];
  assignee?: { id: string; name: string; initials: string } | null;
};
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

type Me = { user: User; account_role?: "owner" | "employee"; person_id?: string | null };
type PersonTool = { tool_id: string | null; name: string; source: "uses" | "approved_request" | "self_declared" | "assigned_task"; catalog: boolean; monthly_cost: number | null };
type PersonDetail = {
  id: string;
  name: string;
  role: string;
  ai_tools: PersonTool[];
  requests: { id: number; tool_id: string; name: string; status: string; created_at: string }[];
};

const TOOL_SOURCE: Record<PersonTool["source"], string> = {
  uses: "You use it",
  approved_request: "Approved for you",
  self_declared: "You added it",
  assigned_task: "Used in your tasks",
};
const REQUEST_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Waiting for approval", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  approved: { label: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  denied: { label: "Not approved", cls: "border-stone-200 bg-stone-50 text-stone-600" },
};

const weekOf = (t: Task) => (t.week && t.week > 0 ? t.week : 0);
const weekLabel = (w: number) => (w === 0 ? "Setup" : `Week ${w}`);

export default function Dashboard() {
  useTitle("Dashboard");
  const router = useRouter();
  const [d, setD] = useState<Dash | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [openWeeks, setOpenWeeks] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [taskErr, setTaskErr] = useState<string | null>(null);
  const { data: adoptions } = useAdoptions();
  const [me, setMe] = useState<Me | null>(null);

  const load = () => {
    setErr(null);
    Promise.all([api<Dash>("/dashboard"), api<Me>("/me")])
      .then(([x, m]) => {
        setMe(m);
        if (!x.business && !x.user.is_demo && m.account_role !== "employee") router.replace("/onboard");
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

  const publish = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (text.length < 3) return setTaskErr("Describe the task in a few words.");
    setPublishing(true);
    setTaskErr(null);
    try {
      const t = await api<Task>("/plan-tasks", { method: "POST", json: { text } });
      setD((p) => p && { ...p, tasks: [...p.tasks, t] });
      setOpenWeeks((s) => new Set(s).add(weekOf(t)));
      setDraft("");
    } catch (x) {
      setTaskErr((x as Error).message);
    }
    setPublishing(false);
  };

  const removeTask = async (t: Task) => {
    setD((p) => p && { ...p, tasks: p.tasks.filter((x) => x.id !== t.id) });
    try {
      await api(`/plan-tasks/${t.id}`, { method: "DELETE" });
    } catch {
      load();
    }
  };

  if (!d)
    return (
      <div className="min-h-dvh">
        <AppHeader />
        <main className="mx-auto max-w-6xl px-4 pt-8">{err ? <PageState kind="error" message={err} onRetry={load} /> : <PageState kind="loading" />}</main>
      </div>
    );

  if (me?.account_role === "employee") return <EmployeeDashboard d={d} me={me} onToggle={toggle} />;

  const { user, business: b, latest } = d;
  const done = d.tasks.filter((t) => t.done).length;
  const pct = d.tasks.length ? Math.round((done / d.tasks.length) * 100) : 0;
  const weeks = Array.from(new Set(d.tasks.map(weekOf))).sort((a, b) => a - b);
  // "This week" = the first week that still has unfinished tasks; it stays open, later weeks are collapsed.
  const currentWeek = weeks.find((w) => d.tasks.some((t) => weekOf(t) === w && !t.done)) ?? weeks[weeks.length - 1];
  const isOpen = (w: number) => w === currentWeek || openWeeks.has(w);
  const adoptedTools: AdoptedTool[] = d.adopted ?? (latest?.approved.map((a) => ({ ...a, source: "plan" as const })) || []);
  const scenarios = adoptions?.scenarios?.length ? adoptions.scenarios : latest?.scenarios || [];
  const category = (b?.details as { business_category?: string } | null | undefined)?.business_category || (b?.vertical ? categoryOfVertical(b.vertical) : null);
  const firstName = user.name.split(" ")[0];
  const cardLink = "card group flex flex-col items-start p-5 text-left transition-[border-color,box-shadow] hover:border-emerald-300 hover:shadow-md";

  const planCard = (
    <section className="card p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Your plan</h2>
        {d.tasks.length > 0 && (
          <span className="text-sm text-stone-500">
            {done} of {d.tasks.length} done
          </span>
        )}
      </div>
      {d.tasks.length > 0 && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-100">
          <motion.div className="h-full rounded-full bg-emerald-600" initial={false} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }} />
        </div>
      )}

      <form onSubmit={publish} className="mt-5">
        <label htmlFor="new-task" className="flex items-center gap-1 text-sm font-medium text-stone-700">
          Add a task
          <HelpTip>Write something you need to get done, like &ldquo;answer the phone during lunch rush&rdquo;. We&apos;ll add it to your plan and suggest tools that can help.</HelpTip>
        </label>
        <div className="mt-1.5 flex gap-2">
          <input id="new-task" className="input" maxLength={200} placeholder="e.g. Reply to Google reviews every week" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={publishing}>
            {publishing ? <Spinner /> : <Plus size={16} />} Publish
          </button>
        </div>
        {publishing && <p className="mt-1.5 text-xs text-stone-500">Finding tools that fit this task…</p>}
        {taskErr && (
          <p role="alert" className="mt-1.5 text-sm text-red-700">
            {taskErr}
          </p>
        )}
      </form>

      <div className="mt-5 space-y-2">
        {weeks.map((w) => {
          const tasks = d.tasks.filter((t) => weekOf(t) === w);
          const left = tasks.filter((t) => !t.done).length;
          const open = isOpen(w);
          return (
            <div key={w} className="rounded-xl border border-stone-100">
              <button
                type="button"
                onClick={() => setOpenWeeks((s) => { const n = new Set(s); if (n.has(w)) n.delete(w); else n.add(w); return n; })}
                disabled={w === currentWeek}
                aria-expanded={open}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {weekLabel(w)}
                  {w === currentWeek && <span className="chip border-emerald-200 bg-emerald-50 text-emerald-800">This week</span>}
                </span>
                <span className="flex items-center gap-2 text-xs text-stone-500">
                  {left === 0 ? "All done" : `${left} to do`}
                  {w !== currentWeek && <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />}
                </span>
              </button>
              {open && (
                <ul className="space-y-1 px-1 pb-2">
                  {tasks.map((t) => (
                    <li key={t.id}>
                      <div className="flex items-start gap-1 rounded-lg hover:bg-stone-50">
                        <button onClick={() => toggle(t)} className="flex min-w-0 flex-1 items-start gap-3 px-2 py-2 text-left" aria-pressed={t.done}>
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
                            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                              {t.assignee && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800" title={`Assigned to ${t.assignee.name}`}>
                                  <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-700 text-[9px] font-bold text-white">{t.assignee.initials}</span>
                                  {t.assignee.name}
                                </span>
                              )}
                              {t.source === "custom" ? "Your task" : t.source === "coworker" ? "From a coworker task" : t.owner}
                              {t.minutes ? ` · about ${t.minutes} min` : ""}
                            </span>
                          </span>
                        </button>
                        {t.source === "custom" && (
                          <button onClick={() => removeTask(t)} className="mt-1.5 rounded p-1 text-stone-400 hover:text-stone-700" aria-label={`Remove task: ${t.text}`}>
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      {t.source === "custom" && !t.done && (
                        <div className="mb-2 ml-10 mr-2">
                          {t.suggestions && t.suggestions.length > 0 ? (
                            <div className="space-y-1.5">
                              <div className="text-xs font-medium text-stone-500">Tools that can help</div>
                              {t.suggestions.map((s) => {
                                const tool = catalog[s.tool_id];
                                return (
                                  <div key={s.tool_id} className="flex items-center gap-2.5 rounded-lg border border-stone-200 bg-white p-2">
                                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                                      <ToolIcon category={tool?.category || ""} size={14} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <Link href={`/tools/${s.tool_id}`} className="block text-sm font-medium hover:underline">
                                        {tool?.name || s.tool_id}
                                      </Link>
                                      <span className="block text-xs text-stone-500">{s.reason}</span>
                                    </span>
                                    <AdoptButton toolId={s.tool_id} compact />
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="text-xs text-stone-400">No catalog tool is a clear fit for this one.</p>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );

  return (
    <div className="min-h-dvh pb-24">
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
        </div>
        {err && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {err}
          </p>
        )}

        {!latest ? (
          <>
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
                <Link href="/team?tab=tasks" className={cardLink}>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                    <Network size={20} />
                  </span>
                  <span className="mt-3 font-semibold">Give your team a task</span>
                  <span className="mt-1 text-sm text-stone-600">AI coworkers plan who does what.</span>
                </Link>
              </div>
            </section>
            {b && <div className="mt-6 max-w-2xl">{planCard}</div>}
          </>
        ) : (
          <>
            <section className="card mt-8 grid grid-cols-1 gap-6 p-6 sm:grid-cols-3">
              <Stat label="Estimated gain" value={`${money(latest.stack.net_monthly, { sign: true })}/mo`} tone="good" sub="after paying for the tools" />
              <Stat
                label="Tools cost"
                value={`${money(latest.stack.monthly_cost)}/mo`}
                sub={latest.stack.within_budget ? `within your ${money(latest.stack.budget)} budget` : "over your budget"}
                tone={latest.stack.within_budget ? "default" : "warn"}
              />
              <Stat label="Plan" value={`${pct}% done`} sub={d.tasks.length ? `${done} of ${d.tasks.length} tasks` : "no tasks yet"} />
            </section>

            {latest.first_step_today && pct < 100 && (
              <div className="mt-4 flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-950">
                <Footprints size={16} className="mt-0.5 shrink-0 text-emerald-800" />
                <span>
                  <b className="text-emerald-900">Next step:</b> {latest.first_step_today}
                </span>
              </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.15fr]">
              <section className="space-y-6">
                <div className="card p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="flex items-center gap-1 font-semibold">
                      Your AI tools
                      {latest.summary && <HelpTip>{latest.summary}</HelpTip>}
                    </h2>
                    <Link href="/tools" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                      Add a tool <ArrowRight size={14} />
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
                              </div>
                              <div className="truncate text-xs text-stone-500">{solves.length > 0 ? solves.join(" · ") : t.source === "manual" ? "Added by you" : "From your plan"}</div>
                            </div>
                          </div>
                          <span className="shrink-0 text-sm text-stone-600">{t.price === 0 ? "Free" : `${money(t.price)}/mo`}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {scenarios.length > 0 && (
                  <section>
                    <div className="mb-3 flex items-end justify-between gap-2">
                      <h2 className="font-semibold">How your tools work together</h2>
                      <Link href="/team?tab=tasks" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                        Full view <ArrowRight size={14} />
                      </Link>
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

                {d.runs.length > 0 && (
                  <details className="card p-5 text-sm">
                    <summary className="cursor-pointer font-semibold">Past analyses</summary>
                    <ul className="mt-3 space-y-1">
                      {d.runs.map((r) => (
                        <li key={r.id}>
                          <Link href={`/war-room/${r.id}`} className="flex items-center justify-between rounded-lg px-2 py-2 hover:bg-stone-50">
                            <span>{new Date(r.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                            <span className={cn("text-xs", r.status === "complete" ? "text-emerald-700" : "text-stone-500")}>{r.status === "complete" ? "Open" : r.status.replace("_", " ")}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              {planCard}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** What an employee sees: their own tasks, the AI tools they use, and their tool requests. No spending or owner actions. */
function EmployeeDashboard({ d, me, onToggle }: { d: Dash; me: Me; onToggle: (t: Task) => void }) {
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [personErr, setPersonErr] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const firstName = me.user.name.split(" ")[0];
  const b = d.business;

  useEffect(() => {
    setWelcome(new URLSearchParams(window.location.search).get("welcome") === "1");
    if (!me.person_id) return;
    api<PersonDetail>(`/people/${me.person_id}`)
      .then(setPerson)
      .catch((e) => setPersonErr(e.message));
  }, [me.person_id]);

  const mine = d.tasks.filter((t) => t.assignee && t.assignee.id === me.person_id);
  const team = d.tasks.filter((t) => !t.assignee && !t.done);
  const tools = person?.ai_tools ?? [];
  const requests = person?.requests ?? [];

  const taskRow = (t: Task) => (
    <li key={t.id}>
      <button onClick={() => onToggle(t)} className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-stone-50" aria-pressed={t.done}>
        <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors", t.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-stone-300 bg-white")}>
          {t.done && <Check size={14} strokeWidth={3} />}
        </span>
        <span className={cn("min-w-0 flex-1 text-sm leading-snug", t.done && "text-stone-400 line-through")}>{t.text}</span>
      </button>
    </li>
  );

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={b?.name} isDemo={me.user.is_demo} />
      <main className="mx-auto max-w-5xl px-4 pt-8">
        <PageHeader
          eyebrow={person?.role || "Employee"}
          title={`Hi ${firstName}${b?.name ? ` — ${b.name}` : ""}`}
          actions={
            <Link href="/tools" className="btn-primary">
              <Compass size={18} /> Find a tool to request
            </Link>
          }
        />
        {welcome && (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-950">
            <b>You&apos;re on the team.</b> Your tasks show up here. If an AI tool would help your work, find it in Discover and press <b>Request</b>.
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className="card p-6">
            <h2 className="font-semibold">My tasks</h2>
            {mine.length === 0 ? (
              <p className="mt-3 text-sm text-stone-500">Nothing assigned to you yet.</p>
            ) : (
              <ul className="mt-3 space-y-1">{mine.map(taskRow)}</ul>
            )}
            {team.length > 0 && (
              <>
                <div className="mt-5 flex items-center gap-2 border-t border-stone-100 pt-4">
                  <h3 className="text-sm font-semibold text-stone-700">Team plan</h3>
                  <HelpTip>Open tasks on your business&apos;s plan that aren&apos;t assigned to anyone yet.</HelpTip>
                </div>
                <ul className="mt-2 space-y-1">{team.slice(0, 8).map(taskRow)}</ul>
              </>
            )}
          </section>

          <div className="space-y-6">
            <section className="card p-6">
              <h2 className="font-semibold">My AI tools</h2>
              {personErr ? (
                <p className="mt-3 text-sm text-red-700">{personErr}</p>
              ) : !person ? (
                <div className="mt-3 h-16 animate-pulse rounded-xl bg-stone-100" />
              ) : tools.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">No AI tools yet. Request one from Discover.</p>
              ) : (
                <ul className="mt-3 divide-y divide-stone-100">
                  {tools.map((t) => (
                    <li key={`${t.tool_id ?? t.name}`} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        {t.catalog && t.tool_id ? (
                          <Link href={`/tools/${t.tool_id}`} className="block truncate text-sm font-medium hover:underline">
                            {t.name}
                          </Link>
                        ) : (
                          <span className="block truncate text-sm font-medium">{t.name}</span>
                        )}
                        <span className="block text-xs text-stone-500">{TOOL_SOURCE[t.source]}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card p-6">
              <h2 className="font-semibold">My requests</h2>
              {!person ? (
                <div className="mt-3 h-12 animate-pulse rounded-xl bg-stone-100" />
              ) : requests.length === 0 ? (
                <p className="mt-3 text-sm text-stone-500">You haven&apos;t requested any tools.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {requests.map((r) => {
                    const s = REQUEST_STATUS[r.status] || { label: r.status, cls: "border-stone-200 bg-stone-50 text-stone-600" };
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                        <Link href={`/tools/${r.tool_id}`} className="min-w-0 truncate font-medium hover:underline">
                          {r.name}
                        </Link>
                        <span className={cn("chip shrink-0", s.cls)}>{s.label}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
