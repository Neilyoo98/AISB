# CLAUDE.md — StackSmith (AISB Hack-a-thon, UMD)

> Working name: **StackSmith**, AI coworkers that help small businesses discover, compare and adopt AI tools.
> Rename freely. Built on the architecture of **AUBI** (github.com/Neilyoo98/GDSC-Hackathon).

## 0. Hard constraints (read first)

- **Deadline: video and prototype link due Sun Nov 8, 2026.** Solo builder. Each feature has to earn its time. Follow the cut lines in §9.
- **LLM budget: $25 OpenRouter credit total.** Every LLM call goes through `backend/llm.py` (§6). Never call OpenRouter from the browser.
- **Judges must be able to test it with no friction.** The login page has a **"Sample businesses"** panel with one-click login cards (§7a). Owners can also register with email + password to save their own business. Demo accounts open on a lived-in dashboard, not an empty state.
- **Secrets:** the OpenRouter key lives only in `backend/.env` (git-ignored) and in Railway env vars. **This repo is public.** Never paste the key into code, docs, commits, logs or the frontend.
- **No hallucinated tools.** Agents may recommend only tools that exist in `backend/data/catalog.json`. Validate IDs and drop anything unknown.
- **IP:** UMD owns all hack-a-thon submissions. Code copied from AUBI becomes part of a UMD-owned submission. Copy patterns, not large verbatim chunks, if that matters to you.
- Commits are authored as `Neilyoo98 <194648525+Neilyoo98@users.noreply.github.com>`. No AI co-author lines.

## Current status (Nov 8, 2026)

Built and verified end to end locally: sample-business login → dashboard → War Room replay → approval → 30-day plan → memory writeback; register → onboard → **live** AI run. 10 backend tests pass (`pytest -q`). Sample-business recordings live in `backend/data/demo_runs/*.json`. Regenerate them with `python -m scripts.precompute_demos` after prompt or ROI changes, then call `seed.reset_demos()`.

Stack selection (`roi.pick_stack`): per pain, pick the highest-net tool within 10 fit points of the best fit. Then consolidate: drop a tool whenever moving its pains onto tools already in the stack doesn't lower total net. Owners hate juggling apps. Scouts never recommend tools the owner already uses.

## Deployment (live)

- **App (give this to judges):** https://stacksmith-tan.vercel.app (Vercel project `stacksmith`, root `frontend/`, env `BACKEND_URL`)
- **API:** https://api-production-f081.up.railway.app (Railway project `stacksmith`, service `api`, Dockerfile in `backend/`)
- Railway volume at `/data` holds SQLite (`DATABASE_URL=sqlite:////data/stacksmith.db`) and embedded Qdrant (`QDRANT_PATH=/data/qdrant`), so no separate DB or Qdrant service is needed. Demo accounts reseed on boot.
- Deploy tokens live in `~/.stacksmith-deploy.env` (outside the repo). Redeploy:
  - API: `cd backend && set -a && . ~/.stacksmith-deploy.env && set +a && unset RAILWAY_API_TOKEN && railway up --service $RAILWAY_SERVICE_ID --environment $RAILWAY_ENV_ID --ci`
  - Web: `cd frontend && vercel deploy --prod --yes --token $VERCEL_TOKEN`
- Reset sample businesses after judges poke at them: `curl -X POST $API/admin/reset-demos -H "x-admin-token: $ADMIN_TOKEN"`.
- Spend so far: `curl $API/ready` shows `spend_usd` against `spend_cap_usd`.

## Phase 1 platform modules (Nov 8)

Branch `feat/platform-modules`. This covers brief Modules 1 & 2 (discovery, comparison) plus the UX cleanup and the Agents page.

**Frontend routes**
- `/agents`: two tabs. "Advisor team" replays the latest run's events as an animated agent network (`lib/agents.ts`: `AGENT_NODES`, `hopsFromEvents`). "Your AI tools" draws the approved tools, existing tools and people as a graph built from the plan's `scenarios` (`lib/stack.ts`).
- `/tools`: semantic search (debounced) plus filters.
- `/tools/[id]`: Overview, Reviews and Trust tabs.
- `/compare?ids=a,b,c`: 2–4 tools, with weight sliders, 12/36-month TCO and integration badges.
- UI kit in `components/ui.tsx`: `HelpTip` (`?` popovers for long copy), `PageHeader`, `PageState`, `FlowStepper`, `Stars`, `Ease`, `useTitle`.

