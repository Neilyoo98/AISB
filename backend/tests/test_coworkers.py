import asyncio
import importlib
import json

import pytest

import coworkers as cw


def emp(eid, name, skills, status="available", resp="", role="", tools=()):
    return {"id": eid, "name": name, "role": role, "skills": list(skills), "responsibilities": resp,
            "tools": list(tools), "status": status, "initials": cw.initials(name)}


NEEDS = {"needed_skills": ["scheduling", "dispatch"], "needed_capabilities": ["answer calls"],
         "text": "Customer says the tech never showed up for the scheduled visit"}


def test_route_picks_context_owner():
    team = [emp("a", "Dana", ["billing", "invoices"]), emp("b", "Maria", ["scheduling", "dispatch"]),
            emp("c", "Luis", ["hvac repair"])]
    r = cw.route_task(team, NEEDS)
    assert r["owner_id"] == "b" and r["human_id"] == "b" and not r["substituted"]
    assert r["substitution_note"] is None
    assert "Maria" in r["owner_reason"]
    assert [s["employee_id"] for s in r["scores"]][0] == "b"


def test_off_owner_is_substituted_by_best_available():
    team = [emp("a", "Dana", ["billing"], status="busy"), emp("b", "Maria", ["scheduling", "dispatch"], status="off"),
            emp("c", "Luis", ["dispatch", "hvac repair"])]
    r = cw.route_task(team, NEEDS)
    assert r["owner_id"] == "b" and r["substituted"]
    assert r["human_id"] == "c"  # available beats busy
    assert "Maria is off today" in r["substitution_note"] and "Luis" in r["substitution_note"]


def test_off_owner_with_nobody_available_is_flagged():
    team = [emp("b", "Maria", ["scheduling"], status="off"), emp("c", "Luis", ["hvac"], status="off")]
    r = cw.route_task(team, NEEDS)
    assert r["substituted"] and r["human_id"] == "b"
    assert "nobody else is available" in r["substitution_note"]


def test_busy_colleague_used_when_no_one_available():
    team = [emp("b", "Maria", ["scheduling"], status="off"), emp("c", "Luis", ["hvac"], status="busy")]
    assert cw.route_task(team, NEEDS)["human_id"] == "c"


def test_memory_hits_break_ties():
    team = [emp("a", "Dana", []), emp("b", "Sam", [])]
    assert cw.route_task(team, {"text": "zzz"}, {"b": 2})["owner_id"] == "b"


def test_mesh_participants_owner_talks_to_human():
    from graphs import coworker_graph as G
    team = [emp("a", "Dana", ["billing"]), emp("b", "Maria", ["scheduling", "dispatch"], status="off"),
            emp("c", "Luis", ["dispatch"])]
    route = cw.route_task(team, NEEDS)
    pairs = G.mesh_participants(route, team)
    assert pairs[0] == ("b", "c") and ("c", "b") in pairs and len(pairs) <= 3


def test_gap_recommendations_only_catalog_and_not_adopted():
    from graphs import coworker_graph as G
    catalog = {"rosie": {"description": "AI answering"}, "goodcall": {"description": "AI phone agent"},
               "jobber": {"description": "Field service"}}
    fake = lambda q: [{"id": "made-up"}, {"id": "jobber"}, {"id": "rosie"}, {"id": "goodcall"}, {"id": "x"}]
    recs = G.gap_recommendations("answer calls", ["jobber"], catalog, search=fake)
    assert [r["tool_id"] for r in recs] == ["rosie", "goodcall"]


def test_sanitize_workflow_restricts_tools_and_reroutes_off_owner():
    from graphs import coworker_graph as G
    team = [emp("b", "Maria", ["scheduling"], status="off"), emp("c", "Luis", ["hvac"])]
    route = {"owner_id": "b", "human_id": "c", "substituted": True}
    steps = [
        {"actor_type": "tool", "actor_id": "jobber", "action": "Draft the quote", "tool_id": "jobber",
         "manual_before": "Maria typed it", "handoff_to": "b", "gap": False, "gap_capability": None},
        {"actor_type": "tool", "actor_id": "rosie", "action": "Answer the call", "tool_id": "rosie",
         "manual_before": None, "handoff_to": "customer", "gap": False, "gap_capability": None},
        {"actor_type": "employee", "actor_id": "b", "action": "Call the customer", "tool_id": None,
         "manual_before": None, "handoff_to": "nowhere", "gap": False, "gap_capability": None},
    ]
    out = G.sanitize_workflow(steps, team, ["jobber"], route)
    assert [s["n"] for s in out] == [1, 2, 3]
    assert out[0]["tool_id"] == "jobber" and out[0]["handoff_to"] == "c"  # off person replaced as receiver
    assert out[1]["gap"] and out[1]["tool_id"] is None and out[1]["actor_id"] == "c"
    assert out[2]["actor_id"] == "c" and out[2]["handoff_to"] is None
    used = {s["tool_id"] for s in out if s["tool_id"]}
    assert used <= {"jobber"}


