import json
from pathlib import Path

from categories import CATEGORIES, CATEGORY_IDS, DEFAULT_VERTICAL, categories_for_tool, category_for_vertical, with_categories
from graphs.state import VERTICALS

CATALOG = json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))


def test_every_internal_vertical_maps_to_one_general_category():
    for v in VERTICALS:
        assert category_for_vertical(v) in CATEGORY_IDS
    assert category_for_vertical("hvac") == "home_field"
    assert category_for_vertical("cafe") == category_for_vertical("restaurant") == "food_drink"
    assert category_for_vertical(None) == "other" and category_for_vertical("spaceship") == "other"
    assert len({c["id"] for c in CATEGORIES}) == len(CATEGORIES)


def test_default_vertical_round_trips():
    for cat, v in DEFAULT_VERTICAL.items():
        assert category_for_vertical(v) == cat or cat == "professional"


def test_tool_categories():
    assert categories_for_tool({"verticals": ["all"]}) == CATEGORY_IDS
    assert categories_for_tool({"verticals": ["hvac", "landscaping"]}) == ["home_field"]
    assert set(categories_for_tool({"verticals": ["cafe", "salon"]})) == {"food_drink", "beauty_wellness"}
    for t in CATALOG:
        cats = with_categories(t)["categories"]
        assert cats and set(cats) <= set(CATEGORY_IDS), t["id"]
