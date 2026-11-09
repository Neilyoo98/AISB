# Coworker mesh — API contract (shared by backend + frontend agents)

Plan: C:\Users\Neil\.claude\plans\replicated-herding-emerson.md. Same coordination rules as docs/PHASE2_CONTRACT.md
(own your files; re-read before Edit on shared files; no git/build/servers; verify with tsc/eslint/pytest).

## Types
```ts
type EmployeeStatus = "available" | "busy" | "off";
type Employee = { id: string; name: string; role: string; skills: string[]; responsibilities: string;
  tools: string[];            // catalog tool ids or plain names of tools they use
  status: EmployeeStatus; user_id: string | null; initials: string; facts_count: number };
type Constitution = { employee: Employee; facts: {category: string; predicate: string; object: string}[];
  past_tasks: {id: string; text: string; role_in_task: string; created_at: string}[] };

type Route = { owner_id: string;            // best-matching coworker (context owner)
  owner_reason: string;                     // plain sentence
  substituted: boolean;                     // owner is Off -> coworker covers, human step goes to `human_id`
  human_id: string;                         // who actually does the human step
  substitution_note: string | null;         // "Maria is off today, so her coworker answered from her notes and Luis takes the call."
  scores: {employee_id: string; score: number}[] };
type MeshMessage = { from_id: string; to_id: string; context_shared: string; should_check: string; confidence: "low"|"medium"|"high" };
type WorkflowStep = { n: number; actor_type: "employee"|"tool"|"customer"; actor_id: string | null; // employee id or tool id
  action: string; tool_id: string | null; manual_before: string | null;  // "Maria types the quote by hand"
  handoff_to: string | null;  // employee id | tool id | "customer"
  gap: boolean; gap_capability: string | null;
  recommendations: {tool_id: string; reason: string}[] };  // only when gap
type Draft = { kind: "customer_reply"|"staff_message"|"review_response"|"quote"|"other"; title: string; to: string; body: string };
type CoworkerTask = { id: string; text: string; status: "running"|"awaiting_approval"|"approved"|"rejected"|"error";
  mode: "live"|"replay"; created_at: string;
  result: null | { intent: string; urgency: "low"|"normal"|"high"; route: Route; mesh: MeshMessage[];
    workflow: WorkflowStep[]; drafts: Draft[];
    send_log?: {channel: string; via_tool_id: string|null; to: string; summary: string}[];   // after approve; ALWAYS labeled simulated
    assigned_tasks?: {task_id: number; assignee_id: string; text: string}[] } };
```

## Endpoints (auth required; owner/admin for writes unless noted)
- `GET /employees` → `Employee[]` (members can read)
- `POST /employees {name, role, skills[], responsibilities, tools[], user_id?}` → `Employee` (generates constitution facts in background)
- `PATCH /employees/{id} {...same fields optional}` → `Employee`
- `PATCH /employees/{id}/status {status}` → `Employee` (members may set their own)
- `DELETE /employees/{id}`
- `GET /employees/{id}` → `Constitution`
- `POST /coworker-tasks {text ≤300}` → `{id, mode}` (sample businesses: if text matches a recorded demo task exactly → replay, else live; rate limit 10 live/day/business; 402 when spend cap reached)
- `GET /coworker-tasks` → `CoworkerTask[]` (newest first, max 20, result omitted except status)
- `GET /coworker-tasks/{id}` → `CoworkerTask & {events: RunEvent[]}`
- `GET /coworker-tasks/{id}/stream` → SSE `RunEvent`s (same format as /runs/{id}/stream; `?after=` supported)
- `POST /coworker-tasks/{id}/approve {approve: boolean}` → `{ok}`; stream then continues with finalize events
- `GET /coworker-tasks/examples` → `string[]` (3 example task texts for this business; sample businesses return their recorded ones)

## SSE event types (data payloads)
`task.start {mode}` · `task.read {intent, urgency, needed_skills[], needed_capabilities[]}` ·
`route.chosen {route}` · `route.substituted {owner_id, human_id, note}` (only when substituted) ·
`mesh.message {MeshMessage}` (1–3) · `workflow.ready {workflow}` · `gap.found {step_n, capability, recommendations}` ·
`drafts.ready {drafts}` · `approval.waiting {}` · `task.approved {assigned_tasks, send_log}` · `task.rejected {}` ·
`memory.saved {employees: string[]}` · `task.complete {}` · `task.error {message}`.
Every event has `agent`: `"reader" | "router" | "coworker:{employee_id}" | "builder" | "drafter" | "you" | "memory"`.

## Dashboard
`GET /dashboard` tasks gain `assignee: {id, name, initials} | null`.