def test_send_log_is_simulated_and_from_tool_steps():
    from graphs import coworker_graph as G
    team = [emp("c", "Luis", [])]
    wf = [{"n": 1, "actor_type": "tool", "actor_id": "jobber", "tool_id": "jobber", "action": "Send the quote",
           "handoff_to": "customer", "gap": False},
          {"n": 2, "actor_type": "employee", "actor_id": "c", "tool_id": None, "action": "Visit", "handoff_to": None,
           "gap": False}]
    log_ = G.build_send_log(wf, team, {"jobber": {"name": "Jobber", "category": "field_service"}})
    assert len(log_) == 1 and log_[0]["simulated"] and log_[0]["to"] == "Customer"
    assert log_[0]["label"] == G.SIMULATED_LABEL
    specs = G.assigned_task_specs(wf, "t")
    assert [s["assignee_employee_id"] for s in specs] == ["c"]


def test_remap_ids_for_replay():
    from graphs import coworker_graph as G
    rec = {"employees": [{"id": "old1", "name": "Maria"}], "events": [], "result": {}}
    m = G._mapping_for(rec, [emp("new1", "Maria", [])])
    out = G.remap_ids({"route": {"owner_id": "old1"}, "coworker:old1": 1, "x": ["old1"]}, m)
    assert out == {"route": {"owner_id": "new1"}, "coworker:new1": 1, "x": ["new1"]}


@pytest.fixture
def fresh_modules(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'co.db'}")
    import config
    import db
    import adoptions
    import coworkers
    from graphs import coworker_graph
    for m in (config, db, adoptions, coworkers, coworker_graph):
        importlib.reload(m)
    db.init_db()
    yield db, adoptions, coworkers, coworker_graph
    monkeypatch.delenv("DATABASE_URL")
    for m in (config, db, adoptions, coworkers, coworker_graph):
        importlib.reload(m)


def test_live_run_events_order_and_approval_creates_assigned_tasks(fresh_modules, monkeypatch):
    db_, adopt, cw_, G = fresh_modules
    uid = db_.create_user("o@x.com", "Owner", "x")
    bid = db_.create_business(uid, "CoolAir", "hvac", "", "desc")
    maria = cw_.create_employee(bid, "Maria", "Dispatcher", ["scheduling", "dispatch"], "", [], status="off")
    luis = cw_.create_employee(bid, "Luis", "Lead tech", ["dispatch", "hvac repair"], "", [])
    adopt.adopt(bid, "jobber", "manual")

    async def fake_call_json(*, schema, **kw):
        n = schema.__name__
        if n == "TaskRead":
            return schema(intent="Fix a missed visit", customer_facing=True, urgency="high",
                          needed_skills=["scheduling", "dispatch"], needed_capabilities=["answer calls"])
        if n == "MeshOut":
            return schema(context_shared="Customer is on the Tuesday route", should_check="Confirm address",
                          confidence="medium")
        if n == "WorkflowOut":
            return schema(steps=[
                {"actor_type": "tool", "actor_id": "jobber", "tool_id": "jobber", "action": "Reschedule the visit",
                 "manual_before": "Maria rebooked by phone", "handoff_to": maria["id"]},
                {"actor_type": "tool", "actor_id": "rosie", "tool_id": "rosie", "action": "Call the customer back",
                 "handoff_to": "customer"},
                {"actor_type": "employee", "actor_id": maria["id"], "action": "Do the repair visit"}])
        if n == "DraftsOut":
            return schema(drafts=[{"kind": "customer_reply", "title": "Apology", "to": "Customer", "body": "Sorry..."}])
        raise AssertionError(n)

    monkeypatch.setattr(G, "call_json", fake_call_json)
    monkeypatch.setattr(G.store, "get_facts", lambda *a, **k: [])
    monkeypatch.setattr(G.store, "search_catalog", lambda q, **k: [{"id": "rosie"}, {"id": "goodcall"}])
    monkeypatch.setattr(G.store, "add_episode", lambda *a, **k: None)
    monkeypatch.setattr(G.store, "upsert_facts", lambda *a, **k: None)

    async def run():
        tid = cw_.create_task(bid, uid, "Customer says the tech never showed up", "live")
        await G.start_coworker_live(tid, bid, "Customer says the tech never showed up")
        await G.resume_coworker_live(tid, True)
        return tid

    tid = asyncio.run(run())
    ch = G.CHANNELS[tid]
    types = [e["type"] for e in ch.events]
    assert types[:4] == ["task.start", "task.read", "route.chosen", "route.substituted"]
    assert types.index("workflow.ready") < types.index("gap.found") < types.index("drafts.ready") < \
        types.index("approval.waiting") < types.index("task.approved") < types.index("task.complete")
    t = cw_.get_task(tid)
    assert t["status"] == "approved"
    res = json.loads(t["result_json"])
    assert res["route"]["owner_id"] == maria["id"] and res["route"]["human_id"] == luis["id"]
    gap = next(s for s in res["workflow"] if s["gap"])
    assert [r["tool_id"] for r in gap["recommendations"]] == ["rosie", "goodcall"]
    assert all(s["actor_id"] != maria["id"] for s in res["workflow"] if s["actor_type"] == "employee")
    assert res["send_log"] and all(x["simulated"] for x in res["send_log"])
    tasks = db_.get_business_tasks(bid)
    assigned = [x for x in tasks if x.get("assignee_employee_id")]
    assert assigned and {x["assignee_employee_id"] for x in assigned} == {luis["id"]}
    assert all(x["source"] == "coworker" for x in assigned)


