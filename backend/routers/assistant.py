"""On-platform helper ("Ask StackSmith") and published plan tasks with tool suggestions.

- POST /assistant/chat: page-aware Q&A. One fast-tier model call, bounded input, no secrets sent, template fallback.
- POST /plan-tasks: the owner/team publishes a task; a recommender suggests up to 3 verified catalog tools for it.
- DELETE /plan-tasks/{id}: remove a published (custom) task.
"""
import asyncio
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

import db
from auth import current_user, rate_limit
from graphs import prompts as P
from llm import BudgetExceeded, LLMError, call_json

log = logging.getLogger("assistant")
router = APIRouter()

MAX_MESSAGE = 500
MAX_HISTORY = 4
MAX_VISIBLE = 4000
MAX_PAGE_ITEMS = 40  # cap on list items across PAGE_DATA
MAX_ANSWER = 900

# ---------------- pure helpers (unit-tested) ----------------

_SECRET_PATTERNS = [
    re.compile(r"\b(pass(word|code|wd)?|pwd|pin)\s*(is|:|=)\s*\S+", re.I),
    re.compile(r"\b(sk|pk|rk)[-_](live|test|or|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}"),
    re.compile(r"\b(AKIA|ASIA)[A-Z0-9]{16}\b"),
    re.compile(r"\b(ghp|gho|github_pat|xox[abp]|rlwy|vcp)_[A-Za-z0-9_]{16,}"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._-]{20,}", re.I),
    re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),  # US SSN shape
]
_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def contains_secret(*texts: str | None) -> bool:
    """True when any text obviously contains a password, API key, card number or SSN."""
    for t in texts:
        if not t:
            continue
        if any(p.search(t) for p in _SECRET_PATTERNS):
            return True
        for m in _CARD.finditer(t):
            digits = re.sub(r"\D", "", m.group())
            if 13 <= len(digits) <= 19 and _luhn_ok(digits):
                return True
    return False


def valid_tool_ids(ids: list[str], allowed: set[str], limit: int = 3) -> list[str]:
    """Keep only known catalog ids, de-duplicated, in order, capped."""
    out: list[str] = []
    for i in ids:
        if i in allowed and i not in out:
            out.append(i)
        if len(out) >= limit:
            break
    return out


def clean_task_text(text: str) -> str:
    t = re.sub(r"\s+", " ", (text or "")).strip()
    return t[:200]


def page_name(path: str) -> str:
    p = (path or "/").split("?")[0]
    for prefix, name in [("/dashboard", "Dashboard"), ("/war-room", "War Room"), ("/agents", "Collaboration"),
                         ("/tools/", "Tool details"), ("/tools", "Discover"), ("/compare", "Compare"),
                         ("/team/tasks/", "Task"), ("/team", "Collaboration"), ("/people", "People"),
                         ("/profile", "Profile"), ("/onboard", "Describe your business")]:
        if p.startswith(prefix):
            return name
    return "StackSmith"


PAGE_HELP = {
    "Dashboard": "This is your home base: the AI tools you've adopted, the estimated savings, and your 30-day plan. "
                 "Tick tasks as you finish them, or publish your own task to get tool suggestions.",
    "War Room": "Here StackSmith's AI advisors analyze your business: they put a dollar cost on each problem, look for "
                "tools, debate the options, then you approve the stack you want.",
    "Collaboration": "Give your team tasks and track them: the task queue shows who each task went to and how far along "
                     "it is, Workflow shows who uses which AI tools and hands work to whom, and Spending covers tool "
                     "requests and your monthly AI limit.",
    "Task": "One team task: who it was assigned to and why, how the AI coworkers planned it with your tools, ready-to-use "
            "drafts, and the steps to tick off.",
    "People": "Everyone on your team: their skills, whether they're available, the AI tools they use, and invite links.",
    "Discover": "Browse verified AI tools. Search in plain words, filter by business type, open Details for a short "
                "summary and the vendor's website, and Adopt a tool to add it to your workflow.",
    "Tool details": "A summary of one tool: what it does, price, setup time, security facts we could verify, and its website.",
    "Compare": "Compare 2-4 tools side by side: overall score, total cost over time, and whether they work with the "
               "tools you already use. Move the sliders to weight what matters to you.",
    "Profile": "Edit your business details and description. When you save, Dashboard, Discover and Compare use them.",
    "Describe your business": "Tell StackSmith about your business in a few sentences, then the advisors start their analysis.",
    "StackSmith": "StackSmith helps small businesses find, compare and adopt AI tools that pay for themselves.",
}


