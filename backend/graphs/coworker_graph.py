"""Coworker mesh graph (LangGraph), modeled on AUBI's issue -> ownership -> coworker mesh -> fix -> approval flow.

task_reader -> router (deterministic, substitution) -> coworker_exchange (<=3 parallel fast calls)
-> workflow_builder (smart; adopted tools only; gaps get catalog recommendations) -> draft_writer (fast)
-> approval_gate (interrupt) -> finalize (assigned tasks, per-employee memory, simulated send log)
"""
import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Optional, TypedDict

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt
from pydantic import BaseModel, Field

import adoptions
import coworkers as cw
import db
from config import DATA_DIR
from graphs import prompts as P
from llm import BudgetExceeded, LLMError, call_json
from memory import store

log = logging.getLogger("coworker_graph")
RUNS_DIR = DATA_DIR / "coworker_runs"
TERMINAL = {"approval.waiting", "task.complete", "task.error"}
SIMULATED_LABEL = "Simulated — nothing was sent"


# ---------------- channel (same shape as graphs/events.py, coworker terminal events) ----------------

@dataclass
class TaskChannel:
    task_id: str
    started: float = field(default_factory=time.monotonic)
    events: list[dict] = field(default_factory=list)
    cond: asyncio.Condition = field(default_factory=asyncio.Condition)
    status: str = "running"

    async def emit(self, type_: str, data: dict | None = None, agent: str | None = None):
        ev = {"seq": len(self.events), "t": int((time.monotonic() - self.started) * 1000), "type": type_,
              "agent": agent, "data": data or {}}
        async with self.cond:
            self.events.append(ev)
            if type_ == "approval.waiting":
                self.status = "awaiting_approval"
            elif type_ == "task.complete":
                self.status = "complete"
            elif type_ == "task.error":
                self.status = "error"
            self.cond.notify_all()
        return ev


CHANNELS: dict[str, TaskChannel] = {}


def channel(task_id: str) -> TaskChannel:
    if task_id not in CHANNELS:
        CHANNELS[task_id] = TaskChannel(task_id)
    return CHANNELS[task_id]


async def emit(task_id: str, type_: str, data: dict | None = None, agent: str | None = None):
    return await channel(task_id).emit(type_, data, agent)


# ---------------- LLM schemas ----------------

class TaskRead(BaseModel):
    intent: str
    customer_facing: bool
    urgency: Literal["low", "normal", "high"]
    needed_skills: list[str] = Field(description="2-5 short skills")
    needed_capabilities: list[str] = Field(description="1-4 kinds of software help")


class MeshOut(BaseModel):
    context_shared: str
    should_check: str
    confidence: Literal["low", "medium", "high"]


class StepIn(BaseModel):
    actor_type: Literal["employee", "tool", "customer"]
    actor_id: Optional[str] = None
    action: str
    tool_id: Optional[str] = None
    manual_before: Optional[str] = None
    handoff_to: Optional[str] = None
    gap: bool = False
    gap_capability: Optional[str] = None


class WorkflowOut(BaseModel):
    steps: list[StepIn] = Field(description="4 to 7 ordered steps")


class DraftIn(BaseModel):
    kind: Literal["customer_reply", "staff_message", "review_response", "quote", "other"]
    title: str
    to: str
    body: str


class DraftsOut(BaseModel):
    drafts: list[DraftIn] = Field(description="1 to 3 drafts")


class EmpFact(BaseModel):
    predicate: str
    object: str
    category: Literal["skill", "responsibility", "tool", "habit", "customer"]


class EmpFactsOut(BaseModel):
    facts: list[EmpFact] = Field(description="5 to 8 facts")


# ---------------- state ----------------

class CoState(TypedDict, total=False):
    task_id: str
    business_id: str
    text: str
    profile: dict
    employees: list[dict]
    adopted: list[str]
    read: dict
    route: dict
    mesh: list[dict]
    workflow: list[dict]
    drafts: list[dict]
    approved: bool
    assigned_tasks: list[dict]
    send_log: list[dict]


def _j(x) -> str:
    return json.dumps(x, ensure_ascii=False)


def _emp_brief(e: dict) -> dict:
    return {"id": e["id"], "name": e["name"], "role": e["role"], "skills": e["skills"], "tools": e["tools"],
            "status": e["status"], "responsibilities": e["responsibilities"][:200]}


