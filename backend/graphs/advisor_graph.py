"""StackSmith advisor graph (LangGraph), modeled on AUBI's incident graph.

intake_parser -> memory_recall -> pain_diagnoser -> tool_scout x N (Send) -> advisor_mesh
-> roi_comparator -> approval_gate (interrupt) -> adoption_planner -> memory_writeback
"""
import asyncio
import json
import logging

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, Send, interrupt

import db
import roi
from graphs import prompts as P
from graphs.events import channel, emit
from graphs.state import (AdvisorState, DiagnoseOut, IntakeOut, MeshOut, PlanOut, ScoutOut, VerdictOut)
from llm import BudgetExceeded, LLMError, call_json
from memory import store

log = logging.getLogger("graph")

SECURITY_FIELDS = {"no_training": "no_training_on_customer_data", "soc2": "soc2"}
SECURITY_LABELS = {"no_training": "No training on our data", "soc2": "SOC 2"}


def _j(x) -> str:
    return json.dumps(x, ensure_ascii=False)


# ---------------- nodes ----------------

async def intake_parser(state: AdvisorState):
    rid = state["run_id"]
    await emit(rid, "agent.start", {"label": "Reading the owner's story"}, agent="intake")
    out = await call_json(tier="fast", system=P.INTAKE_SYSTEM, node="intake_parser", run_id=rid,
                          user=f"Business name: {state.get('business_name') or 'unknown'}\n\nOwner's description:\n{state['raw_input']}",
                          schema=IntakeOut, max_tokens=1800)
    profile = out.profile.model_dump()
    if state.get("business_name") and not profile.get("business_name"):
        profile["business_name"] = state["business_name"]
    # structured answers win over LLM inference (deterministic)
    det = state.get("details") or {}
    profile["security_must_haves"] = [m for m in det.get("security_must_haves", []) if m in SECURITY_FIELDS]
    profile["goals"] = list(det.get("goals", []))[:4]
    for t in det.get("current_tools", []):
        n = t.strip().lower().replace(" ", "-")
        if n and n not in profile["current_tools"]:
            profile["current_tools"].append(n)
    facts = [f.model_dump() for f in out.facts]
    await emit(rid, "intake.done", {"profile": profile, "raw_pains": [p.model_dump() for p in out.raw_pains],
                                    "facts": facts}, agent="intake")
    return {"profile": profile, "facts": facts, "pains": [p.model_dump() for p in out.raw_pains]}


async def memory_recall(state: AdvisorState):
    rid, bid = state["run_id"], state["business_id"]
    await emit(rid, "agent.start", {"label": "Checking the Business Constitution"}, agent="memory")
    prior_facts = await asyncio.to_thread(store.get_facts, bid)
    own_eps = await asyncio.to_thread(store.business_episodes, bid)
    query = " ".join(p["title"] for p in state.get("pains", []))
    similar = await asyncio.to_thread(store.similar_episodes, query or state["profile"]["summary"],
                                      state["profile"]["vertical"], bid)
    memory = {"prior_facts": prior_facts[:30], "own_episodes": own_eps, "similar_businesses": similar}
    await emit(rid, "memory.recalled", {"prior_facts": len(prior_facts), "own_episodes": own_eps,
                                        "similar_businesses": similar}, agent="memory")
    return {"memory": memory}


