import importlib

from profile_sync import facts_from_details, norm_tool, parse_budget, sync_profile


def test_parse_budget():
    assert parse_budget("under $50") == 50
    assert parse_budget("About $200") == 200
    assert parse_budget("$500+") == 500
    assert parse_budget(None) is None and parse_budget("") is None
    assert parse_budget("$120") == 120


def test_sync_profile_owner_answers_win():
    old = {"vertical": "cafe", "employees": 6, "monthly_budget": 150.0, "tech_comfort": 2,
           "current_tools": ["square-pos", "instagram"], "summary": "A café"}
    p = sync_profile(old, {"business_category": "food_drink", "budget": "about $300", "tech_comfort": 4,
                           "team_size": 9, "current_tools": ["Square POS", " Google Calendar ", "square pos"],
                           "security_must_haves": ["soc2", "bogus"], "goals": ["Save time"]},
                     name="Joe's", location="College Park")
    assert p["monthly_budget"] == 300 and p["tech_comfort"] == 4 and p["employees"] == 9
    assert p["current_tools"] == ["square-pos", "google-calendar"]
    assert p["vertical"] == "cafe"  # same category -> keep the analyzed vertical
    assert p["security_must_haves"] == ["soc2"] and p["goals"] == ["Save time"]
    assert p["business_name"] == "Joe's" and p["summary"] == "A café"
    assert old["monthly_budget"] == 150  # pure: input untouched


def test_sync_profile_category_change_and_new_business():
    p = sync_profile({"vertical": "cafe"}, {"business_category": "home_field"})
    assert p["vertical"] == "home_services" and p["business_category"] == "home_field"
    fresh = sync_profile(None, {"business_category": "nonsense", "tech_comfort": 9})
    assert fresh["business_category"] == "other" and fresh["tech_comfort"] == 5
    assert fresh["current_tools"] == []


def test_facts_mirror_owner_answers():
    details = {"team_size": 3, "budget": "about $100", "tech_comfort": 2, "goals": ["Get paid faster"],
               "security_must_haves": ["no_training"], "current_tools": ["QuickBooks"]}
    prof = sync_profile(None, details | {"business_category": "retail"})
    facts = facts_from_details(details, prof)
    objs = {f["object"] for f in facts}
    assert {"Retail & e-commerce", "3", "about $100", "quickbooks", "Get paid faster", "No training on our data"} <= objs
    assert all(f["confidence"] == 1.0 for f in facts)
    assert norm_tool("  Google   Calendar ") == "google-calendar"


def test_adoptions_table_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'a.db'}")
    import config
    import db
    import adoptions
    importlib.reload(config)
    importlib.reload(db)
    importlib.reload(adoptions)
    db.init_db()
    uid = db.create_user("o@x.y", "O", "h")
    bid = db.create_business(uid, "Biz", "cafe", "", "d")
    assert adoptions.adopt(bid, "rosie", "manual") is True
    assert adoptions.adopt(bid, "rosie", "manual") is False  # idempotent
    assert adoptions.adopted_ids(bid) == ["rosie"]
    assert adoptions.remove(bid, "rosie") and adoptions.adopted_ids(bid) == []
    assert adoptions.adopt(bid, "rosie", "plan", "r1") is True  # re-adopt after removal
    assert adoptions.list_adopted(bid)[0]["source"] == "plan"
    # manual setup tasks survive a plan re-save and show up next to the plan's tasks
    rid = db.create_run(bid, uid, "live", "x")
    db.update_run(rid, status="complete", result={"approved_tool_ids": ["rosie"]})
    db.add_business_tasks(bid, rid, [{"week": 1, "tool_id": "jobber", "text": "set up", "owner": "Owner", "minutes": 20}])
    db.replace_plan_tasks(rid, [{"week": 1, "tool_id": "rosie", "text": "plan task", "owner": "Owner", "minutes": 10}])
    texts = {t["text"] for t in db.get_business_tasks(bid, rid)}
    assert texts == {"set up", "plan task"}
    # manual placeholder runs are not analyses
    adoptions._manual_run(bid, uid)
    assert db.latest_complete_run(bid)["id"] == rid
    assert all(r["mode"] != "manual" for r in db.list_runs(bid))
    adoptions.schedule_refresh(bid, "rosie")  # no event loop -> silently skipped, never stuck "updating"
    assert adoptions.scenarios_status(bid) == "none"
    monkeypatch.delenv("DATABASE_URL")
    importlib.reload(config)
    importlib.reload(db)
    importlib.reload(adoptions)