def template_answer(page: str, reason: str) -> dict:
    lead = {"secret": "For your safety I didn't send that message: it looks like it contains a password, key or card number. "
                      "Please remove it and ask again.",
            "unavailable": "I can't reach the AI right now, so here's a quick guide to this page instead."}[reason]
    return {"answer": f"{lead} {PAGE_HELP.get(page, PAGE_HELP['StackSmith'])}".strip()[:MAX_ANSWER],
            "tools": [], "follow_ups": [], "mode": "template", "page": page}


# ---------------- schemas ----------------

class Turn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(max_length=MAX_ANSWER + 100)


class PageContext(BaseModel):
    path: str = Field(default="/", max_length=200)
    query: str = Field(default="", max_length=400)
    page_title: str = Field(default="", max_length=200)
    visible_text: str = Field(default="", max_length=20000)  # trimmed server-side to MAX_VISIBLE


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=MAX_MESSAGE)
    history: list[Turn] = Field(default_factory=list, max_length=20)
    context: PageContext = Field(default_factory=PageContext)


class AssistantOut(BaseModel):
    answer: str
    suggested_tool_ids: list[str] = Field(default_factory=list, description="0-3 tool_ids from CANDIDATE_TOOLS")
    follow_ups: list[str] = Field(default_factory=list, description="0-3 short follow-up questions")


class TaskIn(BaseModel):
    text: str = Field(min_length=3, max_length=200)
    week: int | None = Field(default=None, ge=0, le=4)


class TaskPick(BaseModel):
    tool_id: str
    reason: str


class TaskRecsOut(BaseModel):
    picks: list[TaskPick] = Field(default_factory=list, description="0-3 picks from CANDIDATES")


# ---------------- context helpers ----------------

def _optional_user(request: Request):
    try:
        return current_user(request)
    except HTTPException:
        return None


def _catalog() -> dict:
    from memory import store
    return store.load_catalog()


async def _candidates(query: str, limit: int = 8) -> list[dict]:
    """Semantic search over the verified catalog; empty on any vector-store problem."""
    try:
        from memory import store
        hits = await asyncio.to_thread(store.search_catalog, query, limit=limit)
    except Exception:  # noqa: BLE001 - recommendations are best-effort
        log.warning("catalog search failed", exc_info=True)
        return []
    cat = _catalog()
    return [cat[h["id"]] for h in hits if h["id"] in cat]


def _slim(t: dict) -> dict:
    return {"tool_id": t["id"], "name": t["name"], "does": t["description"][:160],
            "price_monthly": t["price_monthly_typical"], "setup_hours": t["setup_hours"]}


def _tool_card(t: dict) -> dict:
    return {"id": t["id"], "name": t["name"], "line": t["description"][:140], "price": t["price_monthly_typical"],
            "category": t["category"], "url": t["url"]}


def business_facts(user) -> tuple[dict | None, dict]:
    """Server-side facts about the signed-in user's business (never trusted from the client)."""
    if not user:
        return None, {}
    b = db.get_user_business(user["id"])
    if not b:
        return None, {"signed_in": True, "business": "not set up yet"}
    profile = json.loads(b["profile_json"]) if b.get("profile_json") else {}
    facts: dict = {"business": b["name"], "summary": (profile.get("summary") or (b.get("description") or ""))[:300],
                   "monthly_tool_budget": profile.get("monthly_budget"), "team_size": profile.get("employees"),
                   "current_tools": profile.get("current_tools", [])[:10], "is_sample_business": bool(user["is_demo"])}
    try:
        import adoptions
        cat = _catalog()
        facts["adopted_tools"] = [cat[a]["name"] for a in adoptions.adopted_ids(b["id"]) if a in cat]
    except Exception:  # noqa: BLE001
        facts["adopted_tools"] = []
    run = db.latest_complete_run(b["id"])
    if run:
        res = json.loads(run["result_json"] or "{}")
        stack = res.get("stack") or {}
        facts["latest_stack"] = {k: stack.get(k) for k in ("monthly_cost", "net_monthly", "hours_saved_per_month")}
        facts["problems"] = [p.get("title") for p in (res.get("pains") or [])][:3]
    tasks = db.get_business_tasks(b["id"], run["id"] if run else None)
    facts["plan_tasks"] = [{"week": t["week"], "task": t["text"][:120], "done": bool(t["done"])} for t in tasks][:25]
    return b, facts


# ---------------- page data (deterministic, no LLM) ----------------
# Each builder is pure: it takes already-loaded data and returns compact, JSON-safe facts.

