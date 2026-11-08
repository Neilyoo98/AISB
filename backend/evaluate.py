"""Deterministic evaluation math for Compare: weighted scorecard, TCO and integration checks.

Pure functions only (no I/O, no LLM). Unknown data is scored neutrally AND flagged `no_data`, never guessed.
"""
CRITERIA = ["cost", "ease", "fit", "security", "scalability", "support"]
PRESETS = {
    "balanced": {"cost": 20, "ease": 20, "fit": 20, "security": 15, "scalability": 10, "support": 15},
    "budget_first": {"cost": 40, "ease": 20, "fit": 15, "security": 10, "scalability": 5, "support": 10},
    "security_first": {"cost": 10, "ease": 15, "fit": 15, "security": 40, "scalability": 10, "support": 10},
}
TRUST_POINTS = {"verified": 10, "vendor_claimed": 7}


def _clamp(x, lo=0.0, hi=10.0):
    return max(lo, min(hi, x))


def norm_tool_name(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def normalize_weights(w: dict | None) -> dict:
    """Integer weights over CRITERIA summing to exactly 100 (largest-remainder rounding)."""
    raw = {c: max(0.0, float((w or {}).get(c, 0) or 0)) for c in CRITERIA}
    total = sum(raw.values())
    if total <= 0:
        return dict(PRESETS["balanced"])
    exact = {c: raw[c] * 100 / total for c in CRITERIA}
    out = {c: int(exact[c]) for c in CRITERIA}
    for c in sorted(CRITERIA, key=lambda c: exact[c] - out[c], reverse=True)[: 100 - sum(out.values())]:
        out[c] += 1
    return out


def integration_status(tool: dict, current_tools: list[str]) -> dict:
    """For each tool the owner already uses: native / via_zapier_or_make / none."""
    integ = {norm_tool_name(i) for i in tool.get("integrates_with", [])}
    via = bool(integ & {"zapier", "make"})
    links = []
    for c in dict.fromkeys(norm_tool_name(t) for t in current_tools):
        if not c or c == tool["id"]:
            continue
        status = "native" if c in integ else ("via_zapier_or_make" if via else "none")
        links.append({"tool": c, "status": status})
    counts = {s: sum(1 for l in links if l["status"] == s) for s in ("native", "via_zapier_or_make", "none")}
    return {"links": links, **counts, "total": len(links), "missing": [l["tool"] for l in links if l["status"] == "none"]}


def tco(tool: dict, seats: int = 1, months: int = 12, usage_per_month: float = 0, hourly_cost: float = 25.0,
        hosting_monthly: float = 0.0) -> dict:
    """Total cost of ownership: subscription (incl. extra seats) + usage overage + one-time setup time + hosting."""
    seats, months = max(1, int(seats)), max(1, int(months))
    base = float(tool.get("price_monthly_typical", 0))
    model = tool.get("pricing_model", "flat")
    unit_price = float(tool.get("unit_price") or 0)
    sub_monthly = base
    if model == "per_seat":
        sub_monthly += max(0, seats - int(tool.get("seats_included") or 1)) * unit_price
    usage_monthly = 0.0
    if model == "usage":
        usage_monthly = max(0.0, float(usage_per_month) - float(tool.get("units_included") or 0)) * unit_price
    setup = float(tool.get("setup_hours", 0)) * hourly_cost
    out = {
        "monthly": round(sub_monthly + usage_monthly + hosting_monthly, 2),
        "subscription": round(sub_monthly * months, 2),
        "usage": round(usage_monthly * months, 2),
        "setup": round(setup, 2),
        "hosting": round(hosting_monthly * months, 2),
        "months": months,
    }
    out["total"] = round(out["subscription"] + out["usage"] + out["setup"] + out["hosting"], 2)
    return out


def score_tool(tool: dict, profile: dict | None, weights: dict | None, reviews_agg: dict | None = None) -> dict:
    """0-10 per criterion + weighted total. Missing data -> neutral 5 with no_data=True."""
    profile = profile or {}
    w = normalize_weights(weights)
    price = float(tool.get("price_monthly_typical", 0))
    budget = float(profile.get("monthly_budget") or 0)
    crit: dict[str, dict] = {}

    if price == 0:
        crit["cost"] = {"score": 10.0, "why": "free"}
    elif budget > 0:
        crit["cost"] = {"score": _clamp(10 * (1 - price / budget)) if price <= budget else 0.0,
                        "why": f"${price:.0f} of your ${budget:.0f}/mo budget"}
    else:
        crit["cost"] = {"score": _clamp(10 - price / 40), "why": f"${price:.0f}/mo"}

    comfort = int(profile.get("tech_comfort") or 3)
    gap = int(tool.get("tech_comfort_min", 1)) - comfort
    setup_h = float(tool.get("setup_hours", 0))
    crit["ease"] = {"score": _clamp(10 - max(0, gap) * 3 - min(3.0, setup_h / 2)),
                    "why": f"~{setup_h:g}h setup, needs comfort {tool.get('tech_comfort_min', 1)}/5"}

    current = profile.get("current_tools") or []
    integ = integration_status(tool, current)
    if integ["total"] == 0:
        crit["fit"] = {"score": 5.0, "no_data": True, "why": "tell us your current tools"}
    else:
        crit["fit"] = {"score": round(10 * (integ["native"] + 0.5 * integ["via_zapier_or_make"]) / integ["total"], 1),
                       "why": f"connects to {integ['native']}/{integ['total']} of your tools natively"}

    trust = tool.get("trust") or {}
    # Security = sourced claims for SOC 2, (GDPR or ISO 27001), and no-training-on-your-data. Unknown -> neutral.
    groups = [["soc2"], ["gdpr", "iso27001"], ["no_training_on_customer_data"]]
    pts = [max((TRUST_POINTS.get((trust.get(k) or {}).get("status"), 0) for k in g), default=0) for g in groups]
    known = [p for p in pts if p > 0]
    if known:
        # unconfirmed groups count as a neutral 5 so one sourced fact can't max out the score
        crit["security"] = {"score": round(sum(p if p > 0 else 5 for p in pts) / len(groups), 1),
                            "why": f"{len(known)}/{len(groups)} security facts sourced from the vendor"}
    else:
        crit["security"] = {"score": 5.0, "no_data": True, "why": "not yet verified"}

    scal = (4 if tool.get("api_available") else 0) + 3 + (3 if tool.get("pricing_model") in ("per_seat", "usage") else 2)
    crit["scalability"] = {"score": float(scal), "why": ("has API" if tool.get("api_available") else "no public API")
                           + f", {tool.get('pricing_model', 'flat').replace('_', ' ')} pricing"}

    sup = (reviews_agg or {}).get("support")
    if sup:
        crit["support"] = {"score": round(_clamp(sup * 2), 1), "why": f"{sup:.1f}/5 from {reviews_agg.get('count', 0)} reviews"}
    else:
        crit["support"] = {"score": 5.0, "no_data": True, "why": "no reviews yet"}

    for c in crit.values():
        c["score"] = round(float(c["score"]), 1)
        c.setdefault("no_data", False)
    total = round(sum(crit[c]["score"] * w[c] for c in CRITERIA) / 100, 1)
    return {"criteria": crit, "weights": w, "total": total, "integration": integ}