**Backend routes**
- `GET /catalog/search?q=&vertical=&category=&max_price=&modality=&deployment=`: Qdrant semantic search via `store.search_catalog`.
- `GET /tools/{id}`: the tool, review aggregates, reviews, and `can_review` / `verified_eligible`.
- `POST /tools/{id}/reviews`: auth required, 5/day, one review per tool per business.
- `POST /evaluate`: `{ids, weights, seats, months, usage_per_month}` → score + `tco_12` / `tco_36` + integration. Public; personalized when logged in.
- `GET` / `PUT /businesses/me/weights`: one saved preset per business, plus built-in presets.
- `/catalog` responses now include `reviews` aggregates.

**Data**
- New `reviews` table (`verified_use` = the business approved the tool in a completed run ≥14 days ago, via `db.has_verified_use`).
- New columns `businesses.details_json` (structured onboarding answers) and `businesses.weights_json`. `db._add_missing_columns()` ALTERs already-deployed databases on boot.

**Catalog fields** (validated in `tests/test_catalog.py`)
- `capability`, `modalities_in`, `modalities_out`, `workflows`, `deployment`, `api_available`;
- `pricing_model` (flat | per_seat | usage) with `unit`, `unit_price`, `seats_included`, `units_included`;
- `trust.{no_training_on_customer_data, soc2}`, each `{status: vendor_claimed|verified|unknown, source_url, as_of}`. A non-unknown status requires a source URL and date.
- Suggestions come from `scripts/enrich_catalog.py` (fast model). A human reviews them, then `--apply` merges them. It never runs at runtime.

**Math** (`backend/evaluate.py`, pure, tested in `tests/test_evaluate.py`)
- `normalize_weights`, `score_tool` (cost, ease, fit, security, scalability, support; unknown data → neutral 5 flagged `no_data`), `tco`, `integration_status` (native / via_zapier_or_make / none).

**Security must-haves**
- The onboarding chips (`no_training`, `soc2`) are stored in `details`. `tool_scout` hard-filters on *sourced* trust facts only.
- When no tool is confirmed, picks carry a `security_note` ("unknown, verify with the vendor") and a `guard.security` SSE event fires.

**Demo history**
- Seeded sample-business runs are backdated 45 days (`seed.DEMO_HISTORY_DAYS`).
- Sample reviews come from `data/sample_reviews.json`, are flagged `is_demo`, and show in the UI as "Sample review (demo data)". `seed.reset_demos()` restores both.

**What's real and what isn't** (list this in the PR)
- Every `trust.*` field is `unknown` (Module 3 will source them).
- Sample reviews are demo data.
- Taxonomy fields are LLM-suggested and human-reviewed.
- Per-seat and usage unit prices are approximate list prices.
- Security and support scores show "no data" where facts are unknown.

## 1. The problem and the pitch

Mom-and-pop restaurants, coffee shops, HVAC techs and landscapers know "AI could help" but not **which tool fixes which problem, what it costs, or how to start.** Today's directories (There's An AI For That, G2) list thousands of tools with no fit to the business.

**StackSmith is not a directory.** Each business gets a persistent **Business Constitution**, a memory of its vertical, size, budget, current tools, tech comfort and pains. A team of AI advisor agents:

1. **Diagnoses** the owner's top pains in dollars (hours/week × wage, plus lost revenue).
2. **Scouts** a curated catalog of real tools for each pain.
3. **Debates** the shortlist from three angles: budget, ease of use, and fit with tools already in use.
4. **Computes ROI deterministically** (monthly cost against hours saved, and payback in days).
5. Waits for **owner approval** of the stack (human-in-the-loop).
6. Writes a **30-day adoption plan** and remembers the outcome.

Business value line for the video: *"Show a plumber three tools that pay for themselves in under 30 days, explained in the owner's own words, instead of 3,000 tools on a directory."*

## 2. AUBI → StackSmith mapping

