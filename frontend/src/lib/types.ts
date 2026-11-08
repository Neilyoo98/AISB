export type User = { id: string; name: string; email: string; is_demo: boolean; persona_id?: string | null };

export type Profile = {
  business_name?: string | null;
  vertical: string;
  location?: string | null;
  employees: number;
  monthly_budget: number;
  tech_comfort: number;
  current_tools: string[];
  summary: string;
};

export type Business = {
  id: string;
  name: string;
  vertical: string | null;
  location: string | null;
  description: string | null;
  profile: Profile | null;
  details?: BusinessDetails | null;
};

export type BusinessDetails = {
  business_category?: string | null;
  business_type?: string | null;
  team_size?: number | null;
  budget?: string | null;
  tech_comfort?: number | null;
  current_tools?: string[];
  security_must_haves?: string[];
  goals?: string[];
};

export type Tool = {
  id: string;
  name: string;
  url: string;
  category: string;
  verticals: string[];
  solves: string[];
  ai_features: string[];
  description: string;
  price_monthly_min: number;
  price_monthly_typical: number;
  free_tier: boolean;
  setup_hours: number;
  tech_comfort_min: number;
  integrates_with: string[];
  pros: string[];
  cons: string[];
  capability?: string;
  modalities_in?: string[];
  modalities_out?: string[];
  workflows?: string[];
  deployment?: "saas" | "vpc" | "on_prem";
  api_available?: boolean;
  pricing_model?: "flat" | "per_seat" | "usage";
  unit?: string | null;
  unit_price?: number | null;
  seats_included?: number;
  units_included?: number | null;
  trust?: Record<string, TrustFact>;
  reviews?: ReviewAgg | null;
  categories?: string[];
};

export type TrustStatus = "verified" | "vendor_claimed" | "unknown";
export type TrustFact = { status: TrustStatus; source_url: string | null; as_of: string | null; quote?: string | null };

export type RiskLevel = "low" | "medium" | "high" | "not_assessed";
export type RiskItem = { level: RiskLevel; reason: string; basis: string };
export type Risk = Partial<Record<"hallucination" | "bias" | "prompt_injection" | "data_exfiltration", RiskItem>>;

export type Adoption = { tool_id: string; source: "plan" | "manual"; adopted_at: string; run_id?: string | null };

export type ReviewAgg = { count: number; output_quality: number; reliability: number; support: number; overall: number; verified: number };

export type Pain = {
  id: string;
  title: string;
  tag: string;
  hours_per_week: number;
  hourly_cost: number;
  revenue_at_risk_monthly: number;
  impact_explanation: string;
  evidence_quote: string;
  monthly_cost_of_pain: number;
};

export type Pick = {
  tool_id: string;
  pain_id: string;
  why_fit: string;
  pct_time_saved: number;
  pct_revenue_recovered: number;
  estimate_reasoning: string;
};

export type Critique = { tool_id: string; concern: string; severity: "low" | "medium" | "high"; suggestion: string; persona: string };
export type MeshMsg = { persona: string; key: string; headline: string; critiques: Critique[] };

export type Scored = Pick & {
  monthly_cost: number;
  hours_saved_per_month: number;
  time_value_monthly: number;
  revenue_recovered_monthly: number;
  monthly_value: number;
  net_monthly: number;
  setup_cost: number;
  payback_days: number | null;
  roi_multiple: number | null;
  fit_score: number;
  fit_breakdown: Record<string, number>;
};

export type Stack = {
  tool_ids: string[];
  monthly_cost: number;
  monthly_value: number;
  net_monthly: number;
  hours_saved_per_month: number;
  within_budget: boolean;
  budget: number;
  picks: Record<string, string>;
};

export type PlanTask = { tool_id: string | null; text: string; owner: string; minutes: number };
export type FlowStep = { time: string; actor: string; action: string; handoff_to?: string | null; result: string };
export type Scenario = { title: string; steps: FlowStep[] };

export type Plan = {
  first_step_today: string;
  scenarios?: Scenario[];
  weeks: { week: number; theme: string; tasks: PlanTask[] }[];
  success_metrics: { metric: string; target: string }[];
};

// Event payloads differ per event type; the reducer narrows them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RunEvent = { seq: number; t: number; type: string; agent: string | null; data: Record<string, any> };
