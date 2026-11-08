// Advisor-team network: node layout + how each recorded run event becomes a message between agents.
import type { RunEvent } from "@/lib/types";
import { money } from "@/lib/api";

export type AgentNode = { id: string; label: string; sub: string; x: number; y: number; tone: "core" | "scout" | "persona" | "you" };

export const VIEW = { w: 980, h: 520 };

export const AGENT_NODES: AgentNode[] = [
  { id: "intake", label: "Intake Analyst", sub: "reads your story", x: 80, y: 260, tone: "core" },
  { id: "memory", label: "Memory", sub: "Business Constitution", x: 210, y: 90, tone: "core" },
  { id: "diagnoser", label: "Diagnostician", sub: "$ cost of each pain", x: 320, y: 260, tone: "core" },
  { id: "scout0", label: "Scout 1", sub: "", x: 470, y: 120, tone: "scout" },
  { id: "scout1", label: "Scout 2", sub: "", x: 470, y: 260, tone: "scout" },
  { id: "scout2", label: "Scout 3", sub: "", x: 470, y: 400, tone: "scout" },
  { id: "budget_hawk", label: "Budget Hawk", sub: "protects cash", x: 630, y: 120, tone: "persona" },
  { id: "ease_coach", label: "Ease Coach", sub: "keeps it simple", x: 630, y: 260, tone: "persona" },
  { id: "integration_checker", label: "Integration", sub: "no double entry", x: 630, y: 400, tone: "persona" },
  { id: "roi", label: "ROI Calculator", sub: "deterministic math", x: 780, y: 260, tone: "core" },
  { id: "you", label: "You", sub: "approve", x: 900, y: 140, tone: "you" },
  { id: "planner", label: "Adoption Coach", sub: "30-day plan", x: 900, y: 400, tone: "core" },
];

export const AGENT_EDGES: [string, string][] = [
  ["intake", "memory"], ["memory", "diagnoser"],
  ["diagnoser", "scout0"], ["diagnoser", "scout1"], ["diagnoser", "scout2"],
  ...["scout0", "scout1", "scout2"].flatMap((s) => ["budget_hawk", "ease_coach", "integration_checker"].map((p) => [s, p] as [string, string])),
  ["budget_hawk", "roi"], ["ease_coach", "roi"], ["integration_checker", "roi"],
  ["roi", "you"], ["you", "planner"], ["planner", "memory"],
];

export type Hop = { from: string; to: string[]; text: string; tone?: "good" | "warn" };

/** Turn a run's events into an ordered list of agent-to-agent messages. */
export function hopsFromEvents(events: RunEvent[], names: Record<string, string>): Hop[] {
  const scoutIdx: Record<string, number> = {};
  const hops: Hop[] = [];
  const nm = (id: string) => names[id] || id;
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case "intake.done":
        hops.push({ from: "intake", to: ["memory"], text: `Profile: ${d.profile?.summary ?? "business understood"}` });
        break;
      case "memory.recalled":
        hops.push({ from: "memory", to: ["diagnoser"], text: d.prior_facts ? `Recalled ${d.prior_facts} facts from earlier visits` : "First visit, starting a new Constitution" });
        break;
      case "pain.ranked":
        (d.pains || []).slice(0, 3).forEach((p: { id: string }, i: number) => (scoutIdx[p.id] = i));
        hops.push({
          from: "diagnoser",
          to: (d.pains || []).slice(0, 3).map((_: unknown, i: number) => `scout${i}`),
          text: (d.pains || []).slice(0, 3).map((p: { title: string; monthly_cost_of_pain: number }) => `${p.title} (${money(p.monthly_cost_of_pain)}/mo)`).join(" · "),
        });
        break;
      case "scout.result": {
        const i = scoutIdx[d.pain_id] ?? 0;
        hops.push({ from: `scout${i}`, to: ["budget_hawk", "ease_coach", "integration_checker"], text: `Shortlist: ${(d.picks || []).map((p: { tool_id: string }) => nm(p.tool_id)).join(", ")}` });
        break;
      }
      case "guard.dropped": {
        const i = scoutIdx[d.pain_id] ?? 0;
        hops.push({ from: `scout${i}`, to: [], text: `Blocked ${d.tool_ids?.length ?? 0} tool(s) not in the verified catalog`, tone: "warn" });
        break;
      }
      case "guard.security": {
        const i = scoutIdx[d.pain_id] ?? 0;
        hops.push({ from: `scout${i}`, to: [], text: d.unverified ? `${(d.required || []).join(", ")}: no confirmed tools; flagged for you to verify` : `${(d.required || []).join(", ")}: kept ${d.confirmed?.length} confirmed tools`, tone: "warn" });
        break;
      }
      case "mesh.message": {
        const worst = (d.critiques || []).find((c: { severity: string }) => c.severity === "high");
        hops.push({ from: d.key, to: ["roi"], text: worst ? `${d.headline} — flags ${nm(worst.tool_id)} (high)` : d.headline, tone: worst ? "warn" : undefined });
        break;
      }
      case "stack.scored":
        hops.push({ from: "roi", to: ["you"], text: `Recommends ${(d.stack?.tool_ids || []).map(nm).join(" + ")}: ${money(d.stack?.net_monthly, { sign: true })}/mo net`, tone: "good" });
        break;
      case "plan.ready":
        hops.push({ from: "you", to: ["planner"], text: `Approved ${(d.approved_tool_ids || []).map(nm).join(" + ") || "nothing yet"}` });
        break;
      case "memory.saved":
        hops.push({ from: "planner", to: ["memory"], text: `30-day plan ready; saved ${d.facts} facts and ${d.episodes} adoption(s)`, tone: "good" });
        break;
    }
  }
  return hops;
}
