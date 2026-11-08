# Phase 2 build contract (shared by all workstreams)

Goal: user-requested UX overhaul + brief Module 3 (trust/risk) + Module 4 procurement (team mode).
Rules from CLAUDE.md / the brief still apply: no fabricated trust data, catalog is source of truth, math in pure
Python with tests, every LLM call through `llm.py` (fast tier, cached, per-user rate limit), no AI attribution in commits.

## Coordination rules (avoid merge conflicts)
- New backend endpoints go in **new router modules** under `backend/routers/` (`APIRouter`), each added to `main.py`
  with ONE `app.include_router(...)` line at the end of main.py (re-read main.py right before editing; others edit it too).
- New tables go in the router's own module (or a sibling module) using `from db import meta, engine` so `init_db()`
  creates them (the module must be imported in main.py before startup). Column additions to existing tables go in
  `db.py` only via small Edit calls (re-read first). `_add_missing_columns()` migrates deployed DBs automatically.
- Frontend: only the owner of a file edits it. `components/ui.tsx` nav is owned by workstream E. `lib/types.ts` is owned by
  workstream D; others declare local types in their own files.
- Do NOT run `npm run build`, dev servers, git, or deploy. Check with `npx tsc --noEmit`, `npx eslint <your files>`,
  and `backend/.venv/Scripts/python -m pytest -q`. Don't start the API (embedded Qdrant lock); unit-test pure code.

## General business categories (used everywhere in the UI)
`backend/categories.py` + `frontend/src/lib/categories.ts` (same data):

| id | label | internal verticals |
|---|---|---|
| food_drink | Food & drink | cafe, restaurant |
| home_field | Home & field services | hvac, landscaping, home_services |
| beauty_wellness | Beauty & wellness | salon |
| retail | Retail & e-commerce | retail |
| professional | Professional & office | (none) |
| other | Other | other |

A catalog tool's categories = union over its verticals; a tool with vertical `all` belongs to every category.
`GET /catalog` and `GET /tools/{id}` include `"categories": [...]` per tool. Discover filters by these, never by
specific business types. Onboarding/profile "Type of business" picks one of these ids (`details.business_category`).

## Adoption (adopt a tool into the workflow)
Table `adoptions(id, business_id, tool_id, source: "plan"|"manual", status: "adopted"|"removed", run_id NULL, created_at)`.
- Approving a War Room stack (live or replay, and seeded demos) records `source="plan"` adoptions.
- `GET /adoptions` → `{ "items": [{tool_id, source, adopted_at, run_id}], "scenarios": Scenario[], "scenarios_status": "ready"|"updating"|"none", "tasks": PlanTask-with-id[] }`
- `POST /adoptions {tool_id}` → adopts manually (auth; 10/day/user rate limit; 409 if already adopted). Starts a background
  refresh: one fast-tier LLM call writes (a) 2 day-in-the-life scenarios for ALL adopted tools + current tools, stored in
  `businesses.scenarios_json`, and (b) 3 setup tasks for the new tool appended to the business's task list.
  Also writes a memory episode + fact (Business Constitution).
- `DELETE /adoptions/{tool_id}` → status removed (refreshes scenarios).
- `GET /dashboard` adds `adopted: [{id,name,url,category,price,source}]`, and `latest.scenarios` prefers
  `businesses.scenarios_json` when present. Tasks list includes manual-adoption tasks.
- SSE/War Room: the War Room shows an "Adopted" badge on adopted tools and an "Adopt" button on non-adopted rows.

## Profile editing
`PATCH /businesses/me {name, location, description, details}` (owner only; demo accounts → 403 with friendly message).
Deterministically syncs `profile_json` (monthly_budget from budget choice, tech_comfort, employees, current_tools,
business_category) and upserts Constitution facts, so Dashboard / Discover fit / Compare update on next load.
Returns the business. `details` keys: business_category, team_size, budget, tech_comfort, current_tools[],
security_must_haves[], goals[].

## Trust & risk (Module 3)
Catalog `trust` grows to: `soc2, hipaa, gdpr, iso27001, no_training_on_customer_data, retention, data_residency, opt_out`,
each `{status: verified|vendor_claimed|unknown, source_url, as_of, quote|null}`. Filled ONLY from vendor-owned pages
with URL + date; otherwise `unknown`. `backend/risk.py` pure `assess(tool) -> {hallucination, bias, prompt_injection,
data_exfiltration}` each `{level: low|medium|high|not_assessed, reason, basis}` derived from catalog facts only.
`GET /tools/{id}` adds `"risk": {...}`. `scripts/parse_policy.py` (offline) extracts privacy fields from a policy URL/text.

## Team mode & procurement (Module 4, procurement parts)
Router `backend/routers/team.py`. Tables: `org_members(business_id, user_id, role admin|member)`,
`tool_requests(id, business_id, requester_id, tool_id, reason, seats, est_monthly_cost, status pending|approved|denied,
decided_by, decided_at, override)`, `licenses(id, business_id, tool_id, seats_bought, seats_assigned, renewal_date)`,
`shadow_tools(id, business_id, user_id, tool_name, note, created_at)`, `businesses.ai_spend_cap` column.
Endpoints under `/team/...`; approving a request records a `manual` adoption. Frontend page `/team`.
