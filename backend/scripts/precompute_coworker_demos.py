"""Record the sample businesses' demo coworker tasks (live run + auto-approve) for $0 replays.

Usage (from backend/):  .venv/Scripts/python -m scripts.precompute_coworker_demos [persona_id ...]
Each persona gets a throwaway business with the SAME staff (names/roles/skills/status) and adopted tools as the seeded
sample, so recorded employee ids map back by name at replay time. The throwaway business and its memory are removed.
Costs roughly $0.03-0.05 per task.
"""
import asyncio
import json
import sys

import adoptions
import coworkers as cw
import db
import seed
from config import DEMO_RUNS_DIR
from graphs import coworker_graph as G
from memory import store

TASKS: dict[str, list[tuple[str, str]]] = {
    "coolair-hvac": [
        ("tech-no-show", "Customer says the tech never showed up for her 2pm appointment"),
        ("review-requests", "Ask this week's happy customers to leave us a Google review"),
    ],
    "joes-coffee": [
        ("saturday-shift", "A student staffer can't cover Saturday's opening shift"),
        ("two-star-review", "Reply to a 2-star Google review about slow service"),
    ],
    "greenleaf": [
        ("spring-cleanup-quote", "A homeowner wants a spring cleanup quote by tomorrow"),
        ("before-after-photos", "Post before-and-after photos of this week's cleanups on Google and Facebook"),
    ],
}


def _throwaway(persona_id: str) -> tuple[str, str]:
    """A business mirroring the sample: profile + adopted stack + identical staff."""
    p = seed.persona(persona_id)
    rec = json.loads((DEMO_RUNS_DIR / f"{persona_id}.json").read_text(encoding="utf-8"))["result"]
    email = f"precompute-cw+{persona_id}@local"
    u = db.get_user_by_email(email)
    uid = u["id"] if u else db.create_user(email, "precompute", "x")
    bid = db.create_business(uid, p["business_name"], p["vertical"], p["location"], p["raw_input"], rec["profile"])
    rid = db.create_run(bid, uid, "replay", p["raw_input"])
    db.update_run(rid, status="complete", result=rec, cost_usd=0)
    adoptions.record_plan(bid, rid, rec.get("approved_tool_ids") or [])
    seed.seed_demo_staff(bid, persona_id)
    return bid, uid


async def main(ids: list[str]):
    db.init_db()
    store.seed_catalog()
    before = db.total_spend()
    for persona_id, tasks in TASKS.items():
        if ids and persona_id not in ids:
            continue
        bid, uid = _throwaway(persona_id)
        try:
            for slug, text in tasks:
                path = await G.record(bid, text, persona_id, slug, created_by=uid)
                r = json.loads(path.read_text(encoding="utf-8"))["result"]
                names = {e["id"]: e["name"] for e in cw.list_employees(bid)}
                route = r["route"]
                gaps = [s for s in r["workflow"] if s.get("gap")]
                print(f"{persona_id}/{slug}: owner={names.get(route['owner_id'])} human={names.get(route['human_id'])} "
                      f"substituted={route['substituted']} gaps={len(gaps)} "
                      f"recs={[x['tool_id'] for s in gaps for x in s.get('recommendations', [])]} "
                      f"drafts={len(r.get('drafts', []))}")
        finally:
            seed.delete_staff([bid])
            adoptions.delete_for_businesses([bid])
            store.delete_business_memory(bid)
    print(f"spend this run: ${db.total_spend() - before:.4f} (total ${db.total_spend():.4f})")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:]))
