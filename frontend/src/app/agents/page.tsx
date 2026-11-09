"use client";
// Coworkers: every employee gets an AI coworker that knows their skills, customers and tools.
// Give the team a task; the right coworkers share context (covering for anyone who's off),
// plan it with your AI tools, write drafts, and wait for your OK.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { useAdoptions } from "@/hooks/useAdoptions";
import { useCoworkerTask } from "@/hooks/useCoworkerTask";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, useTitle } from "@/components/ui";
import { EmployeeCard } from "@/components/coworkers/EmployeeCard";
import { EmployeeDrawer } from "@/components/coworkers/EmployeeDrawer";
import { ConstitutionDrawer } from "@/components/coworkers/ConstitutionDrawer";
import { PastTasks, TaskBox, TaskStatusChip } from "@/components/coworkers/TaskBox";
import { CoworkerMesh } from "@/components/coworkers/CoworkerMesh";
import { WorkflowMap } from "@/components/coworkers/WorkflowMap";
import { DraftCards } from "@/components/coworkers/DraftCards";
import { ApproveBar, AssignedTasks } from "@/components/coworkers/ApproveBar";
import { SendLog } from "@/components/coworkers/SendLog";
import type { CoworkerTask, Employee, EmployeeStatus } from "@/components/coworkers/types";

type Me = { user: User; business: Business | null };

