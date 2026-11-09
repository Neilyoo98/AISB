"""People (merged Team + Coworkers): AI-tools merge, sign-up as employee, person-bound invites, demo employee login."""
import importlib
import json
from datetime import timedelta

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

import people as P

CATALOG = {
    "quickbooks": {"id": "quickbooks", "name": "QuickBooks Online (Intuit Assist)", "price_monthly_typical": 65},
    "jobber": {"id": "jobber", "name": "Jobber", "price_monthly_typical": 119},
    "canva-pro": {"id": "canva-pro", "name": "Canva Pro (Magic Studio)", "price_monthly_typical": 15},
    "square-pos": {"id": "square-pos", "name": "Square POS (Restaurants & Retail)", "price_monthly_typical": 49},
}


# ---------------- pure helpers ----------------

def test_match_catalog_maps_free_text_names():
    assert P.match_catalog("QuickBooks", CATALOG) == "quickbooks"
    assert P.match_catalog("jobber", CATALOG) == "jobber"
    assert P.match_catalog("Canva", CATALOG) == "canva-pro"
    assert P.match_catalog("Square POS", CATALOG) == "square-pos"
    assert P.match_catalog("Google Calendar", CATALOG) is None
    assert P.match_catalog("ab", CATALOG) is None and P.match_catalog("", CATALOG) is None


def test_ai_tools_merge_dedups_and_keeps_strongest_source():
    tools = P.build_ai_tools(
        profile_tools=["QuickBooks", "jobber", "Google Calendar"],
        approved_requests=[{"tool_id": "jobber", "since": "2026-11-01T00:00:00+00:00"}],
        shadow=[{"tool_name": "Canva", "since": "2026-11-02T00:00:00+00:00"}, {"tool_name": "quickbooks", "since": None}],
        task_tools=[("jobber", "2026-11-03T00:00:00+00:00"), ("square-pos", "2026-11-04T00:00:00+00:00")],
        catalog=CATALOG)
    by = {t["tool_id"] or t["name"]: t for t in tools}
    assert len(tools) == 5  # quickbooks, jobber, Google Calendar, canva-pro, square-pos
    assert by["jobber"]["source"] == "approved_request" and by["jobber"]["since"] == "2026-11-01T00:00:00+00:00"
    assert by["quickbooks"]["source"] == "uses" and by["quickbooks"]["monthly_cost"] == 65
    assert by["canva-pro"]["source"] == "self_declared" and by["canva-pro"]["catalog"] is True
    assert by["square-pos"]["source"] == "assigned_task"
    gc = by["Google Calendar"]
    assert gc["catalog"] is False and gc["tool_id"] is None and gc["monthly_cost"] is None
    assert [t["source"] for t in tools][0] == "approved_request"  # strongest first


def test_tools_from_workflow_only_this_persons_steps():
    res = {"workflow": [
        {"actor_type": "tool", "actor_id": "jobber", "tool_id": "jobber", "handoff_to": "p1"},
        {"actor_type": "tool", "actor_id": "rosie", "tool_id": "rosie", "handoff_to": "customer"},
        {"actor_type": "employee", "actor_id": "p1", "tool_id": "quickbooks"},
        {"actor_type": "employee", "actor_id": "p2", "tool_id": "canva-pro"},
        {"actor_type": "employee", "actor_id": "p1", "tool_id": None, "gap": True},
    ]}
    assert P.tools_from_workflow(res, "p1") == ["jobber", "quickbooks"]
    assert P.tools_from_workflow({}, "p1") == []


def test_parse_invite_code_and_account_role():
    assert P.parse_invite_code("AbC123") == "AbC123"
    assert P.parse_invite_code("https://stacksmith-tan.vercel.app/join/AbC-12_3?x=1") == "AbC-12_3"
    assert P.parse_invite_code(" /join/xyz/ ") == "xyz"
    assert P.parse_invite_code("") is None and P.parse_invite_code(None) is None
    assert P.account_role(None, "u1") == "owner"
    assert P.account_role({"user_id": "u1"}, "u1") == "owner"
    assert P.account_role({"user_id": "u9"}, "u1") == "employee"


