// Coworker mesh types — mirror docs/COWORKERS_CONTRACT.md.
import type { RunEvent } from "@/lib/types";

export type EmployeeStatus = "available" | "busy" | "off";

export type Employee = {
  id: string;
  name: string;
  role: string;
  skills: string[];
  responsibilities: string;
  /** catalog tool ids or plain names */
  tools: string[];
  status: EmployeeStatus;
  user_id: string | null;
  initials: string;
  facts_count: number;
};

export type Constitution = {
  employee: Employee;
  facts: { category: string; predicate: string; object: string }[];
  past_tasks: { id: string; text: string; role_in_task: string; created_at: string }[];
};

export type Route = {
  owner_id: string;
  owner_reason: string;
  substituted: boolean;
  human_id: string;
  substitution_note: string | null;
  scores?: { employee_id: string; score: number }[];
};

export type MeshMessage = { from_id: string; to_id: string; context_shared: string; should_check: string; confidence: "low" | "medium" | "high" };

export type WorkflowStep = {
  n: number;
  actor_type: "employee" | "tool" | "customer";
  actor_id: string | null;
  action: string;
  tool_id: string | null;
  manual_before: string | null;
  handoff_to: string | null;
  gap: boolean;
  gap_capability: string | null;
  recommendations: { tool_id: string; reason: string }[];
};

export type Draft = { kind: "customer_reply" | "staff_message" | "review_response" | "quote" | "other"; title: string; to: string; body: string };
export type SendLogEntry = { channel: string; via_tool_id: string | null; to: string; summary: string };
export type AssignedTask = { task_id: number; assignee_id: string; text: string };

export type TaskStatus = "running" | "awaiting_approval" | "approved" | "rejected" | "error";

export type CoworkerResult = {
  intent: string;
  urgency: "low" | "normal" | "high";
  route: Route;
  mesh: MeshMessage[];
  workflow: WorkflowStep[];
  drafts: Draft[];
  send_log?: SendLogEntry[];
  assigned_tasks?: AssignedTask[];
};

export type CoworkerTask = {
  id: string;
  text: string;
  status: TaskStatus;
  mode: "live" | "replay";
  created_at: string;
  result: CoworkerResult | null;
};

export type CoworkerTaskDetail = CoworkerTask & { events: RunEvent[] };

export const STATUS_LABEL: Record<EmployeeStatus, string> = { available: "Available", busy: "Busy", off: "Off today" };
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  running: "Working",
  awaiting_approval: "Needs your OK",
  approved: "Approved",
  rejected: "Rejected",
  error: "Didn't finish",
};

// ---- Task queue (docs/TASK_QUEUE_CONTRACT.md) ----
export type TaskStage = "planning" | "needs_ok" | "in_progress" | "done" | "rejected";
export type QueuePerson = { id: string; name: string; initials: string; role?: string };
export type QueueStep = { task_id: number; text: string; done: boolean; assignee: QueuePerson | null };
export type QueueTask = {
  id: string;
  text: string;
  created_at: string;
  mode: "live" | "replay";
  status: TaskStatus;
  stage: TaskStage;
  assignee: QueuePerson | null;
  covering_for: { id: string; name: string } | null;
  progress: { done: number; total: number };
  steps: QueueStep[];
};
export type QueueTaskDetail = CoworkerTaskDetail & Partial<Omit<QueueTask, keyof CoworkerTask>>;

export const STAGE_LABEL: Record<TaskStage, string> = {
  planning: "Planning",
  needs_ok: "Needs your OK",
  in_progress: "In progress",
  done: "Done",
  rejected: "Rejected",
};
export const STAGE_LABEL_EMPLOYEE: Record<TaskStage, string> = { ...STAGE_LABEL, needs_ok: "Waiting for owner" };

/** Fallback when the API hasn't sent a stage yet. */
export function stageOf(t: { stage?: TaskStage; status: TaskStatus; progress?: { done: number; total: number } }): TaskStage {
  if (t.stage) return t.stage;
  if (t.status === "running") return "planning";
  if (t.status === "awaiting_approval") return "needs_ok";
  if (t.status === "rejected" || t.status === "error") return "rejected";
  const p = t.progress;
  return p && p.total > 0 && p.done >= p.total ? "done" : "in_progress";
}