def _money(x) -> str:
    try:
        return f"${float(x):,.0f}"
    except (TypeError, ValueError):
        return "unknown"


def open_pains(pains: list[dict], adopted_ids: list[str], catalog: dict) -> list[dict]:
    """Problems from the latest analysis, marked covered when an adopted tool solves that kind of problem."""
    covered_tags = {tag for t in adopted_ids if t in catalog for tag in catalog[t].get("solves", [])}
    out = []
    for p in pains or []:
        tag = p.get("tag")
        out.append({"problem": p.get("title"), "costs_per_month": _money(p.get("monthly_cost_of_pain")),
                    "tag": tag, "covered_by_adopted_tool": tag in covered_tags})
    return out


def rank_tools_for_business(catalog: dict, profile: dict | None, pains: list[dict] | None = None,
                            adopted_ids: list[str] | None = None, reviews_agg: dict | None = None,
                            limit: int = 8) -> list[dict]:
    """Catalog tools ranked for this business: weighted score + a boost for each open problem the tool solves.
    Already-adopted tools are left out (they are listed separately)."""
    import evaluate as ev
    adopted = set(adopted_ids or [])
    open_tags = {p["tag"] for p in open_pains(pains or [], list(adopted), catalog) if not p["covered_by_adopted_tool"]}
    vertical = (profile or {}).get("vertical")
    ranked = []
    for t in catalog.values():
        if t["id"] in adopted:
            continue
        sc = ev.score_tool(t, profile or {}, None, (reviews_agg or {}).get(t["id"]))
        fixes = sorted(open_tags & set(t.get("solves", [])))
        fits_type = not vertical or vertical in t.get("verticals", []) or "all" in t.get("verticals", [])
        rank = sc["total"] + 2.5 * len(fixes) + (0.5 if fits_type else -1.5)
        why = []
        if fixes:
            why.append("fixes " + ", ".join(f.replace("_", " ") for f in fixes))
        why.append(sc["criteria"]["cost"]["why"])
        if sc["criteria"]["fit"].get("no_data") is False:
            why.append(sc["criteria"]["fit"]["why"])
        ranked.append((rank, {"tool_id": t["id"], "name": t["name"], "price_per_month": _money(t["price_monthly_typical"]),
                              "score_out_of_10": sc["total"], "why": "; ".join(why)[:160]}))
    ranked.sort(key=lambda r: r[0], reverse=True)
    return [r[1] for r in ranked[:limit]]


def tool_facts(tool: dict, profile: dict | None, adopted_ids: list[str] | None, reviews_agg: dict | None) -> dict:
    import evaluate as ev
    sc = ev.score_tool(tool, profile or {}, None, reviews_agg)
    trust = tool.get("trust") or {}
    sourced = [k.replace("_", " ") for k, v in trust.items() if (v or {}).get("status") in ("verified", "vendor_claimed")]
    return {"tool_id": tool["id"], "name": tool["name"], "what_it_does": tool["description"][:200],
            "ai_features": tool.get("ai_features", [])[:4], "price_per_month": _money(tool["price_monthly_typical"]),
            "free_plan": bool(tool.get("free_tier")), "setup_hours": tool.get("setup_hours"),
            "solves": [s.replace("_", " ") for s in tool.get("solves", [])][:5],
            "works_with": tool.get("integrates_with", [])[:6],
            "security_facts_confirmed": sourced or "none confirmed yet",
            "score_for_this_business_out_of_10": sc["total"],
            "already_adopted": tool["id"] in set(adopted_ids or []),
            "watch_out": tool.get("cons", [])[:2]}


def compare_facts(tools: list[dict], profile: dict | None, reviews: dict | None) -> list[dict]:
    import evaluate as ev
    hourly = 45.0 if profile else 25.0
    out = []
    for t in tools[:4]:
        sc = ev.score_tool(t, profile or {}, None, (reviews or {}).get(t["id"]))
        out.append({"tool_id": t["id"], "name": t["name"], "score_out_of_10": sc["total"],
                    "price_per_month": _money(t["price_monthly_typical"]),
                    "cost_over_12_months": _money(ev.tco(t, 1, 12, 0, hourly)["total"]),
                    "works_with_your_tools": sc["integration"]["native"] if sc["integration"]["total"] else "no current tools on file"})
    return out


def queue_facts(tasks: list[dict]) -> list[dict]:
    """Task-queue cards (the shape of GET /coworker-tasks)."""
    out = []
    for t in tasks[:8]:
        a = t.get("assignee") or {}
        p = t.get("progress") or {}
        out.append({"task": (t.get("text") or "")[:100], "stage": t.get("stage"), "assigned_to": a.get("name"),
                    "covering_for": (t.get("covering_for") or {}).get("name"),
                    "steps_done": f"{p.get('done', 0)} of {p.get('total', 0)}"})
    return out