| AUBI | StackSmith |
|---|---|
| Context Constitution per developer | **Business Constitution** per business (Qdrant `business_facts`) |
| `issue_reader` | `intake_parser`: free text → structured profile and pains |
| `ownership_router` | `pain_diagnoser`: ranks pains by $ impact |
| `query_single_agent` fan-out (`Send`) | `tool_scout` fan-out, one per pain |
| `coworker_mesh_exchange` | `advisor_mesh`: Budget Hawk, Ease-of-Use Coach, Integration Checker |
| `fix_generator` + `test_runner` | `roi_comparator`: deterministic Python math plus a validation gate |
| `approval_gate` (`interrupt`) | `approval_gate`: the owner approves or removes tools |
| `pr_pusher` + episode writeback | `adoption_planner` + `memory_writeback` |
| War Room (SSE) | **War Room**: live agent stream, the centerpiece of the video |

## 3. Stack (same as AUBI)

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind + Framer Motion, on **Vercel**. A Next.js API route proxies to the backend, so the browser talks only to Vercel.
- **Backend:** FastAPI + **LangGraph**, on **Railway**, **single worker** (the `MemorySaver` checkpointer holds paused approvals in process, as in AUBI). OpenRouter is called directly with `httpx` in `llm.py` (no LangChain wrapper), which gives exact per-call cost from `usage.cost`.
- **Vector memory:** Qdrant. `QDRANT_URL` set → Qdrant Cloud (payload indexes are created for strict mode). Empty → embedded on-disk Qdrant at `QDRANT_PATH`, so no extra service is needed.
- **Embeddings:** `fastembed` with `sentence-transformers/all-MiniLM-L6-v2` (384-d). This is the same model as AUBI, but ONNX instead of torch, so the Docker image stays small and Railway builds fast.
- **Relational data:** SQLAlchemy Core in `db.py` (`create_all`, no migrations). `DATABASE_URL` set → Postgres; empty → SQLite file. On Railway, either attach Postgres or mount a volume at `/data` and point SQLite/Qdrant there.
- **Auth (keep it simple):** email + password, `passlib[bcrypt]` hashes, a JWT (7-day expiry) in an httpOnly `SameSite=Lax` cookie set by the Next.js proxy. No OAuth, email verification or password reset. A Next.js `middleware.ts` redirects unauthenticated users from app pages to `/login`. Demo logins are ordinary seeded users flagged `is_demo=true` (§7a).
- **Streaming:** SSE from FastAPI → Next.js proxy → `useRunStream` hook.

## 4. Repo layout

```
backend/
  main.py                 # FastAPI app, routes, CORS limited to the Vercel origin
  llm.py                  # ONLY place that builds LLM clients; budget guard and cache
  auth.py                 # register/login/guest, JWT helpers
  db/ schema.sql, session.py, repo.py
  graphs/
    state.py              # AdvisorState TypedDict
    advisor_graph.py      # LangGraph build + nodes
    prompts.py            # all prompts as constants
    sse_events.py         # event names and payload helpers
  memory/
    store.py              # Qdrant: catalog, business_facts, episodes
    constitution.py       # build/update the Business Constitution
  roi.py                  # pure deterministic ROI math (unit tested)
  data/
    catalog.json          # curated AI tool catalog (source of truth)
    personas.json         # demo businesses
  scripts/
    seed_qdrant.py        # embed catalog, load personas
    precompute_demos.py   # run the graph once per persona, cache the results
  tests/ test_roi.py, test_catalog.py, test_graph_smoke.py
  Dockerfile, requirements.txt, .env.example
frontend/
  src/app/
    page.tsx              # landing: pitch + "Try a demo business" + login
    onboard/page.tsx      # describe your business (free text + a few chips)
    war-room/[runId]/     # live agent stream (centerpiece)
    stack/[runId]/        # comparison matrix, ROI, approve
    plan/[runId]/         # 30-day adoption plan
    profile/page.tsx      # Business Constitution viewer/editor
    api/[...path]/route.ts# proxy to the backend (forwards cookie, streams SSE)
  src/hooks/useRunStream.ts
  src/components/...
railway.toml, vercel.json, README.md, CLAUDE.md
```

## 5. Agent graph (`backend/graphs/advisor_graph.py`)

`AdvisorState` holds `run_id, business_id, raw_input, profile, pains[], candidates{pain_id: [...]}, critiques[], scored_stack[], approved_tool_ids[], plan, events[]`.

