"""Edit the business profile; other panels read the synced profile on their next load."""
import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import adoptions
import db
from auth import current_user
from memory import store
from profile_sync import facts_from_details, sync_profile

router = APIRouter()


class ProfileDetailsIn(BaseModel):
    business_category: str | None = Field(default=None, max_length=40)
    business_type: str | None = Field(default=None, max_length=60)  # legacy free text, kept for old clients
    team_size: int | None = Field(default=None, ge=1, le=10000)
    budget: str | None = Field(default=None, max_length=40)
    tech_comfort: int | None = Field(default=None, ge=1, le=5)
    current_tools: list[str] = Field(default_factory=list, max_length=20)
    security_must_haves: list[str] = Field(default_factory=list, max_length=4)
    goals: list[str] = Field(default_factory=list, max_length=6)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    location: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, min_length=40, max_length=3000)
    details: ProfileDetailsIn | None = None


@router.patch("/businesses/me")
async def patch_business(body: ProfileIn, user=Depends(current_user)):
    if user["is_demo"]:
        raise HTTPException(403, "Sample businesses can't be edited — create your own account")
    b = db.get_user_business(user["id"])
    if not b:
        raise HTTPException(404, "Set up your business first")
    if b["user_id"] != user["id"]:
        raise HTTPException(403, "Only the business owner can edit the business profile")
    old_profile = json.loads(b["profile_json"]) if b.get("profile_json") else None
    old_details = json.loads(b["details_json"]) if b.get("details_json") else {}
    details = old_details | (body.details.model_dump() if body.details else {})
    name = body.name or b["name"]
    location = body.location if body.location is not None else b.get("location")
    profile = sync_profile(old_profile, details, name=name, location=location)

    vals = {"name": name, "location": location, "details": details, "profile": profile,
            "vertical": profile["vertical"]}
    if body.description:
        vals["description"] = body.description
    db.update_business(b["id"], **vals)
    await asyncio.to_thread(store.upsert_facts, b["id"], facts_from_details(details, profile))

    tools_changed = set((old_profile or {}).get("current_tools") or []) != set(profile["current_tools"])
    if tools_changed and adoptions.adopted_ids(b["id"]):
        adoptions.schedule_refresh(b["id"], None)

    nb = db.get_business(b["id"])
    return {"id": nb["id"], "name": nb["name"], "vertical": nb["vertical"], "location": nb["location"],
            "description": nb["description"], "profile": profile, "details": details}
