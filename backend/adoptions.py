"""Adoptions: which catalog tools a business has put into its workflow (from an approved plan or added manually).

Adding a tool triggers a background refresh (one fast-tier LLM call) that rewrites the business's
day-in-the-life scenarios for the whole adopted stack and appends 3 setup tasks for the new tool.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone

from pydantic import BaseModel, Field
from sqlalchemy import Column, DateTime, Integer, String, Table, delete, insert, select, update

import db
from db import engine, meta
from graphs import prompts as P
from graphs.state import Scenario
from llm import BudgetExceeded, LLMError, call_json

log = logging.getLogger("adoptions")

adoptions = Table(
    "adoptions", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("business_id", String(32), nullable=False, index=True),
    Column("tool_id", String(64), nullable=False),
    Column("source", String(16), nullable=False),  # plan | manual
    Column("status", String(16), nullable=False, default="adopted"),  # adopted | removed
    Column("run_id", String(32)),
    Column("created_at", DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)),
)

# business ids whose scenarios are being regenerated right now (single-worker API)
REFRESHING: set[str] = set()
_tasks: set[asyncio.Task] = set()


class SetupTask(BaseModel):
    text: str
    owner: str = Field(description="who does it, e.g. Owner, Manager, Front staff")
    minutes: int = Field(ge=5, le=480)


class RefreshOut(BaseModel):
    scenarios: list[Scenario] = Field(description="exactly 2 scenarios")
    tasks: list[SetupTask] = Field(description="exactly 3 setup tasks for the newly adopted tool")


# ---------------- data ----------------

def _row(r):
    d = dict(r._mapping)
    d["adopted_at"] = d.pop("created_at").isoformat() if d.get("created_at") else None
    return d


def list_adopted(business_id: str) -> list[dict]:
    with engine.begin() as c:
        rs = c.execute(select(adoptions).where(adoptions.c.business_id == business_id,
                                               adoptions.c.status == "adopted")
                       .order_by(adoptions.c.created_at)).all()
    return [_row(r) for r in rs]


def adopted_ids(business_id: str) -> list[str]:
    return [a["tool_id"] for a in list_adopted(business_id)]


def adopt(business_id: str, tool_id: str, source: str, run_id: str | None = None) -> bool:
    """Returns False if the tool is already adopted (idempotent)."""
    with engine.begin() as c:
        existing = c.execute(select(adoptions.c.id, adoptions.c.status).where(
            adoptions.c.business_id == business_id, adoptions.c.tool_id == tool_id)).first()
        if existing and existing.status == "adopted":
            return False
        if existing:
            c.execute(update(adoptions).where(adoptions.c.id == existing.id).values(
                status="adopted", source=source, run_id=run_id, created_at=datetime.now(timezone.utc)))
        else:
            c.execute(insert(adoptions).values(business_id=business_id, tool_id=tool_id, source=source,
                                               status="adopted", run_id=run_id))
    return True


def remove(business_id: str, tool_id: str) -> bool:
    with engine.begin() as c:
        res = c.execute(update(adoptions).where(adoptions.c.business_id == business_id,
                                                adoptions.c.tool_id == tool_id,
                                                adoptions.c.status == "adopted").values(status="removed"))
    return res.rowcount > 0


def delete_for_businesses(business_ids: list[str]):
    if business_ids:
        with engine.begin() as c:
            c.execute(delete(adoptions).where(adoptions.c.business_id.in_(business_ids)))


def scenarios_status(business_id: str, business: dict | None = None) -> str:
    if business_id in REFRESHING:
        return "updating"
    b = business or db.get_business(business_id)
    return "ready" if b and b.get("scenarios_json") else "none"


def record_plan(business_id: str, run_id: str, tool_ids: list[str]):
    """Called when a War Room stack is approved. Plan scenarios become current; manual extras trigger a refresh."""
    for t in tool_ids:
        adopt(business_id, t, "plan", run_id)
    extras = set(adopted_ids(business_id)) - set(tool_ids)
    if extras:
        schedule_refresh(business_id, sorted(extras)[-1])
    else:
        db.update_business(business_id, scenarios=None)  # the new plan's own scenarios are the freshest


# ---------------- background refresh ----------------

def schedule_refresh(business_id: str, new_tool_id: str | None):
    """Fire-and-forget refresh; safe to call from sync or async code inside the running event loop."""
    REFRESHING.add(business_id)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        REFRESHING.discard(business_id)  # no loop (scripts/tests): skip, scenarios stay as they were
        return
    t = loop.create_task(refresh(business_id, new_tool_id))
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


def _latest_run_id(business_id: str) -> str | None:
    run = db.latest_complete_run(business_id)
    return run["id"] if run else None


async def refresh(business_id: str, new_tool_id: str | None):
    from memory import store  # local import: keeps this module importable without Qdrant
    REFRESHING.add(business_id)
    try:
        b = db.get_business(business_id)
        if not b:
            return
        ids = adopted_ids(business_id)
        if not ids:
            db.update_business(business_id, scenarios=None)
            return
        catalog = store.load_catalog()
        profile = json.loads(b["profile_json"]) if b.get("profile_json") else {}
        details = json.loads(b["details_json"]) if b.get("details_json") else {}
        current = profile.get("current_tools") or details.get("current_tools") or []
        tools = [{"tool_id": t, "name": catalog[t]["name"], "workflows": catalog[t].get("workflows", []),
                  "integrates_with": catalog[t]["integrates_with"]} for t in ids if t in catalog]
        user = json.dumps({"business": b["name"], "summary": profile.get("summary") or b.get("description", "")[:400],
                           "current_tools": current, "adopted_tools": tools,
                           "newly_adopted": new_tool_id}, ensure_ascii=False)
        out = await call_json(tier="fast", system=P.ADOPTION_REFRESH_SYSTEM, user=user, schema=RefreshOut,
                              node="adoption_refresh", max_tokens=2500)
        scenarios = []
        for sc in out.scenarios[:2]:
            d = sc.model_dump()
            d["steps"] = d["steps"][:7]
            scenarios.append(d)
        db.update_business(business_id, scenarios=scenarios)
        if new_tool_id and new_tool_id in catalog:
            run_id = _latest_run_id(business_id) or _manual_run(business_id, b["user_id"])
            db.add_business_tasks(business_id, run_id, [
                {"week": 1, "tool_id": new_tool_id, "text": t.text, "owner": t.owner, "minutes": t.minutes}
                for t in out.tasks[:3]])
            vertical = profile.get("vertical") or b.get("vertical") or "other"
            await asyncio.to_thread(store.add_episode, business_id, vertical,
                                    f"{b['name']} adopted {catalog[new_tool_id]['name']} into its workflow",
                                    {"tool_id": new_tool_id, "source": "manual"})
            await asyncio.to_thread(store.upsert_facts, business_id, [
                {"subject": "business", "predicate": "adopting", "object": catalog[new_tool_id]["name"],
                 "category": "current_tools", "confidence": 0.9}])
    except (LLMError, BudgetExceeded) as e:
        log.warning("adoption refresh failed for %s: %s", business_id, e)
    except Exception:  # noqa: BLE001 - background task must never crash the loop
        log.exception("adoption refresh crashed for %s", business_id)
    finally:
        REFRESHING.discard(business_id)


def _manual_run(business_id: str, user_id: str) -> str:
    """A completed placeholder run that only holds setup tasks when the business has no analysis yet."""
    rid = db.create_run(business_id, user_id, "manual", "manual adoption")
    db.update_run(rid, status="complete", result={"approved_tool_ids": []})
    return rid
