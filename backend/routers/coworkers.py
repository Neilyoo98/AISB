"""Coworker mesh API: employees (with AI coworker constitutions) and owner-written tasks routed across them."""
import asyncio
import json

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import coworkers as cw
import db
from auth import current_user, rate_limit
from config import SPEND_CAP_USD
from graphs import coworker_graph as G
from routers.team import _context

router = APIRouter()
LIVE_TASKS_PER_DAY = 10
_bg_tasks: set[asyncio.Task] = set()

GENERIC_EXAMPLES = [
    "A customer says nobody called them back about their request. Sort it out today.",
    "Send a quote to a returning customer who wants the same service as last time.",
    "We got a 2-star review complaining about wait times. Respond and fix the cause.",
]


def _bg(coro):
    t = asyncio.create_task(coro)
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


def _admin_ctx(user) -> dict:
    b, role = _context(user)
    if role != "admin":
        raise HTTPException(403, "Only the owner or an admin can do that")
    return b


def _emp_or_404(employee_id: str, business_id: str) -> dict:
    e = cw.get_employee(employee_id)
    if not e or e["business_id"] != business_id:
        raise HTTPException(404, "Employee not found")
    return e


def _with_count(e: dict, business_id: str) -> dict:
    e = dict(e)
    e.pop("business_id", None)
    e["facts_count"] = len(G.constitution_facts(business_id, e["id"]))
    return e


# ---------------- employees ----------------

class EmployeeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=120)
    skills: list[str] = Field(default_factory=list, max_length=20)
    responsibilities: str = Field(default="", max_length=600)
    tools: list[str] = Field(default_factory=list, max_length=20)
    user_id: str | None = None


class EmployeePatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    role: str | None = Field(default=None, max_length=120)
    skills: list[str] | None = Field(default=None, max_length=20)
    responsibilities: str | None = Field(default=None, max_length=600)
    tools: list[str] | None = Field(default=None, max_length=20)
    user_id: str | None = None


class StatusIn(BaseModel):
    status: str = Field(pattern="^(available|busy|off)$")


@router.get("/employees")
def list_employees(user=Depends(current_user)):
    b, _ = _context(user)
    return [_with_count(e, b["id"]) for e in cw.list_employees(b["id"])]


@router.post("/employees")
async def create_employee(body: EmployeeIn, request: Request, user=Depends(current_user)):
    rate_limit(request, f"employees:{user['id']}", 30, window_s=3600)
    b = _admin_ctx(user)
    if len(cw.list_employees(b["id"])) >= 25:
        raise HTTPException(400, "That's the most employees this prototype supports")
    e = cw.create_employee(b["id"], body.name, body.role, body.skills, body.responsibilities, body.tools, body.user_id)
    _bg(G.build_constitution(b["id"], e))
    return _with_count(e, b["id"])


@router.get("/employees/{employee_id}")
def get_employee(employee_id: str, user=Depends(current_user)):
    b, _ = _context(user)
    e = _emp_or_404(employee_id, b["id"])
    past = []
    for t in cw.list_tasks(b["id"], limit=30):
        if not t.get("result_json"):
            continue
        role = cw.involvement(json.loads(t["result_json"]), employee_id)
        if role:
            past.append({"id": t["id"], "text": t["text"], "role_in_task": role, "created_at": cw._iso(t["created_at"])})
    return {"employee": _with_count(e, b["id"]), "facts": G.constitution_facts(b["id"], employee_id),
            "past_tasks": past[:10]}


@router.patch("/employees/{employee_id}")
async def patch_employee(employee_id: str, body: EmployeePatch, user=Depends(current_user)):
    b = _admin_ctx(user)
    _emp_or_404(employee_id, b["id"])
    e = cw.update_employee(employee_id, **body.model_dump())
    if body.skills is not None or body.tools is not None or body.responsibilities is not None:
        _bg(G.build_constitution(b["id"], e))
    return _with_count(e, b["id"])


@router.patch("/employees/{employee_id}/status")
def set_status(employee_id: str, body: StatusIn, user=Depends(current_user)):
    b, role = _context(user)
    e = _emp_or_404(employee_id, b["id"])
    if role != "admin" and e["user_id"] != user["id"]:
        raise HTTPException(403, "You can only change your own status")
    return _with_count(cw.update_employee(employee_id, status=body.status), b["id"])


@router.delete("/employees/{employee_id}")
def delete_employee(employee_id: str, user=Depends(current_user)):
    b = _admin_ctx(user)
    _emp_or_404(employee_id, b["id"])
    cw.delete_employee(employee_id)
    G.delete_employee_memory(b["id"], employee_id)
    return {"ok": True}


