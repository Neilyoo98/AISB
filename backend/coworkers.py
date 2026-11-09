"""Coworker mesh: employees with AI coworkers, and owner-written tasks routed across them (AUBI's hook).

Tables: employees, coworker_tasks (on db.meta, created by init_db). Pure routing lives here so it is unit-testable:
route_task() picks the coworker whose context fits the task (context owner) and applies the substitution rule
(owner is Off -> their coworker still answers from their notes; the human step goes to the best available colleague).
"""
import json
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, String, Table, Text, delete, func, insert, select, update

import db
from db import engine, meta

employees = Table(
    "employees", meta,
    Column("id", String(32), primary_key=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("user_id", String(32)),
    Column("name", String(120), nullable=False),
    Column("role", String(120), nullable=False, default=""),
    Column("skills_json", Text),
    Column("responsibilities", Text),
    Column("tools_json", Text),
    Column("status", String(16), nullable=False, default="available"),  # available | busy | off
    Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)),
)

coworker_tasks = Table(
    "coworker_tasks", meta,
    Column("id", String(32), primary_key=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("created_by", String(32)),
    Column("text", Text, nullable=False),
    Column("status", String(24), nullable=False, default="running"),
    Column("mode", String(16), nullable=False, default="live"),  # live | replay
    Column("recording", String(160)),  # replay: "{persona}/{slug}"
    Column("result_json", Text),
    Column("events_json", Text),
    Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)),
)

STATUSES = ("available", "busy", "off")


# ---------------- small helpers ----------------

def initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


def emp_key(business_id: str, employee_id: str) -> str:
    """Memory namespace for one employee's coworker constitution (keeps it out of the business-level facts)."""
    return f"{business_id}:emp:{employee_id}"


def _emp_out(r) -> dict:
    d = dict(r._mapping)
    return {"id": d["id"], "business_id": d["business_id"], "user_id": d["user_id"], "name": d["name"],
            "role": d["role"] or "", "skills": json.loads(d["skills_json"] or "[]"),
            "responsibilities": d["responsibilities"] or "", "tools": json.loads(d["tools_json"] or "[]"),
            "status": d["status"] or "available", "initials": initials(d["name"])}


def _iso(d):
    if not d:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.isoformat()


# ---------------- employees ----------------

def create_employee(business_id: str, name: str, role: str, skills: list[str], responsibilities: str,
                    tools: list[str], user_id: str | None = None, status: str = "available",
                    employee_id: str | None = None) -> dict:
    eid = employee_id or db.new_id()
    with engine.begin() as c:
        c.execute(insert(employees).values(
            id=eid, business_id=business_id, user_id=user_id, name=name.strip(), role=(role or "").strip(),
            skills_json=json.dumps(_clean_list(skills)), responsibilities=(responsibilities or "").strip(),
            tools_json=json.dumps(_clean_list(tools)), status=status if status in STATUSES else "available"))
    return get_employee(eid)


def _clean_list(xs) -> list[str]:
    out = []
    for x in xs or []:
        x = str(x).strip()
        if x and x.lower() not in {o.lower() for o in out}:
            out.append(x[:60])
    return out[:20]


def get_employee(employee_id: str) -> dict | None:
    with engine.begin() as c:
        r = c.execute(select(employees).where(employees.c.id == employee_id)).first()
    return _emp_out(r) if r else None


def list_employees(business_id: str) -> list[dict]:
    with engine.begin() as c:
        rs = c.execute(select(employees).where(employees.c.business_id == business_id)
                       .order_by(employees.c.created_at, employees.c.name)).all()
    return [_emp_out(r) for r in rs]


def update_employee(employee_id: str, **vals) -> dict | None:
    v = {}
    for k in ("name", "role", "responsibilities", "user_id"):
        if k in vals and vals[k] is not None:
            v[k] = vals[k].strip() if isinstance(vals[k], str) else vals[k]
    if vals.get("skills") is not None:
        v["skills_json"] = json.dumps(_clean_list(vals["skills"]))
    if vals.get("tools") is not None:
        v["tools_json"] = json.dumps(_clean_list(vals["tools"]))
    if vals.get("status") in STATUSES:
        v["status"] = vals["status"]
    if v:
        with engine.begin() as c:
            c.execute(update(employees).where(employees.c.id == employee_id).values(**v))
    return get_employee(employee_id)


def delete_employee(employee_id: str):
    with engine.begin() as c:
        c.execute(delete(employees).where(employees.c.id == employee_id))


def delete_for_businesses(business_ids: list[str]):
    if not business_ids:
        return
    with engine.begin() as c:
        c.execute(delete(employees).where(employees.c.business_id.in_(business_ids)))
        c.execute(delete(coworker_tasks).where(coworker_tasks.c.business_id.in_(business_ids)))


# ---------------- coworker tasks ----------------

def create_task(business_id: str, created_by: str | None, text: str, mode: str, recording: str | None = None,
                created_at=None) -> str:
    tid = db.new_id()
    with engine.begin() as c:
        c.execute(insert(coworker_tasks).values(id=tid, business_id=business_id, created_by=created_by, text=text,
                                                status="running", mode=mode, recording=recording,
                                                created_at=created_at or datetime.now(timezone.utc)))
    return tid


def update_task(task_id: str, **vals):
    for k in ("result", "events"):
        if k in vals:
            vals[f"{k}_json"] = json.dumps(vals.pop(k))
    with engine.begin() as c:
        c.execute(update(coworker_tasks).where(coworker_tasks.c.id == task_id).values(**vals))