| # | Node | Model tier | Does | Emits SSE |
|---|---|---|---|---|
| 1 | `intake_parser` | fast | Free text → `profile` (vertical, employees, revenue band, monthly AI budget, current tools, tech comfort 1–5) and raw pains. Structured output via a Pydantic schema. | `intake.done` |
| 2 | `memory_recall` | none | Qdrant: this business's facts and episodes, plus outcomes of similar businesses in the same vertical. | `memory.recalled` |
| 3 | `pain_diagnoser` | fast | Top 3 pains, each with `hours_per_week`, `hourly_cost`, and `revenue_at_risk` given as ranges with an explanation. | `pain.ranked` |
| 4 | `tool_scout` ×N (`Send`) | fast | Qdrant search on the pain, filtered by vertical/budget → top 6 → the LLM picks 3, with a fit reason **citing catalog fields**. IDs are validated against the catalog. | `scout.result` per pain |
| 5 | `advisor_mesh` | fast | Three personas critique the shortlist in parallel. JSON `{persona, tool_id, concern, severity, suggestion}`. | `mesh.message` (streamed one by one; this is what the video shows) |
| 6 | `roi_comparator` | none + smart (one call) | `roi.py` computes monthly cost, hours saved, $ saved, payback days and fit score. A single smart-model call writes a plain-English 2-sentence verdict per tool. | `stack.scored` |
| 7 | `approval_gate` | none | `interrupt()`. The UI shows the matrix; the owner keeps or removes tools. Resumed by `POST /runs/{id}/approve`. | `approval.waiting` |
| 8 | `adoption_planner` | smart | A 30-day plan for the approved tools only: weekly steps, setup time, who does it, success metric. | `plan.ready` |
| 9 | `memory_writeback` | none | Stores facts and an episode (`approved X for pain Y`) in Qdrant and saves the run to Postgres. | `memory.saved` |

Rules:
- Every node catches its own errors and emits `node.error` with a friendly message. The War Room must never hang silently.
- ROI numbers come from `roi.py` only. **The LLM never does the math.** It supplies estimates; Python computes the totals.
- Show a "Why this tool?" evidence panel (catalog fields plus the critiques that mention it), like AUBI's "Why this owner?".

## 6. LLM and budget (`backend/llm.py`)

- One `ChatOpenAI(base_url="https://openrouter.ai/api/v1", api_key=OPENROUTER_API_KEY, default_headers={"HTTP-Referer": APP_URL, "X-Title": "StackSmith"})` per tier.
- Two tiers via env: `MODEL_FAST=anthropic/claude-haiku-5.5` ($0.10/$0.50 per M tokens; nodes 1, 3, 4, 5) and `MODEL_SMART=anthropic/claude-sonnet-5.5` ($2/$10; nodes 6 verdict and 8).
- **Reasoning gotcha:** Haiku 5.5 thinks adaptively and hidden reasoning ate the JSON budget (empty/truncated output), so the fast tier sends `reasoning: {enabled: false}`. Sonnet 5.5 *requires* reasoning, so the smart tier sends `{effort: "low"}` with larger `max_tokens`. On `finish_reason == "length"` the retry gets 1.8x tokens.
- Measured: a full live run costs about **$0.03** and takes about 17s.
- Target cost per full run: **≤ $0.05.** At that rate $25 covers about 500 runs.
- Guards:
  - `max_tokens` set on every call.
  - Response cache keyed by `sha256(model + prompt)` in Postgres. **Demo personas are pre-computed** by `scripts/precompute_demos.py` and replayed through the same SSE stream with realistic delays, so judges clicking demos cost $0.
  - Per-user limit: 5 live runs per day (guest accounts: 0 live runs, replay only, plus 1 "describe your own" run per IP per day).
  - Track spend from OpenRouter `usage` in each response. If `SPEND_CAP_USD` (default 18) is reached, live runs are refused with a friendly message, which keeps a buffer for demo day.
  - Also set a credit limit on the key itself in the OpenRouter dashboard.

## 7. Data

**`catalog.json`** (60–100 tools). This is the credibility of the whole product. Schema:
```json
{ "id": "jobber", "name": "Jobber", "url": "...", "category": "field_service",
  "verticals": ["hvac","landscaping","cleaning"], "solves": ["quoting","scheduling","invoicing","missed_calls"],
  "ai_features": ["AI receptionist","auto quote writing"], "price_monthly_min": 0, "price_monthly_typical": 0,
  "free_tier": false, "setup_hours": 3, "tech_comfort_min": 2, "integrates_with": ["quickbooks","google_calendar"],
  "pros": [], "cons": [], "price_verified_on": "2026-11-08" }
```
Categories to cover: AI receptionist/phone, reviews and reputation, social and marketing content, email/SMS marketing, scheduling/booking, quoting and invoicing, field service management, POS/restaurant ops, bookkeeping, customer chat, general assistants (ChatGPT/Claude/Gemini), website builders, and staff scheduling.
Drafting with an LLM is fine, **but check the price and URL of every tool in the demo personas' top recommendations by hand.** Show "prices as of Nov 2026, verify before buying" in the UI.

