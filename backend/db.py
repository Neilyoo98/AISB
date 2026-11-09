"""Relational storage: users, businesses, runs, plan tasks, LLM cache and spend log.

SQLite locally, Postgres in production (DATABASE_URL). Plain SQLAlchemy Core.
"""
import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, MetaData, String, Table, Text,
    create_engine, func, select, insert, update, delete,
)

from config import DATABASE_URL

engine = create_engine(DATABASE_URL, pool_pre_ping=True, future=True)
meta = MetaData()


def _now():
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex[:16]


users = Table(
    "users", meta,
    Column("id", String(32), primary_key=True),
    Column("email", String(255), unique=True, nullable=False),
    Column("name", String(255), nullable=False),
    Column("password_hash", String(255), nullable=False),
    Column("is_demo", Boolean, default=False, nullable=False),
    Column("persona_id", String(64)),
    Column("created_at", DateTime(timezone=True), default=_now),
)

businesses = Table(
    "businesses", meta,
    Column("id", String(32), primary_key=True),
    Column("user_id", String(32), ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("name", String(255), nullable=False),
    Column("vertical", String(64)),
    Column("location", String(255)),
    Column("description", Text),
    Column("profile_json", Text),  # latest structured profile (Business Constitution summary)
    Column("details_json", Text),  # structured onboarding answers (must-haves, goals, team, budget...)
    Column("weights_json", Text),  # saved Compare scorecard weights
    Column("scenarios_json", Text),  # day-in-the-life scenarios for the adopted stack (refreshed on adopt)
    Column("ai_spend_cap", Float),  # monthly AI spend cap (team mode)
    Column("created_at", DateTime(timezone=True), default=_now),
)

runs = Table(
    "runs", meta,
    Column("id", String(32), primary_key=True),
    Column("business_id", String(32), ForeignKey("businesses.id", ondelete="CASCADE"), nullable=False),
    Column("user_id", String(32), nullable=False),
    Column("mode", String(16), nullable=False),  # live | replay
    Column("status", String(32), nullable=False),  # running | awaiting_approval | complete | error
    Column("input", Text),
    Column("result_json", Text),
    Column("events_json", Text),
    Column("cost_usd", Float, default=0.0),
    Column("client_ip", String(64)),
    Column("created_at", DateTime(timezone=True), default=_now),
)

plan_tasks = Table(
    "plan_tasks", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("run_id", String(32), ForeignKey("runs.id", ondelete="CASCADE"), nullable=False),
    Column("week", Integer, nullable=False),
    Column("tool_id", String(64)),
    Column("text", Text, nullable=False),
    Column("owner", String(64)),
    Column("minutes", Integer),
    Column("done", Boolean, default=False, nullable=False),
    Column("business_id", String(32)),  # set for setup tasks created by a manual adoption
    Column("source", String(16)),  # null = plan/adoption task, "custom" = published by the owner/team
    Column("suggestions_json", Text),  # tool suggestions for a published task [{tool_id, reason}]
    Column("assignee_employee_id", String(32)),  # set when an approved coworker task assigns the step to an employee
)

llm_cache = Table(
    "llm_cache", meta,
    Column("key", String(64), primary_key=True),
    Column("response", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now),
)

llm_calls = Table(
    "llm_calls", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("run_id", String(32)),
    Column("node", String(64)),
    Column("model", String(128)),
    Column("prompt_tokens", Integer),
    Column("completion_tokens", Integer),
    Column("cost_usd", Float, default=0.0),
    Column("created_at", DateTime(timezone=True), default=_now),
)


reviews = Table(
    "reviews", meta,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("tool_id", String(64), nullable=False, index=True),
    Column("business_id", String(32), nullable=False),
    Column("user_id", String(32), nullable=False),
    Column("role", String(64)),
    Column("output_quality", Integer, nullable=False),
    Column("reliability", Integer, nullable=False),
    Column("support", Integer, nullable=False),
    Column("text", Text),
    Column("verified_use", Boolean, default=False, nullable=False),
    Column("is_demo", Boolean, default=False, nullable=False),
    Column("created_at", DateTime(timezone=True), default=_now),
)


def init_db():
    meta.create_all(engine)
    _add_missing_columns()


def _add_missing_columns():
    """create_all never alters existing tables; add new nullable columns to already-deployed databases."""
    from sqlalchemy import inspect, text
    insp = inspect(engine)
    for table in meta.sorted_tables:
        if not insp.has_table(table.name):
            continue
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in have:
                with engine.begin() as c:
                    c.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {col.name} {col.type.compile(engine.dialect)}'))


# ---------- helpers ----------

def row(r):
    return dict(r._mapping) if r is not None else None


def get_user_by_email(email: str):
    with engine.begin() as c:
        return row(c.execute(select(users).where(users.c.email == email.lower())).first())


def get_user(user_id: str):
    with engine.begin() as c:
        return row(c.execute(select(users).where(users.c.id == user_id)).first())


def create_user(email, name, password_hash, is_demo=False, persona_id=None) -> str:
    uid = new_id()
    with engine.begin() as c:
        c.execute(insert(users).values(id=uid, email=email.lower(), name=name, password_hash=password_hash,
                                       is_demo=is_demo, persona_id=persona_id))
    return uid


def create_business(user_id, name, vertical, location, description, profile=None, details=None) -> str:
    bid = new_id()
    with engine.begin() as c:
        c.execute(insert(businesses).values(id=bid, user_id=user_id, name=name, vertical=vertical,
                                            location=location, description=description,
                                            profile_json=json.dumps(profile) if profile else None,
                                            details_json=json.dumps(details) if details else None))
    return bid


def get_business(bid):
    with engine.begin() as c:
        return row(c.execute(select(businesses).where(businesses.c.id == bid)).first())


def get_user_business(user_id):
    """The business a user owns, or (team mode) the business they are a member of."""
    with engine.begin() as c:
        own = c.execute(select(businesses).where(businesses.c.user_id == user_id)
                        .order_by(businesses.c.created_at.desc())).first()
        if own:
            return row(own)
        members = meta.tables.get("org_members")  # defined in routers/team.py
        if members is None:
            return None
        return row(c.execute(select(businesses).join(members, members.c.business_id == businesses.c.id)
                             .where(members.c.user_id == user_id)).first())


def update_business(bid, **vals):
    for k in ("profile", "details", "weights", "scenarios"):
        if k in vals:
            v = vals.pop(k)
            vals[f"{k}_json"] = None if v is None else json.dumps(v)
    with engine.begin() as c:
        c.execute(update(businesses).where(businesses.c.id == bid).values(**vals))


def create_run(business_id, user_id, mode, raw_input, client_ip=None, created_at=None) -> str:
    rid = new_id()
    with engine.begin() as c:
        c.execute(insert(runs).values(id=rid, business_id=business_id, user_id=user_id, mode=mode,
                                      status="running", input=raw_input, client_ip=client_ip,
                                      created_at=created_at or _now()))
    return rid


def update_run(rid, **vals):
    for k in ("result", "events"):
        if k in vals:
            vals[f"{k}_json"] = json.dumps(vals.pop(k))
    with engine.begin() as c:
        c.execute(update(runs).where(runs.c.id == rid).values(**vals))


def get_run(rid):
    with engine.begin() as c:
        return row(c.execute(select(runs).where(runs.c.id == rid)).first())


def latest_complete_run(business_id):
    with engine.begin() as c:
        # "manual" runs only hold setup tasks for manually adopted tools; they are not analyses
        return row(c.execute(select(runs).where(runs.c.business_id == business_id, runs.c.status == "complete",
                                                runs.c.mode != "manual")
                             .order_by(runs.c.created_at.desc())).first())


def list_runs(business_id, limit=10):
    with engine.begin() as c:
        rs = c.execute(select(runs.c.id, runs.c.status, runs.c.mode, runs.c.created_at, runs.c.cost_usd)
                       .where(runs.c.business_id == business_id, runs.c.mode != "manual")
                       .order_by(runs.c.created_at.desc()).limit(limit)).all()
        return [row(r) for r in rs]


def count_live_runs_since(*, user_id=None, ip=None, hours=24) -> int:
    since = _now() - timedelta(hours=hours)
    q = select(func.count()).select_from(runs).where(runs.c.mode == "live", runs.c.created_at >= since)
    if user_id:
        q = q.where(runs.c.user_id == user_id)
    if ip:
        q = q.where(runs.c.client_ip == ip)
    with engine.begin() as c:
        return c.execute(q).scalar() or 0


def replace_plan_tasks(run_id, tasks):
    with engine.begin() as c:
        # keep setup tasks that came from manual adoptions (business_id set)
        c.execute(delete(plan_tasks).where(plan_tasks.c.run_id == run_id, plan_tasks.c.business_id.is_(None)))
        if tasks:
            c.execute(insert(plan_tasks), [{"run_id": run_id, **t} for t in tasks])


def _task_out(r):
    t = row(r)
    raw = t.pop("suggestions_json", None)
    t["suggestions"] = json.loads(raw) if raw else []
    return t


def get_plan_tasks(run_id):
    with engine.begin() as c:
        rs = c.execute(select(plan_tasks).where(plan_tasks.c.run_id == run_id)
                       .order_by(plan_tasks.c.week, plan_tasks.c.id)).all()
        return [_task_out(r) for r in rs]


def get_business_tasks(business_id, latest_run_id=None):
    """Plan tasks of the latest analysis plus setup tasks from manual adoptions (no duplicates)."""
    with engine.begin() as c:
        cond = plan_tasks.c.business_id == business_id
        if latest_run_id:
            cond = cond | (plan_tasks.c.run_id == latest_run_id)
        rs = c.execute(select(plan_tasks).where(cond).order_by(plan_tasks.c.week, plan_tasks.c.id)).all()
        return [_task_out(r) for r in rs]


def add_custom_task(business_id, run_id, text, week, owner) -> int:
    with engine.begin() as c:
        res = c.execute(insert(plan_tasks).values(run_id=run_id, business_id=business_id, week=week, text=text,
                                                  owner=owner, minutes=None, done=False, source="custom"))
        return int(res.inserted_primary_key[0])


def set_task_suggestions(task_id, suggestions):
    with engine.begin() as c:
        c.execute(update(plan_tasks).where(plan_tasks.c.id == task_id)
                  .values(suggestions_json=json.dumps(suggestions)))


def get_task(task_id):
    with engine.begin() as c:
        r = c.execute(select(plan_tasks).where(plan_tasks.c.id == task_id)).first()
        return _task_out(r) if r else None


def delete_custom_task(task_id, business_id) -> bool:
    with engine.begin() as c:
        res = c.execute(delete(plan_tasks).where(plan_tasks.c.id == task_id, plan_tasks.c.business_id == business_id,
                                                 plan_tasks.c.source == "custom"))
        return res.rowcount > 0


def add_business_tasks(business_id, run_id, tasks):
    if tasks:
        with engine.begin() as c:
            c.execute(insert(plan_tasks), [{"run_id": run_id, "business_id": business_id, "done": False, **t}
                                           for t in tasks])


def set_task_done(task_id, done, user_id):
    """The run's owner, or anyone whose business (owner or team member) the task belongs to, may toggle it."""
    with engine.begin() as c:
        t = c.execute(select(plan_tasks.c.run_id).where(plan_tasks.c.id == task_id)).first()
        if not t:
            return False
        r = c.execute(select(runs.c.user_id, runs.c.business_id).where(runs.c.id == t.run_id)).first()
        if not r:
            return False
    if r.user_id != user_id:
        b = get_user_business(user_id)
        if not b or b["id"] != r.business_id:
            return False
    with engine.begin() as c:
        c.execute(update(plan_tasks).where(plan_tasks.c.id == task_id).values(done=done))
        return True


def cache_get(key):
    with engine.begin() as c:
        r = c.execute(select(llm_cache.c.response).where(llm_cache.c.key == key)).first()
        return r.response if r else None


def cache_put(key, response):
    with engine.begin() as c:
        if c.execute(select(llm_cache.c.key).where(llm_cache.c.key == key)).first():
            return
        c.execute(insert(llm_cache).values(key=key, response=response))


def log_llm_call(run_id, node, model, pt, ct, cost):
    with engine.begin() as c:
        c.execute(insert(llm_calls).values(run_id=run_id, node=node, model=model, prompt_tokens=pt,
                                           completion_tokens=ct, cost_usd=cost))


def total_spend() -> float:
    with engine.begin() as c:
        return float(c.execute(select(func.coalesce(func.sum(llm_calls.c.cost_usd), 0.0))).scalar() or 0.0)


def run_spend(run_id) -> float:
    with engine.begin() as c:
        return float(c.execute(select(func.coalesce(func.sum(llm_calls.c.cost_usd), 0.0))
                               .where(llm_calls.c.run_id == run_id)).scalar() or 0.0)


# ---------- reviews ----------

VERIFIED_AFTER_DAYS = 14


def has_verified_use(business_id: str, tool_id: str, now=None) -> bool:
    """True when this business approved the tool in a completed stack at least 14 days ago."""
    cutoff = (now or _now()) - timedelta(days=VERIFIED_AFTER_DAYS)
    with engine.begin() as c:
        rs = c.execute(select(runs.c.result_json, runs.c.created_at).where(
            runs.c.business_id == business_id, runs.c.status == "complete")).all()
    for r in rs:
        created = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        if created <= cutoff and tool_id in (json.loads(r.result_json or "{}").get("approved_tool_ids") or []):
            return True
    return False


def add_review(tool_id, business_id, user_id, role, output_quality, reliability, support, text_, is_demo=False,
               created_at=None) -> dict:
    vals = dict(tool_id=tool_id, business_id=business_id, user_id=user_id, role=role, output_quality=output_quality,
                reliability=reliability, support=support, text=text_, is_demo=is_demo,
                verified_use=has_verified_use(business_id, tool_id), created_at=created_at or _now())
    with engine.begin() as c:
        c.execute(delete(reviews).where(reviews.c.tool_id == tool_id, reviews.c.business_id == business_id))
        c.execute(insert(reviews).values(**vals))
    return vals


def list_reviews(tool_id, limit=50):
    with engine.begin() as c:
        rs = c.execute(select(reviews, businesses.c.name.label("business_name"), businesses.c.vertical)
                       .select_from(reviews.join(businesses, reviews.c.business_id == businesses.c.id, isouter=True))
                       .where(reviews.c.tool_id == tool_id).order_by(reviews.c.created_at.desc()).limit(limit)).all()
    return [row(r) for r in rs]


def review_aggregates() -> dict:
    with engine.begin() as c:
        rs = c.execute(select(reviews.c.tool_id, func.count(), func.avg(reviews.c.output_quality),
                              func.avg(reviews.c.reliability), func.avg(reviews.c.support),
                              func.sum(func.cast(reviews.c.verified_use, Integer)))
                       .group_by(reviews.c.tool_id)).all()
    out = {}
    for tid, n, q, rel, sup, ver in rs:
        out[tid] = {"count": n, "output_quality": round(float(q), 1), "reliability": round(float(rel), 1),
                    "support": round(float(sup), 1), "overall": round((float(q) + float(rel) + float(sup)) / 3, 1),
                    "verified": int(ver or 0)}
    return out


def delete_demo_data():
    """Remove all demo users (cascades to businesses/runs/tasks via explicit deletes for SQLite)."""
    with engine.begin() as c:
        demo_ids = [r.id for r in c.execute(select(users.c.id).where(users.c.is_demo.is_(True))).all()]
        if not demo_ids:
            return
        biz_ids = [r.id for r in c.execute(select(businesses.c.id).where(businesses.c.user_id.in_(demo_ids))).all()]
        run_ids = [r.id for r in c.execute(select(runs.c.id).where(runs.c.business_id.in_(biz_ids))).all()] if biz_ids else []
        c.execute(delete(reviews).where(reviews.c.is_demo.is_(True)))
        if run_ids:
            c.execute(delete(plan_tasks).where(plan_tasks.c.run_id.in_(run_ids)))
            c.execute(delete(runs).where(runs.c.id.in_(run_ids)))
        if biz_ids:
            c.execute(delete(businesses).where(businesses.c.id.in_(biz_ids)))
        c.execute(delete(users).where(users.c.id.in_(demo_ids)))
