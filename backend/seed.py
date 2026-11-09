"""Seed the tool catalog and the sample-business accounts (lived-in: profile, memory, a past run, plan progress)."""
import json
from datetime import datetime, timedelta, timezone
import logging
import secrets

import adoptions
import coworkers
import db
from auth import hash_password
from config import DATA_DIR
from graphs.advisor_graph import save_plan_tasks
from memory import store
from replay import load_recording
from routers import team  # registers team tables on db.meta before init_db()

log = logging.getLogger("seed")

DEMO_HISTORY_DAYS = 45  # sample businesses adopted their stack 45 days ago (lived-in dashboard)

# Sample-business staff for the coworker mesh. Exactly ONE person per business is "off" today, and the recorded demo
# tasks (data/coworker_runs/<persona>/) need that person's context, so the replay shows a coworker covering for them.
# Names must stay identical to the recordings (replay maps recorded employee ids by name).
DEMO_STAFF: dict[str, list[dict]] = {
    "coolair-hvac": [
        {"name": "Maria Okafor", "role": "Owner & dispatcher", "status": "off",
         "skills": ["Dispatch", "Scheduling", "Customer complaints", "Quotes & estimates"],
         "responsibilities": "Books every job, assigns techs to appointments, writes quotes for new systems and calls "
                             "customers back when something goes wrong.",
         "tools": ["rosie", "jobber", "Google Calendar"]},
        {"name": "Luis Ortega", "role": "Lead tech", "status": "available",
         "skills": ["AC repair", "System installs", "Diagnostics", "Maintenance plans"],
         "responsibilities": "Runs repair and install jobs, sizes new AC units on site and trains the apprentice.",
         "tools": ["jobber"]},
        {"name": "Dana Brooks", "role": "Office manager", "status": "available",
         "skills": ["Invoicing", "Payments", "Customer follow-up", "Maintenance-plan renewals"],
         "responsibilities": "Sends invoices, chases late payments, renews maintenance plans and answers the office "
                             "phone when Maria is out.",
         "tools": ["QuickBooks", "jobber", "Google Calendar"]},
        {"name": "Kevin Park", "role": "Apprentice tech", "status": "busy",
         "skills": ["Tune-ups", "Filter changes", "Ride-alongs"],
         "responsibilities": "Handles tune-ups and filter changes and rides along on bigger installs.",
         "tools": ["jobber"]},
    ],
    "joes-coffee": [
        {"name": "Joe Martinez", "role": "Owner", "status": "available",
         "skills": ["Ordering", "Finances", "Marketing", "Customer reviews"],
         "responsibilities": "Orders beans and supplies, runs promotions and answers customer reviews.",
         "tools": ["square-marketing", "meta-business-suite", "Square POS"]},
        {"name": "Priya Shah", "role": "Shift lead", "status": "off",
         "skills": ["Staff scheduling", "Shift coverage", "Opening & closing", "Training"],
         "responsibilities": "Builds the weekly schedule, finds cover when a student staffer drops a shift and opens "
                             "the shop on weekends.",
         "tools": ["7shifts", "Square POS"]},
        {"name": "Marcus Lee", "role": "Barista", "status": "available",
         "skills": ["Espresso drinks", "Customer service", "Instagram photos"],
         "responsibilities": "Works the bar on weekday mornings and takes photos of new drinks for Instagram.",
         "tools": ["7shifts", "Square POS", "Instagram"]},
        {"name": "Ellie Chen", "role": "Weekend barista", "status": "busy",
         "skills": ["Weekend shifts", "Menu boards", "Social media"],
         "responsibilities": "Covers Saturday and Sunday shifts and updates the chalk menu boards.",
         "tools": ["7shifts", "meta-business-suite"]},
    ],
    "greenleaf": [
        {"name": "Dev Patel", "role": "Owner & estimator", "status": "off",
         "skills": ["Quotes & estimates", "Site measuring", "Customer calls", "Spring cleanups"],
         "responsibilities": "Visits properties, measures beds and lawns, writes every quote and talks to homeowners.",
         "tools": ["jobber", "Spreadsheet"]},
        {"name": "Tom Reyes", "role": "Crew lead", "status": "available",
         "skills": ["Mowing", "Mulching", "Crew routing", "Equipment & trucks"],
         "responsibilities": "Leads the crew each day, plans the route between jobs and keeps the trucks running.",
         "tools": ["jobber"]},
        {"name": "Ana Silva", "role": "Office", "status": "available",
         "skills": ["Scheduling", "Customer texts", "Invoicing", "Payments"],
         "responsibilities": "Books and reschedules visits, texts customers about arrival times and sends invoices.",
         "tools": ["jobber", "Spreadsheet", "Text messaging"]},
        {"name": "Mateo Cruz", "role": "Crew member", "status": "busy",
         "skills": ["Cleanups", "Planting", "Hauling"],
         "responsibilities": "Works on the crew doing cleanups, planting and hauling debris.",
         "tools": []},
    ],
}