### 7a. Login and sample businesses (built for the demo)

**Login page (`/login`)** has two columns:
- Left: **"Sample businesses — log in instantly"**. Six cards, each with icon, name, vertical, a one-line pain and a **"Log in as Joe"** button. One click calls `POST /auth/demo/{persona_id}` → cookie → `/dashboard`.
- Right: an ordinary email/password **Log in / Create account** form. A new user goes to `/onboard` and builds their own business.

**`personas.json`** seeds a user, a business, its Constitution facts and **one completed past run** for each persona. Each is detailed enough that the agents produce meaningfully different stacks:

| id | Business | Owner login | Vertical | Size / budget | Tech comfort | Headline pains |
|---|---|---|---|---|---|---|
| `joes-coffee` | Joe's Corner Coffee, College Park | joe@demo.stacksmith | café | 6 staff, $150/mo | 2 | staff scheduling chaos, slow Instagram, weekday-afternoon slump |
| `coolair-hvac` | CoolAir HVAC, Silver Spring | maria@demo.stacksmith | HVAC | 4 techs, $300/mo | 3 | **missed calls on jobs (~$4k/mo lost)**, slow quotes, paper invoices |
| `greenleaf` | GreenLeaf Landscaping, Hyattsville | dev@demo.stacksmith | landscaping | seasonal crew of 8, $200/mo | 2 | quoting from site photos, crew routing, spring rush |
| `mama-rosas` | Mama Rosa's Trattoria, Bethesda | rosa@demo.stacksmith | restaurant | 15 staff, $250/mo | 1 | unanswered Google/Yelp reviews, phone takeout orders, menu costing |
| `bright-smile-salon` | Bright Smile Salon, Laurel | kim@demo.stacksmith | salon | 5 chairs, $100/mo | 3 | no-shows, rebooking, social posts |
| `route1-bikes` | Route 1 Bike Repair, College Park | sam@demo.stacksmith | retail/repair | 3 staff, $75/mo | 4 | inventory, repair status texts, website FAQs |

Each persona has a `raw_input` paragraph written in the owner's voice (casual, specific, including a few numbers). This is the text the War Room run starts from.

Demo account rules:
- Passwords are random and not displayed. Demo login goes only through `/auth/demo/{id}`, so nobody needs credentials.
- **Demo runs replay pre-computed results** (§6) and cost $0. A **"Run live with AI"** toggle on demo accounts allows 2 live runs per session so judges can see it isn't canned.
- A `POST /admin/reset-demos` endpoint (protected by `ADMIN_TOKEN`) plus a nightly `on startup` reseed restores demo data that judges edited.
- A banner reads "You're viewing a sample business. Create an account to analyze yours."

**Dashboard (`/dashboard`)**, the first screen after login, shows the business card, a Constitution summary, the last recommended stack with total $/month saved, 30-day plan progress (checkboxes saved to Postgres), and buttons for **"New analysis"** and **"Edit business profile"**.

**Postgres tables:** `users(id, email, password_hash, is_demo, created_at)`, `businesses(id, user_id, name, vertical, profile_json)`, `runs(id, business_id, status, input, result_json, cost_usd, created_at)`, `plan_tasks(id, run_id, week, text, done)`, `llm_cache(key, response, created_at)`.

**Qdrant collections:** `tool_catalog` (embedding of name + solves + ai_features + description), `business_facts` (`subject/predicate/object/category/confidence`, payload `business_id`), `episodes`.

## 8. API

`POST /auth/register` · `POST /auth/login` · `POST /auth/logout` · `POST /auth/demo/{persona_id}` · `GET /me`
`GET /dashboard` · `PATCH /plan-tasks/{id}` · `POST /admin/reset-demos`
`GET /personas` · `POST /businesses` · `GET/PATCH /businesses/{id}/constitution`
`POST /runs` (`{business_id, raw_input}` → `run_id`) · `GET /runs/{id}/stream` (SSE) · `POST /runs/{id}/approve` (`{tool_ids}`) · `GET /runs/{id}`
`GET /catalog` (filters: vertical, category, max_price) · `GET /health`

