import importlib
import json
from pathlib import Path

import pytest

from people import match_catalog
from workflow_map import build_map, person_node_id

CAT = {t["id"]: t for t in json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}
MARIA = {"id": "m1", "name": "Maria Okafor", "role": "Owner", "status": "off", "tools": ["Google Calendar"]}
LUIS = {"id": "l1", "name": "Luis Ortega", "role": "Lead tech", "status": "available", "tools": ["jobber"]}
DANA = {"id": "d1", "name": "Dana Brooks", "role": "Office", "status": "available", "tools": ["QuickBooks"]}


def _task(tid, steps):
    return {"id": tid, "text": f"task {tid}", "result": {"workflow": steps}}


def _step(n, atype, actor, action, handoff, tool=None, gap=False):
    return {"n": n, "actor_type": atype, "actor_id": actor, "action": action, "tool_id": tool, "handoff_to": handoff,
            "gap": gap, "recommendations": []}


def _build(**kw):
    base = dict(employees=[MARIA, LUIS, DANA], adopted_ids=["rosie", "jobber"], tasks=[], catalog=CAT,
                owner_employee_id="m1", match_catalog=match_catalog)
    return build_map(**(base | kw))


def links_of(m, kind=None):
    return {(l["from"], l["to"]): l for l in m["links"] if kind is None or l["kind"] == kind}


def test_empty_business_returns_people_only():
    m = build_map(employees=[MARIA, LUIS], adopted_ids=[], tasks=[], catalog=CAT, match_catalog=match_catalog)
    kinds = {n["kind"] for n in m["nodes"]}
    assert "person" in kinds and m["stats"]["tasks"] == 0
    m2 = build_map(employees=[{**LUIS, "tools": []}], adopted_ids=[], tasks=[], catalog=CAT)
    assert [n["kind"] for n in m2["nodes"]] == ["person"] and m2["links"] == []


def test_catalog_vs_plain_tool_nodes_and_adopted_linked_to_owner():
    m = _build()
    tools = {n["id"]: n for n in m["nodes"] if n["kind"] == "tool"}
    assert tools["t:jobber"]["tool_id"] == "jobber" and tools["t:jobber"]["existing"] is False
    assert tools["t:quickbooks"]["tool_id"] == "quickbooks" and tools["t:quickbooks"]["existing"] is True
    assert tools["t:name:google-calendar"]["tool_id"] is None and tools["t:name:google-calendar"]["sub"] == "Tool you already use"
    uses = links_of(m, "uses")
    # rosie adopted, nobody lists it -> linked to the owner; jobber is already on Luis's profile -> not to the owner
    assert (person_node_id("m1"), "t:rosie") in uses
    assert (person_node_id("m1"), "t:jobber") not in uses and (person_node_id("l1"), "t:jobber") in uses


def test_handoffs_are_aggregated_with_examples():
    steps = [
        _step(1, "tool", "rosie", "Answer the call", "l1", tool="rosie"),
        _step(2, "employee", "l1", "Check the schedule in Jobber", "customer", tool="jobber"),
        _step(3, "employee", "d1", "Find a refund tool", None, gap=True),
    ]
    tasks = [_task(f"t{i}", steps) for i in range(5)]
    m = _build(tasks=tasks)
    h = links_of(m, "handoff")
    assert h[("t:rosie", person_node_id("l1"))]["count"] == 5
    assert len(h[("t:rosie", person_node_id("l1"))]["examples"]) <= 3
    assert (person_node_id("l1"), "customer") in h
    assert any(n["kind"] == "customer" for n in m["nodes"])
    uses = links_of(m, "uses")
    assert (person_node_id("l1"), "t:rosie") in uses  # human receiving a tool step uses that tool
    assert uses[(person_node_id("l1"), "t:jobber")]["count"] >= 6  # profile + 5 task steps
    assert m["stats"]["tasks"] == 5
    assert not any(l["from"] == person_node_id("d1") and l["kind"] == "handoff" for l in m["links"])  # gap skipped


def test_focus_keeps_person_neighbors_and_links_among_them():
    steps = [_step(1, "employee", "d1", "Send invoice", "customer", tool="quickbooks"),
             _step(2, "tool", "rosie", "Answer", "l1", tool="rosie")]
    m = _build(tasks=[_task("x", steps)], focus="d1")
    ids = {n["id"] for n in m["nodes"]}
    assert person_node_id("d1") in ids and "customer" in ids and "t:quickbooks" in ids
    assert person_node_id("l1") not in ids and "t:rosie" not in ids
    assert all(l["from"] in ids and l["to"] in ids for l in m["links"])
    assert m["focus"] == "d1"
    assert _build(focus="nope")["focus"] is None


@pytest.fixture
def fresh(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'wf.db'}")
    import config, db, adoptions, coworkers
    from graphs import coworker_graph
    mods = (config, db, adoptions, coworkers, coworker_graph)
    for m in mods:
        importlib.reload(m)
    db.init_db()
    yield db, coworkers
    monkeypatch.delenv("DATABASE_URL")
    for m in mods:
        importlib.reload(m)


def test_seeded_history_is_approved_and_builds_a_rich_map(fresh, monkeypatch):
    db_, cw_ = fresh
    import seed
    from routers.workflow import approved_tasks
    monkeypatch.setattr(seed.store, "upsert_facts", lambda *a, **k: None)
    uid = db_.create_user("o@x.com", "Owner", "x")
    bid = db_.create_business(uid, "CoolAir", "hvac", "", "desc")
    staff = seed.seed_demo_staff(bid, "coolair-hvac")
    n = seed.seed_demo_coworker_history(bid, "coolair-hvac", uid, staff)
    assert n == 2
    tasks = approved_tasks(bid)
    # task-queue contract: seeded history now carries real assigned steps (one task done, one in progress)
    assert len(tasks) == 2 and all(t["result"].get("assigned_tasks") for t in tasks)
    ids = {e["id"] for e in staff}
    actors = {s["actor_id"] for t in tasks for s in t["result"]["workflow"] if s["actor_type"] == "employee"}
    assert actors and actors <= ids  # recorded ids remapped to the seeded staff
    m = build_map(employees=cw_.list_employees(bid), adopted_ids=["rosie", "jobber"], tasks=tasks, catalog=CAT,
                  match_catalog=match_catalog)
    assert m["stats"]["tasks"] == 2 and any(l["kind"] == "handoff" for l in m["links"])
    seed.delete_staff([bid])
    assert approved_tasks(bid) == []