def _facts_for(business_id: str, employee_id: str) -> list[str]:
    try:
        facts = store.get_facts(cw.emp_key(business_id, employee_id), limit=30)
    except Exception:  # noqa: BLE001 - memory is optional context
        return []
    return [f"{f.get('predicate', '')} {f.get('object', '')}".strip() for f in facts][:12]


# ---------------- nodes ----------------

async def task_reader(state: CoState):
    tid = state["task_id"]
    out = await call_json(tier="fast", system=P.COWORKER_READER_SYSTEM, node="co_reader", run_id=tid, schema=TaskRead,
                          user=f"TASK: {state['text']}\nBUSINESS: {_j(state.get('profile') or {})}", max_tokens=600)
    read = out.model_dump()
    read["needed_skills"] = read["needed_skills"][:5]
    read["needed_capabilities"] = read["needed_capabilities"][:4]
    await emit(tid, "task.read", read, agent="reader")
    return {"read": read}


async def router(state: CoState):
    tid = state["task_id"]
    needs = state["read"] | {"text": state["text"]}
    hits = cw.memory_hits_for(state["business_id"], state["text"])
    route = cw.route_task(state["employees"], needs, hits)
    await asyncio.to_thread(cw.set_assignment, tid, route)  # assignee shows in the queue right away
    await emit(tid, "route.chosen", {"route": route}, agent="router")
    if route["substituted"]:
        await emit(tid, "route.substituted", {"owner_id": route["owner_id"], "human_id": route["human_id"],
                                              "note": route["substitution_note"]}, agent="router")
    return {"route": route}


def mesh_participants(route: dict, employees: list[dict], limit: int = 3) -> list[tuple[str, str]]:
    """(from_id, to_id) pairs: the context owner talks to whoever does the work; up to 2 adjacent coworkers
    (next best scores, plus the human if substituted) share context with the owner."""
    owner, human = route["owner_id"], route["human_id"]
    ids = {e["id"] for e in employees}
    ranked = [s["employee_id"] for s in route["scores"] if s["employee_id"] in ids and s["employee_id"] != owner]
    adjacent = []
    if human != owner:
        adjacent.append(human)
    for eid in ranked:
        if eid not in adjacent:
            adjacent.append(eid)
    adjacent = adjacent[: max(0, limit - 1)]
    pairs = [(owner, human if human != owner else (adjacent[0] if adjacent else owner))]
    pairs += [(eid, owner) for eid in adjacent]
    return pairs


async def coworker_exchange(state: CoState):
    tid, bid = state["task_id"], state["business_id"]
    emps = {e["id"]: e for e in state["employees"]}
    pairs = mesh_participants(state["route"], state["employees"])

    async def ask(from_id: str, to_id: str):
        e = emps[from_id]
        notes = await asyncio.to_thread(_facts_for, bid, from_id)
        covering = state["route"]["substituted"] and from_id == state["route"]["owner_id"]
        try:
            out = await call_json(
                tier="fast", system=P.COWORKER_MEMBER_SYSTEM, node="co_mesh", run_id=tid, schema=MeshOut,
                user=(f"YOU ARE THE COWORKER OF: {_j(_emp_brief(e))}\nMEMORY NOTES: {_j(notes)}\n"
                      f"{'This employee is OFF today; you are covering with their context.' if covering else ''}\n"
                      f"TASK: {state['text']}\nREAD: {_j(state['read'])}\n"
                      f"SHARING WITH: {emps[to_id]['name'] if to_id in emps else to_id}"),
                max_tokens=400, temperature=0.4)
            msg = {"from_id": from_id, "to_id": to_id} | out.model_dump()
        except (LLMError, BudgetExceeded) as ex:
            log.warning("mesh %s failed: %s", from_id, ex)
            msg = {"from_id": from_id, "to_id": to_id, "context_shared": f"{e['name']}'s coworker had nothing to add.",
                   "should_check": "Double-check the details with the customer.", "confidence": "low"}
        await emit(tid, "mesh.message", msg, agent=f"coworker:{from_id}")
        return msg

    msgs = await asyncio.gather(*(ask(a, b) for a, b in pairs))
    return {"mesh": list(msgs)}


