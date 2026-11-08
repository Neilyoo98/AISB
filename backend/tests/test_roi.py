import json
from pathlib import Path

import roi

CATALOG = {t["id"]: t for t in json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}
PROFILE = {"monthly_budget": 300, "tech_comfort": 3, "current_tools": ["quickbooks", "google-calendar"]}
PAIN = {"id": "missed-calls", "hours_per_week": 2, "hourly_cost": 50, "revenue_at_risk_monthly": 4000}


def test_roi_math_is_deterministic():
    r = roi.compute_tool_roi(tool=CATALOG["rosie"], pain=PAIN, profile=PROFILE, critiques=[],
                             estimate={"pct_time_saved": 0.5, "pct_revenue_recovered": 0.5})
    assert r.monthly_cost == 49
    assert r.hours_saved_per_month == round(2 * 4.33 * 0.5, 1)
    assert r.revenue_recovered_monthly == 2000
    assert r.monthly_value == round(2 * 4.33 * 0.5 * 50 + 2000)
    assert r.net_monthly == r.monthly_value - 49
    assert r.payback_days is not None and r.payback_days < 2
    assert 0 <= r.fit_score <= 100


def test_estimates_are_clamped():
    r = roi.compute_tool_roi(tool=CATALOG["rosie"], pain=PAIN, profile=PROFILE, critiques=[],
                             estimate={"pct_time_saved": 5, "pct_revenue_recovered": -1})
    assert r.revenue_recovered_monthly == 0
    assert r.hours_saved_per_month == round(2 * 4.33, 1)


def test_high_severity_critique_lowers_fit():
    base = dict(tool=CATALOG["podium"], pain=PAIN, profile=PROFILE,
                estimate={"pct_time_saved": 0.3, "pct_revenue_recovered": 0.3})
    a = roi.compute_tool_roi(critiques=[], **base)
    b = roi.compute_tool_roi(critiques=[{"tool_id": "podium", "severity": "high"}], **base)
    assert b.fit_score < a.fit_score


def test_pick_stack_respects_budget_and_dedupes_tools():
    est = {"pct_time_saved": 0.5, "pct_revenue_recovered": 0.5}
    pain2 = {"id": "quotes", "hours_per_week": 6, "hourly_cost": 50, "revenue_at_risk_monthly": 0}
    scored = [roi.compute_tool_roi(tool=CATALOG[t], pain=p, profile=PROFILE, critiques=[], estimate=est)
              for t, p in [("workiz", PAIN), ("rosie", PAIN), ("jobber", pain2), ("housecall-pro", pain2)]]
    ids, summary = roi.pick_stack(scored, budget=200)
    assert summary["monthly_cost"] <= 200
    assert len(ids) == len(set(ids))
    assert summary["within_budget"]


def test_zero_value_tool_has_no_payback():
    r = roi.compute_tool_roi(tool=CATALOG["jobber"], pain={"id": "x", "hours_per_week": 0, "hourly_cost": 0,
                                                           "revenue_at_risk_monthly": 0},
                             profile=PROFILE, critiques=[], estimate={"pct_time_saved": 0.5})
    assert r.payback_days is None


def test_pick_stack_consolidates_onto_one_tool():
    est = {"pct_time_saved": 0.5, "pct_revenue_recovered": 0.5}
    quotes = {"id": "quotes", "hours_per_week": 8, "hourly_cost": 50, "revenue_at_risk_monthly": 6000}
    routing = {"id": "routing", "hours_per_week": 5, "hourly_cost": 22, "revenue_at_risk_monthly": 0}
    scored = [roi.compute_tool_roi(tool=CATALOG[t], pain=p, profile=PROFILE, critiques=[], estimate=est)
              for t, p in [("jobber", quotes), ("yardbook", routing), ("jobber", routing)]]
    ids, summary = roi.pick_stack(scored, budget=300)
    assert ids == ["jobber"]
    assert summary["picks"] == {"quotes": "jobber", "routing": "jobber"}
