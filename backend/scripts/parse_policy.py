"""Offline: extract privacy facts from a vendor policy with the fast model, for HUMAN REVIEW. Never runs at runtime.

Usage (from backend/):
  .venv/Scripts/python -m scripts.parse_policy <tool_id> --url https://vendor.com/privacy
  .venv/Scripts/python -m scripts.parse_policy <tool_id> --text policy.txt --source-url https://vendor.com/privacy

Prints a suggested `trust` patch (status vendor_claimed, each with a verbatim quote). A reviewer checks every quote
against the page before adding it to data/trust_sourced.json. Fields the model can't quote stay out of the patch.
"""
import argparse
import asyncio
import json
import re
from datetime import date
from typing import Literal, Optional

import httpx
from pydantic import BaseModel, Field

import db
from llm import call_json

MAX_CHARS = 60_000


class Fact(BaseModel):
    value: str = Field(description="yes | no | unclear | short text (e.g. '30 days', 'US and EU')")
    quote: Optional[str] = Field(default=None, description="verbatim sentence fragment from the policy, max 25 words; null if none")


class PolicyFacts(BaseModel):
    trains_on_customer_data: Fact
    retention: Fact
    data_residency: Fact
    indemnity: Fact
    opt_out: Fact


SYSTEM = """You read a software vendor's privacy policy or terms and extract facts. Quote verbatim (copy exact words,
max 25 words). If the policy does not clearly state something, value='unclear' and quote=null. Never infer."""

# policy field -> catalog trust key (indemnity has no catalog field yet; printed for the reviewer only)
MAP = {"retention": "retention", "data_residency": "data_residency", "opt_out": "opt_out"}


def _text_from_html(html: str) -> str:
    html = re.sub(r"(?is)<(script|style|noscript).*?</\1>", " ", html)
    return re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", html)).strip()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("tool_id")
    ap.add_argument("--url")
    ap.add_argument("--text")
    ap.add_argument("--source-url")
    a = ap.parse_args()
    db.init_db()
    if a.url:
        r = httpx.get(a.url, follow_redirects=True, timeout=30, headers={"User-Agent": "StackSmith-catalog-review"})
        r.raise_for_status()
        text, src = _text_from_html(r.text), a.url
    else:
        text, src = open(a.text, encoding="utf-8").read(), a.source_url
    if not src or not src.startswith("https://"):
        raise SystemExit("A https source URL is required (--url or --source-url).")
    facts = await call_json(tier="fast", system=SYSTEM, user=text[:MAX_CHARS], schema=PolicyFacts,
                            node="parse_policy", max_tokens=1200)
    print(json.dumps(facts.model_dump(), indent=1))
    patch = {}
    for field, f in facts.model_dump().items():
        if not f["quote"] or f["value"] == "unclear":
            continue
        if field == "trains_on_customer_data":
            if f["value"].lower() == "no":
                patch["no_training_on_customer_data"] = {"status": "vendor_claimed", "source_url": src,
                                                         "as_of": date.today().isoformat(), "quote": f["quote"]}
        elif field in MAP:
            patch[MAP[field]] = {"status": "vendor_claimed", "source_url": src, "as_of": date.today().isoformat(),
                                 "quote": f["quote"]}
    print("\nSuggested patch for data/trust_sourced.json (verify every quote on the page first):")
    print(json.dumps({a.tool_id: patch}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