def seed_demo_staff(business_id: str, persona_id: str, owner_user_id: str | None = None) -> list[dict]:
    """Create the sample business's employees + their coworker profile facts (no LLM call)."""
    from graphs.coworker_graph import base_facts  # local import: graph module is heavy
    members = {m[0]: i for i, m in enumerate(team.DEMO_TEAM.get(persona_id, {}).get("members", []))}
    owner_name = (persona(persona_id) or {}).get("owner_name")
    out = []
    for s in DEMO_STAFF.get(persona_id, []):
        user_id = owner_user_id if owner_user_id and s["name"] == owner_name else None
        if s["name"] in members:  # link to the sample team-member account created by team.seed_demo_team
            u = db.get_user_by_email(f"member{members[s['name']] + 1}.{persona_id}@demo.stacksmith")
            user_id = u["id"] if u else None
        emp = coworkers.create_employee(business_id, s["name"], s["role"], s["skills"], s["responsibilities"],
                                        s["tools"], user_id=user_id, status=s["status"])
        try:
            store.upsert_facts(coworkers.emp_key(business_id, emp["id"]),
                               [f | {"owner_business_id": business_id} for f in base_facts(emp)])
        except Exception as ex:  # noqa: BLE001 - memory is best-effort for seeding
            log.warning("staff facts failed for %s: %s", emp["name"], ex)
        out.append(emp)
    return out


def delete_staff(business_ids: list[str]):
    """Remove employees, their coworker memory and coworker tasks for these businesses."""
    from graphs.coworker_graph import delete_employee_memory
    for bid in business_ids:
        for e in coworkers.list_employees(bid):
            delete_employee_memory(bid, e["id"])
    coworkers.delete_for_businesses(business_ids)


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
        # Demo history: the sample stack was adopted 45 days ago.
        adopted_at = datetime.now(timezone.utc) - timedelta(days=DEMO_HISTORY_DAYS)
        rid = db.create_run(bid, uid, "replay", p["raw_input"], created_at=adopted_at)
        db.update_run(rid, status="complete", result=res, events=rec["events"], cost_usd=0)
        save_plan_tasks(rid, res.get("plan") or {}, done_weeks=1)
        adoptions.record_plan(bid, rid, res.get("approved_tool_ids") or [])
        store.delete_business_memory(bid)
        store.upsert_facts(bid, res.get("facts", []))
        for t in res.get("approved_tool_ids", []):
            name = store.load_catalog()[t]["name"]
            pains = [s["pain_id"] for s in res.get("scored", []) if s["tool_id"] == t]
            store.add_episode(bid, p["vertical"], f"{p['business_name']} adopted {name} for {', '.join(pains)}",
                              {"tool_id": t, "pains": pains, "run_id": rid})
        team.seed_demo_team(bid, uid, p["id"], (res.get("profile") or {}).get("monthly_budget"))
        seed_demo_staff(bid, p["id"], owner_user_id=uid)
        log.info("seeded demo %s", p["id"])


def reset_demos():
    demo_biz = []
    for p in load_personas():
        u = db.get_user_by_email(p["email"])
        if u:
            b = db.get_user_business(u["id"])
            if b:
                store.delete_business_memory(b["id"])
                demo_biz.append(b["id"])
    adoptions.delete_for_businesses(demo_biz)
    delete_staff(demo_biz)
    team.delete_team_rows(demo_biz)
    db.delete_demo_data()  # also removes any reviews written from sample accounts (is_demo)
    seed_demos()


def seed_all():
    db.init_db()
    n = store.seed_catalog(force=True)  # cheap (~40 docs); keeps payloads in sync with catalog.json
    if n:
        log.info("embedded %d catalog tools", n)
    seed_demos()
