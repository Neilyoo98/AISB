"""Team mode + procurement (brief Module 4): members, tool requests with a spend cap, licenses, shadow AI.

The business owner is implicitly the admin. Members belong to one business (db.get_user_business resolves it).
"""
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, String, Table, Text, delete, insert, select, update

import adoptions
import db
import evaluate as ev
import procurement as pr
from auth import current_user, hash_password, rate_limit
from db import engine, meta
from memory import store

router = APIRouter(prefix="/team", tags=["team"])


def _now():
    return datetime.now(timezone.utc)


org_members = Table(
    "org_members", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("user_id", String(32), nullable=False, index=True),
    Column("role", String(16), nullable=False, default="member"),  # admin | member
    Column("created_at", DateTime(timezone=True), default=_now),
)

tool_requests = Table(
    "tool_requests", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("requester_id", String(32), nullable=False),
    Column("tool_id", String(64), nullable=False),
    Column("reason", Text),
    Column("seats", Integer, nullable=False, default=1),
    Column("est_monthly_cost", Float, default=0.0),
    Column("status", String(16), nullable=False, default="pending"),  # pending | approved | denied
    Column("decided_by", String(32)),
    Column("decided_at", DateTime(timezone=True)),
    Column("override", Boolean, default=False),
    Column("source", String(16), default="request"),  # request | shadow
    Column("created_at", DateTime(timezone=True), default=_now),
)

licenses = Table(
    "licenses", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("tool_id", String(64), nullable=False),
    Column("seats_bought", Integer, nullable=False, default=1),
    Column("seats_assigned", Integer, nullable=False, default=0),
    Column("renewal_date", String(10)),  # YYYY-MM-DD
    Column("created_at", DateTime(timezone=True), default=_now),
)