def drop_existing_tool_gaps(steps: list[dict], existing_tools: list[str]) -> list[dict]:
    """A step that just uses a tool the business already has (e.g. Google Calendar) is not a gap."""
    names = [t.lower().replace("-", " ").strip() for t in existing_tools if t]
    for s in steps:
        if s.get("gap"):
            text = f"{s.get('gap_capability') or ''} {s.get('action') or ''}".lower().replace("-", " ")
            if any(n and n in text for n in names):
                s["gap"], s["gap_capability"], s["recommendations"] = False, None, []
    return steps


def gap_recommendations(capability: str, adopted: list[str], catalog: dict, limit: int = 2,
                        search=None, vertical: str | None = None) -> list[dict]:
    """Catalog tools (never adopted ones, never unknown ids) that cover a missing capability.
    With `vertical`, only tools made for that kind of business (or any business) are suggested."""
    search = search or (lambda q: store.search_catalog(q, limit=8))
    out = []
    for hit in search(capability or ""):
        tid = hit["id"] if isinstance(hit, dict) else hit
        fits = not vertical or tid not in catalog or vertical in catalog[tid]["verticals"] or "all" in catalog[tid]["verticals"]
        if tid in catalog and fits and tid not in adopted and tid not in [o["tool_id"] for o in out]:
            out.append({"tool_id": tid, "reason": catalog[tid]["description"][:140]})
        if len(out) >= limit:
            break
    return out


def sanitize_workflow(steps: list[dict], employees: list[dict], adopted: list[str], route: dict) -> list[dict]:
    """Enforce: only known employees; tool steps only with adopted tools (else become a gap done by the human);
    hands-on steps by an Off context owner go to the human; renumber; cap at 7."""
    emp_ids = {e["id"] for e in employees}
    off = {e["id"] for e in employees if e["status"] == "off"}
    valid_targets = emp_ids | set(adopted) | {"customer"}
    out = []
    for s in steps[:7]:
        s = dict(s)
        if s["actor_type"] == "tool":
            if s.get("actor_id") not in adopted and s.get("tool_id") not in adopted:
                s.update(actor_type="employee", actor_id=route["human_id"], tool_id=None, gap=True,
                         gap_capability=s.get("gap_capability") or s.get("action"))
            else:
                s["tool_id"] = s.get("tool_id") if s.get("tool_id") in adopted else s.get("actor_id")
                s["actor_id"] = s["tool_id"]
        elif s["actor_type"] == "employee":
            if s.get("actor_id") not in emp_ids or s.get("actor_id") in off:
                s["actor_id"] = route["human_id"]
            if s.get("tool_id") and s["tool_id"] not in adopted:
                s.update(tool_id=None, gap=True, gap_capability=s.get("gap_capability") or s.get("action"))
        else:
            s["actor_id"] = None
        if s.get("handoff_to") in off:
            s["handoff_to"] = route["human_id"]
        if s.get("handoff_to") not in valid_targets:
            s["handoff_to"] = None
        if not s.get("gap"):
            s["gap"], s["gap_capability"] = False, None
        out.append(s)
    for i, s in enumerate(out, 1):
        s["n"] = i
        s.setdefault("recommendations", [])
    return out


async def workflow_builder(state: CoState):
    tid = state["task_id"]
    catalog = store.load_catalog()
    adopted = [t for t in state["adopted"] if t in catalog]
    tools = [{"tool_id": t, "name": catalog[t]["name"], "ai_features": catalog[t]["ai_features"][:3],
              "integrates_with": catalog[t]["integrates_with"]} for t in adopted]
    out = await call_json(
        tier="smart", system=P.COWORKER_WORKFLOW_SYSTEM, node="co_workflow", run_id=tid, schema=WorkflowOut,
        user=(f"TASK: {state['text']}\nREAD: {_j(state['read'])}\nTEAM: {_j([_emp_brief(e) for e in state['employees']])}\n"
              f"ROUTE: {_j({k: state['route'][k] for k in ('owner_id', 'human_id', 'substituted', 'substitution_note')})}\n"
              f"COWORKER CONTEXT: {_j(state['mesh'])}\nADOPTED TOOLS: {_j(tools)}\n"
              f"EXISTING TOOLS: {_j((state.get('profile') or {}).get('current_tools') or [])}"),
        max_tokens=4000)
    steps = sanitize_workflow([s.model_dump() for s in out.steps], state["employees"], adopted, state["route"])
    vertical = (state.get("profile") or {}).get("vertical")
    existing = (state.get("profile") or {}).get("current_tools") or []
    steps = drop_existing_tool_gaps(steps, existing)
    for s in steps:
        if s["gap"]:
            s["recommendations"] = await asyncio.to_thread(gap_recommendations, s["gap_capability"],
                                                           adopted + list(existing), catalog, vertical=vertical)
    await emit(tid, "workflow.ready", {"workflow": steps}, agent="builder")
    for s in steps:
        if s["gap"]:
            await emit(tid, "gap.found", {"step_n": s["n"], "capability": s["gap_capability"],
                                          "recommendations": s["recommendations"]}, agent="builder")
    return {"workflow": steps}


