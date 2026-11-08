"""One-off: extend every catalog tool's `trust` block to the Phase 2 keys, keeping existing values.

Usage (from backend/):  .venv/Scripts/python -m scripts.extend_trust_schema
Optional: --apply-sourced data/trust_sourced.json  merges a reviewed {tool_id: {key: {status, source_url, as_of, quote}}}
"""
import json
import sys

from config import DATA_DIR

TRUST_KEYS = ["soc2", "hipaa", "gdpr", "iso27001", "no_training_on_customer_data", "retention", "data_residency", "opt_out"]
UNKNOWN = {"status": "unknown", "source_url": None, "as_of": None, "quote": None}


def main():
    path = DATA_DIR / "catalog.json"
    cat = json.loads(path.read_text("utf-8"))
    sourced = {}
    if "--apply-sourced" in sys.argv:
        sourced = json.loads((DATA_DIR / sys.argv[sys.argv.index("--apply-sourced") + 1].split("/")[-1]).read_text("utf-8"))
    for t in cat:
        old = t.get("trust") or {}
        new = {}
        for k in TRUST_KEYS:
            v = dict(UNKNOWN)
            v.update({kk: vv for kk, vv in (old.get(k) or {}).items() if kk in UNKNOWN})
            new[k] = v
        for k, v in (sourced.get(t["id"]) or {}).items():
            assert k in TRUST_KEYS, k
            new[k] = {"status": v["status"], "source_url": v["source_url"], "as_of": v["as_of"], "quote": v["quote"]}
        t["trust"] = new
    path.write_text(json.dumps(cat, indent=1, ensure_ascii=False) + "\n", "utf-8")
    print(f"trust schema extended for {len(cat)} tools; sourced patches for {len(sourced)} tools")


if __name__ == "__main__":
    main()