export default function CoworkersPage() {
  useTitle("Coworkers");
  const [me, setMe] = useState<Me | null>(null);
  const [role, setRole] = useState<"admin" | "member">("admin");
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [tasks, setTasks] = useState<CoworkerTask[]>([]);
  const [examples, setExamples] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [err, setErr] = useState<string | null>(null);
  const [openEmp, setOpenEmp] = useState<Employee | null>(null);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const runRef = useRef<HTMLDivElement>(null);
  const { adopted } = useAdoptions();

  const loadEmployees = useCallback(() => api<Employee[]>("/employees").then(setEmployees), []);
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

  const load = useCallback(() => {
    setErr(null);
    Promise.all([api<Me>("/me").then(setMe), loadEmployees(), loadTasks()]).catch((e) => setErr((e as Error).message));
    api<string[]>("/coworker-tasks/examples").then(setExamples).catch(() => setExamples([]));
    api<{ role: "admin" | "member" }>("/team/me").then((t) => setRole(t.role)).catch(() => {});
  }, [loadEmployees, loadTasks]);

  useEffect(() => {
    load();
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
  }, [load]);

  const { view, decide } = useCoworkerTask(taskId, loadTasks);
  const canEdit = role !== "member";
  const emps = useMemo(() => employees || [], [employees]);

  const setStatus = async (e: Employee, status: EmployeeStatus) => {
    setStatusBusy(e.id);
    setEmployees((list) => list && list.map((x) => (x.id === e.id ? { ...x, status } : x)));
    try {
      await api(`/employees/${e.id}/status`, { method: "PATCH", json: { status } });
    } catch {
      setEmployees((list) => list && list.map((x) => (x.id === e.id ? { ...x, status: e.status } : x)));
    }
    setStatusBusy(null);
  };

  const startTask = (id: string) => {
    setTaskId(id);
    loadTasks();
    setTimeout(() => runRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const current = tasks.find((t) => t.id === taskId);
  const ownerId = view.route?.owner_id;
  const needTwo = emps.length < 2;

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name} isDemo={me?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Coworkers"
          title="Your AI coworkers"
          help={
            <>
              Each employee gets an AI coworker that knows their skills, customers and tools. Give the team a task: the coworker who knows it best takes the lead, others share
              what they know, and if someone is off today their coworker still answers for them. You get a plan that uses your AI tools, drafts ready to copy, and nothing
              happens until you approve.
            </>
          }
          actions={
            canEdit && (
              <button
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                <UserPlus size={16} /> Add employee
              </button>
            )
          }
        />

        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !employees ? (
          <PageState kind="loading" />
        ) : (
          <>
            {/* 1. Coworkers */}
            <section aria-label="Your team's coworkers">
              {emps.length === 0 ? (
                <div className="card p-8 text-center">
                  <h2 className="font-display text-xl font-bold">Add your first two people</h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">Tell us what each person does. Their AI coworkers will work together on tasks you hand them.</p>
                  {canEdit && (
                    <button
                      className="btn-primary mt-4"
                      onClick={() => {
                        setEditing(null);
                        setFormOpen(true);
                      }}
                    >
                      <Plus size={16} /> Add employee
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {emps.map((e) => (
                    <EmployeeCard
                      key={e.id}
                      e={e}
                      catalog={catalog}
                      onOpen={() => setOpenEmp(e)}
                      onStatus={(s) => setStatus(e, s)}
                      busy={statusBusy === e.id}
                      canEdit={canEdit || e.user_id === me?.user.id}
                      highlight={!!ownerId && ownerId === e.id && view.status !== "approved"}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* 2. Task */}
            <TaskBox
              examples={examples}
              onStarted={startTask}
              disabled={needTwo ? (emps.length === 0 ? "Add your team first, then hand them a task." : "Add one more person so coworkers can share context.") : null}
            />

            {/* 3. The run */}
            {taskId && (
              <div ref={runRef} className="scroll-mt-20 space-y-6">
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
                        How your coworkers handled it
                        <HelpTip>
                          Green cards are AI coworkers. The highlighted one knows this task best. A dashed amber line means someone is off today: their coworker shares what they
                          know and a colleague does the hands-on part. Tap any line to see what was passed along.
                        </HelpTip>
                      </h3>
                      <CoworkerMesh view={view} employees={emps} catalog={catalog} />
                    </section>

                    {view.workflow.length > 0 ? (
                      <WorkflowMap view={view} employees={emps} catalog={catalog} />
                    ) : (
                      view.status === "running" && (
                        <div className="card flex items-center gap-3 p-5 text-sm text-stone-600">
                          <Spinner className="text-emerald-700" /> Building the workflow with your AI tools…
                        </div>
                      )
                    )}

                    <DraftCards drafts={view.drafts} />

                    {view.status === "awaiting_approval" && canEdit && <ApproveBar onDecide={decide} />}
                    {view.status === "awaiting_approval" && !canEdit && (
                      <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Waiting for the owner to approve this plan.</p>
                    )}

                    {view.status === "approved" && (
                      <>
                        <AssignedTasks tasks={view.assigned} employees={emps} />
                        <SendLog entries={view.sendLog} catalog={catalog} />
                      </>
                    )}
                    {view.status === "rejected" && <p className="rounded-xl bg-stone-100 px-4 py-3 text-sm text-stone-700">You rejected this plan. Nothing was assigned.</p>}
                  </>
                )}
              </div>
            )}

            <PastTasks tasks={tasks} current={taskId} onOpen={startTask} />
          </>
        )}
      </main>

      <EmployeeDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        catalog={catalog}
        adoptedIds={[...adopted]}
        onSaved={(e) => {
          setFormOpen(false);
          setEmployees((list) => {
            const l = list || [];
            return l.some((x) => x.id === e.id) ? l.map((x) => (x.id === e.id ? e : x)) : [...l, e];
          });
          setOpenEmp((o) => (o && o.id === e.id ? e : o));
        }}
      />
      <ConstitutionDrawer
        employee={openEmp}
        catalog={catalog}
        canEdit={canEdit}
        onClose={() => setOpenEmp(null)}
        onEdit={() => {
          setEditing(openEmp);
          setOpenEmp(null);
          setFormOpen(true);
        }}
        onDelete={async () => {
          if (!openEmp) return;
          const id = openEmp.id;
          setOpenEmp(null);
          await api(`/employees/${id}`, { method: "DELETE" }).catch(() => {});
          loadEmployees();
        }}
      />
    </div>
  );
}
