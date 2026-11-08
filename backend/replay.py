"""Replay pre-recorded runs for sample businesses: same SSE events, realistic pacing, $0 cost."""
import asyncio
import json

import db
from config import DEMO_RUNS_DIR
from graphs.advisor_graph import save_plan_tasks
from graphs.events import channel
from memory import store

POST_APPROVAL = {"plan.ready", "memory.saved", "run.complete"}
SKIP = {"run.start", "approval.waiting", "run.complete", "run.error"}


def load_recording(persona_id: str) -> dict | None:
    p = DEMO_RUNS_DIR / f"{persona_id}.json"
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def _pre_events(rec):
    out = []
    for e in rec["events"]:
        if e["type"] == "approval.waiting":
            break
        if e["type"] not in SKIP:
            out.append(e)
    return out


# Seconds to "think" before each event: paced so a viewer can follow each agent (~18s total).
PACE = {"agent.start": 0.5, "intake.done": 2.2, "memory.recalled": 1.1, "pain.ranked": 2.4, "scout.result": 1.5,
        "guard.dropped": 0.4, "mesh.start": 0.7, "mesh.message": 1.8, "stack.scored": 2.0}


async def _play(ch, events, business_id: str | None = None):
    first_scout = True
    for e in events:
        data = e["data"]
        if e["type"] == "memory.recalled" and business_id:
            # Show this sample business's real memory (its earlier adoption), not the recording's blank slate.
            facts = await asyncio.to_thread(store.get_facts, business_id)
            own = await asyncio.to_thread(store.business_episodes, business_id)
            data = {**data, "prior_facts": len(facts), "own_episodes": own}
        delay = PACE.get(e["type"], 0.3)
        if e["type"] == "scout.result" and first_scout:
            delay, first_scout = 2.6, False
        await asyncio.sleep(delay)
        await ch.emit(e["type"], data, agent=e.get("agent"))


async def start_replay(run_id: str, persona_id: str, business_id: str | None = None):
    ch = channel(run_id)
    await ch.emit("run.start", {"mode": "replay"})
    rec = load_recording(persona_id)
    if not rec:
        await ch.emit("run.error", {"message": "No recording for this sample business yet."})
        return
    await _play(ch, _pre_events(rec), business_id)
    result = {k: v for k, v in rec["result"].items() if k not in ("plan", "approved_tool_ids")}
    db.update_run(run_id, status="awaiting_approval", result=result, events=ch.events)
    await ch.emit("approval.waiting", {"recommended": result["stack"]["tool_ids"]})


async def resume_replay(run_id: str, persona_id: str, approved: list[str]):
    ch = channel(run_id)
    ch.mark_resumed()
    rec = load_recording(persona_id)
    catalog = store.load_catalog()
    approved = [t for t in approved if t in catalog]
    await ch.emit("agent.start", {"label": "Writing your 30-day adoption plan"}, agent="planner")
    await asyncio.sleep(1.8)
    plan = json.loads(json.dumps(rec["result"].get("plan") or {}))
    for w in plan.get("weeks", []):
        w["tasks"] = [t for t in w["tasks"] if not t.get("tool_id") or t["tool_id"] in approved]
    plan["weeks"] = [w for w in plan.get("weeks", []) if w["tasks"]]
    await ch.emit("plan.ready", {"plan": plan, "approved_tool_ids": approved}, agent="planner")
    await asyncio.sleep(0.6)
    await ch.emit("memory.saved", {"facts": len(rec["result"].get("facts", []) or []), "episodes": len(approved)},
                  agent="memory")
    run = db.get_run(run_id)
    result = json.loads(run["result_json"] or "{}") | {"plan": plan, "approved_tool_ids": approved}
    save_plan_tasks(run_id, plan)
    db.update_run(run_id, status="complete", result=result, events=ch.events)
    await ch.emit("run.complete", {})
