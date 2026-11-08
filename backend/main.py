import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr, Field

import db
import evaluate as ev
import seed
from auth import clear, client_ip, current_user, hash_password, issue, rate_limit, verify_password
from config import (ADMIN_TOKEN, FRONTEND_ORIGIN, LIVE_RUNS_PER_IP_PER_DAY_DEMO, LIVE_RUNS_PER_USER_PER_DAY,
                    SPEND_CAP_USD)
from graphs.advisor_graph import resume_live, start_live
from graphs.events import RUNS, TERMINAL, channel
from memory import store
from replay import load_recording, resume_replay, start_replay

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("main")
_tasks: set[asyncio.Task] = set()


def _bg(coro):
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(seed.seed_all)
    yield


app = FastAPI(title="StackSmith API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[FRONTEND_ORIGIN], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ---------------- models ----------------

class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class DetailsIn(BaseModel):
    business_type: str | None = Field(default=None, max_length=60)
    team_size: int | None = Field(default=None, ge=1, le=10000)
    budget: str | None = Field(default=None, max_length=40)
    tech_comfort: int | None = Field(default=None, ge=1, le=5)
    current_tools: list[str] = Field(default_factory=list, max_length=20)
    security_must_haves: list[str] = Field(default_factory=list, max_length=4)
    goals: list[str] = Field(default_factory=list, max_length=6)


class BusinessIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str = Field(default="", max_length=120)
    description: str = Field(min_length=40, max_length=3000)
    details: DetailsIn | None = None


class ReviewIn(BaseModel):
    role: str = Field(default="Owner", max_length=60)
    output_quality: int = Field(ge=1, le=5)
    reliability: int = Field(ge=1, le=5)
    support: int = Field(ge=1, le=5)
    text: str = Field(default="", max_length=1500)


class EvaluateIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=4)
    weights: dict[str, float] | None = None
    seats: int = Field(default=1, ge=1, le=500)
    months: int = Field(default=12, ge=1, le=60)
    usage_per_month: float = Field(default=0, ge=0, le=1_000_000)


class WeightsIn(BaseModel):
    weights: dict[str, float]


class RunIn(BaseModel):
    mode: str = Field(default="auto", pattern="^(auto|live|replay)$")
    raw_input: str | None = Field(default=None, max_length=3000)


class ApproveIn(BaseModel):
    tool_ids: list[str] = Field(max_length=10)


class TaskIn(BaseModel):
    done: bool


def _user_out(u):
    return {"id": u["id"], "name": u["name"], "email": u["email"], "is_demo": bool(u["is_demo"]),
            "persona_id": u.get("persona_id")}


def _biz_out(b):
    if not b:
        return None
    return {"id": b["id"], "name": b["name"], "vertical": b["vertical"], "location": b["location"],
            "description": b["description"], "profile": json.loads(b["profile_json"]) if b["profile_json"] else None,
            "details": json.loads(b["details_json"]) if b.get("details_json") else None}


# ---------------- health ----------------

@app.get("/health")
def health():
    return {"ok": True}


@app.get("/ready")
def ready():
    return {"ok": True, "catalog": len(store.load_catalog()), "spend_usd": round(db.total_spend(), 4),
            "spend_cap_usd": SPEND_CAP_USD}


# ---------------- auth ----------------

@app.get("/auth/demo-accounts")
def demo_accounts():
    return [{"id": p["id"], "business_name": p["business_name"], "owner_name": p["owner_name"],
             "vertical": p["vertical"], "emoji": p["emoji"], "tagline": p["tagline"], "location": p["location"]}
            for p in seed.load_personas()]


@app.post("/auth/demo/{persona_id}")
def demo_login(persona_id: str, request: Request, response: Response):
    rate_limit(request, "demo", 30)
    p = seed.persona(persona_id)
    if not p:
        raise HTTPException(404, "Unknown sample business")
    u = db.get_user_by_email(p["email"])
    if not u:
        seed.seed_demos()
        u = db.get_user_by_email(p["email"])
    issue(response, u["id"])
    return {"user": _user_out(u)}


@app.post("/auth/register")
def register(body: RegisterIn, request: Request, response: Response):
    rate_limit(request, "register", 5)
    if body.email.lower().endswith("@demo.stacksmith") or db.get_user_by_email(body.email):
        raise HTTPException(409, "An account with that email already exists")
    uid = db.create_user(body.email, body.name.strip(), hash_password(body.password))
    issue(response, uid)
    return {"user": _user_out(db.get_user(uid))}