async def draft_writer(state: CoState):
    tid = state["task_id"]
    names = {e["id"]: e["name"] for e in state["employees"]}
    readable = [{"n": s["n"], "who": names.get(s["actor_id"], s["actor_id"] or "customer"), "action": s["action"]}
                for s in state["workflow"]]
    try:
        out = await call_json(
            tier="fast", system=P.COWORKER_DRAFTS_SYSTEM, node="co_drafts", run_id=tid, schema=DraftsOut,
            user=(f"BUSINESS: {_j(state.get('profile') or {})}\nTASK: {state['text']}\nWORKFLOW: {_j(readable)}\n"
                  f"HANDS-ON PERSON: {names.get(state['route']['human_id'])}"),
            max_tokens=1500, temperature=0.5)
        drafts = [d.model_dump() for d in out.drafts[:3]]
    except (LLMError, BudgetExceeded) as ex:
        log.warning("drafts failed: %s", ex)
        drafts = []
    await emit(tid, "drafts.ready", {"drafts": drafts}, agent="drafter")
    return {"drafts": drafts}


async def approval_gate(state: CoState):
    decision = interrupt({"workflow": len(state.get("workflow", []))})
    return {"approved": bool(decision)}


_CHANNEL_BY_CATEGORY = {"ai_receptionist": "Phone / text", "business_phone": "Text message", "reviews": "Review reply",
                        "local_listing": "Google reply", "email_marketing": "Email / SMS", "field_service": "Job & quote",
                        "booking": "Booking link", "customer_chat": "Website chat", "marketing_content": "Social post",
                        "bookkeeping": "Invoice", "pos": "Receipt / offer"}


def build_send_log(workflow: list[dict], employees: list[dict], catalog: dict) -> list[dict]:
    """Deterministic, simulated log of what the adopted tools would send. Nothing is ever sent."""
    names = {e["id"]: e["name"] for e in employees}
    log_ = []
    for s in workflow:
        tool = s.get("tool_id")
        if s.get("gap") or not tool or tool not in catalog:
            continue
        to = s.get("handoff_to")
        to_label = "Customer" if to == "customer" else names.get(to) or (catalog[to]["name"] if to in catalog else "Team")
        log_.append({"channel": _CHANNEL_BY_CATEGORY.get(catalog[tool]["category"], "Update"), "via_tool_id": tool,
                     "to": to_label, "summary": s["action"], "simulated": True, "label": SIMULATED_LABEL})
    return log_


def assigned_task_specs(workflow: list[dict], text: str) -> list[dict]:
    """One dashboard task per hands-on employee step."""
    return [{"assignee_employee_id": s["actor_id"], "text": s["action"], "week": 1, "owner": None, "minutes": None,
             "source": "coworker", "tool_id": s.get("tool_id")}
            for s in workflow if s["actor_type"] == "employee" and s.get("actor_id")]


def _task_run_id(business_id: str) -> str:
    b = db.get_business(business_id)
    return adoptions._latest_run_id(business_id) or adoptions._manual_run(business_id, b["user_id"])


