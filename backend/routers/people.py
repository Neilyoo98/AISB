"""People API: one record per person = employee profile + optional login (Team page, People tab).

Reads: any member of the business. Writes: owner/admin, except employees may change their own status.
Existing /employees* and /team* endpoints keep working; this router is the merged view the Team page uses.
"""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, select

import coworkers as cw
import db
import people as P
from auth import current_user, rate_limit
from graphs import coworker_graph as G
from memory import store
from routers import team as T
from routers.coworkers import _bg

router = APIRouter(prefix="/people", tags=["people"])


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="", max_length=120)
    skills: list[str] = Field(default_factory=list, max_length=20)
    responsibilities: str = Field(default="", max_length=600)
    tools: list[str] = Field(default_factory=list, max_length=20)
    invite: bool = False


class PersonPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    role: str | None = Field(default=None, max_length=120)
    skills: list[str] | None = Field(default=None, max_length=20)
    responsibilities: str | None = Field(default=None, max_length=600)
    tools: list[str] | None = Field(default=None, max_length=20)


class StatusIn(BaseModel):
    status: str = Field(pattern="^(available|busy|off)$")


# ---------------- assembling people ----------------

def _iso(d):
    return cw._iso(d)


def _business_rows(business_id: str) -> dict:
    """Everything needed to build Person rows for one business, loaded once."""
    with T.engine.begin() as c:
        reqs = T._rows(c, select(T.tool_requests).where(T.tool_requests.c.business_id == business_id))
        shadow = T._rows(c, select(T.shadow_tools).where(T.shadow_tools.c.business_id == business_id))
        tasks = [dict(r._mapping) for r in c.execute(select(db.plan_tasks).where(and_(
            db.plan_tasks.c.business_id == business_id, db.plan_tasks.c.assignee_employee_id.isnot(None)))).all()]
    approved_cw = []
    for t in cw.list_tasks(business_id, limit=50):
        if t["status"] == "approved" and t.get("result_json"):
            approved_cw.append((json.loads(t["result_json"]), _iso(t["created_at"]), t))
    return {"requests": reqs, "shadow": shadow, "tasks": tasks, "cw": approved_cw}


def _person(emp: dict, business: dict, rows: dict, *, viewer_is_admin: bool, viewer_id: str) -> dict:
    cat = store.load_catalog()
    uid = emp.get("user_id")
    user = db.get_user(uid) if uid else None
    approved = [{"tool_id": r["tool_id"], "since": _iso(r["decided_at"] or r["created_at"])}
                for r in rows["requests"] if uid and r["requester_id"] == uid and r["status"] == "approved"]
    shadow = [{"tool_name": s["tool_name"], "since": _iso(s["created_at"])}
              for s in rows["shadow"] if uid and s["user_id"] == uid]
    task_tools = [(t, since) for res, since, _ in rows["cw"] for t in P.tools_from_workflow(res, emp["id"])]
    ai_tools = P.build_ai_tools(profile_tools=emp.get("tools", []), approved_requests=approved, shadow=shadow,
                                task_tools=task_tools, catalog=cat)
    open_tasks = sum(1 for t in rows["tasks"] if t["assignee_employee_id"] == emp["id"] and not t["done"])
    show_email = viewer_is_admin or uid == viewer_id
    return {"id": emp["id"], "name": emp["name"], "role": emp["role"], "initials": emp["initials"],
            "status": emp["status"], "skills": emp["skills"], "responsibilities": emp["responsibilities"],
            "is_owner": bool(uid and uid == business["user_id"]), "has_login": bool(user),
            "email": user["email"] if (user and show_email) else None,
            "pending_invite_url": None if user or not viewer_is_admin else T.pending_invite_for_person(business["id"], emp["id"]),
            "ai_tools": ai_tools, "open_tasks": open_tasks}


def _ctx(user):
    b, role = T._context(user)
    return b, role == "admin"


def _get_or_404(person_id: str, business_id: str) -> dict:
    e = cw.get_employee(person_id)
    if not e or e["business_id"] != business_id:
        raise HTTPException(404, "Person not found")
    return e


# ---------------- endpoints ----------------

@router.get("")
def list_people(user=Depends(current_user)):
    b, is_admin = _ctx(user)
    rows = _business_rows(b["id"])
    people = [_person(e, b, rows, viewer_is_admin=is_admin, viewer_id=user["id"]) for e in cw.list_employees(b["id"])]
    people.sort(key=lambda p: (not p["is_owner"], p["name"].lower()))
    return people