@app.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response):
    rate_limit(request, "login", 10)
    u = db.get_user_by_email(body.email)
    if not u or u["is_demo"] or not verify_password(body.password, u["password_hash"]):
        raise HTTPException(401, "Wrong email or password")
    issue(response, u["id"])
    return {"user": _user_out(u)}


@app.post("/auth/logout")
def logout(response: Response):
    clear(response)
    return {"ok": True}


@app.get("/me")
def me(user=Depends(current_user)):
    return {"user": _user_out(user), "business": _biz_out(db.get_user_business(user["id"]))}


# ---------------- business ----------------

@app.post("/businesses")
def upsert_business(body: BusinessIn, user=Depends(current_user)):
    if user["is_demo"]:
        raise HTTPException(403, "Sample businesses can't be edited - create your own account")
    b = db.get_user_business(user["id"])
    details = body.details.model_dump() if body.details else None
    if b:
        db.update_business(b["id"], name=body.name, location=body.location, description=body.description,
                           details=details)
        return _biz_out(db.get_business(b["id"]))
    bid = db.create_business(user["id"], body.name, None, body.location, body.description, details=details)
    return _biz_out(db.get_business(bid))


def _my_business(user):
    b = db.get_user_business(user["id"])
    if not b:
        raise HTTPException(404, "No business yet")
    return b


@app.get("/constitution")
def constitution(user=Depends(current_user)):
    b = _my_business(user)
    facts = store.get_facts(b["id"])
    grouped: dict[str, list] = {}
    for f in sorted(facts, key=lambda f: -f.get("confidence", 0)):
        grouped.setdefault(f["category"], []).append(
            {k: f[k] for k in ("subject", "predicate", "object", "confidence")})
    return {"business": _biz_out(b), "facts": grouped, "episodes": store.business_episodes(b["id"])}


def _live_runs_left(user, ip):
    if user["is_demo"]:
        return max(0, LIVE_RUNS_PER_IP_PER_DAY_DEMO - db.count_live_runs_since(ip=ip))
    return max(0, LIVE_RUNS_PER_USER_PER_DAY - db.count_live_runs_since(user_id=user["id"]))


@app.get("/dashboard")
def dashboard(request: Request, user=Depends(current_user)):
    b = db.get_user_business(user["id"])
    out = {"user": _user_out(user), "business": _biz_out(b), "latest": None, "tasks": [], "runs": [],
           "live_runs_left": _live_runs_left(user, client_ip(request)),
           "budget_ok": db.total_spend() < SPEND_CAP_USD}
    if not b:
        return out
    run = db.latest_complete_run(b["id"])
    if run:
        res = json.loads(run["result_json"] or "{}")
        catalog = store.load_catalog()
        approved = res.get("approved_tool_ids") or []
        out["latest"] = {
            "run_id": run["id"], "created_at": run["created_at"].isoformat() if run["created_at"] else None,
            "stack": res.get("stack"), "summary": (res.get("verdicts") or {}).get("summary"),
            "pains": res.get("pains"),
            "approved": [{"id": t, "name": catalog[t]["name"], "url": catalog[t]["url"],
                          "category": catalog[t]["category"], "price": catalog[t]["price_monthly_typical"]}
                         for t in approved if t in catalog],
            "first_step_today": (res.get("plan") or {}).get("first_step_today"),
            "scenarios": (res.get("plan") or {}).get("scenarios") or [],
            "current_tools": (res.get("profile") or {}).get("current_tools") or [],
        }
        out["tasks"] = db.get_plan_tasks(run["id"])
    out["runs"] = [r | {"created_at": r["created_at"].isoformat() if r["created_at"] else None}
                   for r in db.list_runs(b["id"])]
    return out


@app.patch("/plan-tasks/{task_id}")
def toggle_task(task_id: int, body: TaskIn, user=Depends(current_user)):
    if not db.set_task_done(task_id, body.done, user["id"]):
        raise HTTPException(404, "Task not found")
    return {"ok": True}


# ---------------- runs ----------------

