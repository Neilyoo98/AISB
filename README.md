# StackSmith

**AI advisors that help small businesses discover, compare and adopt the right AI tools.** Built for the AISB Hack-a-thon at the University of Maryland.

An owner describes their business in plain words. A team of agents then:
1. **Intake Analyst** builds a structured profile (the *Business Constitution*, stored as vector memory).
2. **Pain Diagnostician** puts a dollar figure on each problem, showing the math.
3. **Tool Scouts** (parallel fan-out) search a **verified catalog** of real tools. Anything outside the catalog is blocked.
4. **Advisor Panel** (Budget Hawk, Ease-of-Use Coach, Integration Checker) critiques the shortlist.
5. **ROI Calculator** computes value, net and payback **deterministically**, then picks a lean stack within budget.
6. **You approve** (human-in-the-loop interrupt).
7. **Adoption Coach** writes a 30-day rollout plan; outcomes are written back to memory.

Everything streams live into the **War Room** UI.

## Try it
Open the app and click a **sample business** (Joe's Corner Coffee, CoolAir HVAC, GreenLeaf Landscaping); no password needed. Or create an account and describe your own business for a live AI run.

## Stack
Next.js 15 (Vercel) · FastAPI + LangGraph (Railway) · Qdrant (vector memory, fastembed MiniLM) · Postgres/SQLite · OpenRouter (Claude Haiku 5.5 + Sonnet 5.5)

## Run locally
```bash
cd backend && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
cp .env.example .env   # add your OPENROUTER_API_KEY
.venv/Scripts/python -m uvicorn main:app --port 8000 --workers 1
pytest -q

cd frontend && npm install && BACKEND_URL=http://localhost:8000 npm run dev
```

See [CLAUDE.md](CLAUDE.md) for architecture, budget guards and conventions.
