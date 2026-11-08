"""One-off: suggest taxonomy + pricing-model fields for every catalog tool with the fast model.

Never called at runtime. Writes data/catalog.suggested.json for HUMAN REVIEW; a reviewer hand-fixes it and
merges with:  python -m scripts.enrich_catalog --apply
Trust fields are NOT suggested by the model (no fabricated trust data) - they are added as `unknown`.

Usage (from backend/):
  .venv/Scripts/python -m scripts.enrich_catalog            # writes data/catalog.suggested.json
  .venv/Scripts/python -m scripts.enrich_catalog --apply    # merges reviewed suggestions into catalog.json
"""
import asyncio
import json
import sys
from typing import Literal, Optional

from pydantic import BaseModel, Field

import db
from config import DATA_DIR
from llm import call_json

Capability = Literal["generative", "predictive", "automation_agent", "assistant", "platform"]
Modality = Literal["text", "audio", "image", "video", "tabular"]


class Suggestion(BaseModel):
    capability: Capability
    modalities_in: list[Modality]
    modalities_out: list[Modality]
    workflows: list[str] = Field(description="2-4 short verb phrases, e.g. 'answer inbound calls', 'send quotes'")
    deployment: Literal["saas", "vpc", "on_prem"]
    api_available: bool
    pricing_model: Literal["flat", "per_seat", "usage"]
    unit: Optional[str] = Field(default=None, description="for per_seat: 'seat'; for usage: 'minute', 'call', 'contact', etc.; flat: null")
    unit_price: Optional[float] = Field(default=None, description="USD per unit beyond what's included; null if flat")
    seats_included: int = Field(ge=1, description="seats included in price_monthly_typical")
    units_included: Optional[int] = Field(default=None, description="usage units included in price_monthly_typical")


SYSTEM = """You help maintain a catalog of AI tools for small businesses. Given one catalog entry, suggest taxonomy and
pricing-model fields. Be conservative and use only well-known public facts; when unsure prefer 'saas', 'flat',
api_available=false. Do NOT invent compliance or security claims."""

KEYS = list(Suggestion.model_fields)
UNKNOWN = {"status": "unknown", "source_url": None, "as_of": None}


async def suggest():
    db.init_db()
    cat = json.loads((DATA_DIR / "catalog.json").read_text("utf-8"))
    out = {}
    for t in cat:
        slim = {k: t[k] for k in ("id", "name", "category", "description", "ai_features", "price_monthly_min",
                                  "price_monthly_typical", "free_tier")}
        s = await call_json(tier="fast", system=SYSTEM, user=json.dumps(slim), schema=Suggestion,
                            node="enrich_catalog", max_tokens=600)
        out[t["id"]] = s.model_dump()
        print(t["id"], out[t["id"]]["capability"], out[t["id"]]["pricing_model"])
    (DATA_DIR / "catalog.suggested.json").write_text(json.dumps(out, indent=1), "utf-8")
    print(f"wrote catalog.suggested.json - review it, then run with --apply (spend ${db.total_spend():.4f})")


def apply():
    cat = json.loads((DATA_DIR / "catalog.json").read_text("utf-8"))
    sug = json.loads((DATA_DIR / "catalog.suggested.json").read_text("utf-8"))
    for t in cat:
        for k in KEYS:
            t[k] = sug[t["id"]][k]
        t.setdefault("trust", {"no_training_on_customer_data": dict(UNKNOWN), "soc2": dict(UNKNOWN)})
    (DATA_DIR / "catalog.json").write_text(json.dumps(cat, indent=1, ensure_ascii=False) + "\n", "utf-8")
    print(f"applied suggestions to {len(cat)} tools")


if __name__ == "__main__":
    apply() if "--apply" in sys.argv else asyncio.run(suggest())