async def pain_diagnoser(state: AdvisorState):
    rid = state["run_id"]
    await emit(rid, "agent.start", {"label": "Putting a dollar figure on each pain"}, agent="diagnoser")
    mem = state.get("memory", {})
    user = (f"PROFILE: {_j(state['profile'])}\nRAW PAINS: {_j(state['pains'])}\n"
            f"OWNER TEXT: {state['raw_input']}\n"
            f"PAST ADOPTIONS FOR THIS BUSINESS: {_j([e.get('text') for e in mem.get('own_episodes', [])])}")
    out = await call_json(tier="fast", system=P.DIAGNOSE_SYSTEM, node="pain_diagnoser", run_id=rid, user=user,
                          schema=DiagnoseOut, max_tokens=1500)
    pains = []
    seen = set()
    for p in out.pains[:3]:
        d = p.model_dump()
        base, i = d["id"] or d["tag"], 2
        while d["id"] in seen or not d["id"]:
            d["id"] = f"{base}-{i}"
            i += 1
        seen.add(d["id"])
        d["monthly_cost_of_pain"] = round(d["hours_per_week"] * roi.WEEKS_PER_MONTH * d["hourly_cost"]
                                          + d["revenue_at_risk_monthly"])
        pains.append(d)
    await emit(rid, "pain.ranked", {"pains": pains}, agent="diagnoser")
    return {"pains": pains}


def fan_out_scouts(state: AdvisorState):
    return [Send("tool_scout", {"run_id": state["run_id"], "profile": state["profile"], "pain": p})
            for p in state["pains"]]


async def tool_scout(payload: dict):
    rid, pain, profile = payload["run_id"], payload["pain"], payload["profile"]
    agent = f"scout:{pain['id']}"
    await emit(rid, "agent.start", {"label": f"Scouting tools for “{pain['title']}”", "pain_id": pain["id"]},
               agent=agent)
    cands = await asyncio.to_thread(store.search_tools, f"{pain['title']}. {pain['impact_explanation']}",
                                    pain_tag=pain["tag"], vertical=profile["vertical"], limit=8)
    owned = {t.lower() for t in profile.get("current_tools", [])}
    cands = [c for c in cands if c["id"] not in owned] or cands
    # Security must-haves: hard filter on SOURCED trust facts only (verified / vendor_claimed).
    must = profile.get("security_must_haves") or []
    security_unverified = False
    if must:
        ok = [c for c in cands if all((c.get("trust") or {}).get(SECURITY_FIELDS[m], {}).get("status")
                                      in ("verified", "vendor_claimed") for m in must)]
        security_unverified = not ok
        await emit(rid, "guard.security", {"pain_id": pain["id"], "required": [SECURITY_LABELS[m] for m in must],
                                           "confirmed": [c["id"] for c in ok], "unverified": security_unverified},
                   agent=agent)
        if ok:
            cands = ok
    cand_ids = {c["id"] for c in cands}
    slim = [{k: c[k] for k in ("id", "name", "category", "verticals", "solves", "ai_features", "description",
                               "price_monthly_typical", "free_tier", "setup_hours", "tech_comfort_min",
                               "integrates_with", "cons")} for c in cands]
    picks, dropped = [], []
    try:
        out = await call_json(tier="fast", system=P.SCOUT_SYSTEM, node="tool_scout", run_id=rid, schema=ScoutOut,
                              user=f"PAIN: {_j(pain)}\nPROFILE: {_j(profile)}\nCANDIDATES: {_j(slim)}",
                              max_tokens=1200)
        for pk in out.picks[:3]:
            (picks if pk.tool_id in cand_ids else dropped).append(pk.model_dump())
    except (LLMError, BudgetExceeded) as e:
        log.warning("scout fallback for %s: %s", pain["id"], e)
    if dropped:
        await emit(rid, "guard.dropped", {"pain_id": pain["id"], "tool_ids": [d["tool_id"] for d in dropped],
                                          "reason": "not in verified catalog"}, agent=agent)
    if not picks:  # deterministic fallback: top-3 search hits with conservative estimates
        picks = [{"tool_id": c["id"], "why_fit": c["description"], "pct_time_saved": 0.3,
                  "pct_revenue_recovered": 0.2, "estimate_reasoning": "conservative default"} for c in cands[:3]]
    for pk in picks:
        pk["pain_id"] = pain["id"]
        if security_unverified:
            pk["security_note"] = " / ".join(SECURITY_LABELS[m] for m in must) + ": unknown — verify with the vendor"
    await emit(rid, "scout.result", {"pain_id": pain["id"], "searched": [c["id"] for c in cands],
                                     "picks": picks}, agent=agent)
    return {"candidates": picks}