def task_facts(task: dict, names: dict[str, str]) -> dict:
    """One coworker task (GET /coworker-tasks/{id} shape, with result)."""
    res = task.get("result") or {}
    route = res.get("route") or {}
    name = lambda i: names.get(i, i) if i else None  # noqa: E731
    steps = []
    for s in (res.get("workflow") or [])[:8]:
        actor = name(s.get("actor_id")) if s.get("actor_type") == "employee" else (s.get("tool_id") or s.get("actor_type"))
        line = f"{actor}: {s.get('action', '')}"[:120]
        if s.get("gap"):
            line += " (no tool covers this yet)"
        steps.append(line)
    out = {"task": task.get("text"), "stage": task.get("stage"), "intent": res.get("intent"),
           "assigned_to": (task.get("assignee") or {}).get("name") or name(route.get("human_id")),
           "why_them": route.get("owner_reason"), "workflow": steps,
           "drafts": [d.get("title") for d in (res.get("drafts") or [])][:4],
           "checklist": [f"{'[x]' if s.get('done') else '[ ]'} {s.get('text', '')[:90]}" for s in task.get("steps") or []][:6]}
    if route.get("substituted"):
        out["covering"] = route.get("substitution_note")
    return out


def people_facts(people: list[dict]) -> list[dict]:
    return [{"name": p["name"], "role": p["role"], "status": p["status"], "is_owner": p.get("is_owner", False),
             "has_login": p.get("has_login", False), "skills": p.get("skills", [])[:3],
             "ai_tools": [t["name"] for t in p.get("ai_tools", [])][:4], "open_tasks": p.get("open_tasks", 0)}
            for p in people[:10]]


def run_facts(result: dict, catalog: dict) -> dict:
    stack = result.get("stack") or {}
    plan = result.get("plan") or {}
    first_steps = [t.get("text") for w in plan.get("weeks", [])[:1] for t in w.get("tasks", [])[:4]]
    return {"problems": [{"problem": p.get("title"), "costs_per_month": _money(p.get("monthly_cost_of_pain"))}
                         for p in (result.get("pains") or [])[:3]],
            "recommended_tools": [catalog[i]["name"] for i in stack.get("tool_ids", []) if i in catalog],
            "approved_tools": [catalog[i]["name"] for i in (result.get("approved_tool_ids") or []) if i in catalog],
            "tools_cost_per_month": _money(stack.get("monthly_cost")), "net_gain_per_month": _money(stack.get("net_monthly")),
            "do_this_today": plan.get("first_step_today"), "first_steps": first_steps}


def cap_page_data(data: dict, max_items: int = MAX_PAGE_ITEMS) -> dict:
    """Keep the total number of list items across PAGE_DATA under max_items (lists trimmed in order)."""
    budget = max_items
    out = {}
    for k, v in data.items():
        if isinstance(v, list):
            take = max(0, min(len(v), budget))
            out[k] = v[:take]
            budget -= take
        else:
            out[k] = v
    return out


def _profile_for(b: dict | None) -> dict:
    if not b:
        return {}
    profile = json.loads(b["profile_json"]) if b.get("profile_json") else {}
    if b.get("details_json"):
        det = json.loads(b["details_json"])
        profile["current_tools"] = list(dict.fromkeys(profile.get("current_tools", []) + det.get("current_tools", [])))
        if det.get("tech_comfort") and not profile.get("tech_comfort"):
            profile["tech_comfort"] = det["tech_comfort"]
    return profile


