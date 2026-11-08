import copy
import json
from pathlib import Path

import risk

CAT = {t["id"]: t for t in json.loads((Path(__file__).parents[1] / "data" / "catalog.json").read_text("utf-8"))}
LEVELS = {"low", "medium", "high", "not_assessed"}


def test_every_tool_gets_all_four_ratings_with_reasons():
    for t in CAT.values():
        r = risk.assess(t)
        assert set(r) == {"hallucination", "bias", "prompt_injection", "data_exfiltration"}
        for v in r.values():
            assert v["level"] in LEVELS and v["reason"] and v["basis"], t["id"]


def test_generative_output_is_medium_hallucination():
    assert risk.assess(CAT["chatgpt-business"])["hallucination"]["level"] == "medium"
    assert risk.assess(CAT["canva-pro"])["hallucination"]["level"] == "medium"


def test_call_answering_agent_has_injection_exposure():
    assert risk.assess(CAT["rosie"])["prompt_injection"]["level"] == "medium"


def test_bias_only_for_people_decisions():
    assert risk.assess(CAT["7shifts"])["bias"]["level"] == "medium"
    assert risk.assess(CAT["jobber"])["bias"]["level"] == "not_assessed"


def test_customer_data_exfiltration_drops_with_sourced_soc2():
    t = copy.deepcopy(CAT["jobber"])
    t["trust"]["soc2"] = {"status": "unknown", "source_url": None, "as_of": None, "quote": None}
    assert risk.assess(t)["data_exfiltration"]["level"] == "medium"
    t["trust"]["soc2"] = {"status": "vendor_claimed", "source_url": "https://x.example", "as_of": "2026-11-08", "quote": "q"}
    assert risk.assess(t)["data_exfiltration"]["level"] == "low"


def test_non_agent_platform_has_no_injection_rating():
    assert risk.assess(CAT["yardbook"])["prompt_injection"]["level"] == "not_assessed"