async def advisor_mesh(state: AdvisorState):
    rid = state["run_id"]
    catalog = store.load_catalog()
    by_tool: dict[str, dict] = {}
    for c in state["candidates"]:
        t = catalog[c["tool_id"]]
        entry = by_tool.setdefault(t["id"], {
            "tool_id": t["id"], "name": t["name"], "for_pains": [],
            "price_monthly_typical": t["price_monthly_typical"], "setup_hours": t["setup_hours"],
            "tech_comfort_min": t["tech_comfort_min"], "integrates_with": t["integrates_with"], "cons": t["cons"]})
        entry["for_pains"].append(c["pain_id"])
    shortlist = list(by_tool.values())
    await emit(rid, "mesh.start", {"personas": [v["name"] for v in P.MESH_PERSONAS.values()],
                                   "shortlist": [s["tool_id"] for s in shortlist]}, agent="mesh")
    user = f"PROFILE: {_j(state['profile'])}\nPAINS: {_j(state['pains'])}\nSHORTLIST: {_j(shortlist)}"
    valid = {s["tool_id"] for s in shortlist}

    async def ask(key, persona):
        try:
            out = await call_json(tier="fast", system=f"{persona['system']}\n{P.MESH_RULES}", node=f"mesh:{key}",
                                  run_id=rid, user=user, schema=MeshOut, max_tokens=900, temperature=0.5)
            crits = [c.model_dump() | {"persona": persona["name"]} for c in out.critiques[:4] if c.tool_id in valid]
            msg = {"persona": persona["name"], "key": key, "headline": out.headline, "critiques": crits}
        except (LLMError, BudgetExceeded) as e:
            log.warning("mesh %s failed: %s", key, e)
            msg = {"persona": persona["name"], "key": key, "headline": "(unavailable)", "critiques": []}
        await emit(rid, "mesh.message", msg, agent=f"mesh:{key}")
        return msg

    msgs = await asyncio.gather(*(ask(k, p) for k, p in P.MESH_PERSONAS.items()))
    critiques = [c for m in msgs for c in m["critiques"]]
    return {"critiques": critiques, "mesh": list(msgs)}


async def roi_comparator(state: AdvisorState):
    rid = state["run_id"]
    await emit(rid, "agent.start", {"label": "Computing ROI (deterministic)"}, agent="roi")
    catalog = store.load_catalog()
    pains = {p["id"]: p for p in state["pains"]}
    scored = []
    for c in state["candidates"]:
        r = roi.compute_tool_roi(tool=catalog[c["tool_id"]], pain=pains[c["pain_id"]], estimate=c,
                                 profile=state["profile"], critiques=state.get("critiques", []))
        scored.append(r)
    budget = float(state["profile"].get("monthly_budget") or 0)
    tool_ids, summary = roi.pick_stack(scored, budget)
    scored_d = [s.to_dict() | {"why_fit": c["why_fit"], "estimate_reasoning": c["estimate_reasoning"],
                               "security_note": c.get("security_note"),
                               "pct_time_saved": c["pct_time_saved"], "pct_revenue_recovered": c["pct_revenue_recovered"]}
                for s, c in zip(scored, state["candidates"])]
    stack = {"tool_ids": tool_ids, **summary}

    verdicts = {}
    try:
        rec = [{"tool": catalog[t]["name"], "tool_id": t,
                "roi": next(s for s in scored_d if s["tool_id"] == t and stack["picks"].get(s["pain_id"]) == t),
                "concerns": [c for c in state.get("critiques", []) if c["tool_id"] == t]} for t in tool_ids]
        out = await call_json(tier="smart", system=P.VERDICT_SYSTEM, node="roi_verdict", run_id=rid, schema=VerdictOut,
                              user=f"PROFILE: {_j(state['profile'])}\nSTACK TOTALS: {_j(summary)}\nRECOMMENDED: {_j(rec)}",
                              max_tokens=3000)
        verdicts = {"summary": out.stack_summary, "by_tool": {v.tool_id: v.verdict for v in out.verdicts}}
    except (LLMError, BudgetExceeded, StopIteration) as e:
        log.warning("verdict failed: %s", e)
        verdicts = {"summary": "", "by_tool": {}}
    await emit(rid, "stack.scored", {"scored": scored_d, "stack": stack, "verdicts": verdicts}, agent="roi")
    return {"scored": scored_d, "stack": stack, "verdicts": verdicts}