def page_facts(path: str, query: str, user, b: dict | None) -> tuple[dict, list[str]]:
    """PAGE_DATA for the current page plus the tool ids it mentions (allowed as suggestions)."""
    from urllib.parse import parse_qs
    import adoptions
    cat = _catalog()
    p = (path or "/").split("?")[0].rstrip("/") or "/"
    qs = parse_qs((query or "").lstrip("?"))
    profile = _profile_for(b)
    adopted = adoptions.adopted_ids(b["id"]) if b else []
    run = db.latest_complete_run(b["id"]) if b else None
    pains = (json.loads(run["result_json"] or "{}").get("pains") or []) if run else []
    data: dict = {}
    tool_ids: list[str] = []

    if p == "/tools":
        reviews = db.review_aggregates()
        ranked = rank_tools_for_business(cat, profile, pains, adopted, reviews)
        data["best_fit_tools_for_this_business" if b else "popular_tools"] = ranked
        tool_ids += [r["tool_id"] for r in ranked]
        if b:
            data["already_adopted"] = [cat[a]["name"] for a in adopted if a in cat]
            data["problems_from_analysis"] = open_pains(pains, adopted, cat)
        if qs.get("q"):
            data["search"] = qs["q"][0][:80]
    elif p.startswith("/tools/"):
        tid = p.split("/")[2]
        if tid in cat:
            data["tool"] = tool_facts(cat[tid], profile if b else None, adopted, db.review_aggregates().get(tid))
            tool_ids.append(tid)
    elif p == "/compare":
        ids = [i for i in (qs.get("ids", [""])[0]).split(",") if i in cat]
        data["compared_tools"] = compare_facts([cat[i] for i in ids], profile if b else None, db.review_aggregates())
        tool_ids += ids
    elif not b:
        return {}, []
    elif p.startswith("/team/tasks/"):
        import coworkers as cw
        t = cw.get_task(p.split("/")[3])
        if t and t["business_id"] == b["id"]:
            steps = cw.steps_for([t["id"]]).get(t["id"], [])
            by_id = {e["id"]: e for e in cw.list_employees(b["id"])}
            out = cw.task_out(t) | cw.queue_fields(t, t["status"], steps, by_id)
            data["task"] = task_facts(out, {k: v["name"] for k, v in by_id.items()})
            tool_ids += [s.get("tool_id") for s in ((out.get("result") or {}).get("workflow") or []) if s.get("tool_id") in cat]
    elif p in ("/team", "/agents"):
        import coworkers as cw
        rows = cw.list_tasks(b["id"])
        steps = cw.steps_for([t["id"] for t in rows])
        by_id = {e["id"]: e for e in cw.list_employees(b["id"])}
        cards = [cw.task_out(t, with_result=False) | cw.queue_fields(t, t["status"], steps.get(t["id"], []), by_id) for t in rows]
        data["task_queue"] = queue_facts(cards)
        data["people"] = [f"{e['name']} ({e['role']}, {e['status']})" for e in by_id.values()][:8]
        data["adopted_tools"] = [cat[a]["name"] for a in adopted if a in cat]
    elif p == "/people":
        from routers import people as PR
        rows = PR._business_rows(b["id"])
        people = [PR._person(e, b, rows, viewer_is_admin=b["user_id"] == user["id"], viewer_id=user["id"])
                  for e in PR.cw.list_employees(b["id"])]
        data["people"] = people_facts(people)
    elif p.startswith("/war-room/"):
        r = db.get_run(p.split("/")[2])
        if r and r["business_id"] == b["id"] and r.get("result_json"):
            res = json.loads(r["result_json"])
            data["analysis"] = run_facts(res, cat)
            tool_ids += [i for i in (res.get("stack") or {}).get("tool_ids", []) if i in cat]
    elif p == "/dashboard":
        tasks = db.get_business_tasks(b["id"], run["id"] if run else None)
        data["open_plan_tasks"] = [t["text"][:100] for t in tasks if not t["done"]][:8]
        data["adopted_tools"] = [cat[a]["name"] for a in adopted if a in cat]
        if run:
            data["analysis"] = run_facts(json.loads(run["result_json"] or "{}"), cat)
    elif p == "/profile":
        import coworkers as cw
        pid = cw.person_id_for_user(b["id"], user["id"])
        emp = cw.get_employee(pid) if pid else None
        data["you"] = {"name": user["name"], "account": "owner" if b["user_id"] == user["id"] else "employee",
                       "job_role": emp["role"] if emp else None}
        data["business_profile"] = {k: profile.get(k) for k in ("vertical", "employees", "monthly_budget", "tech_comfort", "summary")}
        data["current_tools"] = profile.get("current_tools", [])[:8]
    return cap_page_data(data), [i for i in dict.fromkeys(tool_ids) if i]


# ---------------- whole-business snapshot (always sent, role-aware, no LLM) ----------------

MAX_FACTS = 60  # list items across SNAPSHOT + PAGE_DATA


