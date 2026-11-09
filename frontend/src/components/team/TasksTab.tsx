"use client";
// Hand the team a task: the coworker who knows it best takes the lead (covering for anyone who's off),
// coworkers share context, plan it with your AI tools, write drafts, and wait for your OK.
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { useCoworkerTask } from "@/hooks/useCoworkerTask";
import { HelpTip, PageState, Spinner } from "@/components/ui";
import { PastTasks, TaskBox, TaskStatusChip } from "@/components/coworkers/TaskBox";
import { CoworkerMesh } from "@/components/coworkers/CoworkerMesh";
import { WorkflowMap } from "@/components/coworkers/WorkflowMap";
import { DraftCards } from "@/components/coworkers/DraftCards";
import { ApproveBar, AssignedTasks } from "@/components/coworkers/ApproveBar";
import { SendLog } from "@/components/coworkers/SendLog";
import type { CoworkerTask, Employee } from "@/components/coworkers/types";

export function TasksTab({ catalog, isOwnerView, initialTaskId, peopleCount, autoStartDemo = false }: { catalog: Record<string, Tool>; isOwnerView: boolean; initialTaskId: string | null; peopleCount: number; /** sample businesses: replay the first recorded task ($0) so the mesh is visible right away */ autoStartDemo?: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [tasks, setTasks] = useState<CoworkerTask[] | null>(null);
  const [examples, setExamples] = useState<string[]>([]);
  const [taskId, setTaskId] = useState<string | null>(initialTaskId);
  const [jumpToRun, setJumpToRun] = useState(false);
  const runRef = useRef<HTMLDivElement>(null);

  const loadTasks = useCallback(
    () =>
      api<CoworkerTask[]>("/coworker-tasks")
        .then((ts) => {
          setTasks(ts);
          setTaskId((cur) => cur ?? ts[0]?.id ?? null);
        })
        .catch(() => setTasks([])),
    [],
  );

  useEffect(() => {
    api<Employee[]>("/employees").then(setEmployees).catch(() => setEmployees([]));
    api<string[]>("/coworker-tasks/examples").then(setExamples).catch(() => setExamples([]));
    loadTasks();
  }, [loadTasks]);

  const { view, decide } = useCoworkerTask(taskId, loadTasks);

  // Sample businesses start with no tasks after a reset: replay the first recorded one so the graph shows immediately.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStartDemo || !isOwnerView || autoStarted.current || !tasks || tasks.length > 0 || !examples[0]) return;
    autoStarted.current = true;
    api<{ id: string }>("/coworker-tasks", { method: "POST", json: { text: examples[0] } })
      .then((r) => {
        setTaskId(r.id);
        loadTasks();
      })
      .catch(() => {});
  }, [autoStartDemo, isOwnerView, tasks, examples, loadTasks]);

  // Only move the page when the owner just started/opened a task (never on timers).
  useEffect(() => {
    if (!jumpToRun || !runRef.current) return;
    const top = runRef.current.getBoundingClientRect().top + window.scrollY - 80;
    window.scrollTo({ top, behavior: "smooth" });
    setJumpToRun(false);
  }, [jumpToRun, taskId]);

  const open = (id: string) => {
    setTaskId(id);
    loadTasks();
    setJumpToRun(true);
  };

  if (!tasks) return <PageState kind="loading" />;
  const current = tasks.find((t) => t.id === taskId);
  const disabled = !isOwnerView
    ? "Only the owner can hand the team a task."
    : peopleCount < 2
      ? peopleCount === 0
        ? "Add your people first, then hand them a task."
        : "Add one more person so their coworkers can share context."
      : null;

  return (
    <div className="space-y-6">
      <TaskBox examples={examples} onStarted={open} disabled={disabled} />

      {taskId && (
        <div ref={runRef} className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Task</p>
              <h2 className="mt-0.5 font-display text-xl font-bold leading-snug sm:text-2xl">{view.text || current?.text || "…"}</h2>
            </div>
            <div className="flex items-center gap-2">
              {view.mode === "replay" && <span className="chip">Sample replay</span>}
              <TaskStatusChip status={view.status} />
            </div>
          </div>

          {view.loading ? (
            <PageState kind="loading" />
          ) : view.status === "error" ? (
            <PageState kind="error" message={view.error || "This task didn't finish."} onRetry={() => setTaskId(taskId)} />
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="flex items-center gap-1 font-semibold">
                  Who handled it
                  <HelpTip>
                    Green cards are AI coworkers; the highlighted one knows this task best. A dashed amber line means someone is off today: their coworker shares what they know and a
                    colleague does the hands-on part. Tap a line to see what was passed along.
                  </HelpTip>
                </h3>
                <CoworkerMesh view={view} employees={employees} catalog={catalog} />
              </section>

              {view.workflow.length > 0 ? (
                <WorkflowMap view={view} employees={employees} catalog={catalog} />
              ) : (
                view.status === "running" && (
                  <div className="card flex items-center gap-3 p-5 text-sm text-stone-600">
                    <Spinner className="text-emerald-700" /> Planning it with your AI tools…
                  </div>
                )
              )}

              <DraftCards drafts={view.drafts} />

              {view.status === "awaiting_approval" && isOwnerView && <ApproveBar onDecide={decide} />}
              {view.status === "awaiting_approval" && !isOwnerView && (
                <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Waiting for the owner to approve this plan.</p>
              )}

              {view.status === "approved" && (
                <>
                  <AssignedTasks tasks={view.assigned} employees={employees} />
                  <SendLog entries={view.sendLog} catalog={catalog} />
                </>
              )}
              {view.status === "rejected" && <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">This plan was rejected. Nothing was assigned.</p>}
            </>
          )}
        </div>
      )}

      <PastTasks tasks={tasks} current={taskId} onOpen={open} />
    </div>
  );
}
