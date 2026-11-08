"""Deterministic AI risk matrix for a catalog tool. Pure, no I/O, no LLM, no invented benchmark numbers.

Every rating is derived from catalog facts (capability, category, solves, trust statuses) and says which facts it used.
"""
SOURCED = {"verified", "vendor_claimed"}
CUSTOMER_DATA_CATEGORIES = {"pos", "bookkeeping", "field_service", "email_marketing", "booking", "reviews",
                            "customer_chat", "ai_receptionist", "business_phone", "online_ordering"}
PAYMENT_SOLVES = {"invoicing_payments", "bookkeeping", "online_ordering"}
PEOPLE_DECISION_SOLVES = {"staff_scheduling"}
ACTS_ON_MESSAGES_SOLVES = {"missed_calls", "phone_orders", "customer_chat", "customer_followup", "email_sms_marketing", "reviews"}


def _r(level: str, reason: str, basis: list[str]) -> dict:
    return {"level": level, "reason": reason, "basis": basis}


def _sourced(tool: dict, key: str) -> bool:
    return ((tool.get("trust") or {}).get(key) or {}).get("status") in SOURCED


def assess(tool: dict) -> dict:
    cap = tool.get("capability", "")
    cat = tool.get("category", "")
    solves = set(tool.get("solves", []))
    outs = set(tool.get("modalities_out", []))

    # Hallucination: anything that writes or speaks for you can state wrong things.
    if cap in ("generative", "assistant") or (cap == "automation_agent" and outs & {"text", "audio"}):
        halluc = _r("medium", "Writes or speaks content for you; review what it says to customers.",
                    [f"capability={cap}", f"outputs={sorted(outs)}"])
    elif cap == "predictive":
        halluc = _r("low", "Produces forecasts/numbers rather than free text; sanity-check outliers.", [f"capability={cap}"])
    else:
        halluc = _r("low", "Mostly records and workflows; AI text is a side feature.", [f"capability={cap}"])

    # Bias: only assessed when the tool makes decisions about people.
    if solves & PEOPLE_DECISION_SOLVES:
        bias = _r("medium", "Influences who gets shifts or hours; check schedules for fairness.",
                  [f"solves={sorted(solves & PEOPLE_DECISION_SOLVES)}"])
    else:
        bias = _r("not_assessed", "Doesn't make decisions about people.", [f"solves={sorted(solves)}"])

    # Prompt injection: agents that read and act on outside messages/calls can be manipulated.
    acts = solves & ACTS_ON_MESSAGES_SOLVES
    if cap == "automation_agent" and acts:
        inj = _r("medium", "Reads and acts on incoming calls/messages that a stranger could craft.",
                 [f"capability={cap}", f"solves={sorted(acts)}"])
    elif cap in ("generative", "assistant", "automation_agent"):
        inj = _r("low", "Uses AI on inputs you mostly control.", [f"capability={cap}"])
    else:
        inj = _r("not_assessed", "No autonomous AI acting on outside input.", [f"capability={cap}"])

    # Data exfiltration: holds customer or payment data; lower when a SOC 2 claim is sourced.
    holds = cat in CUSTOMER_DATA_CATEGORIES or bool(solves & PAYMENT_SOLVES)
    if holds and _sourced(tool, "soc2"):
        exf = _r("low", "Holds customer data, and the vendor publishes a SOC 2 claim (see Trust).",
                 [f"category={cat}", "trust.soc2 sourced"])
    elif holds:
        exf = _r("medium", "Holds customer or payment data; no sourced SOC 2 claim yet. Ask the vendor.",
                 [f"category={cat}", "trust.soc2 unknown"])
    else:
        exf = _r("low", "Mainly your own content, little customer data.", [f"category={cat}"])

    return {"hallucination": halluc, "bias": bias, "prompt_injection": inj, "data_exfiltration": exf}
