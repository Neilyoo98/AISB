"""Adopt a catalog tool into the business workflow (and remove it). See docs/PHASE2_CONTRACT.md."""
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import adoptions
import db
from auth import current_user, rate_limit
from memory import store

router = APIRouter()


class AdoptIn(BaseModel):
    tool_id: str = Field(min_length=1, max_length=64)


def _business(user) -> dict:
    b = db.get_user_business(user["id"])
    if not b:
        raise HTTPException(404, "Set up your business first")
    return b


def record_adoption(business_id: str, tool_id: str, source: str = "manual") -> bool:
    """Shared entry point (team approvals etc.): adopt + refresh scenarios/tasks. False if already adopted."""
    if not adoptions.adopt(business_id, tool_id, source):
        return False
    adoptions.schedule_refresh(business_id, tool_id)
    return True


def adoption_payload(b: dict) -> dict:
    run = db.latest_complete_run(b["id"])
    scenarios = json.loads(b["scenarios_json"]) if b.get("scenarios_json") else None
    if scenarios is None and run:
        scenarios = (json.loads(run["result_json"] or "{}").get("plan") or {}).get("scenarios") or []
    return {"items": adoptions.list_adopted(b["id"]), "scenarios": scenarios or [],
            "scenarios_status": adoptions.scenarios_status(b["id"], b),
            "tasks": db.get_business_tasks(b["id"], run["id"] if run else None)}


@router.get("/adoptions")
def get_adoptions(user=Depends(current_user)):
    return adoption_payload(_business(user))


@router.post("/adoptions")
async def post_adoption(body: AdoptIn, request: Request, user=Depends(current_user)):
    if body.tool_id not in store.load_catalog():
        raise HTTPException(404, "Unknown tool")
    b = _business(user)
    if body.tool_id in adoptions.adopted_ids(b["id"]):
        raise HTTPException(409, "Already in your stack")
    rate_limit(request, f"adopt:{user['id']}", 10, window_s=24 * 3600)
    record_adoption(b["id"], body.tool_id, "manual")
    return adoption_payload(db.get_business(b["id"]))


@router.delete("/adoptions/{tool_id}")
async def delete_adoption(tool_id: str, user=Depends(current_user)):
    b = _business(user)
    if not adoptions.remove(b["id"], tool_id):
        raise HTTPException(404, "That tool isn't in your stack")
    if adoptions.adopted_ids(b["id"]):
        adoptions.schedule_refresh(b["id"], None)
    else:
        db.update_business(b["id"], scenarios=None)
    return adoption_payload(db.get_business(b["id"]))