@app.post("/runs")
async def create_run(body: RunIn, request: Request, user=Depends(current_user)):
    rate_limit(request, "runs", 6)
    b = _my_business(user)
    ip = client_ip(request)
    mode = body.mode
    if mode == "auto":
        mode = "replay" if user["is_demo"] else "live"
    if mode == "replay":
        if not user["is_demo"] or not load_recording(user["persona_id"]):
            raise HTTPException(400, "Replay is only available for sample businesses")
        rid = db.create_run(b["id"], user["id"], "replay", b["description"], ip)
        _bg(start_replay(rid, user["persona_id"], b["id"]))
        return {"run_id": rid, "mode": "replay"}

    if db.total_spend() >= SPEND_CAP_USD:
        raise HTTPException(402, "The live-AI budget for this demo is used up. Try a sample business replay.")
    if _live_runs_left(user, ip) <= 0:
        raise HTTPException(429, "Daily live-AI limit reached for this account. Replays are unlimited.")
    raw = (body.raw_input or b["description"] or "").strip()
    if user["is_demo"]:
        raw = b["description"]  # sample businesses always use their own story
    if len(raw) < 40:
        raise HTTPException(400, "Tell us a bit more about your business (at least a couple of sentences).")
    rid = db.create_run(b["id"], user["id"], "live", raw, ip)
    _bg(start_live(rid, b["id"], b["name"], raw, json.loads(b["details_json"]) if b.get("details_json") else None))
    return {"run_id": rid, "mode": "live"}


def _own_run(run_id, user):
    r = db.get_run(run_id)
    if not r or r["user_id"] != user["id"]:
        raise HTTPException(404, "Run not found")
    return r


@app.get("/runs/{run_id}")
def get_run(run_id: str, user=Depends(current_user)):
    r = _own_run(run_id, user)
    ch = RUNS.get(run_id)
    return {"id": r["id"], "mode": r["mode"], "status": ch.status if ch else r["status"],
            "result": json.loads(r["result_json"]) if r["result_json"] else None,
            "events": ch.events if ch else json.loads(r["events_json"] or "[]"),
            "catalog": {t: store.load_catalog()[t] for t in _run_tool_ids(r)},
            "tasks": db.get_plan_tasks(run_id), "cost_usd": r["cost_usd"]}


def _run_tool_ids(r):
    res = json.loads(r["result_json"] or "{}")
    return sorted({s["tool_id"] for s in res.get("scored", []) or []} & set(store.load_catalog()))


@app.get("/catalog")
def catalog(vertical: str | None = None, ids: str | None = None):
    cat = store.load_catalog()
    agg = db.review_aggregates()
    if ids:
        return {t: cat[t] | {"reviews": agg.get(t)} for t in ids.split(",") if t in cat}
    tools = [t | {"reviews": agg.get(t["id"])} for t in cat.values()]
    if vertical:
        tools = [t for t in tools if vertical in t["verticals"] or "all" in t["verticals"]]
    return tools


@app.get("/catalog/search")
async def catalog_search(request: Request, q: str, vertical: str | None = None, category: str | None = None,
                         max_price: float | None = None, modality: str | None = None, deployment: str | None = None):
    rate_limit(request, "search", 60)
    q = q.strip()[:200]
    if not q:
        return []
    return await asyncio.to_thread(store.search_catalog, q, vertical=vertical, category=category,
                                   max_price=max_price, modality=modality, deployment=deployment)


def _optional_user(request: Request):
    try:
        return current_user(request)
    except HTTPException:
        return None


@app.get("/tools/{tool_id}")
def tool_detail(tool_id: str, request: Request):
    cat = store.load_catalog()
    if tool_id not in cat:
        raise HTTPException(404, "Unknown tool")
    user = _optional_user(request)
    b = db.get_user_business(user["id"]) if user else None
    revs = db.list_reviews(tool_id)
    mine = next((r for r in revs if b and r["business_id"] == b["id"]), None)
    return {"tool": cat[tool_id], "aggregate": db.review_aggregates().get(tool_id),
            "reviews": [{k: r[k] for k in ("id", "role", "output_quality", "reliability", "support", "text",
                                           "verified_use", "is_demo", "business_name", "vertical")}
                        | {"created_at": r["created_at"].isoformat() if r["created_at"] else None} for r in revs],
            "can_review": bool(b), "my_review": bool(mine),
            "verified_eligible": bool(b and db.has_verified_use(b["id"], tool_id))}


@app.post("/tools/{tool_id}/reviews")
def post_review(tool_id: str, body: ReviewIn, request: Request, user=Depends(current_user)):
    rate_limit(request, "review", 5, window_s=24 * 3600)
    if tool_id not in store.load_catalog():
        raise HTTPException(404, "Unknown tool")
    b = _my_business(user)
    r = db.add_review(tool_id, b["id"], user["id"], body.role, body.output_quality, body.reliability, body.support,
                      body.text.strip(), is_demo=bool(user["is_demo"]))
    return {"ok": True, "verified_use": r["verified_use"]}