# ---------------- DB-backed flows (temp SQLite, endpoint functions called directly) ----------------

@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'people.db'}")
    import config
    import db
    import adoptions
    import coworkers
    from routers import team
    from graphs import coworker_graph
    import seed
    mods = (config, db, adoptions, coworkers, team, coworker_graph, seed)
    for m in mods:
        importlib.reload(m)
    db.init_db()
    # no vector store in unit tests
    from memory import store
    for fn in ("upsert_facts", "delete_business_memory", "add_episode"):
        monkeypatch.setattr(store, fn, lambda *a, **k: None)
    monkeypatch.setattr(store, "get_facts", lambda *a, **k: [])
    import main
    from routers import people as rp
    yield {"db": db, "cw": coworkers, "team": team, "main": main, "rp": rp, "seed": seed}
    monkeypatch.delenv("DATABASE_URL")
    for m in mods:
        importlib.reload(m)


_ip = iter(range(1, 10_000))


def _req():
    return Request({"type": "http", "headers": [], "client": (f"10.0.0.{next(_ip) % 250}", 1), "method": "POST",
                    "path": "/", "query_string": b""})


def _register(main, **kw):
    body = main.RegisterIn(**({"name": "N", "password": "password-123"} | kw))
    return main.register(body, _req(), Response())


def _owner_with_business(e, email="owner@x.com"):
    out = _register(e["main"], email=email, name="Olivia Owner")
    uid = out["user"]["id"]
    bid = e["db"].create_business(uid, "Olivia's Bakery", "cafe", "", "desc")
    owner_person = e["cw"].create_employee(bid, "Olivia Owner", "Owner", [], "", [], user_id=uid)
    return e["db"].get_user(uid), bid, owner_person


def test_register_as_employee_requires_a_valid_code(env):
    main, team = env["main"], env["team"]
    owner, bid, _ = _owner_with_business(env)
    with pytest.raises(HTTPException) as ex:
        _register(main, email="nocode@x.com", account_type="employee")
    assert ex.value.status_code == 400 and env["db"].get_user_by_email("nocode@x.com") is None
    with pytest.raises(HTTPException) as ex:
        _register(main, email="bad@x.com", account_type="employee", invite_code="not-a-real-code")
    assert ex.value.status_code == 400 and env["db"].get_user_by_email("bad@x.com") is None
    code = team.create_invite_row(bid, owner["id"], "Old")
    with team.engine.begin() as c:  # expire it
        c.execute(team.update(team.invites).where(team.invites.c.code == code)
                  .values(expires_at=team._now() - timedelta(days=1)))
    with pytest.raises(HTTPException) as ex:
        _register(main, email="late@x.com", account_type="employee", invite_code=code)
    assert ex.value.status_code == 400 and "expired" in ex.value.detail


def test_employee_signup_with_unbound_invite_creates_their_person(env):
    main, team, cw = env["main"], env["team"], env["cw"]
    owner, bid, _ = _owner_with_business(env)
    code = team.create_invite_row(bid, owner["id"])
    out = _register(main, email="emp@x.com", name="Eli Employee", account_type="employee",
                    invite_code=f"https://example.com/join/{code}")
    assert out["account_role"] == "employee" and out["business_name"] == "Olivia's Bakery"
    u = env["db"].get_user(out["user"]["id"])
    me = main.me(u)
    assert me["account_role"] == "employee" and me["business"]["id"] == bid
    person = cw.get_employee(me["person_id"])
    assert person["user_id"] == u["id"] and person["name"] == "Eli Employee"
    assert main.me(owner)["account_role"] == "owner"
    with pytest.raises(HTTPException) as ex:  # the link can't be reused
        _register(main, email="emp2@x.com", account_type="employee", invite_code=code)
    assert ex.value.status_code == 400


