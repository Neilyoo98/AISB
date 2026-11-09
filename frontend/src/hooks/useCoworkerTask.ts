"use client";
// Streams one coworker task (GET /coworker-tasks/{id} for history, then SSE), and approves/rejects it.
// Never blanks an open view: the first load resets, later reloads (after ticking a step, polling) merge in place.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import type { RunEvent } from "@/lib/types";
import type {
  AssignedTask, CoworkerResult, Draft, MeshMessage, QueuePerson, QueueStep, QueueTaskDetail, Route, SendLogEntry, TaskStage, TaskStatus, WorkflowStep,
} from "@/components/coworkers/types";
import { stageOf } from "@/components/coworkers/types";

export type CoworkerView = {
  loading: boolean;
  text: string;
  status: TaskStatus;
  mode: "live" | "replay" | null;
  events: RunEvent[];
  lastSeq: number;
  intent: string | null;
  urgency: "low" | "normal" | "high" | null;
  route: Route | null;
  mesh: MeshMessage[];
  workflow: WorkflowStep[];
  gaps: Record<number, { capability: string; recommendations: { tool_id: string; reason: string }[] }>;
  drafts: Draft[];
  assigned: AssignedTask[];
  sendLog: SendLogEntry[];
  savedFor: string[];
  error: string | null;
  // queue fields (task queue contract)
  stage: TaskStage;
  assignee: QueuePerson | null;
  coveringFor: { id: string; name: string } | null;
  progress: { done: number; total: number };
  steps: QueueStep[];
  createdAt: string | null;
};

const initial: CoworkerView = {
  loading: true, text: "", status: "running", mode: null, events: [], lastSeq: -1, intent: null, urgency: null, route: null,
  mesh: [], workflow: [], gaps: {}, drafts: [], assigned: [], sendLog: [], savedFor: [], error: null,
  stage: "planning", assignee: null, coveringFor: null, progress: { done: 0, total: 0 }, steps: [], createdAt: null,
};

type Action =
  | { kind: "reset" }
  | { kind: "loaded"; task: QueueTaskDetail }
  | { kind: "refreshed"; task: QueueTaskDetail }
  | { kind: "event"; e: RunEvent }
  | { kind: "status"; status: TaskStatus }
  | { kind: "step"; taskId: number; done: boolean }
  | { kind: "error"; message: string };

/**
 * Finished tasks seeded as history may have no stored events. Rebuild the same event sequence from `result`
 * so the mesh animation and step log always have something to replay (never a blank panel).
 */
export function synthesizeEvents(status: TaskStatus, mode: "live" | "replay", r: CoworkerResult | null): RunEvent[] {
  if (!r) return [];
  const out: RunEvent[] = [];
  const push = (type: string, agent: string | null, data: Record<string, unknown>) => out.push({ seq: out.length, t: out.length * 900, type, agent, data });
  push("task.start", null, { mode });
  push("task.read", "reader", { intent: r.intent, urgency: r.urgency, needed_skills: [], needed_capabilities: [] });
  if (r.route) {
    push("route.chosen", "router", { route: r.route });
    if (r.route.substituted) push("route.substituted", "router", { owner_id: r.route.owner_id, human_id: r.route.human_id, note: r.route.substitution_note });
  }
  for (const m of r.mesh || []) push("mesh.message", `coworker:${m.from_id}`, m as unknown as Record<string, unknown>);
  if (r.workflow?.length) push("workflow.ready", "builder", { workflow: r.workflow });
  for (const s of r.workflow || []) if (s.gap) push("gap.found", "builder", { step_n: s.n, capability: s.gap_capability, recommendations: s.recommendations || [] });
  if (r.drafts?.length) push("drafts.ready", "drafter", { drafts: r.drafts });
  push("approval.waiting", null, {});
  if (status === "approved") {
    push("task.approved", "you", { assigned_tasks: r.assigned_tasks || [], send_log: r.send_log || [] });
    push("task.complete", null, {});
  } else if (status === "rejected") push("task.rejected", "you", {});
  return out;
}

function fromResult(s: CoworkerView, r: CoworkerResult | null): CoworkerView {
  if (!r) return s;
  return {
    ...s,
    intent: s.intent ?? r.intent ?? null,
    urgency: s.urgency ?? r.urgency ?? null,
    route: s.route ?? r.route ?? null,
    mesh: s.mesh.length ? s.mesh : r.mesh || [],
    workflow: s.workflow.length ? s.workflow : r.workflow || [],
    drafts: s.drafts.length ? s.drafts : r.drafts || [],
    assigned: s.assigned.length ? s.assigned : r.assigned_tasks || [],
    sendLog: s.sendLog.length ? s.sendLog : r.send_log || [],
  };
}

function withQueue(s: CoworkerView, t: QueueTaskDetail): CoworkerView {
  const progress = t.progress ?? s.progress;
  return {
    ...s,
    stage: stageOf({ stage: t.stage, status: t.status, progress }),
    assignee: t.assignee ?? s.assignee,
    coveringFor: t.covering_for ?? s.coveringFor,
    progress,
    steps: t.steps ?? s.steps,
    createdAt: t.created_at ?? s.createdAt,
  };
}