def test_rejected_task_creates_nothing(fresh_modules, monkeypatch):
    db_, adopt, cw_, G = fresh_modules
    uid = db_.create_user("o2@x.com", "Owner", "x")
    bid = db_.create_business(uid, "B", "other", "", "d")
    cw_.create_employee(bid, "Sam", "Owner", ["sales"], "", [])

    async def run():
        tid = cw_.create_task(bid, uid, "x task", "replay")
        out = await G.finalize_core(tid, bid, "x task", {"workflow": [], "route": {}}, False, cw_.list_employees(bid))
        return tid, out

    tid, out = asyncio.run(run())
    assert out == {"approved": False}
    assert [e["type"] for e in G.CHANNELS[tid].events] == ["task.rejected", "task.complete"]
    assert db_.get_business_tasks(bid) == []


def test_existing_tools_are_not_gaps_and_never_recommended():
    from graphs.coworker_graph import drop_existing_tool_gaps, gap_recommendations
    steps = [{"n": 1, "gap": True, "gap_capability": "Check Google Calendar for open slots", "action": "x",
              "recommendations": []},
             {"n": 2, "gap": True, "gap_capability": "review requests", "action": "ask for reviews",
              "recommendations": []}]
    out = drop_existing_tool_gaps(steps, ["quickbooks", "google-calendar"])
    assert out[0]["gap"] is False and out[1]["gap"] is True
    catalog = {"quickbooks": {"verticals": ["all"], "description": "q"}, "7shifts": {"verticals": ["cafe"], "description": "s"},
               "nicejob": {"verticals": ["hvac"], "description": "n"}}
    recs = gap_recommendations("x", ["rosie", "quickbooks"], catalog, search=lambda q: ["quickbooks", "7shifts", "nicejob"],
                               vertical="hvac")
    assert [r["tool_id"] for r in recs] == ["nicejob"]


def test_demo_staff_seed_and_reset_are_idempotent(fresh_modules, monkeypatch):
    db_, _adopt, cw_, G = fresh_modules
    import seed
    monkeypatch.setattr(seed.store, "upsert_facts", lambda *a, **k: None)
    monkeypatch.setattr(G.store, "delete_business_memory", lambda *a, **k: None)
    uid = db_.create_user("o@x.com", "Owner", "x")
    for persona_id, staff in seed.DEMO_STAFF.items():
        assert sum(1 for s in staff if s["status"] == "off") == 1, persona_id  # exactly one person covers via coworker
        bid = db_.create_business(uid, persona_id, "other", "", "desc")
        first = seed.seed_demo_staff(bid, persona_id)
        seed.delete_staff([bid])
        assert cw_.list_employees(bid) == []
        second = seed.seed_demo_staff(bid, persona_id)
        key = lambda es: sorted((e["name"], e["role"], e["status"], tuple(e["skills"])) for e in es)
        assert key(first) == key(second) == key(cw_.list_employees(bid))
        assert len(second) == len(staff)


