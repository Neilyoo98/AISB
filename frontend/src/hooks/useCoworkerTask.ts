"use client";
// Streams one coworker task (GET /coworker-tasks/{id} for history, then SSE), and approves/rejects it.
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import type { RunEvent } from "@/lib/types";
import type {
  AssignedTask, CoworkerResult, CoworkerTaskDetail, Draft, MeshMessage, Route, SendLogEntry, TaskStatus, WorkflowStep,
} from "@/components/coworkers/types";

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
};

const initial: CoworkerView = {
  loading: true, text: "", status: "running", mode: null, events: [], lastSeq: -1, intent: null, urgency: null, route: null,
  mesh: [], workflow: [], gaps: {}, drafts: [], assigned: [], sendLog: [], savedFor: [], error: null,
};

type Action =
  | { kind: "reset" }
  | { kind: "loaded"; task: CoworkerTaskDetail }
  | { kind: "event"; e: RunEvent }
  | { kind: "status"; status: TaskStatus }
  | { kind: "error"; message: string };

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
      break;
    case "task.approved":
      n.status = "approved";
      n.assigned = d.assigned_tasks || [];
      n.sendLog = d.send_log || [];
      break;
    case "task.rejected":
      n.status = "rejected";
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

function reducer(s: CoworkerView, a: Action): CoworkerView {
  switch (a.kind) {
    case "reset":
      return initial;
    case "loaded": {
      let n: CoworkerView = { ...s, loading: false, text: a.task.text, mode: a.task.mode };
      for (const e of a.task.events || []) n = apply(n, e);
      n = fromResult(n, a.task.result);
      // the server's status wins once history is applied (e.g. approved after a reload)
      return { ...n, status: a.task.status };
    }
    case "event":
      return apply(s, a.e);
    case "status":
      return { ...s, status: a.status };
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
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) esRef.current = null;
    };
  }, [taskId]);

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    dispatch({ kind: "reset" });
    seqRef.current = -1;
    api<CoworkerTaskDetail>(`/coworker-tasks/${taskId}`)
      .then((t) => {
        if (cancelled) return;
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

  return { view, decide };
}
