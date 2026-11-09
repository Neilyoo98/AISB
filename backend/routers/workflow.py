"""GET /workflow-map: real-data map of people, their AI tools and how work flows between them."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

import adoptions
import coworkers as cw
from auth import current_user
import db
from memory import store
from people import match_catalog
from routers.team import _context
from workflow_map import build_map

router = APIRouter()

TYPE_LABEL = {
    "ai_receptionist": "AI receptionist", "business_phone": "Business phone", "reviews": "Reviews & reputation",
    "local_listing": "Local listing", "marketing_content": "Marketing content", "email_marketing": "Email & SMS marketing",
    "general_assistant": "AI assistant", "booking": "Booking", "staff_scheduling": "Staff scheduling",
    "field_service": "Field service", "bookkeeping": "Bookkeeping", "pos": "Point of sale",
    "online_ordering": "Online ordering", "restaurant_ops": "Kitchen & menu", "customer_chat": "Customer chat",
    "website": "Website", "automation": "Automation",
}


def approved_tasks(business_id: str, limit: int = 50) -> list[dict]:
    with db.engine.begin() as c:
        rs = c.execute(select(cw.coworker_tasks).where(cw.coworker_tasks.c.business_id == business_id,
                                                       cw.coworker_tasks.c.status == "approved")
                       .order_by(cw.coworker_tasks.c.created_at.desc()).limit(limit)).all()
    out = []
    for r in rs:
        d = dict(r._mapping)
        out.append({"id": d["id"], "text": d["text"], "result": json.loads(d["result_json"] or "{}")})
    return out


@router.get("/workflow-map")
def workflow_map(person_id: str | None = None, scope: str | None = None, user=Depends(current_user)):
    b, role = _context(user)
    emps = cw.list_employees(b["id"])
    ids = {e["id"] for e in emps}
    if person_id and person_id not in ids:
        raise HTTPException(404, "Person not found")
    focus = person_id
    if not focus and role != "admin" and scope != "team":
        me = next((e for e in emps if e["user_id"] == user["id"]), None)
        focus = me["id"] if me else None
    owner = next((e for e in emps if e["user_id"] == b["user_id"]), None)
    return build_map(employees=emps, adopted_ids=adoptions.adopted_ids(b["id"]), tasks=approved_tasks(b["id"]),
                     catalog=store.load_catalog(), owner_employee_id=owner["id"] if owner else None, focus=focus,
                     match_catalog=match_catalog, category_label=lambda c: TYPE_LABEL.get(c, c.replace("_", " ").capitalize()))