## 9. Build order for today (stop at any cut line and still have a demo)

1. **Skeleton (45 min):** FastAPI `/health` on Railway, Next.js on Vercel, proxy working, env vars set. Deploy *first*.
2. **Data (60 min):** `catalog.json` (start with 40 tools, grow later), `personas.json`, `seed_qdrant.py`.
3. **Graph, nodes 1–6 (2 h):** plus `roi.py` with tests. Run it from the CLI against one persona.
4. **War Room + SSE (90 min):** the centerpiece. Animated agent cards and mesh messages.
   — **CUT LINE A:** demo personas → War Room → stack matrix. Record the video if time is short.
5. **Approval gate + planner + plan page (60 min).**
6. **Auth + Postgres + sample businesses + dashboard (75 min).** Order: schema → seed personas → `/auth/demo` cards (judges need these) → register/login form → dashboard.
   — **CUT LINE B:** full flow.
7. **Precompute demos, spend guard, polish, mobile check (45 min).**
8. **Record the video (60 min, never skip; leave time for upload).**

If Railway or Qdrant breaks within an hour of the deadline, fall back to an in-memory catalog search (cosine similarity in numpy over pre-computed embeddings) and keep shipping.

## 10. Video outline (10 min)

1. 0:00 The problem: one owner, one pain, many tools (1 min).
2. 1:00 Live demo: login page → click the CoolAir HVAC sample card → dashboard → New analysis → War Room → mesh debate → stack + ROI → approve → 30-day plan → Constitution remembers (4 min).
3. 5:00 How we built it: architecture diagram, AUBI lineage, no-hallucination catalog guard, deterministic ROI, cost controls (2 min).
4. 7:00 **16-week roadmap** (2 min):
   - Wk 1–3: interview 20+ local businesses (College Park / Route 1), validate the pain taxonomy.
   - Wk 4–6: catalog to 300+ tools, pricing scraper + human review, partner with the UMD SBDC.
   - Wk 7–9: integrations (Google Business Profile, Square, QuickBooks) so the diagnosis uses real data instead of self-report.
   - Wk 10–12: guided setup ("do it with me" agents), outcome tracking at 30/60/90 days, feeding episodes back into rankings.
   - Wk 13–14: pilot with 10 businesses, measure hours saved and adoption rate.
   - Wk 15–16: Spanish/Korean/Chinese language support, accessibility, pricing model (free for owners; affiliate/referral or chamber-of-commerce licensing).
5. 9:00 Business value and the ask (1 min).

## 11. Commands

```bash
# backend
cd backend && python -m venv .venv && .venv/Scripts/activate && pip install -r requirements.txt
uvicorn main:app --reload --port 8000 --workers 1
python scripts/seed_qdrant.py && python scripts/precompute_demos.py
pytest -q

# frontend
cd frontend && npm install && npm run dev      # BACKEND_URL=http://localhost:8000
npm run build && npm run lint
```

Env (`backend/.env.example`, with placeholder values only): `OPENROUTER_API_KEY, MODEL_FAST, MODEL_SMART, SPEND_CAP_USD, QDRANT_URL, QDRANT_API_KEY, DATABASE_URL, JWT_SECRET, ADMIN_TOKEN, APP_URL, FRONTEND_ORIGIN`. The real key is already in `backend/.env` (git-ignored).
Env (`frontend/.env.example`): `BACKEND_URL`. **No secrets in `NEXT_PUBLIC_*`.**

## 12. Conventions for Claude

- Deploy early and continuously. A feature that only works on localhost doesn't count.
- Prefer working end to end over complete. Stub with personas and cached data rather than block.
- All prompts live in `graphs/prompts.py`. All model calls go through `llm.py`. All math lives in `roi.py`.
- Structured output everywhere: Pydantic models for every LLM JSON response. Retry once on parse failure, then emit `node.error`.
- Test `roi.py`, catalog validation (every recommended ID exists), and one graph smoke test with a mocked LLM.
- Never commit `.env`. CORS allows only `FRONTEND_ORIGIN`. Hash passwords. Rate-limit `/runs` and `/auth/*`.
- Work on a branch, open a PR, keep PR text short.
