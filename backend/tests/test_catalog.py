import json
from pathlib import Path

from graphs.state import PAIN_TAGS, VERTICALS

DATA = Path(__file__).parents[1] / "data"
CATALOG = json.loads((DATA / "catalog.json").read_text("utf-8"))
REQUIRED = {"id", "name", "url", "category", "verticals", "solves", "ai_features", "description",
            "price_monthly_min", "price_monthly_typical", "free_tier", "setup_hours", "tech_comfort_min",
            "integrates_with", "pros", "cons"}


def test_catalog_entries_are_complete_and_unique():
    ids = [t["id"] for t in CATALOG]
    assert len(ids) == len(set(ids))
    for t in CATALOG:
        assert REQUIRED <= t.keys(), t["id"]
        assert t["url"].startswith("https://")
        assert set(t["solves"]) <= set(PAIN_TAGS), (t["id"], set(t["solves"]) - set(PAIN_TAGS))
        assert set(t["verticals"]) <= set(VERTICALS) | {"all"}, t["id"]
        assert 1 <= t["tech_comfort_min"] <= 5
        assert t["price_monthly_min"] <= t["price_monthly_typical"]


def test_every_pain_tag_has_a_tool():
    covered = {s for t in CATALOG for s in t["solves"]}
    assert set(PAIN_TAGS) <= covered, set(PAIN_TAGS) - covered


def test_recordings_only_reference_catalog_tools():
    ids = {t["id"] for t in CATALOG}
    for f in (DATA / "demo_runs").glob("*.json"):
        rec = json.loads(f.read_text("utf-8"))["result"]
        assert set(rec["stack"]["tool_ids"]) <= ids, f.name
        assert {s["tool_id"] for s in rec["scored"]} <= ids, f.name