def test_recordings_match_seeded_staff_names():
    import seed
    from graphs.coworker_graph import list_recordings
    for persona_id, staff in seed.DEMO_STAFF.items():
        recs = list_recordings(persona_id)
        assert len(recs) == 2, persona_id
        names = {s["name"] for s in staff}
        for r in recs:
            assert {e["name"] for e in r["employees"]} <= names, (persona_id, r["slug"])
        assert any(r["result"]["route"]["substituted"] for r in recs), persona_id
        assert any(s.get("gap") for r in recs for s in r["result"]["workflow"]), persona_id


# ---------------- task queue: stage / progress / synthesized events / assignment ----------------

def test_stage_and_progress_lifecycle():
    assert cw.stage_for("running", []) == "planning"
    assert cw.stage_for("awaiting_approval", []) == "needs_ok"
    assert cw.stage_for("rejected", []) == "rejected"
    steps = [{"done": True}, {"done": False}]
    assert cw.progress_of(steps) == {"done": 1, "total": 2}
    assert cw.stage_for("approved", steps) == "in_progress"
    assert cw.stage_for("approved", [{"done": True}, {"done": True}]) == "done"
    assert cw.stage_for("approved", []) == "done"  # approved with no hands-on steps is finished


def test_synth_events_are_ordered_and_never_blank():
    result = {"intent": "Fix", "route": {"owner_id": "m", "human_id": "l", "substituted": True, "substitution_note": "n"},
              "mesh": [{"from_id": "m", "to_id": "l", "context_shared": "x", "should_check": "y", "confidence": "high"}],
              "workflow": [{"n": 1, "actor_type": "employee", "actor_id": "l", "action": "Call", "gap": False},
                           {"n": 2, "actor_type": "employee", "actor_id": "l", "action": "Reviews", "gap": True,
                            "gap_capability": "reviews", "recommendations": [{"tool_id": "nicejob", "reason": "r"}]}],
              "drafts": [{"kind": "other", "title": "t", "to": "x", "body": "b"}], "send_log": []}
    evs = cw.synth_events(result, "approved", [{"task_id": 7, "text": "Call", "done": False, "assignee_employee_id": "l"}])
    types = [e["type"] for e in evs]
    assert types == ["task.start", "task.read", "route.chosen", "route.substituted", "mesh.message", "workflow.ready",
                     "gap.found", "drafts.ready", "approval.waiting", "task.approved", "task.complete"]
    assert [e["seq"] for e in evs] == list(range(len(evs)))
    assert evs[types.index("task.approved")]["data"]["assigned_tasks"][0]["task_id"] == 7
    assert cw.synth_events({}, "approved") == []
    assert "task.approved" not in [e["type"] for e in cw.synth_events(result, "awaiting_approval")]