async def approval_gate(state: AdvisorState):
    approved = interrupt({"recommended": state["stack"]["tool_ids"]})
    catalog = store.load_catalog()
    approved = [t for t in (approved or []) if t in catalog]
    return {"approved_tool_ids": approved}


async def adoption_planner(state: AdvisorState):
    rid = state["run_id"]
    approved = state.get("approved_tool_ids", [])
    await emit(rid, "agent.start", {"label": "Writing your 30-day adoption plan"}, agent="planner")
    if not approved:
        plan = {"first_step_today": "No tools approved — revisit when ready.", "weeks": [], "success_metrics": [],
                "scenarios": []}
    else:
        catalog = store.load_catalog()
        tools = [{"tool_id": t, "name": catalog[t]["name"], "setup_hours": catalog[t]["setup_hours"],
                  "url": catalog[t]["url"], "for_pains": [s["pain_id"] for s in state["scored"] if s["tool_id"] == t]}
                 for t in approved]
        out = await call_json(tier="smart", system=P.PLAN_SYSTEM, node="adoption_planner", run_id=rid, schema=PlanOut,
                              user=f"PROFILE: {_j(state['profile'])}\nPAINS: {_j(state['pains'])}\nAPPROVED TOOLS: {_j(tools)}",
                              max_tokens=6500)
        plan = out.model_dump()
        plan["weeks"] = plan["weeks"][:4]
        plan["success_metrics"] = plan["success_metrics"][:4]
        plan["scenarios"] = [sc | {"steps": sc["steps"][:7]} for sc in plan.get("scenarios", [])[:2]]
        for w in plan["weeks"]:
            w["tasks"] = w["tasks"][:5]
            for t in w["tasks"]:
                if t.get("tool_id") not in catalog:
                    t["tool_id"] = None
    await emit(rid, "plan.ready", {"plan": plan, "approved_tool_ids": approved}, agent="planner")
    return {"plan": plan}


async def memory_writeback(state: AdvisorState):
    rid, bid = state["run_id"], state["business_id"]
    vertical = state["profile"]["vertical"]
    catalog = store.load_catalog()
    await asyncio.to_thread(store.upsert_facts, bid, state.get("facts", []))
    adopted_facts = []
    for t in state.get("approved_tool_ids", []):
        pains = [s["pain_id"] for s in state["scored"] if s["tool_id"] == t]
        text = f"{state['profile'].get('business_name') or 'A ' + vertical} adopted {catalog[t]['name']} for {', '.join(pains)}"
        await asyncio.to_thread(store.add_episode, bid, vertical, text, {"tool_id": t, "pains": pains, "run_id": rid})
        adopted_facts.append({"subject": "business", "predicate": "adopting", "object": catalog[t]["name"],
                              "category": "current_tools", "confidence": 0.9})
    await asyncio.to_thread(store.upsert_facts, bid, adopted_facts)
    await emit(rid, "memory.saved", {"facts": len(state.get("facts", [])) + len(adopted_facts),
                                     "episodes": len(state.get("approved_tool_ids", []))}, agent="memory")
    return {}


# ---------------- graph ----------------

