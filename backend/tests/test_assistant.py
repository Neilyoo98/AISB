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
