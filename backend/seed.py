"""Seed the tool catalog and the sample-business accounts (lived-in: profile, memory, a past run, plan progress)."""
import json
import logging
import secrets

import db
from auth import hash_password
from config import DATA_DIR
from graphs.advisor_graph import save_plan_tasks
from memory import store
from replay import load_recording

log = logging.getLogger("seed")


def load_personas() -> list[dict]:
    return json.loads((DATA_DIR / "personas.json").read_text(encoding="utf-8"))


def persona(pid: str) -> dict | None:
    return next((p for p in load_personas() if p["id"] == pid), None)


def seed_demos():
    for p in load_personas():
        if db.get_user_by_email(p["email"]):
            continue
        uid = db.create_user(p["email"], p["owner_name"], hash_password(secrets.token_urlsafe(24)), is_demo=True,
                             persona_id=p["id"])
        rec = load_recording(p["id"])
        profile = rec["result"]["profile"] if rec else None
        bid = db.create_business(uid, p["business_name"], p["vertical"], p["location"], p["raw_input"], profile)
        if not rec:
            log.warning("no recording for %s - run scripts/precompute_demos.py", p["id"])
            continue
        res = rec["result"]
        rid = db.create_run(bid, uid, "replay", p["raw_input"])
        db.update_run(rid, status="complete", result=res, events=rec["events"], cost_usd=0)
        save_plan_tasks(rid, res.get("plan") or {}, done_weeks=1)
        store.delete_business_memory(bid)
        store.upsert_facts(bid, res.get("facts", []))
        for t in res.get("approved_tool_ids", []):
            name = store.load_catalog()[t]["name"]
            pains = [s["pain_id"] for s in res.get("scored", []) if s["tool_id"] == t]
            store.add_episode(bid, p["vertical"], f"{p['business_name']} adopted {name} for {', '.join(pains)}",
                              {"tool_id": t, "pains": pains, "run_id": rid})
        log.info("seeded demo %s", p["id"])


def reset_demos():
    for p in load_personas():
        u = db.get_user_by_email(p["email"])
        if u:
            b = db.get_user_business(u["id"])
            if b:
                store.delete_business_memory(b["id"])
    db.delete_demo_data()
    seed_demos()


def seed_all():
    db.init_db()
    n = store.seed_catalog()
    if n:
        log.info("embedded %d catalog tools", n)
    seed_demos()
