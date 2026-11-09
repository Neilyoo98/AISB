import asyncio

import pytest

from routers import assistant as A


@pytest.mark.parametrize("text", [
    "my password is hunter2",
    "pwd: Sup3rS3cret",
    "card 4111 1111 1111 1111 exp 12/28",
    "key sk-or-v1-0000aaaa1111bbbb2222cccc3333dddd",
    "AKIAIOSFODNN7EXAMPLE",
    "token rlwy_wksp_FAKEFAKEFAKEFAKEFAKE",
    "ssn 123-45-6789",
])
def test_secrets_are_detected(text):
    assert A.contains_secret(text)


@pytest.mark.parametrize("text", [
    "What should I do this week?",
    "We miss about 15 calls a week worth $350 each",
    "Is Jobber worth $119 per month for 4 techs?",
    "call me at 301 555 0100",  # phone numbers are not card numbers (fails Luhn / too short)
    None,
])
def test_normal_questions_pass(text):
    assert not A.contains_secret(text)


def test_secret_in_history_or_page_text_blocks_too():
    assert A.contains_secret("hi", "visible page", "earlier I said password: abc123")


def test_valid_tool_ids_drops_unknown_and_duplicates():
    assert A.valid_tool_ids(["rosie", "made-up", "rosie", "jobber", "goodcall", "calendly"],
                            {"rosie", "jobber", "goodcall", "calendly"}) == ["rosie", "jobber", "goodcall"]
    assert A.valid_tool_ids([], {"rosie"}) == []


def test_clean_task_text_trims_and_caps():
    assert A.clean_task_text("  answer   the phone \n during lunch ") == "answer the phone during lunch"
    assert len(A.clean_task_text("x" * 500)) == 200


def test_page_name_mapping():
    assert A.page_name("/war-room/abc") == "War Room"
    assert A.page_name("/tools/jobber") == "Tool details"
    assert A.page_name("/tools?q=x") == "Discover"
    assert A.page_name("/nowhere") == "StackSmith"


def test_template_answer_for_secret_is_safe():
    out = A.template_answer("Dashboard", "secret")
    assert out["mode"] == "template" and out["tools"] == [] and "didn't send" in out["answer"]


def test_task_recs_only_return_catalog_candidates(monkeypatch):
    cands = [{"id": "rosie", "name": "Rosie", "description": "AI answering", "price_monthly_typical": 49, "setup_hours": 0.5},
             {"id": "goodcall", "name": "Goodcall", "description": "AI phone", "price_monthly_typical": 99, "setup_hours": 1}]

    async def fake_candidates(q, limit=8):
        return cands

    async def fake_call_json(**kw):
        return A.TaskRecsOut(picks=[A.TaskPick(tool_id="invented-tool", reason="x"),
                                    A.TaskPick(tool_id="rosie", reason="Answers calls while you work.")])

    monkeypatch.setattr(A, "_candidates", fake_candidates)
    monkeypatch.setattr(A, "call_json", fake_call_json)
    out = asyncio.run(A.recommend_for_task("answer the phone during lunch", []))
    assert out == [{"tool_id": "rosie", "reason": "Answers calls while you work."}]


def test_task_recs_fall_back_to_search_when_model_fails(monkeypatch):
    cands = [{"id": "rosie", "name": "Rosie", "description": "d", "price_monthly_typical": 49, "setup_hours": 1}]

    async def fake_candidates(q, limit=8):
        return cands

    async def boom(**kw):
        raise A.LLMError("down")

    monkeypatch.setattr(A, "_candidates", fake_candidates)
    monkeypatch.setattr(A, "call_json", boom)
    out = asyncio.run(A.recommend_for_task("phones", []))
    assert [o["tool_id"] for o in out] == ["rosie"]


def test_custom_task_roundtrip(tmp_path, monkeypatch):
    import importlib
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 't.db'}")
    import config, db as _db
    importlib.reload(config); importlib.reload(_db)
    try:
        _db.init_db()
        uid = _db.create_user("o@x.y", "Owner", "x")
        bid = _db.create_business(uid, "B", "cafe", "", "d")
        rid = _db.create_run(bid, uid, "manual", "x")
        tid = _db.add_custom_task(bid, rid, "Answer phones at lunch", 1, "Owner")
        _db.set_task_suggestions(tid, [{"tool_id": "rosie", "reason": "r"}])
        t = _db.get_task(tid)
        assert t["source"] == "custom" and t["suggestions"][0]["tool_id"] == "rosie"
        assert [x["id"] for x in _db.get_business_tasks(bid)] == [tid]
        assert not _db.delete_custom_task(tid, "other-business")
        assert _db.delete_custom_task(tid, bid)
    finally:
        monkeypatch.delenv("DATABASE_URL")
        importlib.reload(config); importlib.reload(_db)


