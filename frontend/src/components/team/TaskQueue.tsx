"use client";
// Task queue: every team task with who it's assigned to, its stage and step progress.
// Owner: "New task" box + progress board. Employees: "Mine" by default, toggle "All".
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CheckCircle2, Hourglass, ListChecks, Loader2, XCircle } from "lucide-react";
import { api, cn } from "@/lib/api";
import { HelpTip, PageState } from "@/components/ui";
import { TaskBox } from "@/components/coworkers/TaskBox";
import { STAGE_LABEL, STAGE_LABEL_EMPLOYEE, stageOf, type QueueTask, type TaskStage } from "@/components/coworkers/types";

const STAGE_TONE: Record<TaskStage, string> = {
  planning: "border-sky-200 bg-sky-50 text-sky-800",
  needs_ok: "border-amber-200 bg-amber-50 text-amber-800",
  in_progress: "border-emerald-200 bg-emerald-50 text-emerald-800",
  done: "border-stone-200 bg-stone-100 text-stone-700",
  rejected: "border-stone-200 bg-stone-50 text-stone-500",
};
const STAGE_ICON: Record<TaskStage, typeof Hourglass> = { planning: Loader2, needs_ok: Hourglass, in_progress: ListChecks, done: CheckCircle2, rejected: XCircle };
const ORDER: TaskStage[] = ["planning", "needs_ok", "in_progress", "done"];

export function StageChip({ stage, isOwnerView }: { stage: TaskStage; isOwnerView: boolean }) {
  const Icon = STAGE_ICON[stage];
  return (
    <span className={cn("chip shrink-0", STAGE_TONE[stage])}>
      <Icon size={12} className={stage === "planning" ? "animate-spin motion-reduce:animate-none" : undefined} />
      {(isOwnerView ? STAGE_LABEL : STAGE_LABEL_EMPLOYEE)[stage]}
    </span>
  );
}

export function Avatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-emerald-700 font-bold text-white", size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs")} aria-hidden>
      {initials}
    </span>
  );
}