async def finalize_core(task_id: str, business_id: str, text: str, result: dict, approved: bool,
                        employees: list[dict]) -> dict:
    """Shared by live and replay: on approve create assigned tasks, write coworker memory, build the send log."""
    if not approved:
        await emit(task_id, "task.rejected", {}, agent="you")
        await emit(task_id, "task.complete", {}, agent="you")
        return {"approved": False}
    catalog = store.load_catalog()
    emp_ids = {e["id"] for e in employees}
    workflow = [s for s in result.get("workflow", []) if s["actor_type"] != "employee" or s.get("actor_id") in emp_ids]
    specs = assigned_task_specs(workflow, text)
    run_id = await asyncio.to_thread(_task_run_id, business_id)
    assigned = []
    for spec in specs:
        tid_ = await asyncio.to_thread(db.add_custom_task, business_id, run_id, spec["text"], 1, None)
        await asyncio.to_thread(_set_assignee, tid_, spec["assignee_employee_id"], task_id)
        assigned.append({"task_id": tid_, "assignee_id": spec["assignee_employee_id"], "text": spec["text"]})
    send_log = build_send_log(workflow, employees, catalog)
    await emit(task_id, "task.approved", {"assigned_tasks": assigned, "send_log": send_log}, agent="you")
    involved = sorted({cw_id for cw_id in [result.get("route", {}).get("owner_id"), result.get("route", {}).get("human_id")]
                       + [s.get("actor_id") for s in workflow if s["actor_type"] == "employee"] if cw_id in emp_ids})
    b = db.get_business(business_id) or {}
    vertical = b.get("vertical") or "other"
    names = {e["id"]: e["name"] for e in employees}
    for eid in involved:
        role = cw.involvement(result, eid) or "Helped"
        try:
            await asyncio.to_thread(store.add_episode, cw.emp_key(business_id, eid), vertical,
                                    f"{names.get(eid, 'Employee')}: {role.lower()} on \"{text[:120]}\"",
                                    {"task_id": task_id, "employee_id": eid, "scope": f"employee:{eid}",
                                     "owner_business_id": business_id})
            await asyncio.to_thread(store.upsert_facts, cw.emp_key(business_id, eid), [{
                "subject": names.get(eid, "employee"), "predicate": "handled",
                "object": (result.get("intent") or text)[:120], "category": "habit", "confidence": 0.8,
                "scope": f"employee:{eid}", "employee_id": eid, "owner_business_id": business_id}])
        except Exception as ex:  # noqa: BLE001 - memory write is best-effort
            log.warning("memory write failed for %s: %s", eid, ex)
    await emit(task_id, "memory.saved", {"employees": involved}, agent="memory")
    await emit(task_id, "task.complete", {}, agent="you")
    return {"approved": True, "assigned_tasks": assigned, "send_log": send_log}


def _set_assignee(task_id: int, employee_id: str, coworker_task_id: str | None = None):
    from sqlalchemy import update as _upd
    with db.engine.begin() as c:
        c.execute(_upd(db.plan_tasks).where(db.plan_tasks.c.id == task_id)
                  .values(assignee_employee_id=employee_id, source="coworker", coworker_task_id=coworker_task_id))


async def finalize(state: CoState):
    result = _result(state)
    out = await finalize_core(state["task_id"], state["business_id"], state["text"], result, state.get("approved"),
                              state["employees"])
    return {k: v for k, v in out.items() if k in ("assigned_tasks", "send_log")}


# ---------------- graph ----------------

def build_graph():
    g = StateGraph(CoState)
    for name, fn in [("task_reader", task_reader), ("router", router), ("coworker_exchange", coworker_exchange),
                     ("workflow_builder", workflow_builder), ("draft_writer", draft_writer),
                     ("approval_gate", approval_gate), ("finalize", finalize)]:
        g.add_node(name, fn)
    g.add_edge(START, "task_reader")
    g.add_edge("task_reader", "router")
    g.add_edge("router", "coworker_exchange")
    g.add_edge("coworker_exchange", "workflow_builder")
    g.add_edge("workflow_builder", "draft_writer")
    g.add_edge("draft_writer", "approval_gate")
    g.add_edge("approval_gate", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=MemorySaver())


GRAPH = build_graph()


def _cfg(task_id):
    return {"configurable": {"thread_id": f"co-{task_id}"}}


def _result(state: dict) -> dict:
    read = state.get("read") or {}
    out = {"intent": read.get("intent"), "urgency": read.get("urgency", "normal"), "route": state.get("route"),
           "mesh": state.get("mesh", []), "workflow": state.get("workflow", []), "drafts": state.get("drafts", [])}
    for k in ("send_log", "assigned_tasks"):
        if state.get(k) is not None:
            out[k] = state[k]
    return out


def _friendly(e: Exception) -> str:
    if isinstance(e, BudgetExceeded):
        return "The live-AI budget for this demo is used up. Recorded sample tasks still work."
    return "A coworker hit a snag. Please try again in a moment."


