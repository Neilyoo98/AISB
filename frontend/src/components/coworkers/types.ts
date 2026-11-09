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
