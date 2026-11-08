import json
from pathlib import Path

import evaluate as ev

CAT = {t["id"]: t for t in json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}


def test_normalize_weights_sums_to_100():
    assert sum(ev.normalize_weights({"cost": 1, "ease": 1, "fit": 1}).values()) == 100
    assert ev.normalize_weights({}) == ev.PRESETS["balanced"]
    w = ev.normalize_weights({"cost": 33, "ease": 33, "fit": 33, "security": 0})
    assert sum(w.values()) == 100 and w["security"] == 0
    assert ev.normalize_weights({"cost": -5}) == ev.PRESETS["balanced"]


def test_tco_free_tier_is_only_setup_time():
    t = CAT["yardbook"]  # free
    r = ev.tco(t, seats=3, months=12, hourly_cost=40)
    assert r["subscription"] == 0 and r["usage"] == 0
    assert r["total"] == t["setup_hours"] * 40


def test_tco_per_seat_charges_extra_seats():
    t = CAT["chatgpt-business"]
    one = ev.tco(t, seats=1, months=12, hourly_cost=0)
    four = ev.tco(t, seats=4, months=12, hourly_cost=0)
    assert four["subscription"] - one["subscription"] == 3 * t["unit_price"] * 12


def test_tco_flat_ignores_seats():
    t = CAT["jobber"]
    assert ev.tco(t, seats=1)["subscription"] == ev.tco(t, seats=9)["subscription"]


def test_tco_usage_overage_and_zero_usage():
    t = CAT["smith-ai"]
    assert ev.tco(t, usage_per_month=0, hourly_cost=0)["usage"] == 0
    assert ev.tco(t, usage_per_month=t["units_included"], hourly_cost=0)["usage"] == 0
    over = ev.tco(t, usage_per_month=t["units_included"] + 10, months=36, hourly_cost=0)
    assert over["usage"] == round(10 * t["unit_price"] * 36, 2)
    assert over["total"] == over["subscription"] + over["usage"]


def test_integration_status_native_via_none():
    r = ev.integration_status(CAT["jobber"], ["QuickBooks", "Google Calendar", "spreadsheet"])
    st = {l["tool"]: l["status"] for l in r["links"]}
    assert st["quickbooks"] == "native" and st["google-calendar"] == "native"
    assert st["spreadsheet"] == "none" and r["missing"] == ["spreadsheet"]
    z = ev.integration_status(CAT["calendly"], ["spreadsheet"])  # calendly lists zapier
    assert z["links"][0]["status"] == "via_zapier_or_make"


def test_score_tool_flags_unknown_data_and_respects_weights():
    prof = {"monthly_budget": 200, "tech_comfort": 2, "current_tools": ["quickbooks"]}
    s = ev.score_tool(CAT["yardbook"], prof, ev.PRESETS["balanced"])  # nothing sourced yet
    assert s["criteria"]["security"]["no_data"] and s["criteria"]["security"]["score"] == 5.0
    assert s["criteria"]["support"]["no_data"]
    cal = ev.score_tool(CAT["calendly"], prof, {"security": 100})  # SOC 2 + GDPR/ISO + no-training all sourced
    assert not cal["criteria"]["security"]["no_data"] and cal["total"] == 7.0
    s = ev.score_tool(CAT["jobber"], prof, ev.PRESETS["balanced"])
    assert 0 <= s["total"] <= 10
    cheap = ev.score_tool(CAT["yardbook"], prof, {"cost": 100})
    pricey = ev.score_tool(CAT["workiz"], prof, {"cost": 100})
    assert cheap["total"] > pricey["total"]
    with_reviews = ev.score_tool(CAT["jobber"], prof, {"support": 100}, {"support": 4.5, "count": 3})
    assert with_reviews["total"] == 9.0 and not with_reviews["criteria"]["support"]["no_data"]


def test_over_budget_tool_scores_zero_cost():
    s = ev.score_tool(CAT["owner-com"], {"monthly_budget": 100}, {"cost": 100})
    assert s["criteria"]["cost"]["score"] == 0


def test_verified_use_requires_14_days(tmp_path, monkeypatch):
    import importlib, json as _json
    from datetime import datetime, timedelta, timezone
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 't.db'}")
    import config, db as _db
    importlib.reload(config); importlib.reload(_db)
    _db.init_db()
    uid = _db.create_user("a@b.c", "A", "x")
    bid = _db.create_business(uid, "B", "cafe", "", "d")
    now = datetime.now(timezone.utc)
    rid = _db.create_run(bid, uid, "live", "x", created_at=now - timedelta(days=5))
    _db.update_run(rid, status="complete", result={"approved_tool_ids": ["jobber"]})
    assert not _db.has_verified_use(bid, "jobber")
    assert _db.has_verified_use(bid, "jobber", now=now + timedelta(days=10))
    assert not _db.has_verified_use(bid, "rosie", now=now + timedelta(days=10))
    r = _db.add_review("jobber", bid, uid, "Owner", 5, 4, 3, "ok")
    assert r["verified_use"] is False
    agg = _db.review_aggregates()["jobber"]
    assert agg["count"] == 1 and agg["overall"] == 4.0
    monkeypatch.delenv("DATABASE_URL"); importlib.reload(config); importlib.reload(_db)