def _initial_state(task_id: str, business_id: str, text: str) -> dict:
    b = db.get_business(business_id) or {}
    profile = json.loads(b["profile_json"]) if b.get("profile_json") else {}
    slim = {k: profile.get(k) for k in ("business_name", "vertical", "summary", "current_tools")} | {"name": b.get("name")}
    return {"task_id": task_id, "business_id": business_id, "text": text, "profile": slim,
            "employees": cw.list_employees(business_id), "adopted": adoptions.adopted_ids(business_id)}


async def start_coworker_live(task_id: str, business_id: str, text: str):
    ch = channel(task_id)
    await ch.emit("task.start", {"mode": "live"})
    try:
        init = _initial_state(task_id, business_id, text)
        if not init["employees"]:
            raise ValueError("Add at least one employee first")
        await GRAPH.ainvoke(init, _cfg(task_id))
        snap = await GRAPH.aget_state(_cfg(task_id))
        cw.update_task(task_id, status="awaiting_approval", result=_result(snap.values), events=ch.events)
        await ch.emit("approval.waiting", {})
    except Exception as e:  # noqa: BLE001
        log.exception("coworker task %s failed", task_id)
        cw.update_task(task_id, status="error", events=ch.events)
        await ch.emit("task.error", {"message": str(e) if isinstance(e, ValueError) else _friendly(e)})


async def resume_coworker_live(task_id: str, approve: bool):
    ch = channel(task_id)
    ch.status = "running"
    try:
        await GRAPH.ainvoke(Command(resume=approve), _cfg(task_id))
        snap = await GRAPH.aget_state(_cfg(task_id))
        cw.update_task(task_id, status="approved" if approve else "rejected", result=_result(snap.values),
                       events=ch.events)
    except Exception as e:  # noqa: BLE001
        log.exception("coworker resume %s failed", task_id)
        await ch.emit("task.error", {"message": _friendly(e)})


# ---------------- replay (sample businesses) ----------------

PACE = {"task.read": 1.8, "route.chosen": 1.4, "route.substituted": 1.6, "mesh.message": 1.9, "workflow.ready": 2.4,
        "gap.found": 0.9, "drafts.ready": 1.8}
_SKIP = {"task.start", "approval.waiting", "task.approved", "task.rejected", "memory.saved", "task.complete", "task.error"}


def recording_path(persona: str, slug: str) -> Path:
    return RUNS_DIR / persona / f"{slug}.json"


def list_recordings(persona: str) -> list[dict]:
    d = RUNS_DIR / persona
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.json")):
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")) | {"slug": p.stem})
        except Exception:  # noqa: BLE001
            continue
    return out


def find_recording(persona: str, text: str) -> dict | None:
    t = " ".join(text.lower().split())
    return next((r for r in list_recordings(persona) if " ".join(r["text"].lower().split()) == t), None)


def remap_ids(obj, mapping: dict[str, str]):
    """Recorded employee ids -> this business's current employee ids (demo resets create new ids)."""
    if isinstance(obj, str):
        return mapping.get(obj, obj)
    if isinstance(obj, list):
        return [remap_ids(x, mapping) for x in obj]
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            nk = k
            if isinstance(k, str) and k.startswith("coworker:") and k[9:] in mapping:
                nk = "coworker:" + mapping[k[9:]]
            out[nk] = remap_ids(v, mapping)
        return out
    return obj


def _mapping_for(recording: dict, employees: list[dict]) -> dict[str, str]:
    by_name = {e["name"].lower(): e["id"] for e in employees}
    return {old["id"]: by_name[old["name"].lower()] for old in recording.get("employees", [])
            if old["name"].lower() in by_name}


async def start_coworker_replay(task_id: str, business_id: str, recording: dict):
    ch = channel(task_id)
    await ch.emit("task.start", {"mode": "replay"})
    employees = cw.list_employees(business_id)
    mapping = _mapping_for(recording, employees)
    rec = remap_ids({"events": recording["events"], "result": recording["result"]}, mapping)
    cw.set_assignment(task_id, (rec["result"] or {}).get("route"))  # queue shows the assignee immediately
    for e in rec["events"]:
        if e["type"] in _SKIP:
            continue
        await asyncio.sleep(PACE.get(e["type"], 0.4))
        agent = e.get("agent")
        if isinstance(agent, str) and agent.startswith("coworker:"):
            agent = "coworker:" + mapping.get(agent[9:], agent[9:])
        await ch.emit(e["type"], e["data"], agent=agent)
    result = {k: v for k, v in rec["result"].items() if k not in ("send_log", "assigned_tasks")}
    cw.update_task(task_id, status="awaiting_approval", result=result, events=ch.events)
    await ch.emit("approval.waiting", {})


