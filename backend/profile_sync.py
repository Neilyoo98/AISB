"""Pure helpers: turn the owner's edited profile answers into the structured profile + Constitution facts.

Deterministic on purpose: what the owner types wins over anything the AI inferred earlier.
"""
from categories import CATEGORIES, CATEGORY_IDS, DEFAULT_VERTICAL, category_for_vertical

CATEGORY_LABELS = {c["id"]: c["label"] for c in CATEGORIES}

BUDGETS = {"under $50": 50.0, "about $100": 100.0, "about $200": 200.0, "about $300": 300.0, "$500+": 500.0}
SECURITY_LABELS = {"no_training": "No training on our data", "soc2": "SOC 2"}


def parse_budget(choice: str | None) -> float | None:
    if not choice:
        return None
    key = choice.strip().lower()
    for k, v in BUDGETS.items():
        if k.lower() == key:
            return v
    digits = "".join(ch for ch in key if ch.isdigit() or ch == ".")
    try:
        return float(digits) if digits else None
    except ValueError:
        return None


def norm_tool(name: str) -> str:
    return "-".join(name.strip().lower().split())


def sync_profile(profile: dict | None, details: dict, *, name: str | None = None, location: str | None = None) -> dict:
    """Return a new profile dict with the owner's answers applied (profile=None for a business never analyzed)."""
    p = dict(profile or {})
    p.setdefault("vertical", "other")
    p.setdefault("employees", 0)
    p.setdefault("monthly_budget", 0.0)
    p.setdefault("tech_comfort", 3)
    p.setdefault("current_tools", [])
    p.setdefault("summary", "")
    if name:
        p["business_name"] = name
    if location is not None:
        p["location"] = location or None

    cat = details.get("business_category")
    if cat in CATEGORY_IDS:
        p["business_category"] = cat
        if category_for_vertical(p.get("vertical")) != cat:
            p["vertical"] = DEFAULT_VERTICAL[cat]
    else:
        p["business_category"] = category_for_vertical(p.get("vertical"))

    budget = parse_budget(details.get("budget"))
    if budget is not None:
        p["monthly_budget"] = budget
    if details.get("tech_comfort"):
        p["tech_comfort"] = max(1, min(5, int(details["tech_comfort"])))
    if details.get("team_size"):
        p["employees"] = int(details["team_size"])
    if "current_tools" in details and details["current_tools"] is not None:
        p["current_tools"] = list(dict.fromkeys(n for n in (norm_tool(t) for t in details["current_tools"]) if n))
    p["security_must_haves"] = [m for m in details.get("security_must_haves") or [] if m in SECURITY_LABELS]
    p["goals"] = list(details.get("goals") or [])[:6]
    return p


def facts_from_details(details: dict, profile: dict) -> list[dict]:
    """Business Constitution facts that mirror what the owner told us (confidence 1.0: owner-stated)."""
    facts = []

    def add(pred, obj, cat):
        facts.append({"subject": "business", "predicate": pred, "object": str(obj), "category": cat, "confidence": 1.0})

    if profile.get("business_category"):
        add("is in category", CATEGORY_LABELS.get(profile["business_category"], profile["business_category"]), "identity")
    if details.get("team_size"):
        add("has team size", details["team_size"], "identity")
    if details.get("budget"):
        add("monthly software budget", details["budget"], "budget")
    if details.get("tech_comfort"):
        add("tech comfort (1-5)", details["tech_comfort"], "tech_comfort")
    for t in profile.get("current_tools") or []:
        add("uses", t, "current_tools")
    for g in details.get("goals") or []:
        add("goal", g, "goal")
    for m in profile.get("security_must_haves") or []:
        add("requires", SECURITY_LABELS[m], "goal")
    return facts