@app.post("/evaluate")
def evaluate_tools(body: EvaluateIn, request: Request):
    cat = store.load_catalog()
    user = _optional_user(request)
    b = db.get_user_business(user["id"]) if user else None
    profile = json.loads(b["profile_json"]) if b and b["profile_json"] else {}
    if b and b.get("details_json"):
        det = json.loads(b["details_json"])
        profile["current_tools"] = list(dict.fromkeys(profile.get("current_tools", []) + det.get("current_tools", [])))
        if det.get("tech_comfort") and not profile.get("tech_comfort"):
            profile["tech_comfort"] = det["tech_comfort"]
    hourly = 45.0 if profile else 25.0
    agg = db.review_aggregates()
    out = []
    for tid in body.ids:
        if tid not in cat:
            continue
        t = cat[tid]
        out.append({"id": tid, "score": ev.score_tool(t, profile, body.weights, agg.get(tid)),
                    "tco_12": ev.tco(t, body.seats, 12, body.usage_per_month, hourly),
                    "tco_36": ev.tco(t, body.seats, 36, body.usage_per_month, hourly)})
    return {"results": out, "weights": ev.normalize_weights(body.weights), "personalized": bool(profile),
            "business_name": b["name"] if b else None, "current_tools": profile.get("current_tools", []),
            "hourly_cost": hourly}


@app.get("/businesses/me/weights")
def get_weights(request: Request):
    user = _optional_user(request)
    b = db.get_user_business(user["id"]) if user else None
    saved = json.loads(b["weights_json"]) if b and b.get("weights_json") else None
    return {"saved": saved, "presets": ev.PRESETS, "criteria": ev.CRITERIA}


@app.put("/businesses/me/weights")
def put_weights(body: WeightsIn, user=Depends(current_user)):
    b = _my_business(user)
    w = ev.normalize_weights(body.weights)
    db.update_business(b["id"], weights=w)
    return {"saved": w}


@app.get("/runs/{run_id}/stream")
async def stream(run_id: str, request: Request, after: int = -1, user=Depends(current_user),
                 last_event_id: str | None = Header(default=None)):
    r = _own_run(run_id, user)
    if last_event_id and last_event_id.isdigit():
        after = max(after, int(last_event_id))

    async def gen():
        ch = RUNS.get(run_id)
        if ch is None:  # server restarted or old run: send what we stored and close
            for e in json.loads(r["events_json"] or "[]"):
                if e["seq"] > after:
                    yield f"id: {e['seq']}\ndata: {json.dumps(e)}\n\n"
            yield f"data: {json.dumps({'seq': -1, 'type': 'stream.end', 'data': {'status': r['status']}})}\n\n"
            return
        idx = after + 1
        while True:
            if await request.is_disconnected():
                return
            async with ch.cond:
                if idx >= len(ch.events):
                    try:
                        await asyncio.wait_for(ch.cond.wait(), timeout=15)
                    except asyncio.TimeoutError:
                        pass
                new = ch.events[idx:]
            if not new:
                yield ": keepalive\n\n"
                continue
            for e in new:
                idx = e["seq"] + 1
                yield f"id: {e['seq']}\ndata: {json.dumps(e)}\n\n"
                if e["type"] in TERMINAL:
                    return

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/runs/{run_id}/approve")
async def approve(run_id: str, body: ApproveIn, user=Depends(current_user)):
    r = _own_run(run_id, user)
    ch = RUNS.get(run_id)
    status = ch.status if ch else r["status"]
    if status != "awaiting_approval":
        raise HTTPException(409, f"Run is {status}, not awaiting approval")
    if r["mode"] == "live" and run_id not in RUNS:
        raise HTTPException(410, "This run expired after a server restart - please start a new analysis.")
    channel(run_id).mark_resumed()
    if r["mode"] == "replay":
        _bg(resume_replay(run_id, user["persona_id"], body.tool_ids))
    else:
        _bg(resume_live(run_id, body.tool_ids))
    return {"ok": True}


# ---------------- admin ----------------

@app.post("/admin/reset-demos")
def reset_demos(x_admin_token: str = Header(default="")):
    if not ADMIN_TOKEN or x_admin_token != ADMIN_TOKEN:
        raise HTTPException(403, "Forbidden")
    seed.reset_demos()
    return {"ok": True}