# ---------------- coworker tasks ----------------

class TaskIn(BaseModel):
    text: str = Field(min_length=8, max_length=300)


class ApproveIn(BaseModel):
    approve: bool


@router.get("/coworker-tasks/examples")
def examples(user=Depends(current_user)):
    b, _ = _context(user)
    persona = _persona(user, b)
    recs = G.list_recordings(persona) if persona else []
    return [r["text"] for r in recs][:3] or GENERIC_EXAMPLES


def _persona(user, b) -> str | None:
    if user.get("persona_id"):
        return user["persona_id"]
    owner = db.get_user(b["user_id"])
    return owner.get("persona_id") if owner and owner.get("is_demo") else None


@router.post("/coworker-tasks")
async def create_task(body: TaskIn, request: Request, user=Depends(current_user)):
    rate_limit(request, f"cotasks:{user['id']}", 12, window_s=3600)
    b = _admin_ctx(user)
    text = " ".join(body.text.split())
    if not cw.list_employees(b["id"]):
        raise HTTPException(400, "Add at least one employee first")
    persona = _persona(user, b)
    rec = G.find_recording(persona, text) if persona else None
    if rec:
        tid = cw.create_task(b["id"], user["id"], text, "replay", recording=f"{persona}/{rec['slug']}")
        _bg(G.start_coworker_replay(tid, b["id"], rec))
        return {"id": tid, "mode": "replay"}
    if db.total_spend() >= SPEND_CAP_USD:
        raise HTTPException(402, "The live-AI budget for this demo is used up. Try one of the example tasks.")
    if cw.count_live_today(b["id"]) >= LIVE_TASKS_PER_DAY:
        raise HTTPException(429, "Daily limit for live coworker tasks reached. Example tasks still replay.")
    tid = cw.create_task(b["id"], user["id"], text, "live")
    _bg(G.start_coworker_live(tid, b["id"], text))
    return {"id": tid, "mode": "live"}


@router.get("/coworker-tasks")
def list_tasks(user=Depends(current_user)):
    b, _ = _context(user)
    return [_task_with_status(t, with_result=False) for t in cw.list_tasks(b["id"])]


def _task_with_status(t: dict, with_result=True) -> dict:
    out = cw.task_out(t, with_result=with_result)
    ch = G.CHANNELS.get(t["id"])
    if ch and ch.status == "running" and out["status"] in ("approved", "rejected", "awaiting_approval"):
        out["status"] = "running"  # resumed and still finalizing
    return out


def _own_task(task_id: str, user) -> tuple[dict, dict]:
    b, _ = _context(user)
    t = cw.get_task(task_id)
    if not t or t["business_id"] != b["id"]:
        raise HTTPException(404, "Task not found")
    return t, b


@router.get("/coworker-tasks/{task_id}")
def get_task(task_id: str, user=Depends(current_user)):
    t, _ = _own_task(task_id, user)
    ch = G.CHANNELS.get(task_id)
    return _task_with_status(t) | {"events": ch.events if ch else json.loads(t["events_json"] or "[]")}


@router.get("/coworker-tasks/{task_id}/stream")
async def stream(task_id: str, request: Request, after: int = -1, user=Depends(current_user),
                 last_event_id: str | None = Header(default=None)):
    t, _ = _own_task(task_id, user)
    if last_event_id and last_event_id.isdigit():
        after = max(after, int(last_event_id))

    async def gen():
        ch = G.CHANNELS.get(task_id)
        if ch is None:  # restarted server / old task: send what we stored and close
            for e in json.loads(t["events_json"] or "[]"):
                if e["seq"] > after:
                    yield f"id: {e['seq']}\ndata: {json.dumps(e)}\n\n"
            yield f"data: {json.dumps({'seq': -1, 'type': 'stream.end', 'data': {'status': t['status']}})}\n\n"
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
                if e["type"] in G.TERMINAL:
                    return

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/coworker-tasks/{task_id}/approve")
async def approve(task_id: str, body: ApproveIn, user=Depends(current_user)):
    t, b = _own_task(task_id, user)
    _admin_ctx(user)
    ch = G.CHANNELS.get(task_id)
    status = ch.status if ch else t["status"]
    if status != "awaiting_approval":
        raise HTTPException(409, f"Task is {status}, not waiting for approval")
    if t["mode"] == "live" and ch is None:
        raise HTTPException(410, "This task expired after a server restart - please run it again.")
    G.channel(task_id).status = "running"
    if t["mode"] == "replay":
        _bg(G.resume_coworker_replay(task_id, b["id"], body.approve))
    else:
        _bg(G.resume_coworker_live(task_id, body.approve))
    return {"ok": True}
