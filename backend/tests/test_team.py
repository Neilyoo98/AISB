import json
from pathlib import Path

import procurement as pr

CAT = {t["id"]: t for t in json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}


def test_license_extra_cost_only_for_per_seat_tools():
    t = CAT["chatgpt-business"]  # per_seat, 1 seat included
    assert pr.license_extra_cost(t, 1) == 0
    assert pr.license_extra_cost(t, 4) == 3 * t["unit_price"]
    assert pr.license_extra_cost(CAT["jobber"], 10) == 0  # flat


def test_committed_monthly_sums_tools_and_extra_seats():
    tools = [CAT["rosie"], CAT["jobber"]]
    c = pr.committed_monthly(tools, [(CAT["chatgpt-business"], 3)])
    assert c == CAT["rosie"]["price_monthly_typical"] + CAT["jobber"]["price_monthly_typical"] + 2 * CAT["chatgpt-business"]["unit_price"]
    assert pr.committed_monthly([], []) == 0


def test_spend_summary_with_and_without_cap():
    s = pr.spend_summary(300, 168)
    assert s["headroom"] == 132 and not s["over_cap"] and s["pct"] == 56.0
    n = pr.spend_summary(None, 168)
    assert n["cap"] is None and n["headroom"] is None and not n["over_cap"]
    assert pr.spend_summary(100, 168)["over_cap"]


def test_check_approval_requires_override_over_cap():
    ok, _ = pr.check_approval(300, 168, 99, override=False)
    assert ok
    ok, msg = pr.check_approval(300, 250, 99, override=False)
    assert not ok and "over your $300/mo cap" in msg
    ok, _ = pr.check_approval(300, 250, 99, override=True)
    assert ok
    ok, _ = pr.check_approval(None, 5000, 99, override=False)
    assert ok


def test_request_impact_shows_projected_spend():
    i = pr.request_impact(300, 168, 75)
    assert i == {"adds": 75, "projected": 243, "cap": 300, "over_cap": False}
    assert pr.request_impact(200, 168, 75)["over_cap"]
    assert pr.request_impact(300, 168, 75, already_adopted=True)["projected"] == 168
    assert pr.request_impact(None, 168, 75)["cap"] is None


def test_invite_status_expiry_and_usage():
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    fresh = {"used_by": None, "revoked": False, "expires_at": now + timedelta(days=pr.INVITE_DAYS)}
    assert pr.invite_status(fresh, now) == "valid"
    assert pr.invite_status({**fresh, "expires_at": now - timedelta(seconds=1)}, now) == "expired"
    assert pr.invite_status({**fresh, "used_by": "u1"}, now) == "used"
    assert pr.invite_status({**fresh, "revoked": True, "used_by": "u1"}, now) == "revoked"
    naive = {**fresh, "expires_at": (now - timedelta(days=1)).replace(tzinfo=None)}  # SQLite returns naive datetimes
    assert pr.invite_status(naive, now) == "expired"
