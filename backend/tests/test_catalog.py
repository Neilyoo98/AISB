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


CAPABILITIES = {"generative", "predictive", "automation_agent", "assistant", "platform"}
MODALITIES = {"text", "audio", "image", "video", "tabular"}
TRUST_STATUS = {"vendor_claimed", "verified", "unknown"}


def test_taxonomy_and_pricing_fields():
    for t in CATALOG:
        assert t["capability"] in CAPABILITIES, t["id"]
        assert t["modalities_in"] and set(t["modalities_in"]) <= MODALITIES, t["id"]
        assert t["modalities_out"] and set(t["modalities_out"]) <= MODALITIES, t["id"]
        assert 1 <= len(t["workflows"]) <= 6, t["id"]
        assert t["deployment"] in {"saas", "vpc", "on_prem"}
        assert isinstance(t["api_available"], bool)
        assert t["pricing_model"] in {"flat", "per_seat", "usage"}
        if t["pricing_model"] != "flat":
            assert t["unit"] and t["unit_price"] and t["unit_price"] > 0, t["id"]
        if t["pricing_model"] == "usage":
            assert t["units_included"] is not None, t["id"]
        assert t["seats_included"] >= 1


def test_trust_fields_are_honest():
    for t in CATALOG:
        assert set(t["trust"]) == {"no_training_on_customer_data", "soc2"}, t["id"]
        for k, v in t["trust"].items():
            assert v["status"] in TRUST_STATUS, (t["id"], k)
            if v["status"] != "unknown":  # a claim must say where it came from and when
                assert v["source_url"] and v["source_url"].startswith("https://") and v["as_of"], (t["id"], k)