def test_assignee_set_at_routing_and_steps_drive_progress(fresh_modules, monkeypatch):
    db_, adopt, cw_, G = fresh_modules
    import routers.team as team_mod
    importlib.reload(team_mod)  # registers org_members on the reloaded db.meta
    db_.init_db()
    uid = db_.create_user("o3@x.com", "Owner", "x")
    bid = db_.create_business(uid, "CoolAir", "hvac", "", "desc")
    maria = cw_.create_employee(bid, "Maria", "Dispatcher", ["scheduling", "dispatch"], "", [], status="off")
    luis_user = db_.create_user("luis@x.com", "Luis", "x")
    dana_user = db_.create_user("dana@x.com", "Dana", "x")
    luis = cw_.create_employee(bid, "Luis", "Lead tech", ["dispatch", "hvac repair"], "", [], user_id=luis_user)
    cw_.create_employee(bid, "Dana", "Office", ["billing"], "", [], user_id=dana_user)
    for u in (luis_user, dana_user):
        with db_.engine.begin() as c:
            c.execute(team_mod.org_members.insert().values(business_id=bid, user_id=u, role="member"))
    seen = {}

    async def fake_call_json(*, schema, **kw):
        n = schema.__name__
        if n == "TaskRead":
            return schema(intent="Fix a missed visit", customer_facing=True, urgency="high",
                          needed_skills=["scheduling", "dispatch"], needed_capabilities=[])
        if n == "MeshOut":
            row = cw_.get_task(seen["tid"])  # by the time coworkers talk, the queue already shows the assignee
            seen["assignee"], seen["cover"] = row["assignee_employee_id"], row["covering_for_id"]
            return schema(context_shared="c", should_check="s", confidence="medium")
        if n == "WorkflowOut":
            return schema(steps=[{"actor_type": "employee", "actor_id": luis["id"], "action": "Call the customer"},
                                 {"actor_type": "employee", "actor_id": luis["id"], "action": "Do the visit"}])
        if n == "DraftsOut":
            return schema(drafts=[])
        raise AssertionError(n)

    monkeypatch.setattr(G, "call_json", fake_call_json)
    monkeypatch.setattr(G.store, "get_facts", lambda *a, **k: [])
    monkeypatch.setattr(G.store, "search_catalog", lambda q, **k: [])
    monkeypatch.setattr(G.store, "add_episode", lambda *a, **k: None)
    monkeypatch.setattr(G.store, "upsert_facts", lambda *a, **k: None)

    async def run():
        tid = cw_.create_task(bid, uid, "Customer says the tech never showed up", "live")
        seen["tid"] = tid
        await G.start_coworker_live(tid, bid, "Customer says the tech never showed up")
        mid = cw_.stage_for(cw_.get_task(tid)["status"], [])
        await G.resume_coworker_live(tid, True)
        return tid, mid

    tid, mid_stage = asyncio.run(run())
    assert seen == {"tid": tid, "assignee": luis["id"], "cover": maria["id"]}
    assert mid_stage == "needs_ok"
    t = cw_.get_task(tid)
    steps = cw_.steps_for([tid])[tid]
    by_id = {e["id"]: e for e in cw_.list_employees(bid)}
    q = cw_.queue_fields(t, t["status"], steps, by_id)
    assert q["stage"] == "in_progress" and q["progress"] == {"done": 0, "total": 2}
    assert q["assignee"]["name"] == "Luis" and q["assignee"]["role"] == "Lead tech"
    assert q["covering_for"] == {"id": maria["id"], "name": "Maria"}
    assert all(s["assignee"]["id"] == luis["id"] for s in q["steps"])
    # scope=mine
    assert cw_.is_mine(t, steps, cw_.person_id_for_user(bid, luis_user))
    assert not cw_.is_mine(t, steps, cw_.person_id_for_user(bid, dana_user))
    # employees may only check off their own steps; owner may toggle any
    with pytest.raises(PermissionError):
        db_.set_task_done(steps[0]["task_id"], True, dana_user)
    assert db_.set_task_done(steps[0]["task_id"], True, luis_user)
    assert db_.set_task_done(steps[1]["task_id"], True, uid)
    steps = cw_.steps_for([tid])[tid]
    assert cw_.stage_for("approved", steps) == "done"


def test_seeded_history_has_in_progress_and_done_tasks(fresh_modules, monkeypatch):
    db_, _adopt, cw_, G = fresh_modules
    import seed
    importlib.reload(seed)
    monkeypatch.setattr(seed.store, "upsert_facts", lambda *a, **k: None)
    uid = db_.create_user("o4@x.com", "Owner", "x")
    bid = db_.create_business(uid, "CoolAir", "hvac", "", "desc")
    rid = db_.create_run(bid, uid, "replay", "x")
    staff = seed.seed_demo_staff(bid, "coolair-hvac")
    assert seed.seed_demo_coworker_history(bid, "coolair-hvac", uid, staff, run_id=rid) == 2
    rows = cw_.list_tasks(bid)
    steps = cw_.steps_for([t["id"] for t in rows])
    by_id = {e["id"]: e for e in cw_.list_employees(bid)}
    stages = sorted(cw_.queue_fields(t, t["status"], steps[t["id"]], by_id)["stage"] for t in rows)
    assert stages == ["done", "in_progress"]
    for t in rows:
        q = cw_.queue_fields(t, t["status"], steps[t["id"]], by_id)
        assert q["assignee"] and q["progress"]["total"] >= 1
        assert all(s["assignee"] for s in q["steps"])
        approved = [e for e in json.loads(t["events_json"]) if e["type"] == "task.approved"]
        assert {a["task_id"] for a in approved[0]["data"]["assigned_tasks"]} == {s["task_id"] for s in steps[t["id"]]}
