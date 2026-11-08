"""Run the live graph once per sample business, auto-approve the recommended stack, and save the recording.

Usage (from backend/):  .venv/Scripts/python -m scripts.precompute_demos [persona_id ...]
Costs roughly $0.05 per persona; results are cached so reruns are ~free.
"""
import asyncio
import json
import sys

import db
import seed
from config import DEMO_RUNS_DIR
from graphs.advisor_graph import GRAPH, _cfg, _result, resume_live, start_live
from graphs.events import channel
from memory import store


async def record(p: dict):
    uid = db.get_user_by_email(f"precompute+{p['id']}@local")
    uid = uid["id"] if uid else db.create_user(f"precompute+{p['id']}@local", "precompute", "x")
    bid = db.create_business(uid, p["business_name"], p["vertical"], p["location"], p["raw_input"])
    rid = db.create_run(bid, uid, "live", p["raw_input"])
    ch = channel(rid)
    await start_live(rid, bid, p["business_name"], p["raw_input"])
    if ch.status != "awaiting_approval":
        raise SystemExit(f"{p['id']}: run failed: {ch.events[-1]}")
    rec = (await GRAPH.aget_state(_cfg(rid))).values["stack"]["tool_ids"]
    await resume_live(rid, rec)
    if ch.status != "complete":
        raise SystemExit(f"{p['id']}: resume failed: {ch.events[-1]}")
    result = _result((await GRAPH.aget_state(_cfg(rid))).values)
    result.pop("memory", None)
    DEMO_RUNS_DIR.mkdir(parents=True, exist_ok=True)
    out = DEMO_RUNS_DIR / f"{p['id']}.json"
    out.write_text(json.dumps({"persona_id": p["id"], "events": ch.events, "result": result}, indent=1,
                              ensure_ascii=False), encoding="utf-8")
    store.delete_business_memory(bid)
    print(f"{p['id']}: {len(ch.events)} events, stack={rec}, cost=${db.run_spend(rid):.4f} -> {out.name}")


async def main(ids):
    seed.db.init_db()
    store.seed_catalog()
    for p in seed.load_personas():
        if not ids or p["id"] in ids:
            await record(p)
    print(f"total spend so far: ${db.total_spend():.4f}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
