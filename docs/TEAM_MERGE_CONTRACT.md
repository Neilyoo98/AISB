# Team + Coworkers merge, account roles — shared contract

Coordination rules: same as docs/PHASE2_CONTRACT.md (own your files; re-read before Edit on shared files;
no git / `npm run build` / servers; verify with `npx tsc --noEmit`, `npx eslint <your files>`, `pytest -q`).

## Product model (simple language)
- One **Team** page, tabs: **People** · **Tasks** · **Spending**. (`/agents` redirects to `/team?tab=tasks`.)
- A **person** = an employee profile (skills, what they handle, status Available/Busy/Off, their AI coworker memory)
  + optionally a login (linked user account). Each person appears ONCE.
- Owner can click a person to see **the AI tools that person uses/owns**.
- Accounts are either **Owner** (owns the business, approves, sees spending) or **Employee** (joined via invite, requests
  tools, sees their tasks). Sign-up asks which one.

## API (backend workstream A)
- `POST /auth/register {name, email, password, account_type: "owner"|"employee", invite_code?}`
  - owner → as today (then /onboard). employee → `invite_code` required (accept full link or code); joins that business,
    links/creates their person profile. 400 with a friendly message if the code is invalid/expired.
- `GET /me` adds `account_role: "owner"|"employee"`, `person_id: string|null`.
- `GET /auth/demo-accounts` items add `employee: {name, role}` (the sample employee login for that business).
- `POST /auth/demo/{persona_id}?as=employee` → logs in as that business's sample employee (e.g. Luis Ortega at CoolAir).
- `GET /people` → `Person[]`; `GET /people/{id}` → `PersonDetail`.
- `POST /people {name, role, skills[], responsibilities, tools[], invite?: boolean}` → `{person, invite_url|null}`
  (owner/admin). When `invite` is true an invite link bound to this person is created (joining links the login to this
  profile instead of creating a new one).
- `PATCH /people/{id}`, `PATCH /people/{id}/status {status}` (employees may set their own), `DELETE /people/{id}`,
  `POST /people/{id}/invite` → `{invite_url}` (for a person without a login).
- Existing `/employees*` and `/team*` endpoints keep working (aliases) so nothing else breaks.

```ts
type PersonTool = { tool_id: string | null; name: string; source: "uses" | "approved_request" | "self_declared" | "assigned_task";
  catalog: boolean; monthly_cost: number | null; since: string | null };
type Person = { id: string; name: string; role: string; initials: string; status: "available"|"busy"|"off";
  skills: string[]; responsibilities: string; is_owner: boolean; has_login: boolean; email: string | null;
  pending_invite_url: string | null; ai_tools: PersonTool[]; open_tasks: number };
type PersonDetail = Person & {
  memory: {category: string; predicate: string; object: string}[];       // what their AI coworker knows
  requests: {id: number; tool_id: string; name: string; status: string; created_at: string}[];
  tasks: {id: number; text: string; done: boolean}[];                    // dashboard tasks assigned to them
  coworker_tasks: {id: string; text: string; role_in_task: string; created_at: string}[] };
```
AI tools a person "owns": tools listed on their profile (`uses`), tool requests of theirs that were approved
(`approved_request`), tools they declared using without approval (`self_declared`), and tools named in coworker
workflow steps assigned to them (`assigned_task`). De-duplicate by tool_id/name, catalog names for catalog ids.

## Demo data
Each sample business: owner login (existing) + one employee login linked to a person (CoolAir: Luis Ortega,
Joe's: Marcus Lee, GreenLeaf: Tom Reyes). People keep the seeded staff/status from the coworker seed.
