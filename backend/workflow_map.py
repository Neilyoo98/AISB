"""Workflow map: who works with which AI tools, and how work actually flows between people, tools and customers.

Pure builder (no I/O, no LLM). Built only from real data:
- people (employees) and the tools on their profiles,
- tools the business adopted,
- APPROVED coworker tasks' workflow steps (actor -> handoff_to), aggregated with example actions.
"""
import re

CUSTOMER = "customer"
MAX_EXAMPLES = 3


def person_node_id(employee_id: str) -> str:
    return f"p:{employee_id}"


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.strip().lower()).strip("-")


def _short(name: str) -> str:
    return name.split(" (")[0]


def build_map(*, employees: list[dict], adopted_ids: list[str], tasks: list[dict], catalog: dict[str, dict],
              owner_employee_id: str | None = None, focus: str | None = None, match_catalog=None,
              category_label=None) -> dict:
    """tasks: [{id, text, result}] for approved coworker tasks. Returns {nodes, links, stats, focus}."""
    nodes: dict[str, dict] = {}
    links: dict[tuple, dict] = {}
    emp_ids = {e["id"] for e in employees}

    def cat_label(cat: str | None) -> str:
        if not cat:
            return "AI tool"
        return category_label(cat) if category_label else cat.replace("_", " ").capitalize()

    for e in employees:
        nodes[person_node_id(e["id"])] = {"id": person_node_id(e["id"]), "kind": "person", "label": e["name"],
                                          "sub": e.get("role") or "", "status": e.get("status") or "available"}

    def tool_node(ref: str | None) -> str | None:
        """Catalog id or plain tool name -> tool node id (created on first use)."""
        if not ref:
            return None
        tid = ref if ref in catalog else (match_catalog(ref, catalog) if match_catalog else None)
        if tid:
            nid = f"t:{tid}"
            if nid not in nodes:
                t = catalog[tid]
                nodes[nid] = {"id": nid, "kind": "tool", "label": _short(t["name"]), "sub": cat_label(t.get("category")),
                              "tool_id": tid, "category": t.get("category"), "existing": tid not in adopted_ids}
            return nid
        slug = _slug(ref)
        if not slug:
            return None
        nid = f"t:name:{slug}"
        if nid not in nodes:
            nodes[nid] = {"id": nid, "kind": "tool", "label": ref.strip()[:40], "sub": "Tool you already use",
                          "tool_id": None, "category": None, "existing": True}
        return nid

    def customer_node() -> str:
        if CUSTOMER not in nodes:
            nodes[CUSTOMER] = {"id": CUSTOMER, "kind": "customer", "label": "Customer", "sub": "the people you serve"}
        return CUSTOMER

    def resolve(ref: str | None, actor_type: str | None = None) -> str | None:
        if not ref:
            return None
        if ref == CUSTOMER or actor_type == "customer":
            return customer_node()
        if ref in emp_ids:
            return person_node_id(ref)
        if actor_type == "employee":
            return None  # an employee who no longer exists
        return tool_node(ref)

    def add_link(a: str | None, b: str | None, kind: str, label: str, example: dict | None = None):
        if not a or not b or a == b:
            return
        key = (a, b, kind)
        ln = links.get(key)
        if not ln:
            ln = links[key] = {"from": a, "to": b, "kind": kind, "label": label, "count": 0, "examples": []}
        ln["count"] += 1
        if example and len(ln["examples"]) < MAX_EXAMPLES and example not in ln["examples"]:
            ln["examples"].append(example)

    # 1) tools on people's profiles
    for e in employees:
        for t in e.get("tools") or []:
            add_link(person_node_id(e["id"]), tool_node(t), "uses", "uses")

    # 2) adopted tools: always shown; linked to the owner if nobody else is using them yet
    for tid in adopted_ids:
        if tid not in catalog:
            continue
        nid = tool_node(tid)
        used = any(k[1] == nid for k in links)
        if not used and owner_employee_id in emp_ids:
            add_link(person_node_id(owner_employee_id), nid, "uses", "adopted for the business")

    # 3) approved coworker tasks: hand-offs between people, tools and customers
    used_tasks = 0
    for task in tasks:
        steps = ((task.get("result") or {}).get("workflow")) or []
        if not steps:
            continue
        used_tasks += 1
        for s in steps:
            if s.get("gap"):
                continue
            atype = s.get("actor_type")
            src = resolve(s.get("actor_id"), atype) if atype != "customer" else customer_node()
            dst = resolve(s.get("handoff_to"))
            ex = {"task_text": task.get("text", "")[:120], "action": (s.get("action") or "")[:160], "task_id": task.get("id")}
            label = (s.get("action") or "hands off")[:60]
            add_link(src, dst, "handoff", label, ex)
            # a person doing a step with a tool -> that person uses the tool
            tool_ref = s.get("tool_id")
            if atype == "employee" and tool_ref:
                add_link(src, tool_node(tool_ref), "uses", "uses in tasks", ex)
            elif atype == "tool" and s.get("handoff_to") in emp_ids:
                add_link(person_node_id(s["handoff_to"]), src, "uses", "uses in tasks", ex)

    out_links = list(links.values())
    out_nodes = list(nodes.values())
    focus_node = person_node_id(focus) if focus and person_node_id(focus) in nodes else None
    if focus_node:
        keep = {focus_node} | {l["to"] for l in out_links if l["from"] == focus_node} | \
               {l["from"] for l in out_links if l["to"] == focus_node}
        out_nodes = [n for n in out_nodes if n["id"] in keep]
        out_links = [l for l in out_links if l["from"] in keep and l["to"] in keep]
    return {"nodes": out_nodes, "links": out_links,
            "stats": {"tasks": used_tasks, "people": sum(1 for n in out_nodes if n["kind"] == "person"),
                      "tools": sum(1 for n in out_nodes if n["kind"] == "tool")},
            "focus": focus if focus_node else None}
