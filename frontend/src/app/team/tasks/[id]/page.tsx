"use client";
// One team task on its own page: who it's assigned to, progress, the coworker mesh (replayable), workflow, drafts,
// the owner's approval, and the step checklist the assignee ticks off.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Clock } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { AppHeader, HelpTip, PageState, Spinner, useTitle } from "@/components/ui";
import { useCoworkerTask } from "@/hooks/useCoworkerTask";
import { CoworkerMesh } from "@/components/coworkers/CoworkerMesh";
import { WorkflowMap } from "@/components/coworkers/WorkflowMap";
import { DraftCards } from "@/components/coworkers/DraftCards";
import { ApproveBar } from "@/components/coworkers/ApproveBar";
import { SendLog } from "@/components/coworkers/SendLog";
import type { Employee, QueueStep } from "@/components/coworkers/types";
import { Avatar, ProgressBar, StageChip } from "@/components/team/TaskQueue";

type Me = { user: User; business: Business | null; account_role?: "owner" | "employee"; person_id?: string | null };

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { view, decide, toggleStep } = useCoworkerTask(id);
  const [me, setMe] = useState<Me | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [stepErr, setStepErr] = useState<string | null>(null);
  useTitle(view.text ? `Task · ${view.text.slice(0, 40)}` : "Task");

  useEffect(() => {
    api<Me>("/me").then(setMe).catch(() => {});
    api<Employee[]>("/employees").then(setEmployees).catch(() => setEmployees([]));
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
  }, []);

  const isOwnerView = me ? me.account_role !== "employee" : false;
  const myPersonId = me?.person_id ?? null;
  const canTick = (s: QueueStep) => isOwnerView || (!!myPersonId && s.assignee?.id === myPersonId);

  const tick = async (s: QueueStep) => {
    setStepErr(null);
    try {
      await toggleStep(s.task_id, !s.done);
    } catch (e) {
      setStepErr((e as Error).message);
    }
  };

  // steps: prefer the queue's step list; fall back to steps assigned at approval
  const steps: QueueStep[] = view.steps.length
    ? view.steps
    : view.assigned.map((a) => {
        const e = employees.find((x) => x.id === a.assignee_id);
        return { task_id: a.task_id, text: a.text, done: false, assignee: e ? { id: e.id, name: e.name, initials: e.initials } : null };
      });
  const myFirst = [...steps].sort((a, b) => Number(b.assignee?.id === myPersonId) - Number(a.assignee?.id === myPersonId));

  return (
    <div className="min-h-dvh pb-28">
      <AppHeader businessName={me?.business?.name} isDemo={me?.user.is_demo} />
      <main className="page-wrap space-y-6 pt-6">
        <Link href="/team?tab=queue" className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
          <ArrowLeft size={14} /> Collaboration
        </Link>

        {view.loading ? (
          <PageState kind="loading" />
        ) : view.status === "error" && !view.workflow.length ? (
          <PageState kind="error" message={view.error || "This task didn't finish."} />
        ) : (
          <>
            <header className="card space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="min-w-0 break-words font-display text-2xl font-bold leading-snug sm:text-3xl">{view.text}</h1>
                <div className="flex items-center gap-2">
                  {view.mode === "replay" && <span className="chip">Sample</span>}
                  <StageChip stage={view.stage} isOwnerView={isOwnerView} />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_minmax(0,260px)] sm:items-center">
                {view.assignee ? (
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar initials={view.assignee.initials} />
                    <div className="min-w-0 text-sm">
                      <div>
                        Assigned to <b>{view.assignee.name}</b>
                        {view.assignee.role && <span className="text-stone-500"> · {view.assignee.role}</span>}
                      </div>
                      {view.coveringFor && <div className="text-amber-800">Covering for {view.coveringFor.name}, who is off today</div>}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    {view.status === "running" ? <><Spinner className="text-emerald-700" /> Picking who handles it…</> : "Unassigned"}
                  </div>
                )}
                <ProgressBar done={view.progress.done} total={view.progress.total} />
              </div>
            </header>

            {view.status === "awaiting_approval" && !isOwnerView && (
              <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Waiting for the owner to approve this plan.</p>
            )}

            {steps.length > 0 && (
              <section className="card p-5" aria-labelledby="steps-h">
                <h2 id="steps-h" className="flex items-center gap-1 font-semibold">
                  Steps
                  <HelpTip>Tick a step when it&apos;s done. The task moves to Finished when every step is ticked. You can tick your own steps; the owner can tick any.</HelpTip>
                </h2>
                <ol className="mt-3 space-y-1">
                  {myFirst.map((s) => {
                    const allowed = canTick(s);
                    return (
                      <li key={s.task_id}>
                        <button
                          onClick={() => allowed && tick(s)}
                          disabled={!allowed}
                          aria-pressed={s.done}
                          className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left", allowed ? "hover:bg-stone-50" : "cursor-default")}
                        >
                          <span
                            className={cn(
                              "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                              s.done ? "border-emerald-600 bg-emerald-600 text-white" : allowed ? "border-stone-300 bg-white" : "border-stone-200 bg-stone-50",
                            )}
                          >
                            {s.done && <Check size={14} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn("block break-words text-sm leading-snug", s.done && "text-stone-400 line-through")}>{s.text}</span>
                            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-500">
                              {s.assignee ? (
                                <>
                                  <Avatar initials={s.assignee.initials} size="sm" /> {s.assignee.id === myPersonId ? "You" : s.assignee.name}
                                </>
                              ) : (
                                <>
                                  <Clock size={11} /> Anyone
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {stepErr && <p role="alert" className="mt-2 text-sm text-red-700">{stepErr}</p>}
              </section>
            )}

            <section className="space-y-2">
              <h2 className="flex items-center gap-1 font-semibold">
                How the coworkers handled it
                <HelpTip>
                  Green cards are AI coworkers; the highlighted one knows this task best. A dashed amber line means someone is off today: their coworker shares what they know and a
                  colleague does the hands-on part. Press play to replay it; tap a line to see what was passed along.
                </HelpTip>
              </h2>
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

            {view.status === "approved" && <SendLog entries={view.sendLog} catalog={catalog} />}
            {view.status === "rejected" && <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">This plan was rejected. Nothing was assigned.</p>}
            {view.status === "awaiting_approval" && isOwnerView && <ApproveBar onDecide={decide} />}
          </>
        )}
      </main>
    </div>
  );
}