def get_task(task_id: str) -> dict | None:
    with engine.begin() as c:
        r = c.execute(select(coworker_tasks).where(coworker_tasks.c.id == task_id)).first()
    return dict(r._mapping) if r else None


def task_out(t: dict, with_result: bool = True) -> dict:
    out = {"id": t["id"], "text": t["text"], "status": t["status"], "mode": t["mode"],
           "created_at": _iso(t["created_at"]), "result": None}
    if with_result and t.get("result_json"):
        out["result"] = json.loads(t["result_json"])
    return out


def list_tasks(business_id: str, limit: int = 20) -> list[dict]:
    with engine.begin() as c:
        rs = c.execute(select(coworker_tasks).where(coworker_tasks.c.business_id == business_id)
                       .order_by(coworker_tasks.c.created_at.desc()).limit(limit)).all()
    return [dict(r._mapping) for r in rs]


def count_live_today(business_id: str) -> int:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    with engine.begin() as c:
        return c.execute(select(func.count()).select_from(coworker_tasks).where(
            coworker_tasks.c.business_id == business_id, coworker_tasks.c.mode == "live",
            coworker_tasks.c.created_at >= since)).scalar() or 0


# ---------------- pure routing (context owner + substitution) ----------------

_STOP = {"the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "with", "at", "is", "are", "be", "by", "from",
         "our", "my", "we", "i", "it", "this", "that", "customer", "customers", "new", "get", "about", "up", "out"}


def tokens(text: str) -> set[str]:
    out = set()
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if len(w) > 2 and w not in _STOP:
            out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def _overlap(a: set[str], b: set[str]) -> list[str]:
    return sorted(a & b)


def score_employee(emp: dict, needs: dict, memory_hits: int = 0) -> tuple[float, list[str]]:
    """Skill overlap (x3) + responsibilities vs task words (x2) + past similar tasks (x1, capped) + tool fit (x0.5)."""
    need_words = tokens(" ".join(needs.get("needed_skills", []))) | tokens(needs.get("text", ""))
    cap_words = tokens(" ".join(needs.get("needed_capabilities", [])))
    skill_words = tokens(" ".join(emp.get("skills", [])))
    resp_words = tokens(emp.get("responsibilities", "")) | tokens(emp.get("role", ""))
    tool_words = tokens(" ".join(emp.get("tools", [])))
    skill_hit = _overlap(need_words, skill_words)
    resp_hit = _overlap(need_words | cap_words, resp_words)
    tool_hit = _overlap(cap_words | need_words, tool_words)
    score = 3 * len(skill_hit) + 2 * len(resp_hit) + min(3, max(0, memory_hits)) + 0.5 * len(tool_hit)
    return round(score, 2), skill_hit or resp_hit


def route_task(employees_: list[dict], needs: dict, memory_hits: dict[str, int] | None = None) -> dict:
    """Pick the context owner; if they are Off, their coworker covers and the human step goes to the best
    Available colleague (then Busy). Returns the contract's Route."""
    if not employees_:
        raise ValueError("no employees")
    memory_hits = memory_hits or {}
    scored = []
    for i, e in enumerate(employees_):
        s, why = score_employee(e, needs, memory_hits.get(e["id"], 0))
        scored.append((s, -i, e, why))
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    owner_score, _, owner, why = scored[0]
    if why:
        owner_reason = f"{owner['name']} knows this best ({', '.join(why[:3])})."
    else:
        owner_reason = f"{owner['name']} is the closest fit as {owner['role'] or 'a team member'}."
    human, substituted, note = owner, False, None
    if owner["status"] == "off":
        substituted = True
        others = [x for x in scored if x[2]["id"] != owner["id"]]
        pick = next((x[2] for x in others if x[2]["status"] == "available"), None) or \
            next((x[2] for x in others if x[2]["status"] == "busy"), None)
        if pick:
            human = pick
            note = (f"{owner['name']} is off today, so their coworker answered from their notes "
                    f"and {pick['name']} takes the hands-on step.")
        else:
            note = (f"{owner['name']} is off today and nobody else is available, so their coworker prepared "
                    f"everything for when they're back.")
    return {"owner_id": owner["id"], "owner_reason": owner_reason, "substituted": substituted,
            "human_id": human["id"], "substitution_note": note,
            "scores": [{"employee_id": x[2]["id"], "score": x[0]} for x in scored]}


def memory_hits_for(business_id: str, text: str) -> dict[str, int]:
    """How many earlier approved tasks with similar wording each employee was involved in."""
    words = tokens(text)
    hits: dict[str, int] = {}
    for t in list_tasks(business_id, limit=30):
        if t["status"] != "approved" or not t.get("result_json"):
            continue
        if len(words & tokens(t["text"])) < 2:
            continue
        res = json.loads(t["result_json"])
        involved = {res.get("route", {}).get("owner_id"), res.get("route", {}).get("human_id")}
        involved |= {s.get("actor_id") for s in res.get("workflow", []) if s.get("actor_type") == "employee"}
        for eid in involved - {None}:
            hits[eid] = hits.get(eid, 0) + 1
    return hits


def involvement(result: dict, employee_id: str) -> str | None:
    """Plain role an employee played in a task result (for their constitution page)."""
    route = result.get("route") or {}
    if route.get("owner_id") == employee_id and route.get("substituted"):
        return "Their coworker covered while they were off"
    if route.get("owner_id") == employee_id:
        return "Knew this best"
    if route.get("human_id") == employee_id:
        return "Took the hands-on step"
    if any(s.get("actor_id") == employee_id for s in result.get("workflow", [])):
        return "Did a step"
    if any(m.get("from_id") == employee_id for m in result.get("mesh", [])):
        return "Shared context"
    return None
