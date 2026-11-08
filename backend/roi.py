"""Deterministic ROI math. The LLM supplies *estimates*; every number shown to the owner is computed here.

Glossary
- pain.hours_per_week: owner/staff hours lost to this pain each week
- pain.hourly_cost: what an hour of that time is worth ($)
- pain.revenue_at_risk_monthly: revenue lost each month because of the pain ($)
- tool estimate pct_time_saved / pct_revenue_recovered: 0..1 share of the pain the tool removes
"""
from dataclasses import dataclass, asdict

WEEKS_PER_MONTH = 4.33


@dataclass
class ToolROI:
    tool_id: str
    pain_id: str
    monthly_cost: float
    hours_saved_per_month: float
    time_value_monthly: float
    revenue_recovered_monthly: float
    monthly_value: float
    net_monthly: float
    setup_cost: float
    payback_days: float | None
    roi_multiple: float | None
    fit_score: int
    fit_breakdown: dict

    def to_dict(self):
        return asdict(self)


def _clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, float(x)))


def compute_tool_roi(*, tool: dict, pain: dict, estimate: dict, profile: dict, critiques: list[dict]) -> ToolROI:
    hours = max(0.0, float(pain.get("hours_per_week", 0)))
    hourly = max(0.0, float(pain.get("hourly_cost", 0)))
    rev_risk = max(0.0, float(pain.get("revenue_at_risk_monthly", 0)))
    pct_time = _clamp(estimate.get("pct_time_saved", 0))
    pct_rev = _clamp(estimate.get("pct_revenue_recovered", 0))

    monthly_cost = float(tool.get("price_monthly_typical", 0))
    hours_saved = hours * WEEKS_PER_MONTH * pct_time
    time_value = hours_saved * hourly
    rev_recovered = rev_risk * pct_rev
    monthly_value = round(time_value + rev_recovered)  # round once so displayed figures add up
    net = monthly_value - monthly_cost
    setup_cost = float(tool.get("setup_hours", 0)) * (hourly or 25.0)

    daily_value = monthly_value / 30.0
    payback = None
    if daily_value > 0:
        # payback = (setup effort + first month's bill) recovered by daily value
        payback = round((setup_cost + monthly_cost) / daily_value, 1)
    roi_multiple = round(monthly_value / monthly_cost, 1) if monthly_cost > 0 else None

    # ---- fit score (0..100) ----
    budget = float(profile.get("monthly_budget", 0) or 0)
    comfort = int(profile.get("tech_comfort", 3) or 3)
    current = {t.lower() for t in profile.get("current_tools", [])}

    value_pts = 40 * _clamp(net / max(monthly_cost, 50.0) / 4.0)  # net = 4x cost (or $200) -> full marks
    budget_pts = 20 if budget <= 0 or monthly_cost <= budget * 0.6 else (10 if monthly_cost <= budget else 0)
    gap = int(tool.get("tech_comfort_min", 1)) - comfort
    comfort_pts = 20 if gap <= 0 else (10 if gap == 1 else 0)
    integ = {i.lower() for i in tool.get("integrates_with", [])}
    integ_pts = 10 if integ & current or tool["id"] in current else 5
    sev = {"low": 2, "medium": 5, "high": 10}
    penalty = sum(sev.get(c.get("severity", "low"), 2) for c in critiques if c.get("tool_id") == tool["id"])
    critique_pts = max(0, 10 - penalty)

    fit = round(value_pts + budget_pts + comfort_pts + integ_pts + critique_pts)
    return ToolROI(
        tool_id=tool["id"], pain_id=pain["id"], monthly_cost=round(monthly_cost, 2),
        hours_saved_per_month=round(hours_saved, 1), time_value_monthly=round(time_value),
        revenue_recovered_monthly=round(rev_recovered), monthly_value=round(monthly_value),
        net_monthly=round(net), setup_cost=round(setup_cost), payback_days=payback, roi_multiple=roi_multiple,
        fit_score=int(max(0, min(100, fit))),
        fit_breakdown={"value": round(value_pts), "budget": budget_pts, "ease": comfort_pts,
                       "integration": integ_pts, "advisor_concerns": critique_pts},
    )


def pick_stack(scored: list[ToolROI], budget: float) -> tuple[list[str], dict]:
    """Best tool per pain by fit score; if over budget, swap in cheaper runners-up, then drop lowest net."""
    by_pain: dict[str, list[ToolROI]] = {}
    for s in scored:
        by_pain.setdefault(s.pain_id, []).append(s)
    for lst in by_pain.values():
        lst.sort(key=lambda s: (s.fit_score, s.net_monthly), reverse=True)

    # Per pain: among tools within 10 fit points of the best fit, take the highest net value.
    choice = {}
    for p, lst in by_pain.items():
        window = [s for s in lst if s.fit_score >= lst[0].fit_score - 10 and s.net_monthly > 0]
        if window:
            choice[p] = max(window, key=lambda s: (s.net_monthly, s.fit_score))

    # Consolidate: owners hate juggling apps. Try removing each tool and moving its pains onto tools already
    # in the stack; keep the removal whenever the stack's total net (value - unique costs) doesn't drop.
    def portfolio_net(ch):
        return sum(s.monthly_value for s in ch.values()) - sum({s.tool_id: s.monthly_cost for s in ch.values()}.values())

    improved = True
    while improved and len({s.tool_id for s in choice.values()}) > 1:
        improved = False
        for tool in sorted({s.tool_id for s in choice.values()}):
            keep = {s.tool_id for s in choice.values()} - {tool}
            trial = {}
            for p, cur in choice.items():
                if cur.tool_id != tool:
                    trial[p] = cur
                    continue
                alts = [s for s in by_pain[p] if s.tool_id in keep]
                if alts:
                    trial[p] = max(alts, key=lambda s: s.monthly_value)
            if trial and portfolio_net(trial) >= portfolio_net(choice):
                choice, improved = trial, True
                break

    # the same tool can solve two pains -- count its cost once
    def total(ch):
        return sum({s.tool_id: s.monthly_cost for s in ch.values()}.values())

    if budget > 0:
        for _ in range(10):
            if total(choice) <= budget:
                break
            # try cheaper alternative for the priciest pick
            p_exp = max(choice, key=lambda p: choice[p].monthly_cost)
            alts = [s for s in by_pain[p_exp] if s.monthly_cost < choice[p_exp].monthly_cost and s.net_monthly > 0]
            if alts:
                choice[p_exp] = alts[0]
            else:
                del choice[min(choice, key=lambda p: choice[p].net_monthly)]

    tool_ids = list(dict.fromkeys(s.tool_id for s in choice.values()))
    seen, value, cost, hours = set(), 0.0, 0.0, 0.0
    for s in choice.values():
        value += s.monthly_value
        hours += s.hours_saved_per_month
        if s.tool_id not in seen:
            cost += s.monthly_cost
            seen.add(s.tool_id)
    summary = {
        "monthly_cost": round(cost), "monthly_value": round(value), "net_monthly": round(value - cost),
        "hours_saved_per_month": round(hours, 1), "within_budget": budget <= 0 or cost <= budget,
        "budget": budget, "picks": {p: s.tool_id for p, s in choice.items()},
    }
    return tool_ids, summary
