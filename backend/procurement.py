"""Pure spend math for team mode (no I/O). Committed spend = adopted tools' typical prices + extra license seats."""


def license_extra_cost(tool: dict, seats_bought: int) -> float:
    """Monthly cost of seats bought beyond what the plan includes (per-seat tools only)."""
    if tool.get("pricing_model") != "per_seat":
        return 0.0
    extra = max(0, int(seats_bought or 0) - int(tool.get("seats_included") or 1))
    return round(extra * float(tool.get("unit_price") or 0), 2)


def committed_monthly(adopted_tools: list[dict], licenses: list[tuple[dict, int]]) -> float:
    base = sum(float(t.get("price_monthly_typical", 0)) for t in adopted_tools)
    extra = sum(license_extra_cost(t, seats) for t, seats in licenses)
    return round(base + extra, 2)


def spend_summary(cap: float | None, committed: float) -> dict:
    has_cap = bool(cap) and cap > 0
    return {
        "cap": round(cap, 2) if has_cap else None,
        "committed_monthly": round(committed, 2),
        "headroom": round(cap - committed, 2) if has_cap else None,
        "over_cap": bool(has_cap and committed > cap),
        "pct": round(min(100.0, committed / cap * 100), 1) if has_cap else None,
    }


def request_impact(cap: float | None, committed: float, add_cost: float, already_adopted: bool = False) -> dict:
    """What approving one request does to monthly AI spend: shown to the owner before deciding."""
    add = 0.0 if already_adopted else max(0.0, float(add_cost or 0))
    projected = round(float(committed) + add, 2)
    has_cap = bool(cap) and cap > 0
    return {"adds": round(add, 2), "projected": projected, "cap": round(cap, 2) if has_cap else None,
            "over_cap": bool(has_cap and projected > cap)}


INVITE_DAYS = 14


def invite_status(invite: dict, now) -> str:
    """valid | used | revoked | expired for an invite row ({used_by, revoked, expires_at})."""
    if invite.get("revoked"):
        return "revoked"
    if invite.get("used_by"):
        return "used"
    exp = invite.get("expires_at")
    if exp is not None:
        if exp.tzinfo is None and now.tzinfo is not None:
            exp = exp.replace(tzinfo=now.tzinfo)
        if exp <= now:
            return "expired"
    return "valid"


def check_approval(cap: float | None, committed: float, add_cost: float, override: bool) -> tuple[bool, str]:
    """May this request be approved? Exceeding the cap requires an explicit override."""
    if not cap or cap <= 0:
        return True, "no spend cap set"
    projected = round(committed + max(0.0, add_cost), 2)
    if projected <= cap:
        return True, f"within cap (${projected:,.0f} of ${cap:,.0f}/mo)"
    if override:
        return True, f"over cap by ${projected - cap:,.0f}/mo (override)"
    return False, (f"Approving brings AI spend to ${projected:,.0f}/mo, over your ${cap:,.0f}/mo cap. "
                   "Approve with override, or raise the cap.")