export function ProgressBar({ done, total }: { done: number; total: number }) {
  if (!total) return null;
  const pct = Math.round((done / total) * 100);
  return (
    <div className="min-w-0">
      <div className="h-1.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Steps done">
        <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-stone-500">
        {done} of {total} step{total === 1 ? "" : "s"} done
      </div>
    </div>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function TaskCard({ t, isOwnerView }: { t: QueueTask; isOwnerView: boolean }) {
  const stage = stageOf(t);
  return (
    <li>
      <Link
        href={`/team/tasks/${t.id}`}
        className="card group flex flex-col gap-3 p-4 transition-[border-color,box-shadow] hover:border-emerald-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 break-words font-medium leading-snug text-stone-900">{t.text}</p>
          <StageChip stage={stage} isOwnerView={isOwnerView} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          {t.assignee ? (
            <span className="flex min-w-0 items-center gap-2">
              <Avatar initials={t.assignee.initials} size="sm" />
              <span className="min-w-0 truncate">
                <span className="font-medium">{t.assignee.name}</span>
                {t.covering_for && <span className="text-amber-800"> · covering for {t.covering_for.name.split(" ")[0]}</span>}
              </span>
            </span>
          ) : (
            <span className="text-stone-500">{stage === "planning" ? "Picking who handles it…" : "Unassigned"}</span>
          )}
          <span className="text-xs text-stone-500">{when(t.created_at)}</span>
        </div>
        {stage !== "planning" && stage !== "rejected" && <ProgressBar done={t.progress?.done ?? 0} total={t.progress?.total ?? 0} />}
        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          Open task <ArrowRight size={12} />
        </span>
      </Link>
    </li>
  );
}

export function TaskQueue({ isOwnerView, myPersonId, peopleCount }: { isOwnerView: boolean; myPersonId: string | null; peopleCount: number }) {
  const router = useRouter();
  const [scope, setScope] = useState<"mine" | "all">(isOwnerView ? "all" : "mine");
  const [tasks, setTasks] = useState<QueueTask[] | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<QueueTask[]>(`/coworker-tasks?scope=${isOwnerView ? "all" : scope}`)
        .then((ts) => {
          setTasks(ts);
          setErr(null);
        })
        .catch((e) => setErr((e as Error).message)),
    [isOwnerView, scope],
  );

  useEffect(() => {
    load();
    if (isOwnerView) api<string[]>("/coworker-tasks/examples").then(setExamples).catch(() => setExamples([]));
  }, [load, isOwnerView]);

  // keep the board live while any task is still being planned
  const anyPlanning = !!tasks?.some((t) => stageOf(t) === "planning");
  useEffect(() => {
    if (!anyPlanning) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [anyPlanning, load]);

  // backend filters by scope; this also keeps "Mine" right if it returns everything
  const shown = useMemo(() => {
    if (!tasks) return [];
    if (isOwnerView || scope === "all" || !myPersonId) return tasks;
    return tasks.filter((t) => t.assignee?.id === myPersonId || t.steps?.some((s) => s.assignee?.id === myPersonId));
  }, [tasks, isOwnerView, scope, myPersonId]);

  const counts = useMemo(() => {
    const c: Record<TaskStage, number> = { planning: 0, needs_ok: 0, in_progress: 0, done: 0, rejected: 0 };
    for (const t of shown) c[stageOf(t)]++;
    return c;
  }, [shown]);

  const unfinished = shown.filter((t) => !["done", "rejected"].includes(stageOf(t)));
  const finished = shown.filter((t) => ["done", "rejected"].includes(stageOf(t)));

  const disabled =
    peopleCount === 0 ? "Add your people first (People page), then hand them a task." : peopleCount < 2 ? "Add one more person so their coworkers can share context." : null;

  return (
    <div className="space-y-6">
      {isOwnerView && (
        <div>
          <TaskBox examples={examples} disabled={disabled} onStarted={(id) => router.push(`/team/tasks/${id}`)} />
          <p className="mt-2 flex items-center gap-1 text-xs text-stone-500">
            New tasks are assigned to the best-fit person automatically.
            <HelpTip>
              Each person&apos;s AI coworker knows their skills. The task goes to whoever knows it best; if they&apos;re off today, their coworker shares what they know and an
              available colleague does the hands-on part.
            </HelpTip>
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" aria-label="Task summary">
          {ORDER.map((s) => (
            <span key={s} className={cn("chip", STAGE_TONE[s])}>
              {(isOwnerView ? STAGE_LABEL : STAGE_LABEL_EMPLOYEE)[s]} <b className="tabular-nums">{counts[s]}</b>
            </span>
          ))}
        </div>
        {!isOwnerView && (
          <div role="radiogroup" aria-label="Which tasks" className="inline-grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
                className={cn("rounded-lg px-4 py-1.5 transition-colors", scope === s ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
              >
                {s === "mine" ? "Mine" : "All"}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && !tasks ? (
        <PageState kind="error" message={err} onRetry={load} />
      ) : !tasks ? (
        <PageState kind="loading" />
      ) : shown.length === 0 ? (
        <PageState
          kind="empty"
          message={isOwnerView ? "No tasks yet. Describe one above and it's assigned automatically." : scope === "mine" ? "Nothing assigned to you yet." : "No team tasks yet."}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
          <section aria-labelledby="q-unfinished">
            <h2 id="q-unfinished" className="mb-3 flex items-center gap-2 font-semibold">
              Unfinished <span className="text-sm font-normal text-stone-500">{unfinished.length}</span>
            </h2>
            {unfinished.length ? (
              <ul className="space-y-3">{unfinished.map((t) => <TaskCard key={t.id} t={t} isOwnerView={isOwnerView} />)}</ul>
            ) : (
              <p className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">All caught up.</p>
            )}
          </section>
          <section aria-labelledby="q-finished">
            <h2 id="q-finished" className="mb-3 flex items-center gap-2 font-semibold">
              Finished <span className="text-sm font-normal text-stone-500">{finished.length}</span>
            </h2>
            {finished.length ? (
              <ul className="space-y-3">{finished.map((t) => <TaskCard key={t.id} t={t} isOwnerView={isOwnerView} />)}</ul>
            ) : (
              <p className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">Finished tasks show up here.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
