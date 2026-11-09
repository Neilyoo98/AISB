"""Owner-only actions are blocked for employees (from the whole-site audit), and new owners appear on People."""
import asyncio

import pytest
from fastapi import HTTPException

from tests.test_people import _owner_with_business, _register, _req, env  # noqa: F401  (fixture re-export)


def _employee(e, bid, owner, email="emp@x.com"):
    code = e["team"].create_invite_row(bid, owner["id"])
    out = _register(e["main"], email=email, name="Eli Employee", account_type="employee", invite_code=code)
    return e["db"].get_user(out["user"]["id"])


def test_employee_cannot_adopt_or_remove_tools(env):
    from routers import adoption
    owner, bid, _ = _owner_with_business(env)
    emp = _employee(env, bid, owner)
    with pytest.raises(HTTPException) as ex:
        asyncio.run(adoption.post_adoption(adoption.AdoptIn(tool_id="jobber"), _req(), emp))
    assert ex.value.status_code == 403 and "Request" in ex.value.detail
    with pytest.raises(HTTPException) as ex:
        asyncio.run(adoption.delete_adoption("jobber", emp))
    assert ex.value.status_code == 403


def test_employee_cannot_run_analysis_or_save_weights(env):
    main = env["main"]
    owner, bid, _ = _owner_with_business(env)
    emp = _employee(env, bid, owner)
    with pytest.raises(HTTPException) as ex:
        asyncio.run(main.create_run(main.RunIn(mode="live"), _req(), emp))
    assert ex.value.status_code == 403
    with pytest.raises(HTTPException) as ex:
        main.put_weights(main.WeightsIn(weights={"cost": 100}), emp)
    assert ex.value.status_code == 403


def test_team_hides_owner_only_data_from_employees(env):
    team = env["team"]
    owner, bid, _ = _owner_with_business(env)
    emp = _employee(env, bid, owner)
    as_emp = team.get_team(emp)
    assert as_emp["spend"] is None and as_emp["licenses"] == []
    others = [m for m in as_emp["members"] if m["user_id"] != emp["id"]]
    assert others and all(m["email"] is None for m in others)
    assert next(m for m in as_emp["members"] if m["user_id"] == emp["id"])["email"] == "emp@x.com"
    as_owner = team.get_team(owner)
    assert as_owner["spend"] is not None
    assert all(m["email"] for m in as_owner["members"])


def test_new_owner_business_creates_their_person(env):
    main, cw = env["main"], env["cw"]
    out = _register(main, email="new@x.com", name="Nina New")
    u = env["db"].get_user(out["user"]["id"])
    b = main.upsert_business(main.BusinessIn(name="Nina's Shop", location="", description="x" * 60), u)
    people = cw.list_employees(b["id"])
    assert len(people) == 1 and people[0]["user_id"] == u["id"] and people[0]["role"] == "Owner"


def test_stale_live_tasks_expire_at_startup(env):
    cw = env["cw"]
    owner, bid, _ = _owner_with_business(env)
    live = cw.create_task(bid, owner["id"], "stuck task", "live")
    replay = cw.create_task(bid, owner["id"], "replay task", "replay")
    cw.update_task(live, status="awaiting_approval")
    cw.update_task(replay, status="awaiting_approval")
    assert cw.expire_stale_live_tasks() == 1
    assert cw.get_task(live)["status"] == "error"
    assert cw.get_task(replay)["status"] == "awaiting_approval"
