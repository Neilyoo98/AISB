"""General business categories shown in the UI (never overly specific business types)."""

CATEGORIES = [
    {"id": "food_drink", "label": "Food & drink", "verticals": ["cafe", "restaurant"]},
    {"id": "home_field", "label": "Home & field services", "verticals": ["hvac", "landscaping", "home_services"]},
    {"id": "beauty_wellness", "label": "Beauty & wellness", "verticals": ["salon"]},
    {"id": "retail", "label": "Retail & e-commerce", "verticals": ["retail"]},
    {"id": "professional", "label": "Professional & office", "verticals": []},
    {"id": "other", "label": "Other", "verticals": ["other"]},
]
CATEGORY_IDS = [c["id"] for c in CATEGORIES]
_BY_VERTICAL = {v: c["id"] for c in CATEGORIES for v in c["verticals"]}

# when a business picks a general category but has no analyzed profile yet
DEFAULT_VERTICAL = {"food_drink": "restaurant", "home_field": "home_services", "beauty_wellness": "salon",
                    "retail": "retail", "professional": "other", "other": "other"}


def category_for_vertical(vertical: str | None) -> str:
    return _BY_VERTICAL.get(vertical or "", "other")


def categories_for_tool(tool: dict) -> list[str]:
    verticals = tool.get("verticals") or []
    if "all" in verticals:
        return list(CATEGORY_IDS)
    return [c for c in CATEGORY_IDS if c in {category_for_vertical(v) for v in verticals}]


def with_categories(tool: dict) -> dict:
    return tool | {"categories": categories_for_tool(tool)}
