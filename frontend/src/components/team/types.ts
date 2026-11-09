// Types for the merged Team page (see docs/TEAM_MERGE_CONTRACT.md).
export type PersonStatus = "available" | "busy" | "off";

export type PersonToolSource = "uses" | "approved_request" | "self_declared" | "assigned_task";

export type PersonTool = {
  tool_id: string | null;
  name: string;
  source: PersonToolSource;
  catalog: boolean;
  monthly_cost: number | null;
  since: string | null;
};

export type Person = {
  id: string;
  name: string;
  role: string;
  initials: string;
  status: PersonStatus;
  skills: string[];
  responsibilities: string;
  is_owner: boolean;
  has_login: boolean;
  email: string | null;
  pending_invite_url: string | null;
  ai_tools: PersonTool[];
  open_tasks: number;
  // present on some backends (profile tools); optional so older payloads still type-check
  tools?: string[];
};

export type PersonDetail = Person & {
  memory: { category: string; predicate: string; object: string }[];
  requests: { id: number; tool_id: string; name: string; status: string; created_at: string }[];
  tasks: { id: number; text: string; done: boolean }[];
  coworker_tasks: { id: string; text: string; role_in_task: string; created_at: string }[];
};

export type Impact = { adds: number; projected: number; cap: number | null; over_cap: boolean };
export type Req = {
  id: number; tool_id: string; tool_name: string; reason: string; seats: number; est_monthly_cost: number;
  status: "pending" | "approved" | "denied"; override: boolean; source: string; requester: string; mine: boolean;
  decided_by: string | null; decided_at: string | null; created_at: string; impact: Impact | null;
};
export type License = { id: number; tool_id: string; name: string; seats_bought: number; seats_assigned: number; renewal_date: string | null; monthly_cost: number | null };
export type Shadow = { id: number; tool_name: string; note: string; status: "open" | "converted"; user: string; catalog_id: string | null };
export type Spend = { cap: number | null; committed_monthly: number; headroom: number | null; over_cap: boolean; pct: number | null };
export type TeamData = {
  role: "admin" | "member";
  business_name: string;
  requests: Req[];
  licenses: License[];
  shadow: Shadow[];
  spend: Spend;
};

export type Act = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

export const STATUS_LABEL: Record<PersonStatus, string> = { available: "Available", busy: "Busy", off: "Off today" };

export const TOOL_SOURCE_LABEL: Record<PersonToolSource, string> = {
  uses: "On their profile",
  approved_request: "Approved for them",
  self_declared: "Using without approval",
  assigned_task: "Used in their tasks",
};

export const short = (n: string) => n.replace(/ \(.*\)$/, "");
export const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
export const fullUrl = (url: string) => (typeof window !== "undefined" && url.startsWith("/") ? `${window.location.origin}${url}` : url);

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