function apply(s: CoworkerView, e: RunEvent): CoworkerView {
  if (e.seq !== -1 && e.seq <= s.lastSeq) return s;
  const n: CoworkerView = { ...s, lastSeq: Math.max(s.lastSeq, e.seq), events: [...s.events, e] };
  const d = e.data || {};
  switch (e.type) {
    case "task.start":
      n.status = "running";
      n.mode = d.mode ?? n.mode;
      break;
    case "task.read":
      n.intent = d.intent ?? null;
      n.urgency = d.urgency ?? null;
      break;
    case "route.chosen":
      n.route = (d.route || d) as Route;
      break;
    case "route.substituted":
      n.route = n.route
        ? { ...n.route, substituted: true, human_id: d.human_id ?? n.route.human_id, substitution_note: d.note ?? n.route.substitution_note }
        : { owner_id: d.owner_id, owner_reason: "", substituted: true, human_id: d.human_id, substitution_note: d.note ?? null };
      break;
    case "mesh.message":
      n.mesh = [...n.mesh, d as MeshMessage];
      break;
    case "workflow.ready":
      n.workflow = (d.workflow || []) as WorkflowStep[];
      break;
    case "gap.found":
      n.gaps = { ...n.gaps, [d.step_n]: { capability: d.capability, recommendations: d.recommendations || [] } };
      break;
    case "drafts.ready":
      n.drafts = (d.drafts || []) as Draft[];
      break;
    case "approval.waiting":
      n.status = "awaiting_approval";
      n.stage = "needs_ok";
      break;
    case "task.approved":
      n.status = "approved";
      n.stage = "in_progress";
      n.assigned = d.assigned_tasks || [];
      n.sendLog = d.send_log || [];
      break;
    case "task.rejected":
      n.status = "rejected";
      n.stage = "rejected";
      break;
    case "memory.saved":
      n.savedFor = d.employees || [];
      break;
    case "task.error":
      n.status = "error";
      n.error = d.message || "This task didn't finish.";
      break;
  }
  return n;
}

function load(s: CoworkerView, t: QueueTaskDetail): CoworkerView {
  const events = t.events?.length ? t.events : synthesizeEvents(t.status, t.mode, t.result);
  let n: CoworkerView = { ...s, loading: false, text: t.text, mode: t.mode };
  for (const e of events) n = apply(n, e);
  n = fromResult(n, t.result);
  // the server's status wins once history is applied (e.g. approved after a reload)
  return withQueue({ ...n, status: t.status }, t);
}

function reducer(s: CoworkerView, a: Action): CoworkerView {
  switch (a.kind) {
    case "reset":
      return initial;
    case "loaded":
      return load(s, a.task);
    case "refreshed": {
      // merge without clearing: keep the events already played, take the latest status/queue fields
      if (s.loading || !s.events.length) return load(s, a.task);
      return withQueue(fromResult({ ...s, status: a.task.status, text: a.task.text || s.text }, a.task.result), a.task);
    }
    case "event":
      return apply(s, a.e);
    case "status":
      return { ...s, status: a.status };
    case "step": {
      const steps = s.steps.map((x) => (x.task_id === a.taskId ? { ...x, done: a.done } : x));
      const done = steps.filter((x) => x.done).length;
      const progress = steps.length ? { done, total: steps.length } : s.progress;
      const stage: TaskStage = s.stage === "in_progress" || s.stage === "done" ? (progress.total > 0 && done >= progress.total ? "done" : "in_progress") : s.stage;
      return { ...s, steps, progress, stage };
    }
    case "error":
      return { ...s, loading: false, status: "error", error: a.message };
  }
}

const TERMINAL = new Set(["approval.waiting", "task.complete", "task.error", "task.rejected", "stream.end"]);

export function useCoworkerTask(taskId: string | null, onSettled?: () => void) {
  const [view, dispatch] = useReducer(reducer, initial);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(-1);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const refresh = useCallback(async () => {
    if (!taskId) return;
    try {
      const t = await api<QueueTaskDetail>(`/coworker-tasks/${taskId}`);
      dispatch({ kind: "refreshed", task: t });
    } catch {
      /* keep what's on screen */
    }
  }, [taskId]);

  const open = useCallback(() => {
    if (!taskId) return;
    esRef.current?.close();
    const es = new EventSource(`/api/coworker-tasks/${taskId}/stream?after=${seqRef.current}`);
    esRef.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      if (e.seq > seqRef.current) seqRef.current = e.seq;
      dispatch({ kind: "event", e });
      if (TERMINAL.has(e.type)) {
        es.close();
        settled.current?.();
        // pick up assignee / steps / progress the stream doesn't carry
        refresh();
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) esRef.current = null;
    };
  }, [taskId, refresh]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    dispatch({ kind: "reset" });
    seqRef.current = -1;
    api<QueueTaskDetail>(`/coworker-tasks/${taskId}`)
      .then((t) => {
        if (cancelled) return;
        // only stored events count toward the stream cursor; synthesized ones are display-only
        for (const e of t.events || []) seqRef.current = Math.max(seqRef.current, e.seq);
        dispatch({ kind: "loaded", task: t });
        if (t.status === "running") open();
      })
      .catch((err) => !cancelled && dispatch({ kind: "error", message: (err as Error).message }));
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [taskId, open]);

  const decide = useCallback(
    async (approve: boolean) => {
      if (!taskId) return;
      await api(`/coworker-tasks/${taskId}/approve`, { method: "POST", json: { approve } });
      dispatch({ kind: "status", status: "running" });
      open();
    },
    [taskId, open],
  );

  /** Tick / untick one assigned step. Optimistic; rolls back on error. */
  const toggleStep = useCallback(
    async (stepTaskId: number, done: boolean) => {
      dispatch({ kind: "step", taskId: stepTaskId, done });
      try {
        await api(`/plan-tasks/${stepTaskId}`, { method: "PATCH", json: { done } });
        refresh();
      } catch (e) {
        dispatch({ kind: "step", taskId: stepTaskId, done: !done });
        throw e;
      }
    },
    [refresh],
  );

  return { view, decide, toggleStep, refresh };
}