def build_snapshot(d: dict, is_owner: bool) -> dict:
    """Pure: turn loaded rows into a compact snapshot. Employees never get owner-only data
    (spending, licenses, other people's requests, unapproved tools)."""
    cat = d.get("catalog") or {}
    tname = lambda i: cat.get(i, {}).get("name", i)  # noqa: E731
    me = d.get("me") or {}
    snap: dict = {
        "you": {"name": me.get("name"), "account": "owner" if is_owner else "employee", "job_role": me.get("job_role")},
        "business": d.get("business") or {},
        "adopted_stack": [{"tool": tname(t), "tool_id": t, "price_per_month": _money(cat.get(t, {}).get("price_monthly_typical"))}
                          for t in d.get("adopted_ids", []) if t in cat],
    }
    reqs = d.get("requests") or []
    if is_owner:
        sp = d.get("spend") or {}
        snap["spending"] = {"monthly_ai_limit": _money(sp["cap"]) if sp.get("cap") else "no limit set",
                            "committed_per_month": _money(sp.get("committed_monthly")),
                            "headroom_per_month": _money(sp["headroom"]) if sp.get("headroom") is not None else "n/a",
                            "over_limit": bool(sp.get("over_cap"))}
        snap["tool_requests"] = [{"tool": tname(r["tool_id"]), "requested_by": r.get("requester"),
                                  "cost_per_month": _money(r.get("est_monthly_cost")), "status": r.get("status"),
                                  "reason": (r.get("reason") or "")[:80]} for r in reqs][:8]
        snap["licenses"] = [{"tool": tname(l["tool_id"]), "seats_bought": l["seats_bought"], "seats_used": l["seats_assigned"]}
                            for l in d.get("licenses") or []][:5]
        snap["unapproved_tools_in_use"] = [{"tool": s["tool_name"], "used_by": s.get("user")}
                                           for s in d.get("shadow") or [] if s.get("status", "open") == "open"][:5]
    else:
        snap["my_tool_requests"] = [{"tool": tname(r["tool_id"]), "status": r.get("status")}
                                    for r in reqs if r.get("mine")][:5]
    snap["people"] = [{"name": p["name"], "role": p.get("role"), "status": p.get("status"),
                       "ai_tools": p.get("ai_tools", [])[:3]} for p in d.get("people") or []][:8]
    tasks = d.get("tasks") or []
    if not is_owner:
        mine = [t for t in tasks if t.get("mine")]
        snap["my_tasks"] = queue_facts(mine)
        snap["team_task_count"] = len(tasks)
    else:
        snap["task_queue"] = queue_facts(tasks)
    if d.get("my_steps"):
        snap["my_open_steps"] = d["my_steps"][:6]
    a = d.get("analysis")
    if a:
        snap["latest_analysis"] = a
    return snap


def count_items(obj) -> int:
    """List items anywhere in a facts structure (the cap counts these)."""
    if isinstance(obj, list):
        return len(obj) + sum(count_items(x) for x in obj if isinstance(x, (dict, list)))
    if isinstance(obj, dict):
        return sum(count_items(v) for v in obj.values())
    return 0


def cap_facts(snapshot: dict, page: dict, max_items: int = MAX_FACTS) -> tuple[dict, dict]:
    """Page facts are trimmed first, then the snapshot's longest lists, until the total is under the cap."""
    def trim(d: dict):
        keys = sorted((k for k, v in d.items() if isinstance(v, list) and v), key=lambda k: -len(d[k]))
        if not keys:
            return False
        d[keys[0]] = d[keys[0]][:-1]
        return True
    snapshot, page = json.loads(json.dumps(snapshot)), json.loads(json.dumps(page))
    while count_items(snapshot) + count_items(page) > max_items:
        if not trim(page) and not trim(snapshot):
            break
    return snapshot, page


