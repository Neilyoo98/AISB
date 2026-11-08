import operator
from typing import Annotated, Literal, Optional, TypedDict

from pydantic import BaseModel, Field

PAIN_TAGS = [
    "missed_calls", "phone_orders", "online_ordering", "reviews", "social_media", "email_sms_marketing",
    "marketing_content", "website", "customer_chat", "appointment_booking", "no_shows", "staff_scheduling",
    "quoting", "invoicing_payments", "bookkeeping", "dispatch_routing", "inventory", "menu_costing",
    "admin_writing", "customer_followup",
]
VERTICALS = ["cafe", "restaurant", "hvac", "landscaping", "home_services", "salon", "retail", "other"]

PainTag = Literal[tuple(PAIN_TAGS)]  # type: ignore[valid-type]
Vertical = Literal[tuple(VERTICALS)]  # type: ignore[valid-type]


# ---------- LLM output schemas ----------

class Fact(BaseModel):
    subject: str
    predicate: str
    object: str
    category: Literal["identity", "operations", "current_tools", "budget", "tech_comfort", "pain", "goal"]
    confidence: float = Field(ge=0, le=1)


class Profile(BaseModel):
    business_name: Optional[str] = None
    vertical: Vertical
    location: Optional[str] = None
    employees: int = Field(ge=0)
    monthly_budget: float = Field(ge=0, description="USD per month the owner will spend on software")
    tech_comfort: int = Field(ge=1, le=5, description="1 = avoids computers, 5 = power user")
    current_tools: list[str] = Field(description="lowercase-hyphenated tool names, e.g. square-pos, quickbooks")
    summary: str = Field(description="one sentence describing the business")


class RawPain(BaseModel):
    title: str
    tag: PainTag
    owner_quote: str = Field(description="short verbatim phrase from the owner's text")


class IntakeOut(BaseModel):
    profile: Profile
    raw_pains: list[RawPain]
    facts: list[Fact]


class Pain(BaseModel):
    id: str = Field(description="short slug, e.g. missed-calls")
    title: str
    tag: PainTag
    hours_per_week: float = Field(ge=0)
    hourly_cost: float = Field(ge=0)
    revenue_at_risk_monthly: float = Field(ge=0)
    impact_explanation: str = Field(description="one or two sentences showing the arithmetic")
    evidence_quote: str


class DiagnoseOut(BaseModel):
    pains: list[Pain] = Field(description="the top 3 pains, each with a different tag")


class ScoutPick(BaseModel):
    tool_id: str
    why_fit: str = Field(description="one sentence citing specific catalog features")
    pct_time_saved: float = Field(ge=0, le=1)
    pct_revenue_recovered: float = Field(ge=0, le=1)
    estimate_reasoning: str


class ScoutOut(BaseModel):
    picks: list[ScoutPick] = Field(description="up to 3 picks")


class Critique(BaseModel):
    tool_id: str
    concern: str
    severity: Literal["low", "medium", "high"]
    suggestion: str


class MeshOut(BaseModel):
    headline: str = Field(description="one-sentence overall take, in character")
    critiques: list[Critique] = Field(description="2 to 4 critiques")


class Verdict(BaseModel):
    tool_id: str
    verdict: str = Field(description="two plain-English sentences for the owner")


class VerdictOut(BaseModel):
    stack_summary: str = Field(description="two sentences: what this stack does for the business and why")
    verdicts: list[Verdict]


class PlanTask(BaseModel):
    tool_id: Optional[str] = None
    text: str
    owner: str = Field(description="who does it, e.g. Owner, Manager, Front staff")
    minutes: int = Field(ge=5, le=480)


class PlanWeek(BaseModel):
    week: int = Field(ge=1, le=4)
    theme: str
    tasks: list[PlanTask] = Field(description="2 to 5 tasks")


class Metric(BaseModel):
    metric: str
    target: str


class FlowStep(BaseModel):
    time: str = Field(description="time of day, e.g. 9:40 AM")
    actor: str = Field(description="who acts: an approved tool_id copied exactly, an existing tool name, or Customer / Owner / Staff")
    action: str = Field(description="what happens, max 18 words")
    handoff_to: Optional[str] = Field(default=None, description="actor that receives the work next (same naming rules), or null")
    result: str = Field(description="the payoff for the business, max 12 words")


class Scenario(BaseModel):
    title: str = Field(description="short, concrete, e.g. 'A no-cooling call during lunch'")
    steps: list[FlowStep] = Field(description="4 to 7 steps")


class PlanOut(BaseModel):
    first_step_today: str
    scenarios: list[Scenario] = Field(description="exactly 2 day-in-the-life scenarios showing the approved tools and the owner's existing tools working together")
    weeks: list[PlanWeek] = Field(description="exactly 4 weeks, week 1 to 4")
    success_metrics: list[Metric] = Field(description="2 to 4 metrics")


# ---------- graph state ----------

class AdvisorState(TypedDict, total=False):
    run_id: str
    business_id: str
    business_name: str
    raw_input: str
    details: dict  # structured onboarding answers; must-haves are enforced in code, not by the LLM
    profile: dict
    facts: list[dict]
    memory: dict
    pains: list[dict]
    candidates: Annotated[list[dict], operator.add]  # from tool_scout fan-out
    critiques: list[dict]
    mesh: list[dict]
    scored: list[dict]
    stack: dict
    verdicts: dict
    approved_tool_ids: list[str]
    plan: dict