@router.get("/{person_id}")
def get_person(person_id: str, user=Depends(current_user)):
    b, is_admin = _ctx(user)
    e = _get_or_404(person_id, b["id"])
    rows = _business_rows(b["id"])
    out = _person(e, b, rows, viewer_is_admin=is_admin, viewer_id=user["id"])
    cat = store.load_catalog()
    uid = e.get("user_id")
    out["memory"] = G.constitution_facts(b["id"], person_id)
    out["requests"] = [{"id": r["id"], "tool_id": r["tool_id"], "name": cat.get(r["tool_id"], {}).get("name", r["tool_id"]),
                        "status": r["status"], "created_at": _iso(r["created_at"])}
                       for r in sorted(rows["requests"], key=lambda r: r["created_at"] or 0, reverse=True)
                       if uid and r["requester_id"] == uid]
    out["tasks"] = [{"id": t["id"], "text": t["text"], "done": bool(t["done"])}
                    for t in rows["tasks"] if t["assignee_employee_id"] == person_id]
    past = []
    for res, since, t in rows["cw"]:
        role = cw.involvement(res, person_id)
        if role:
            past.append({"id": t["id"], "text": t["text"], "role_in_task": role, "created_at": since})
    # also unapproved tasks they were part of (shown as history on the person page)
    for t in cw.list_tasks(b["id"], limit=30):
        if t["status"] != "approved" and t.get("result_json"):
            role = cw.involvement(json.loads(t["result_json"]), person_id)
            if role:
                past.append({"id": t["id"], "text": t["text"], "role_in_task": role, "created_at": _iso(t["created_at"])})
    out["coworker_tasks"] = sorted(past, key=lambda x: x["created_at"] or "", reverse=True)[:10]
    return out


@router.post("")
async def create_person(body: PersonIn, request: Request, user=Depends(current_user)):
    rate_limit(request, f"people:{user['id']}", 30, window_s=3600)
    b, is_admin = _ctx(user)
    if not is_admin:
        raise HTTPException(403, "Only the owner can add people")
    if len(cw.list_employees(b["id"])) >= 25:
        raise HTTPException(400, "That's the most people this prototype supports")
    e = cw.create_employee(b["id"], body.name, body.role, body.skills, body.responsibilities, body.tools)
    _bg(G.build_constitution(b["id"], e))
    url = None
    if body.invite:
        url = f"/join/{T.create_invite_row(b['id'], user['id'], body.name, 'member', person_id=e['id'])}"
    return {"person": _person(e, b, _business_rows(b["id"]), viewer_is_admin=True, viewer_id=user["id"]),
            "invite_url": url}


@router.patch("/{person_id}")
async def patch_person(person_id: str, body: PersonPatch, user=Depends(current_user)):
    b, is_admin = _ctx(user)
    if not is_admin:
        raise HTTPException(403, "Only the owner can edit people")
    _get_or_404(person_id, b["id"])
    e = cw.update_employee(person_id, **body.model_dump())
    if body.skills is not None or body.tools is not None or body.responsibilities is not None:
        _bg(G.build_constitution(b["id"], e))
    return _person(e, b, _business_rows(b["id"]), viewer_is_admin=True, viewer_id=user["id"])


@router.patch("/{person_id}/status")
def set_status(person_id: str, body: StatusIn, user=Depends(current_user)):
    b, is_admin = _ctx(user)
    e = _get_or_404(person_id, b["id"])
    if not is_admin and e["user_id"] != user["id"]:
        raise HTTPException(403, "You can only change your own status")
    e = cw.update_employee(person_id, status=body.status)
    return _person(e, b, _business_rows(b["id"]), viewer_is_admin=is_admin, viewer_id=user["id"])


@router.post("/{person_id}/invite")
def invite_person(person_id: str, request: Request, user=Depends(current_user)):
    rate_limit(request, "team_invite", 20)
    b, is_admin = _ctx(user)
    if not is_admin:
        raise HTTPException(403, "Only the owner can invite people")
    e = _get_or_404(person_id, b["id"])
    if e["user_id"]:
        raise HTTPException(409, f"{e['name']} already has a login")
    existing = T.pending_invite_for_person(b["id"], person_id)
    if existing:
        return {"invite_url": existing}
    return {"invite_url": f"/join/{T.create_invite_row(b['id'], user['id'], e['name'], 'member', person_id=person_id)}"}


@router.delete("/{person_id}")
def delete_person(person_id: str, user=Depends(current_user)):
    b, is_admin = _ctx(user)
    if not is_admin:
        raise HTTPException(403, "Only the owner can remove people")
    e = _get_or_404(person_id, b["id"])
    if e["user_id"] and e["user_id"] == b["user_id"]:
        raise HTTPException(400, "The owner can't be removed")
    cw.delete_employee(person_id)
    G.delete_employee_memory(b["id"], person_id)
    with T.engine.begin() as c:
        if e["user_id"]:  # removing a person also removes their login's access to this business
            c.execute(delete(T.org_members).where(T.org_members.c.business_id == b["id"],
                                                  T.org_members.c.user_id == e["user_id"]))
        c.execute(T.update(T.invites).where(T.invites.c.business_id == b["id"], T.invites.c.person_id == person_id)
                  .values(revoked=True))
    return {"ok": True}