# ---------------- page data + whole-business snapshot ----------------

import json as _json
from pathlib import Path as _Path

_CAT = {t["id"]: t for t in _json.loads((_Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}
_COOLAIR = {"vertical": "hvac", "monthly_budget": 300, "tech_comfort": 3, "employees": 4,
            "current_tools": ["quickbooks", "google-calendar"]}
_PAINS = [{"title": "Missed calls while techs are on jobs", "tag": "missed_calls", "monthly_cost_of_pain": 4608},
          {"title": "Quotes take forever", "tag": "quoting", "monthly_cost_of_pain": 1299},
          {"title": "Slow payments", "tag": "invoicing_payments", "monthly_cost_of_pain": 162}]


def test_discover_ranking_for_coolair_returns_catalog_tools_that_fix_its_problems():
    ranked = A.rank_tools_for_business(_CAT, _COOLAIR, _PAINS, adopted_ids=[], limit=8)
    assert len(ranked) == 8 and all(r["tool_id"] in _CAT for r in ranked)
    top3 = {r["tool_id"] for r in ranked[:3]}
    assert any("missed_calls" in _CAT[t]["solves"] for t in top3), ranked[:3]
    assert "fixes" in ranked[0]["why"]


def test_discover_ranking_skips_adopted_tools_and_marks_covered_problems():
    ranked = A.rank_tools_for_business(_CAT, _COOLAIR, _PAINS, adopted_ids=["rosie", "jobber"])
    assert not {"rosie", "jobber"} & {r["tool_id"] for r in ranked}
    covered = {p["tag"]: p["covered_by_adopted_tool"] for p in A.open_pains(_PAINS, ["rosie", "jobber"], _CAT)}
    assert covered == {"missed_calls": True, "quoting": True, "invoicing_payments": True}


def test_discover_page_facts_include_ranked_tools(monkeypatch):
    import adoptions
    biz = {"id": "b1", "user_id": "u1", "profile_json": _json.dumps(_COOLAIR), "details_json": None}
    run = {"id": "r1", "result_json": _json.dumps({"pains": _PAINS})}
    monkeypatch.setattr(A.db, "latest_complete_run", lambda bid: run)
    monkeypatch.setattr(A.db, "review_aggregates", lambda: {})
    monkeypatch.setattr(adoptions, "adopted_ids", lambda bid: ["rosie"])
    data, tool_ids = A.page_facts("/tools", "", {"id": "u1"}, biz)
    ranked = data["best_fit_tools_for_this_business"]
    assert ranked and tool_ids[:len(ranked)] == [r["tool_id"] for r in ranked]
    assert "rosie" not in tool_ids and data["already_adopted"] == [_CAT["rosie"]["name"]]
    assert any(p["tag"] == "missed_calls" and p["covered_by_adopted_tool"] for p in data["problems_from_analysis"])


def test_task_page_facts_show_route_cover_workflow_and_checklist():
    task = {"text": "Customer says the tech never showed up", "stage": "in_progress",
            "assignee": {"name": "Luis Ortega"},
            "steps": [{"text": "Call the customer", "done": True}, {"text": "Rebook in Jobber", "done": False}],
            "result": {"intent": "apologize and rebook",
                       "route": {"owner_id": "e1", "human_id": "e2", "substituted": True, "owner_reason": "handles complaints",
                                 "substitution_note": "Maria is off today, so Luis takes the call."},
                       "workflow": [{"actor_type": "employee", "actor_id": "e2", "action": "Call the customer"},
                                    {"actor_type": "tool", "tool_id": "jobber", "action": "Draft the apology"},
                                    {"actor_type": "employee", "actor_id": "e2", "action": "Reply to the review", "gap": True}],
                       "drafts": [{"title": "Apology text"}]}}
    f = A.task_facts(task, {"e1": "Maria Okafor", "e2": "Luis Ortega"})
    assert f["assigned_to"] == "Luis Ortega" and "Maria is off" in f["covering"]
    assert f["workflow"][0].startswith("Luis Ortega:") and f["workflow"][1].startswith("jobber:")
    assert "no tool covers" in f["workflow"][2]
    assert f["checklist"] == ["[x] Call the customer", "[ ] Rebook in Jobber"] and f["drafts"] == ["Apology text"]


def _snapshot_data():
    return {"catalog": _CAT, "me": {"name": "Luis Ortega", "job_role": "Lead tech"},
            "business": {"name": "CoolAir HVAC", "monthly_tool_budget": "$300"},
            "adopted_ids": ["rosie", "jobber"],
            "spend": {"cap": 300, "committed_monthly": 168, "headroom": 132, "over_cap": False},
            "requests": [{"tool_id": "nicejob", "requester": "Luis Ortega", "est_monthly_cost": 75, "status": "pending", "mine": True},
                         {"tool_id": "calendly", "requester": "Dana Brooks", "est_monthly_cost": 12, "status": "approved", "mine": False}],
            "licenses": [{"tool_id": "jobber", "seats_bought": 5, "seats_assigned": 4}],
            "shadow": [{"tool_name": "Claude", "user": "Dana Brooks", "status": "open"}],
            "people": [{"name": "Luis Ortega", "role": "Lead tech", "status": "available", "ai_tools": ["Jobber"]}],
            "tasks": [{"text": "Tech never showed up", "stage": "in_progress", "assignee": {"name": "Luis Ortega"},
                       "progress": {"done": 1, "total": 3}, "mine": True},
                      {"text": "Ask for reviews", "stage": "done", "assignee": {"name": "Dana Brooks"},
                       "progress": {"done": 3, "total": 3}, "mine": False}],
            "my_steps": ["Rebook in Jobber"], "analysis": {"problems": [{"problem": "Missed calls", "costs_per_month": "$4,608"}]}}


def test_snapshot_gives_owners_spending_requests_and_licenses():
    s = A.build_snapshot(_snapshot_data(), is_owner=True)
    assert s["you"]["account"] == "owner"
    assert s["spending"] == {"monthly_ai_limit": "$300", "committed_per_month": "$168", "headroom_per_month": "$132",
                             "over_limit": False}
    assert [r["tool"] for r in s["tool_requests"]] == [_CAT["nicejob"]["name"], _CAT["calendly"]["name"]]
    assert s["licenses"][0]["seats_bought"] == 5 and s["unapproved_tools_in_use"][0]["tool"] == "Claude"
    assert len(s["task_queue"]) == 2 and s["adopted_stack"][0]["price_per_month"].startswith("$")


def test_snapshot_hides_owner_only_data_from_employees():
    s = A.build_snapshot(_snapshot_data(), is_owner=False)
    assert s["you"] == {"name": "Luis Ortega", "account": "employee", "job_role": "Lead tech"}
    for owner_only in ("spending", "tool_requests", "licenses", "unapproved_tools_in_use", "task_queue"):
        assert owner_only not in s
    assert s["my_tool_requests"] == [{"tool": _CAT["nicejob"]["name"], "status": "pending"}]  # only their own
    assert [t["task"] for t in s["my_tasks"]] == ["Tech never showed up"] and s["team_task_count"] == 2
    assert s["my_open_steps"] == ["Rebook in Jobber"]


def test_facts_cap_is_respected():
    big_snap = {"people": [{"name": f"P{i}", "ai_tools": ["a", "b"]} for i in range(30)], "you": {"name": "x"}}
    big_page = {"best_fit_tools_for_this_business": [{"tool_id": f"t{i}"} for i in range(30)]}
    s, p = A.cap_facts(big_snap, big_page, max_items=60)
    assert A.count_items(s) + A.count_items(p) <= 60
    assert s["you"] == {"name": "x"}  # scalars untouched
    assert A.count_items(big_snap) == 90  # inputs not mutated


def test_only_owner_or_publisher_can_delete_published_tasks(tmp_path, monkeypatch):
    import importlib
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'd.db'}")
    import config, db as _db
    importlib.reload(config); importlib.reload(_db)
    try:
        _db.init_db()
        owner = _db.create_user("o@x.y", "Owner", "x")
        bid = _db.create_business(owner, "B", "hvac", "", "d")
        rid = _db.create_run(bid, owner, "manual", "x")
        owners_task = _db.add_custom_task(bid, rid, "Owner task", 1, "Owner", created_by=owner)
        staff_task = _db.add_custom_task(bid, rid, "Luis task", 1, "Luis", created_by="luis")
        assert not _db.delete_custom_task(owners_task, bid, user_id="luis", is_owner=False)  # member can't delete owner's
        assert _db.get_task(owners_task)
        assert _db.delete_custom_task(staff_task, bid, user_id="luis", is_owner=False)       # publisher can
        assert _db.delete_custom_task(owners_task, bid, user_id=owner, is_owner=True)         # owner can
    finally:
        monkeypatch.delenv("DATABASE_URL")
        importlib.reload(config); importlib.reload(_db)
