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

    _, facts = await asyncio.to_thread(business_facts, user)
    candidates = await _candidates(body.message)
    allowed = {c["id"] for c in candidates}
    convo = "\n".join(f"{h.role.upper()}: {h.content[:500]}" for h in history)
    user_msg = json.dumps({
        "CURRENT_PAGE": {"name": page, "path": ctx.path, "title": ctx.page_title[:120], "text": visible},
        "BUSINESS": facts or {"signed_in": False},
        "CANDIDATE_TOOLS": [_slim(c) for c in candidates],
        "RECENT_CONVERSATION": convo,
        "QUESTION": body.message,
    }, ensure_ascii=False)
    try:
        out = await call_json(tier="fast", system=P.ASSISTANT_SYSTEM, user=user_msg, schema=AssistantOut,
                              node="assistant_chat", max_tokens=700, temperature=0.3, use_cache=not history)
    except (LLMError, BudgetExceeded) as e:
        log.warning("assistant fallback: %s", e)
        return template_answer(page, "unavailable")
    cat = _catalog()
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
    task_id = db.add_custom_task(b["id"], run_id, text, body.week if body.week is not None else 1, owner)
    suggestions = await recommend_for_task(text, adoptions.adopted_ids(b["id"]))
    db.set_task_suggestions(task_id, suggestions)
    return db.get_task(task_id)


@router.delete("/plan-tasks/{task_id}")
def delete_task(task_id: int, user=Depends(current_user)):
    b = db.get_user_business(user["id"])
    if not b or not db.delete_custom_task(task_id, b["id"]):
        raise HTTPException(404, "Only tasks you published can be removed")
    return {"ok": True}