def build_graph():
    g = StateGraph(AdvisorState)
    g.add_node("intake_parser", intake_parser)
    g.add_node("memory_recall", memory_recall)
    g.add_node("pain_diagnoser", pain_diagnoser)
    g.add_node("tool_scout", tool_scout)
    g.add_node("advisor_mesh", advisor_mesh)
    g.add_node("roi_comparator", roi_comparator)
    g.add_node("approval_gate", approval_gate)
    g.add_node("adoption_planner", adoption_planner)
    g.add_node("memory_writeback", memory_writeback)
    g.add_edge(START, "intake_parser")
    g.add_edge("intake_parser", "memory_recall")
    g.add_edge("memory_recall", "pain_diagnoser")
    g.add_conditional_edges("pain_diagnoser", fan_out_scouts, ["tool_scout"])
    g.add_edge("tool_scout", "advisor_mesh")
    g.add_edge("advisor_mesh", "roi_comparator")
    g.add_edge("roi_comparator", "approval_gate")
    g.add_edge("approval_gate", "adoption_planner")
    g.add_edge("adoption_planner", "memory_writeback")
    g.add_edge("memory_writeback", END)
    return g.compile(checkpointer=MemorySaver())


GRAPH = build_graph()


def _cfg(run_id):
    return {"configurable": {"thread_id": run_id}}


def _result(state: dict) -> dict:
    keys = ("profile", "facts", "pains", "candidates", "critiques", "mesh", "scored", "stack", "verdicts",
            "approved_tool_ids", "plan", "memory")
    return {k: state.get(k) for k in keys if k in state}


def _friendly(e: Exception) -> str:
    if isinstance(e, BudgetExceeded):
        return "The live-AI budget for this demo is used up. Sample businesses still work in replay mode."
    return "An advisor hit a snag. Please try again in a moment."


async def start_live(run_id: str, business_id: str, business_name: str, raw_input: str, details: dict | None = None):
    ch = channel(run_id)
    await ch.emit("run.start", {"mode": "live"})
    try:
        await GRAPH.ainvoke({"run_id": run_id, "business_id": business_id, "business_name": business_name,
                             "raw_input": raw_input, "details": details or {}}, _cfg(run_id))
        snap = await GRAPH.aget_state(_cfg(run_id))
        result = _result(snap.values)
        db.update_run(run_id, status="awaiting_approval", result=result, events=ch.events,
                      cost_usd=db.run_spend(run_id))
        db.update_business(business_id, profile=result.get("profile"))
        await ch.emit("approval.waiting", {"recommended": result["stack"]["tool_ids"]})
    except Exception as e:  # noqa: BLE001
        log.exception("run %s failed", run_id)
        db.update_run(run_id, status="error", events=ch.events, cost_usd=db.run_spend(run_id))
        await ch.emit("run.error", {"message": _friendly(e)})


async def resume_live(run_id: str, approved_tool_ids: list[str]):
    ch = channel(run_id)
    ch.mark_resumed()
    try:
        await GRAPH.ainvoke(Command(resume=approved_tool_ids), _cfg(run_id))
        snap = await GRAPH.aget_state(_cfg(run_id))
        result = _result(snap.values)
        save_plan_tasks(run_id, result.get("plan") or {})
        db.update_run(run_id, status="complete", result=result, events=ch.events, cost_usd=db.run_spend(run_id))
        await ch.emit("run.complete", {})
    except Exception as e:  # noqa: BLE001
        log.exception("resume %s failed", run_id)
        await ch.emit("run.error", {"message": _friendly(e)})


def save_plan_tasks(run_id: str, plan: dict, done_weeks: int = 0):
    tasks = []
    for w in plan.get("weeks", []):
        for t in w["tasks"]:
            tasks.append({"week": w["week"], "tool_id": t.get("tool_id"), "text": t["text"], "owner": t.get("owner"),
                          "minutes": t.get("minutes"), "done": w["week"] <= done_weeks})
    db.replace_plan_tasks(run_id, tasks)
