"""People = employee profile (skills, status, AI coworker memory) + optional login. Pure helpers (unit-tested).

"AI tools a person owns" merges four sources, de-duplicated by catalog id (or lower-cased name for non-catalog tools):
  approved_request  - their tool requests the owner approved
  uses              - tools listed on their profile
  assigned_task     - tools in approved coworker-task workflow steps assigned to them
  self_declared     - tools they said they use without approval
When the same tool appears in several sources the strongest one wins (order above).
"""
SOURCE_PRIORITY = {"approved_request": 0, "uses": 1, "assigned_task": 2, "self_declared": 3}


def match_catalog(name: str | None, catalog: dict[str, dict]) -> str | None:
    """Map a free-text tool name ('QuickBooks', 'Square POS', 'Canva') or a catalog id to a catalog id."""
    if not name:
        return None
    n = name.strip().lower()
    if len(n) < 3:
        return None
    if n in catalog:
        return n
    for t in catalog.values():
        full = t["name"].lower()
        short = full.split(" (")[0]
        if n in (full, short) or full.startswith(n) or (len(short) >= 4 and n.startswith(short)):
            return t["id"]
    return None


def tools_from_workflow(result: dict, person_id: str) -> list[str]:
    """Tool ids from workflow steps that are this person's: their own steps using a tool, and tool steps handed to them."""
    out = []
    for s in (result or {}).get("workflow", []) or []:
        if s.get("gap"):
            continue
        tid = s.get("tool_id")
        if s.get("actor_type") == "employee" and s.get("actor_id") == person_id and tid:
            out.append(tid)
        elif s.get("actor_type") == "tool" and s.get("handoff_to") == person_id:
            out.append(tid or s.get("actor_id"))
    return [t for t in out if t]


def build_ai_tools(*, profile_tools: list[str], approved_requests: list[dict], shadow: list[dict],
                   task_tools: list[tuple[str, str | None]], catalog: dict[str, dict]) -> list[dict]:
    """Merge the four sources into PersonTool rows (see module docstring).

    approved_requests: [{tool_id, decided_at|created_at}]; shadow: [{tool_name, created_at}];
    task_tools: [(tool_id_or_name, since_iso)].
    """
    entries: list[tuple[str, str, str | None]] = []  # (source, raw, since)
    entries += [("uses", t, None) for t in profile_tools or []]
    entries += [("approved_request", r["tool_id"], r.get("since")) for r in approved_requests or []]
    entries += [("assigned_task", t, since) for t, since in task_tools or []]
    entries += [("self_declared", s["tool_name"], s.get("since")) for s in shadow or []]

    best: dict[str, dict] = {}
    order: list[str] = []
    for source, raw, since in entries:
        raw = (raw or "").strip()
        if not raw:
            continue
        tid = match_catalog(raw, catalog)
        key = tid or raw.lower()
        row = {"tool_id": tid, "name": catalog[tid]["name"] if tid else raw, "source": source, "catalog": bool(tid),
               "monthly_cost": float(catalog[tid].get("price_monthly_typical", 0)) if tid else None, "since": since}
        cur = best.get(key)
        if cur is None:
            best[key] = row
            order.append(key)
        elif SOURCE_PRIORITY[source] < SOURCE_PRIORITY[cur["source"]]:
            best[key] = row | {"since": since or cur["since"]}
    return sorted((best[k] for k in order), key=lambda r: (SOURCE_PRIORITY[r["source"]], r["name"].lower()))


def account_role(business: dict | None, user_id: str) -> str:
    """'owner' if the user owns their business (or has none yet - they'll create one), else 'employee'."""
    if business and business.get("user_id") != user_id:
        return "employee"
    return "owner"


def parse_invite_code(text: str | None) -> str | None:
    """Accept a bare code or a full join link ('https://…/join/AbC123', '/join/AbC123?x=1')."""
    if not text:
        return None
    t = text.strip()
    if "/join/" in t:
        t = t.split("/join/", 1)[1]
    t = t.split("?", 1)[0].split("#", 1)[0].strip().strip("/")
    return t or None