def load_snapshot_data(user, b: dict) -> tuple[dict, bool]:
    """Load everything the snapshot needs for this user's business. Returns (data, is_owner)."""
    import adoptions
    import coworkers as cw
    from routers import team as T
    from sqlalchemy import select
    cat = _catalog()
    is_owner = b["user_id"] == user["id"]
    profile = _profile_for(b)
    details = json.loads(b["details_json"]) if b.get("details_json") else {}
    pid = cw.person_id_for_user(b["id"], user["id"])
    emp = cw.get_employee(pid) if pid else None
    with T.engine.begin() as c:
        reqs = T._rows(c, select(T.tool_requests).where(T.tool_requests.c.business_id == b["id"])
                       .order_by(T.tool_requests.c.created_at.desc()))
        lic = T._rows(c, select(T.licenses).where(T.licenses.c.business_id == b["id"]))
        shadow = T._rows(c, select(T.shadow_tools).where(T.shadow_tools.c.business_id == b["id"]))
    names: dict = {}

    def uname(uid):
        if uid and uid not in names:
            u = db.get_user(uid)
            names[uid] = u["name"] if u else "Former member"
        return names.get(uid)
    for r in reqs:
        r["requester"], r["mine"] = uname(r["requester_id"]), r["requester_id"] == user["id"]
    for s in shadow:
        s["user"] = uname(s["user_id"])
    # people + the AI tools each uses
    try:
        from routers import people as PR
        rows = PR._business_rows(b["id"])
        people = [PR._person(e, b, rows, viewer_is_admin=is_owner, viewer_id=user["id"]) for e in cw.list_employees(b["id"])]
        people = [p | {"ai_tools": [t["name"] for t in p.get("ai_tools", [])]} for p in people]
    except Exception:  # noqa: BLE001
        people = [{"name": e["name"], "role": e["role"], "status": e["status"], "ai_tools": []} for e in cw.list_employees(b["id"])]
    # task queue
    rows_t = cw.list_tasks(b["id"])
    steps = cw.steps_for([t["id"] for t in rows_t])
    by_id = {e["id"]: e for e in cw.list_employees(b["id"])}
    tasks = []
    for t in rows_t:
        card = cw.task_out(t, with_result=False) | cw.queue_fields(t, t["status"], steps.get(t["id"], []), by_id)
        card["mine"] = cw.is_mine(t, steps.get(t["id"], []), pid)
        tasks.append(card)
    my_steps = [s["text"][:100] for st in steps.values() for s in st if pid and s.get("assignee_employee_id") == pid and not s["done"]]
    # latest analysis
    run = db.latest_complete_run(b["id"])
    analysis = None
    if run and run.get("result_json"):
        res = json.loads(run["result_json"])
        plan_tasks = db.get_business_tasks(b["id"], run["id"])
        week = [t["text"][:100] for t in plan_tasks if not t["done"] and (t.get("week") or 1) <= 1][:4]
        analysis = {"problems": [{"problem": p.get("title"), "costs_per_month": _money(p.get("monthly_cost_of_pain"))}
                                 for p in (res.get("pains") or [])[:3]],
                    "recommended_stack": [cat[i]["name"] for i in (res.get("stack") or {}).get("tool_ids", []) if i in cat],
                    "net_gain_per_month": _money((res.get("stack") or {}).get("net_monthly")),
                    "this_week_plan": week}
    from categories import category_for_vertical
    data = {
        "catalog": cat,
        "me": {"name": user["name"], "job_role": emp["role"] if emp else ("Owner" if is_owner else None)},
        "business": {"name": b["name"], "category": details.get("business_category") or category_for_vertical(profile.get("vertical") or b.get("vertical")),
                     "monthly_tool_budget": _money(profile.get("monthly_budget")) if profile.get("monthly_budget") else "not set",
                     "tech_comfort_1_to_5": profile.get("tech_comfort"), "team_size": profile.get("employees"),
                     "current_tools": profile.get("current_tools", [])[:6], "summary": (profile.get("summary") or "")[:200],
                     "is_sample_business": bool(user["is_demo"])},
        "adopted_ids": adoptions.adopted_ids(b["id"]),
        "spend": T._spend(b) if is_owner else None,
        "requests": reqs, "licenses": lic, "shadow": shadow,
        "people": people, "tasks": tasks, "my_steps": my_steps, "analysis": analysis,
    }
    return data, is_owner


# ---------------- endpoints ----------------