async def resume_coworker_replay(task_id: str, business_id: str, approve: bool):
    ch = channel(task_id)
    ch.status = "running"
    t = cw.get_task(task_id)
    result = json.loads(t["result_json"] or "{}")
    await asyncio.sleep(1.0)
    out = await finalize_core(task_id, business_id, t["text"], result, approve, cw.list_employees(business_id))
    cw.update_task(task_id, status="approved" if approve else "rejected",
                   result=result | {k: v for k, v in out.items() if k in ("send_log", "assigned_tasks")}, events=ch.events)


async def record(business_id: str, text: str, persona: str, slug: str, created_by: str | None = None) -> Path:
    """Precompute helper: run a task live, auto-approve, and save the recording for replay."""
    task_id = cw.create_task(business_id, created_by, text, "live")
    await start_coworker_live(task_id, business_id, text)
    ch = channel(task_id)
    if ch.status != "awaiting_approval":
        raise RuntimeError(f"recording failed: {ch.events[-1] if ch.events else 'no events'}")
    await resume_coworker_live(task_id, True)
    t = cw.get_task(task_id)
    employees = cw.list_employees(business_id)
    path = recording_path(persona, slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"persona": persona, "slug": slug, "text": text,
                                "employees": [{"id": e["id"], "name": e["name"]} for e in employees],
                                "events": ch.events, "result": json.loads(t["result_json"] or "{}")},
                               indent=1, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------- coworker constitution ----------------

def base_facts(emp: dict) -> list[dict]:
    """Deterministic facts straight from the profile (available immediately, no LLM)."""
    common = {"subject": emp["name"], "confidence": 0.9, "scope": f"employee:{emp['id']}", "employee_id": emp["id"]}
    facts = [common | {"predicate": "has skill", "object": s, "category": "skill"} for s in emp["skills"][:6]]
    facts += [common | {"predicate": "uses", "object": t, "category": "tool"} for t in emp["tools"][:4]]
    if emp["responsibilities"]:
        facts.append(common | {"predicate": "is responsible for", "object": emp["responsibilities"][:160],
                               "category": "responsibility"})
    return facts


async def build_constitution(business_id: str, emp: dict):
    """Write base facts now, then 5-8 richer facts from one fast-tier call (best-effort)."""
    key = cw.emp_key(business_id, emp["id"])
    try:
        await asyncio.to_thread(store.upsert_facts, key, [f | {"owner_business_id": business_id} for f in base_facts(emp)])
    except Exception as ex:  # noqa: BLE001
        log.warning("base facts failed: %s", ex)
    try:
        out = await call_json(tier="fast", system=P.EMPLOYEE_FACTS_SYSTEM, node="co_constitution",
                              user=_j(_emp_brief(emp)), schema=EmpFactsOut, max_tokens=700)
        common = {"subject": emp["name"], "confidence": 0.75, "scope": f"employee:{emp['id']}",
                  "employee_id": emp["id"], "owner_business_id": business_id}
        await asyncio.to_thread(store.upsert_facts, key, [common | f.model_dump() for f in out.facts[:8]])
    except Exception as ex:  # noqa: BLE001
        log.warning("constitution generation failed for %s: %s", emp["id"], ex)


def constitution_facts(business_id: str, employee_id: str) -> list[dict]:
    try:
        facts = store.get_facts(cw.emp_key(business_id, employee_id), limit=60)
    except Exception:  # noqa: BLE001
        return []
    seen, out = set(), []
    for f in facts:
        k = (f.get("predicate"), f.get("object"))
        if k in seen:
            continue
        seen.add(k)
        out.append({"category": f.get("category", "skill"), "predicate": f.get("predicate", ""),
                    "object": f.get("object", "")})
    return out


def delete_employee_memory(business_id: str, employee_id: str):
    try:
        store.delete_business_memory(cw.emp_key(business_id, employee_id))
    except Exception:  # noqa: BLE001
        pass