invites = Table(
    "team_invites", meta,
    Column("code", String(32), primary_key=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("name", String(100)),  # who the owner meant to invite (display only)
    Column("role", String(16), nullable=False, default="member"),
    Column("created_by", String(32), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("used_by", String(32)),
    Column("person_id", String(32)),  # invite bound to an existing person profile (joining links the login to it)
    Column("revoked", Boolean, default=False, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now),
)

shadow_tools = Table(
    "shadow_tools", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("user_id", String(32), nullable=False),
    Column("tool_name", String(120), nullable=False),
    Column("note", Text),
    Column("status", String(16), nullable=False, default="open"),  # open | converted
    Column("created_at", DateTime(timezone=True), default=_now),
)


# ---------------- helpers ----------------

def _rows(c, q):
    return [dict(r._mapping) for r in c.execute(q).all()]


def _iso(d):
    return d.isoformat() if d else None


def _context(user) -> tuple[dict, str]:
    """(business, role) for the current user; 404 if they have no business yet."""
    b = db.get_user_business(user["id"])
    if not b:
        raise HTTPException(404, "Set up your business first")
    if b["user_id"] == user["id"]:
        return b, "admin"
    with engine.begin() as c:
        m = c.execute(select(org_members.c.role).where(org_members.c.business_id == b["id"],
                                                       org_members.c.user_id == user["id"])).first()
    return b, (m.role if m else "member")


def _admin(user) -> dict:
    b, role = _context(user)
    if role != "admin":
        raise HTTPException(403, "Only an admin can do that")
    return b


def _adopted_tool_ids(business_id: str) -> list[str]:
    return adoptions.adopted_ids(business_id)


def _record_adoption(business_id: str, tool_id: str):
    """Approved request -> manual adoption + scenario/task refresh (workstream A's shared entry point)."""
    from routers.adoption import record_adoption  # local import avoids a router import cycle
    record_adoption(business_id, tool_id, "manual")


def _spend(b: dict) -> dict:
    cat = store.load_catalog()
    adopted = [cat[t] for t in _adopted_tool_ids(b["id"]) if t in cat]
    with engine.begin() as c:
        lic = _rows(c, select(licenses).where(licenses.c.business_id == b["id"]))
    committed = pr.committed_monthly(adopted, [(cat[l["tool_id"]], l["seats_bought"]) for l in lic if l["tool_id"] in cat])
    return pr.spend_summary(b.get("ai_spend_cap"), committed)


def _match_catalog(name: str) -> str | None:
    n = name.strip().lower()
    for t in store.load_catalog().values():
        if n in (t["id"], t["name"].lower()) or t["name"].lower().startswith(n) or n.startswith(t["name"].lower().split(" (")[0]):
            return t["id"]
    return None


# ---------------- models ----------------

class InviteIn(BaseModel):
    name: str = Field(default="", max_length=100)
    role: str = Field(default="member", pattern="^(admin|member)$")


class RequestIn(BaseModel):
    tool_id: str
    reason: str = Field(default="", max_length=600)
    seats: int = Field(default=1, ge=1, le=500)


class DecideIn(BaseModel):
    approve: bool
    override: bool = False


class CapIn(BaseModel):
    monthly_cap: float | None = Field(default=None, ge=0, le=1_000_000)


class LicenseIn(BaseModel):
    tool_id: str
    seats_bought: int = Field(ge=1, le=10000)
    renewal_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class SeatsIn(BaseModel):
    seats_assigned: int = Field(ge=0, le=10000)


class ShadowIn(BaseModel):
    tool_name: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=600)


# ---------------- endpoints ----------------

@router.get("")
def get_team(user=Depends(current_user)):
    b, role = _context(user)
    cat = store.load_catalog()
    with engine.begin() as c:
        mem = _rows(c, select(org_members).where(org_members.c.business_id == b["id"]))
        reqs = _rows(c, select(tool_requests).where(tool_requests.c.business_id == b["id"])
                     .order_by(tool_requests.c.created_at.desc()))
        lic = _rows(c, select(licenses).where(licenses.c.business_id == b["id"]).order_by(licenses.c.id))
        shadow = _rows(c, select(shadow_tools).where(shadow_tools.c.business_id == b["id"])
                       .order_by(shadow_tools.c.created_at.desc()))
    names = {}

    def uname(uid):
        if uid not in names:
            u = db.get_user(uid)
            names[uid] = u["name"] if u else "Former member"
        return names[uid]

    owner = db.get_user(b["user_id"])
    members = [{"user_id": owner["id"], "name": owner["name"], "email": owner["email"], "role": "admin", "owner": True}] if owner else []
    for m in mem:
        u = db.get_user(m["user_id"])
        if u:
            members.append({"user_id": u["id"], "name": u["name"], "email": u["email"], "role": m["role"], "owner": False})
    spend = _spend(b)
    adopted = set(_adopted_tool_ids(b["id"]))
    if role != "admin":  # members only see their own requests
        reqs = [r for r in reqs if r["requester_id"] == user["id"]]
    pending_invites = []
    if role == "admin":
        now = _now()
        with engine.begin() as c:
            inv = _rows(c, select(invites).where(invites.c.business_id == b["id"]).order_by(invites.c.created_at.desc()))
        pending_invites = [{"code": i["code"], "name": i["name"], "role": i["role"], "url": f"/join/{i['code']}",
                            "expires_at": _iso(i["expires_at"])} for i in inv if pr.invite_status(i, now) == "valid"]
    return {
        "role": role,
        "business_name": b["name"],
        "me": user["id"],
        "members": members,
        "invites": pending_invites,
        "requests": [{**{k: r[k] for k in ("id", "tool_id", "reason", "seats", "est_monthly_cost", "status", "override", "source")},
                      "tool_name": cat.get(r["tool_id"], {}).get("name", r["tool_id"]),
                      "category": cat.get(r["tool_id"], {}).get("category"),
                      "mine": r["requester_id"] == user["id"],
                      "requester": uname(r["requester_id"]), "decided_by": uname(r["decided_by"]) if r["decided_by"] else None,
                      "decided_at": _iso(r["decided_at"]), "created_at": _iso(r["created_at"]),
                      "impact": pr.request_impact(spend["cap"], spend["committed_monthly"], r["est_monthly_cost"],
                                                  r["tool_id"] in adopted) if r["status"] == "pending" else None}
                     for r in reqs],
        "licenses": [{"id": l["id"], "tool_id": l["tool_id"], "name": cat.get(l["tool_id"], {}).get("name", l["tool_id"]),
                      "seats_bought": l["seats_bought"], "seats_assigned": l["seats_assigned"], "renewal_date": l["renewal_date"],
                      "monthly_cost": ev.tco(cat[l["tool_id"]], l["seats_bought"], 1, hourly_cost=0)["monthly"] if l["tool_id"] in cat else None}
                     for l in lic],
        "shadow": [{"id": s["id"], "tool_name": s["tool_name"], "note": s["note"], "status": s["status"],
                    "user": uname(s["user_id"]), "catalog_id": _match_catalog(s["tool_name"]), "created_at": _iso(s["created_at"])}
                   for s in shadow],
        "adopted": sorted(adopted),
        "spend": spend,
    }


@router.get("/me")
def team_me(user=Depends(current_user)):
    """Lightweight role lookup for buttons across the app (Adopt for owners, Request for members)."""
    b = db.get_user_business(user["id"])
    if not b:
        return {"role": None, "business_name": None, "pending_requests": 0, "my_pending_tool_ids": []}
    _, role = _context(user)
    with engine.begin() as c:
        rows = c.execute(select(tool_requests.c.tool_id, tool_requests.c.requester_id).where(
            tool_requests.c.business_id == b["id"], tool_requests.c.status == "pending")).all()
    mine = sorted({r.tool_id for r in rows if r.requester_id == user["id"]})
    pending = len(rows) if role == "admin" else len([r for r in rows if r.requester_id == user["id"]])
    return {"role": role, "business_name": b["name"], "pending_requests": pending, "my_pending_tool_ids": mine}


# ---------------- invites (shareable link) ----------------

@router.post("/invites")
def create_invite(body: InviteIn, request: Request, user=Depends(current_user)):
    rate_limit(request, "team_invite", 20)
    b = _admin(user)
    code = create_invite_row(b["id"], user["id"], body.name, body.role)
    return {"code": code, "url": f"/join/{code}", "expires_in_days": pr.INVITE_DAYS}


@router.delete("/invites/{code}")
def revoke_invite(code: str, user=Depends(current_user)):
    b = _admin(user)
    with engine.begin() as c:
        c.execute(update(invites).where(invites.c.code == code, invites.c.business_id == b["id"]).values(revoked=True))
    return {"ok": True}


def _invite(code: str) -> dict:
    with engine.begin() as c:
        r = c.execute(select(invites).where(invites.c.code == code)).first()
    if not r:
        raise HTTPException(404, "This invite link isn't valid. Ask the owner for a new one.")
    return dict(r._mapping)


_INVITE_MSG = {"expired": "This invite link has expired. Ask the owner for a new one.",
               "used": "This invite link has already been used. Ask the owner for a new one.",
               "revoked": "This invite link was cancelled. Ask the owner for a new one."}


@router.get("/invite/{code}")
def invite_info(code: str):
    """Public: what the join page shows before the employee signs up."""
    inv = _invite(code)
    b = db.get_business(inv["business_id"])
    owner = db.get_user(b["user_id"]) if b else None
    status = pr.invite_status(inv, _now())
    return {"business_name": b["name"] if b else None, "invited_by": owner["name"] if owner else None,
            "name": inv["name"], "role": inv["role"], "status": status, "message": _INVITE_MSG.get(status)}


def create_invite_row(business_id: str, created_by: str, name: str | None = None, role: str = "member",
                      person_id: str | None = None) -> str:
    code = secrets.token_urlsafe(9)
    with engine.begin() as c:
        c.execute(insert(invites).values(code=code, business_id=business_id, name=(name or "").strip() or None, role=role,
                                         created_by=created_by, person_id=person_id,
                                         expires_at=_now() + timedelta(days=pr.INVITE_DAYS)))
    return code


def pending_invite_for_person(business_id: str, person_id: str) -> str | None:
    """Join link of a still-valid invite bound to this person, if any."""
    now = _now()
    with engine.begin() as c:
        rs = _rows(c, select(invites).where(invites.c.business_id == business_id, invites.c.person_id == person_id)
                   .order_by(invites.c.created_at.desc()))
    inv = next((i for i in rs if pr.invite_status(i, now) == "valid"), None)
    return f"/join/{inv['code']}" if inv else None


def check_invite(code: str) -> dict:
    """The invite row if it can still be used; HTTP 410 with a friendly message otherwise."""
    inv = _invite(code)
    status = pr.invite_status(inv, _now())
    if status != "valid":
        raise HTTPException(410, _INVITE_MSG[status])
    return inv


def _link_person(inv: dict, user: dict) -> str:
    """Attach the new login to the person the invite was made for, or give them a fresh person profile."""
    import coworkers as cw  # local import keeps router import order simple
    bid = inv["business_id"]
    staff = cw.list_employees(bid)
    mine = next((e for e in staff if e["user_id"] == user["id"]), None)
    if mine:
        return mine["id"]
    pid = inv.get("person_id")
    if pid:
        e = next((e for e in staff if e["id"] == pid), None)
        if e and not e["user_id"]:
            cw.update_employee(pid, user_id=user["id"])
            return pid
    e = cw.create_employee(bid, user["name"], "Team member", [], "", [], user_id=user["id"])
    return e["id"]


def join_with_invite(user: dict, inv: dict) -> dict:
    """Make `user` a member of the invite's business and link their person profile. Used by /join and sign-up."""
    current = db.get_user_business(user["id"])
    if current and current["id"] == inv["business_id"]:
        return {"ok": True, "business_name": current["name"], "already_member": True,
                "person_id": _link_person(inv, user)}
    if current:
        raise HTTPException(409, f"You already belong to {current['name']}. Use a different account to join this team.")
    with engine.begin() as c:
        c.execute(insert(org_members).values(business_id=inv["business_id"], user_id=user["id"], role=inv["role"]))
        c.execute(update(invites).where(invites.c.code == inv["code"]).values(used_by=user["id"]))
    b = db.get_business(inv["business_id"])
    return {"ok": True, "business_name": b["name"] if b else None, "person_id": _link_person(inv, user)}


@router.post("/join/{code}")
def join_team(code: str, request: Request, user=Depends(current_user)):
    rate_limit(request, "team_join", 10)
    return join_with_invite(user, check_invite(code))


@router.delete("/members/{user_id}")
def remove_member(user_id: str, user=Depends(current_user)):
    b = _admin(user)
    with engine.begin() as c:
        c.execute(delete(org_members).where(org_members.c.business_id == b["id"], org_members.c.user_id == user_id))
    return {"ok": True}


@router.post("/requests")
def create_request(body: RequestIn, request: Request, user=Depends(current_user)):
    rate_limit(request, "team_request", 20)
    b, _ = _context(user)
    cat = store.load_catalog()
    if body.tool_id not in cat:
        raise HTTPException(404, "Unknown tool")
    cost = ev.tco(cat[body.tool_id], body.seats, 1, hourly_cost=0)["monthly"]
    with engine.begin() as c:
        rid = c.execute(insert(tool_requests).values(business_id=b["id"], requester_id=user["id"], tool_id=body.tool_id,
                                                     reason=body.reason.strip(), seats=body.seats, est_monthly_cost=cost,
                                                     status="pending")).inserted_primary_key[0]
    return {"ok": True, "id": rid, "est_monthly_cost": cost}


@router.post("/requests/{req_id}/decide")
async def decide_request(req_id: int, body: DecideIn, user=Depends(current_user)):
    b = _admin(user)
    with engine.begin() as c:
        r = c.execute(select(tool_requests).where(tool_requests.c.id == req_id, tool_requests.c.business_id == b["id"])).first()
    if not r:
        raise HTTPException(404, "Request not found")
    if r.status != "pending":
        raise HTTPException(409, f"Already {r.status}")
    if body.approve:
        spend = _spend(b)
        already = r.tool_id in _adopted_tool_ids(b["id"])
        ok, msg = pr.check_approval(b.get("ai_spend_cap"), spend["committed_monthly"], 0 if already else r.est_monthly_cost,
                                    body.override)
        if not ok:
            raise HTTPException(409, msg)
    with engine.begin() as c:
        c.execute(update(tool_requests).where(tool_requests.c.id == req_id).values(
            status="approved" if body.approve else "denied", decided_by=user["id"], decided_at=_now(),
            override=bool(body.approve and body.override)))
    if body.approve:
        _record_adoption(b["id"], r.tool_id)
    return {"ok": True, "status": "approved" if body.approve else "denied", "spend": _spend(db.get_business(b["id"]))}


@router.put("/spend-cap")
def set_cap(body: CapIn, user=Depends(current_user)):
    b = _admin(user)
    db.update_business(b["id"], ai_spend_cap=body.monthly_cap or None)
    return {"ok": True, "spend": _spend(db.get_business(b["id"]))}


@router.post("/licenses")
def add_license(body: LicenseIn, user=Depends(current_user)):
    b = _admin(user)
    if body.tool_id not in store.load_catalog():
        raise HTTPException(404, "Unknown tool")
    with engine.begin() as c:
        lid = c.execute(insert(licenses).values(business_id=b["id"], tool_id=body.tool_id, seats_bought=body.seats_bought,
                                                seats_assigned=0, renewal_date=body.renewal_date)).inserted_primary_key[0]
    return {"ok": True, "id": lid}


@router.patch("/licenses/{lic_id}")
def update_license(lic_id: int, body: SeatsIn, user=Depends(current_user)):
    b = _admin(user)
    with engine.begin() as c:
        l = c.execute(select(licenses).where(licenses.c.id == lic_id, licenses.c.business_id == b["id"])).first()
        if not l:
            raise HTTPException(404, "License not found")
        if body.seats_assigned > l.seats_bought:
            raise HTTPException(400, f"Only {l.seats_bought} seats were bought")
        c.execute(update(licenses).where(licenses.c.id == lic_id).values(seats_assigned=body.seats_assigned))
    return {"ok": True}


@router.post("/shadow")
def declare_shadow(body: ShadowIn, request: Request, user=Depends(current_user)):
    rate_limit(request, "team_shadow", 20)
    b, _ = _context(user)
    with engine.begin() as c:
        sid = c.execute(insert(shadow_tools).values(business_id=b["id"], user_id=user["id"], tool_name=body.tool_name.strip(),
                                                    note=body.note.strip(), status="open")).inserted_primary_key[0]
    return {"ok": True, "id": sid}


@router.post("/shadow/{shadow_id}/approve")
def shadow_to_request(shadow_id: int, user=Depends(current_user)):
    """Turn a declared 'unapproved in use' tool into a normal approval request (catalog tools only)."""
    b = _admin(user)
    with engine.begin() as c:
        s = c.execute(select(shadow_tools).where(shadow_tools.c.id == shadow_id, shadow_tools.c.business_id == b["id"])).first()
    if not s:
        raise HTTPException(404, "Not found")
    if s.status != "open":
        raise HTTPException(409, "Already converted")
    tool_id = _match_catalog(s.tool_name)
    if not tool_id:
        raise HTTPException(400, f"“{s.tool_name}” isn't in our verified catalog yet, so it can't be approved here.")
    cost = ev.tco(store.load_catalog()[tool_id], 1, 1, hourly_cost=0)["monthly"]
    with engine.begin() as c:
        rid = c.execute(insert(tool_requests).values(business_id=b["id"], requester_id=s.user_id, tool_id=tool_id,
                                                     reason=f"Already in use (declared): {s.note or ''}".strip(),
                                                     seats=1, est_monthly_cost=cost, status="pending", source="shadow")
                        ).inserted_primary_key[0]
        c.execute(update(shadow_tools).where(shadow_tools.c.id == shadow_id).values(status="converted"))
    return {"ok": True, "request_id": rid}


# ---------------- demo seed (called from seed.py) ----------------

DEMO_TEAM = {
    "joes-coffee": {"members": [("Priya Shah", "Shift lead"), ("Marcus Lee", "Barista")],
                    "request": ("canva-pro", "Make menu boards and Instagram posts faster", 1),
                    "license": ("7shifts", 6, 4), "shadow": ("ChatGPT", "Using my personal account to write the weekly specials")},
    "coolair-hvac": {"members": [("Luis Ortega", "Lead tech"), ("Dana Brooks", "Office manager")],
                     "request": ("nicejob", "Ask every customer for a Google review after the job", 1),
                     "license": ("jobber", 5, 4), "shadow": ("Claude", "Drafting maintenance-plan emails")},
    "greenleaf": {"members": [("Tom Reyes", "Crew lead"), ("Ana Silva", "Office")],
                  "request": ("google-business-profile", "Post spring photos and answer reviews", 1),
                  "license": ("jobber", 3, 2), "shadow": ("Canva", "Flyers for the spring cleanup promo")},
}


def seed_demo_team(business_id: str, owner_id: str, persona_id: str, monthly_budget: float | None):
    spec = DEMO_TEAM.get(persona_id)
    if not spec:
        return
    member_ids = []
    for i, (name, _title) in enumerate(spec["members"]):
        email = f"member{i + 1}.{persona_id}@demo.stacksmith"
        u = db.get_user_by_email(email)
        uid = u["id"] if u else db.create_user(email, name, hash_password(secrets.token_urlsafe(24)), is_demo=True)
        member_ids.append(uid)
    tool, reason, seats = spec["request"]
    cat = store.load_catalog()
    lic_tool, bought, assigned = spec["license"]
    with engine.begin() as c:
        for uid in member_ids:
            c.execute(insert(org_members).values(business_id=business_id, user_id=uid, role="member"))
        c.execute(insert(tool_requests).values(business_id=business_id, requester_id=member_ids[0], tool_id=tool,
                                               reason=reason, seats=seats, status="pending",
                                               est_monthly_cost=ev.tco(cat[tool], seats, 1, hourly_cost=0)["monthly"]))
        c.execute(insert(licenses).values(business_id=business_id, tool_id=lic_tool, seats_bought=bought,
                                          seats_assigned=assigned, renewal_date=f"{_now().year + 1}-01-15"))
        name, note = spec["shadow"]
        c.execute(insert(shadow_tools).values(business_id=business_id, user_id=member_ids[1], tool_name=name, note=note,
                                              status="open"))
    if monthly_budget:
        db.update_business(business_id, ai_spend_cap=float(monthly_budget))


def delete_team_rows(business_ids: list[str]):
    if not business_ids:
        return
    with engine.begin() as c:
        for t in (org_members, tool_requests, licenses, shadow_tools, invites):
            c.execute(delete(t).where(t.c.business_id.in_(business_ids)))