def test_person_bound_invite_links_login_to_that_profile(env):
    main, rp, cw = env["main"], env["rp"], env["cw"]
    owner, bid, _ = _owner_with_business(env)
    import asyncio
    created = asyncio.run(rp.create_person(rp.PersonIn(name="Luis Ortega", role="Lead tech", skills=["AC repair"],
                                                       tools=["jobber"], invite=True), _req(), owner))
    pid, url = created["person"]["id"], created["invite_url"]
    assert url.startswith("/join/") and created["person"]["has_login"] is False
    listed = {p["id"]: p for p in rp.list_people(owner)}
    assert listed[pid]["pending_invite_url"] == url
    out = _register(main, email="luis@x.com", name="Luis O.", account_type="employee", invite_code=url)
    staff = cw.list_employees(bid)
    assert len(staff) == 2  # no duplicate profile was created
    assert cw.get_employee(pid)["user_id"] == out["user"]["id"]
    luis_user = env["db"].get_user(out["user"]["id"])
    assert main.me(luis_user)["person_id"] == pid
    p = rp.get_person(pid, owner)
    assert p["has_login"] and p["pending_invite_url"] is None and p["email"] == "luis@x.com"
    assert [t["tool_id"] for t in p["ai_tools"]] == ["jobber"]
    # employees can read people and set only their own status
    assert {x["id"] for x in rp.list_people(luis_user)} == {pid, staff[0]["id"]}
    assert rp.set_status(pid, rp.StatusIn(status="off"), luis_user)["status"] == "off"
    with pytest.raises(HTTPException):
        rp.set_status(staff[0]["id"], rp.StatusIn(status="off"), luis_user)
    with pytest.raises(HTTPException):
        asyncio.run(rp.create_person(rp.PersonIn(name="X"), _req(), luis_user))


def test_person_ai_tools_include_approved_requests_and_declared_tools(env):
    rp, team, cw = env["rp"], env["team"], env["cw"]
    owner, bid, _ = _owner_with_business(env)
    out = _register(env["main"], email="m@x.com", name="Mia", account_type="employee",
                    invite_code=team.create_invite_row(bid, owner["id"]))
    uid = out["user"]["id"]
    with team.engine.begin() as c:
        c.execute(team.insert(team.tool_requests).values(business_id=bid, requester_id=uid, tool_id="canva-pro",
                                                        status="approved", seats=1, est_monthly_cost=15))
        c.execute(team.insert(team.tool_requests).values(business_id=bid, requester_id=uid, tool_id="buffer",
                                                        status="pending", seats=1, est_monthly_cost=18))
        c.execute(team.insert(team.shadow_tools).values(business_id=bid, user_id=uid, tool_name="ChatGPT", status="open"))
    pid = env["main"].me(env["db"].get_user(uid))["person_id"]
    p = rp.get_person(pid, owner)
    sources = {t["tool_id"]: t["source"] for t in p["ai_tools"]}
    assert sources == {"canva-pro": "approved_request", "chatgpt-business": "self_declared"}  # pending isn't owned
    assert {r["tool_id"]: r["status"] for r in p["requests"]} == {"canva-pro": "approved", "buffer": "pending"}


def test_demo_employee_login_is_an_employee_linked_to_a_person(env, monkeypatch):
    main, seed, cw = env["main"], env["seed"], env["cw"]
    seed.seed_demos()
    for pid_, name in seed.DEMO_EMPLOYEE_LOGIN.items():
        out = main.demo_login(pid_, _req(), Response(), as_="employee")
        assert out["account_role"] == "employee"
        u = env["db"].get_user(out["user"]["id"])
        me = main.me(u)
        assert me["account_role"] == "employee" and me["business"]["name"] == seed.persona(pid_)["business_name"]
        assert cw.get_employee(me["person_id"])["name"] == name
        owner = env["db"].get_user(main.demo_login(pid_, _req(), Response())["user"]["id"])
        assert main.me(owner)["account_role"] == "owner"
    accounts = {a["id"]: a for a in main.demo_accounts()}
    assert accounts["coolair-hvac"]["employee"] == {"name": "Luis Ortega", "role": "Lead tech"}
    seed.reset_demos()  # restores the employee login and its link
    out = main.demo_login("joes-coffee", _req(), Response(), as_="employee")
    me = main.me(env["db"].get_user(out["user"]["id"]))
    assert cw.get_employee(me["person_id"])["name"] == "Marcus Lee"