@router.post("/assistant/chat")
async def chat(body: ChatIn, request: Request):
    user = _optional_user(request)
    rate_limit(request, f"assistant:{user['id'] if user else 'anon'}", 20, window_s=3600)
    ctx = body.context
    page = page_name(ctx.path)
    visible = ctx.visible_text[:MAX_VISIBLE]
    history = body.history[-MAX_HISTORY:]
    if contains_secret(body.message, visible, *[h.content for h in history]):
        return template_answer(page, "secret")

    b = await asyncio.to_thread(db.get_user_business, user["id"]) if user else None
    snapshot: dict = {"signed_in": bool(user)}
    if user and not b:
        snapshot["business"] = "not set up yet - the owner starts at Describe your business (/onboard)"
    elif b:
        try:
            data, is_owner = await asyncio.to_thread(load_snapshot_data, user, b)
            snapshot = build_snapshot(data, is_owner)
        except Exception:  # noqa: BLE001 - never fail the chat because a section couldn't load
            log.warning("snapshot failed", exc_info=True)
    try:
        page_data, page_tool_ids = await asyncio.to_thread(page_facts, ctx.path, ctx.query, user, b)
    except Exception:  # noqa: BLE001 - page data is best-effort; the visible text is still sent
        log.warning("page facts failed for %s", ctx.path, exc_info=True)
        page_data, page_tool_ids = {}, []
    snapshot, page_data = cap_facts(snapshot, page_data)

    cat = _catalog()
    # Candidates: tools named by this page / the business first, then a semantic search on the question.
    first = page_tool_ids + [s["tool_id"] for s in snapshot.get("adopted_stack", [])]
    candidates = [cat[i] for i in dict.fromkeys(first) if i in cat]
    seen = {c["id"] for c in candidates}
    candidates += [c for c in await _candidates(body.message) if c["id"] not in seen]
    candidates = candidates[:14]
    allowed = {c["id"] for c in candidates}
    convo = "\n".join(f"{h.role.upper()}: {h.content[:500]}" for h in history)
    user_msg = json.dumps({
        "CURRENT_PAGE": {"name": page, "path": ctx.path, "query": ctx.query[:200], "title": ctx.page_title[:120],
                         "visible_text": visible},
        "PAGE_DATA": page_data,
        "BUSINESS_SNAPSHOT": snapshot,
        "CANDIDATE_TOOLS": [_slim(c) for c in candidates],
        "RECENT_CONVERSATION": convo,
        "QUESTION": body.message,
    }, ensure_ascii=False, default=str)
    try:
        out = await call_json(tier="smart", system=P.ASSISTANT_SYSTEM, user=user_msg, schema=AssistantOut,
                              node="assistant_chat", max_tokens=1600, temperature=0.3, use_cache=not history)
    except (LLMError, BudgetExceeded) as e:
        log.warning("assistant fallback: %s", e)
        return template_answer(page, "unavailable")
    ids = valid_tool_ids(out.suggested_tool_ids, allowed)
    return {"answer": out.answer.strip()[:MAX_ANSWER], "tools": [_tool_card(cat[i]) for i in ids],
            "follow_ups": [f.strip()[:80] for f in out.follow_ups if f.strip()][:3], "mode": "ai", "page": page}


async def recommend_for_task(text: str, adopted: list[str]) -> list[dict]:
    candidates = await _candidates(text)
    if not candidates:
        return []
    allowed = {c["id"] for c in candidates}
    user_msg = json.dumps({"TASK": text, "ALREADY_ADOPTED": adopted,
                           "CANDIDATES": [_slim(c) for c in candidates]}, ensure_ascii=False)
    try:
        out = await call_json(tier="fast", system=P.TASK_RECS_SYSTEM, user=user_msg, schema=TaskRecsOut,
                              node="task_recs", max_tokens=500)
        reasons = {p.tool_id: p.reason.strip()[:160] for p in out.picks}
        ids = valid_tool_ids([p.tool_id for p in out.picks], allowed)
        return [{"tool_id": i, "reason": reasons[i]} for i in ids]
    except (LLMError, BudgetExceeded) as e:
        log.warning("task recs fallback: %s", e)
        return [{"tool_id": c["id"], "reason": "Closest match in the catalog for this task."} for c in candidates[:2]]


@router.post("/plan-tasks")
async def publish_task(body: TaskIn, request: Request, user=Depends(current_user)):
    rate_limit(request, f"plan-task:{user['id']}", 15, window_s=3600)
    text = clean_task_text(body.text)
    if len(text) < 3:
        raise HTTPException(400, "Describe the task in a few words")
    if contains_secret(text):
        raise HTTPException(400, "Please remove passwords, keys or card numbers from the task")
    b = db.get_user_business(user["id"])
    if not b:
        raise HTTPException(404, "Set up your business first")
    import adoptions
    run = db.latest_complete_run(b["id"])
    run_id = run["id"] if run else adoptions._manual_run(b["id"], b["user_id"])
    owner = "Owner" if b["user_id"] == user["id"] else (user["name"].split(" ")[0] or "Team")
    task_id = db.add_custom_task(b["id"], run_id, text, body.week if body.week is not None else 1, owner,
                                 created_by=user["id"])
    suggestions = await recommend_for_task(text, adoptions.adopted_ids(b["id"]))
    db.set_task_suggestions(task_id, suggestions)
    return db.get_task(task_id)


@router.delete("/plan-tasks/{task_id}")
def delete_task(task_id: int, user=Depends(current_user)):
    b = db.get_user_business(user["id"])
    is_owner = bool(b) and b["user_id"] == user["id"]
    if not b or not db.delete_custom_task(task_id, b["id"], user_id=user["id"], is_owner=is_owner):
        raise HTTPException(404, "Only the owner or the person who published this task can remove it")
    return {"ok": True}
