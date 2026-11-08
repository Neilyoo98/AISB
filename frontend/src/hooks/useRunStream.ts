"use client";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import type { MeshMsg, Pain, Pick, Plan, Profile, RunEvent, Scored, Stack } from "@/lib/types";

export type AgentKey = "intake" | "memory" | "diagnoser" | "scout" | "mesh" | "roi" | "approval" | "planner";
export type AgentStatus = "idle" | "working" | "done";

export type RunView = {
  status: "loading" | "running" | "awaiting_approval" | "complete" | "error";
  mode?: "live" | "replay";
  agents: Record<AgentKey, AgentStatus>;
  label: string;
  profile?: Profile;
  rawPains?: { title: string; tag: string; owner_quote: string }[];
  facts?: { subject: string; predicate: string; object: string; category: string }[];
  memory?: { prior_facts: number; own_episodes: { text: string }[]; similar_businesses: { text: string }[] };
  pains: Pain[];
  scouts: Record<string, { status: "working" | "done"; picks: Pick[]; searched: string[] }>;
  dropped: { pain_id: string; tool_ids: string[] }[];
  security: { pain_id: string; required: string[]; confirmed: string[]; unverified: boolean }[];
  mesh: MeshMsg[];
  meshStarted: boolean;
  scored: Scored[];
  stack?: Stack;
  verdicts?: { summary: string; by_tool: Record<string, string> };
  plan?: Plan;
  approved?: string[];
  memorySaved?: { facts: number; episodes: number };
  error?: string;
  lastSeq: number;
  feed: { seq: number; type: string; agent: string | null }[];
};

const initial: RunView = {
  status: "loading",
  agents: { intake: "idle", memory: "idle", diagnoser: "idle", scout: "idle", mesh: "idle", roi: "idle", approval: "idle", planner: "idle" },
  label: "Connecting to your advisors…",
  pains: [],
  scouts: {},
  dropped: [],
  security: [],
  mesh: [],
  meshStarted: false,
  scored: [],
  lastSeq: -1,
  feed: [],
};

type Action = { kind: "event"; e: RunEvent } | { kind: "reset" } | { kind: "status"; status: RunView["status"]; mode?: RunView["mode"] };

function agentOf(a: string | null): AgentKey | null {
  if (!a) return null;
  if (a.startsWith("scout")) return "scout";
  if (a.startsWith("mesh")) return "mesh";
  return a as AgentKey;
}

function apply(s: RunView, e: RunEvent): RunView {
  if (e.seq !== -1 && e.seq <= s.lastSeq) return s;
  const n: RunView = { ...s, agents: { ...s.agents }, lastSeq: Math.max(s.lastSeq, e.seq), feed: [...s.feed, { seq: e.seq, type: e.type, agent: e.agent }] };
  const ag = agentOf(e.agent);
  const d = e.data || {};
  switch (e.type) {
    case "run.start":
      n.status = "running";
      n.mode = d.mode;
      break;
    case "agent.start":
      if (ag) n.agents[ag] = "working";
      n.label = d.label || n.label;
      if (ag === "scout" && d.pain_id) n.scouts = { ...n.scouts, [d.pain_id]: { status: "working", picks: [], searched: [] } };
      break;
    case "intake.done":
      n.agents.intake = "done";
      n.profile = d.profile;
      n.rawPains = d.raw_pains;
      n.facts = d.facts;
      break;
    case "memory.recalled":
      n.agents.memory = "done";
      n.memory = d as RunView["memory"];
      break;
    case "pain.ranked":
      n.agents.diagnoser = "done";
      n.pains = d.pains;
      n.agents.scout = "working";
      break;
    case "scout.result":
      n.scouts = { ...n.scouts, [d.pain_id]: { status: "done", picks: d.picks, searched: d.searched } };
      break;
    case "guard.dropped":
      n.dropped = [...n.dropped, d as { pain_id: string; tool_ids: string[] }];
      break;
    case "guard.security":
      n.security = [...n.security.filter((g) => g.pain_id !== d.pain_id), d as RunView["security"][number]];
      break;
    case "mesh.start":
      n.agents.scout = "done";
      n.agents.mesh = "working";
      n.meshStarted = true;
      n.label = "Advisor panel is debating the shortlist";
      break;
    case "mesh.message":
      n.mesh = [...n.mesh, d as MeshMsg];
      if (n.mesh.length >= 3) n.agents.mesh = "done";
      break;
    case "stack.scored":
      n.agents.mesh = "done";
      n.agents.roi = "done";
      n.scored = d.scored;
      n.stack = d.stack;
      n.verdicts = d.verdicts;
      break;
    case "approval.waiting":
      n.status = "awaiting_approval";
      n.agents.approval = "working";
      n.label = "Waiting for your approval";
      break;
    case "plan.ready":
      n.agents.approval = "done";
      n.agents.planner = "done";
      n.plan = d.plan;
      n.approved = d.approved_tool_ids;
      break;
    case "memory.saved":
      n.memorySaved = d as RunView["memorySaved"];
      break;
    case "run.complete":
      n.status = "complete";
      n.label = "Done — your plan is ready";
      break;
    case "run.error":
      n.status = "error";
      n.error = d.message;
      break;
    case "stream.end":
      break;
  }
  if (e.type === "agent.start" && ag === "planner") n.agents.approval = "done";
  return n;
}

function reducer(s: RunView, a: Action): RunView {
  if (a.kind === "reset") return initial;
  if (a.kind === "status") return { ...s, status: a.status, mode: a.mode ?? s.mode };
  return apply(s, a.e);
}

const TERMINAL = new Set(["approval.waiting", "run.complete", "run.error", "stream.end"]);

export function useRunStream(runId: string) {
  const [view, dispatch] = useReducer(reducer, initial);
  const esRef = useRef<EventSource | null>(null);
  const seqRef = useRef(-1);

  const open = useCallback(() => {
    esRef.current?.close();
    const es = new EventSource(`/api/runs/${runId}/stream?after=${seqRef.current}`);
    esRef.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      if (e.seq > seqRef.current) seqRef.current = e.seq;
      dispatch({ kind: "event", e });
      if (TERMINAL.has(e.type)) es.close();
    };
    es.onerror = () => {
      // Browser auto-reconnects with Last-Event-ID; only give up if the stream is closed for good.
      if (es.readyState === EventSource.CLOSED) esRef.current = null;
    };
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    dispatch({ kind: "reset" });
    seqRef.current = -1;
    api<{ status: string; mode: "live" | "replay"; events: RunEvent[] }>(`/runs/${runId}`)
      .then((r) => {
        if (cancelled) return;
        for (const e of r.events) {
          seqRef.current = Math.max(seqRef.current, e.seq);
          dispatch({ kind: "event", e });
        }
        dispatch({ kind: "status", status: r.status as RunView["status"], mode: r.mode });
        if (r.status === "running") open();
      })
      .catch((err) => !cancelled && dispatch({ kind: "event", e: { seq: -1, t: 0, type: "run.error", agent: null, data: { message: err.message } } }));
    return () => {
      cancelled = true;
      esRef.current?.close();
    };
  }, [runId, open]);

  const approve = useCallback(
    async (toolIds: string[]) => {
      await api(`/runs/${runId}/approve`, { method: "POST", json: { tool_ids: toolIds } });
      dispatch({ kind: "status", status: "running" });
      open();
    },
    [runId, open],
  );

  return { view, approve };
}
