# CLAUDE.md — StackSmith (AISB Hack-a-thon, UMD)

> Working name: **StackSmith**, AI coworkers that help small businesses discover, compare and adopt AI tools.
> Rename freely. Built on the architecture of **AUBI** (github.com/Neilyoo98/GDSC-Hackathon).

## 0. Hard constraints (read first)

- **Deadline: video and prototype link due Sun Nov 8, 2026.** Solo builder. Each feature has to earn its time. Follow the cut lines in §9.
- **LLM budget: $25 OpenRouter credit total.** Every LLM call goes through `backend/llm.py` (§6). Never call OpenRouter from the browser.
- **Judges must be able to test it with no friction.** A "Try a demo business" button skips signup. Login is only for saving your own business.
- **No hallucinated tools.** Agents may recommend only tools that exist in `backend/data/catalog.json`. Validate IDs and drop anything unknown.
- **IP:** UMD owns all hack-a-thon submissions. Code copied from AUBI becomes part of a UMD-owned submission. Copy patterns, not large verbatim chunks, if that matters to you.
- Commits are authored as `Neilyoo98 <194648525+Neilyoo98@users.noreply.github.com>`. No AI co-author lines.

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
- **Backend:** FastAPI + **LangGraph** + `langchain-openai` (`ChatOpenAI` pointed at OpenRouter), on **Railway**, **single worker** (the `MemorySaver` checkpointer holds paused approvals in process, as in AUBI).
- **Vector memory:** **Qdrant Cloud** (free tier).
- **Embeddings:** `fastembed` with `sentence-transformers/all-MiniLM-L6-v2` (384-d). This is the same model as AUBI, but ONNX instead of torch, so the Docker image stays small and Railway builds fast.
- **Relational data:** **Railway Postgres** for users, businesses and saved plans. SQLAlchemy plus raw SQL migrations in `backend/db/schema.sql`. No Alembic, given the time.
- **Auth:** email + password, `passlib[bcrypt]`, JWT in an httpOnly cookie set by the Next.js proxy. Demo mode issues a guest JWT bound to a seeded persona.
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
- Two tiers via env: `MODEL_FAST` (cheap, used for nodes 1, 3, 4, 5) and `MODEL_SMART` (nodes 6 verdict and 8). **Check exact slugs and prices on openrouter.ai/models before setting them.** Pick a fast model under ~$0.50/M input tokens with JSON/structured-output support.
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

**`personas.json`**: Joe's Corner Coffee (café, 6 staff), CoolAir HVAC (4 techs, missed calls), GreenLeaf Landscaping (seasonal crew, quoting), Mama Rosa's Trattoria (reviews, online orders).

**Qdrant collections:** `tool_catalog` (embedding of name + solves + ai_features + description), `business_facts` (`subject/predicate/object/category/confidence`, payload `business_id`), `episodes`.

## 8. API

`POST /auth/register` · `POST /auth/login` · `POST /auth/guest` · `GET /me`
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
6. **Auth + Postgres + saved Constitution (60 min).** Guest mode first, then register/login.
   — **CUT LINE B:** full flow.
7. **Precompute demos, spend guard, polish, mobile check (45 min).**
8. **Record the video (60 min, never skip; leave time for upload).**

If Railway or Qdrant breaks within an hour of the deadline, fall back to an in-memory catalog search (cosine similarity in numpy over pre-computed embeddings) and keep shipping.

## 10. Video outline (10 min)

1. 0:00 The problem: one owner, one pain, many tools (1 min).
2. 1:00 Live demo: CoolAir HVAC → War Room → mesh debate → stack + ROI → approve → 30-day plan → Constitution remembers (4 min).
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

Env (`backend/.env.example`): `OPENROUTER_API_KEY, MODEL_FAST, MODEL_SMART, SPEND_CAP_USD, QDRANT_URL, QDRANT_API_KEY, DATABASE_URL, JWT_SECRET, APP_URL, FRONTEND_ORIGIN`.
Env (`frontend/.env.example`): `BACKEND_URL`. **No secrets in `NEXT_PUBLIC_*`.**

## 12. Conventions for Claude

- Deploy early and continuously. A feature that only works on localhost doesn't count.
- Prefer working end to end over complete. Stub with personas and cached data rather than block.
- All prompts live in `graphs/prompts.py`. All model calls go through `llm.py`. All math lives in `roi.py`.
- Structured output everywhere: Pydantic models for every LLM JSON response. Retry once on parse failure, then emit `node.error`.
- Test `roi.py`, catalog validation (every recommended ID exists), and one graph smoke test with a mocked LLM.
- Never commit `.env`. CORS allows only `FRONTEND_ORIGIN`. Hash passwords. Rate-limit `/runs` and `/auth/*`.
- Work on a branch, open a PR, keep PR text short.
