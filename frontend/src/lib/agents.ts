// Advisor team: who the agents are, how they are linked (and why), and how a recorded run
// becomes a plain-language message log grouped by phase.
import type { RunEvent } from "@/lib/types";

export type AgentKind = "core" | "scout" | "advisor" | "you";
export type AgentIcon = "intake" | "memory" | "diagnoser" | "scout" | "budget" | "ease" | "integration" | "roi" | "you" | "planner";
export type AgentNode = { id: string; label: string; sub: string; x: number; y: number; kind: AgentKind; icon: AgentIcon };

export const VIEW = { w: 1000, h: 540 };

export const AGENT_NODES: AgentNode[] = [
  { id: "intake", label: "Intake Analyst", sub: "Reads your story", x: 90, y: 270, kind: "core", icon: "intake" },
  { id: "memory", label: "Memory", sub: "Remembers your business", x: 220, y: 90, kind: "core", icon: "memory" },
  { id: "diagnoser", label: "Diagnostician", sub: "Prices each problem", x: 330, y: 270, kind: "core", icon: "diagnoser" },
  { id: "scout0", label: "Scout 1", sub: "Finds tools", x: 485, y: 130, kind: "scout", icon: "scout" },
  { id: "scout1", label: "Scout 2", sub: "Finds tools", x: 485, y: 270, kind: "scout", icon: "scout" },
  { id: "scout2", label: "Scout 3", sub: "Finds tools", x: 485, y: 410, kind: "scout", icon: "scout" },
  { id: "budget_hawk", label: "Budget Hawk", sub: "Protects your cash", x: 650, y: 130, kind: "advisor", icon: "budget" },
  { id: "ease_coach", label: "Ease Coach", sub: "Keeps it simple", x: 650, y: 270, kind: "advisor", icon: "ease" },
  { id: "integration_checker", label: "Integration", sub: "Avoids double entry", x: 650, y: 410, kind: "advisor", icon: "integration" },
  { id: "roi", label: "ROI Calculator", sub: "Does the math", x: 800, y: 270, kind: "core", icon: "roi" },
  { id: "you", label: "You", sub: "Approve the plan", x: 915, y: 130, kind: "you", icon: "you" },
  { id: "planner", label: "Adoption Coach", sub: "Writes your plan", x: 915, y: 410, kind: "core", icon: "planner" },
];

export const AGENT_LABEL: Record<string, string> = Object.fromEntries(AGENT_NODES.map((n) => [n.id, n.label]));

/** Every link, with what flows along it and why the two agents are connected. */
export type AgentLink = { from: string; to: string; label: string; why: string[] };

const SCOUTS = ["scout0", "scout1", "scout2"];
const ADVISORS = ["budget_hawk", "ease_coach", "integration_checker"];
const ADVISOR_FOCUS: Record<string, string> = {
  budget_hawk: "price, contracts and overlap",
  ease_coach: "how hard it is to learn and set up",
  integration_checker: "whether it connects to tools you already use",
};

export const AGENT_LINKS: AgentLink[] = [
  { from: "intake", to: "memory", label: "Your business profile", why: ["The Intake Analyst turns what you wrote into facts (team, budget, tools).", "Memory stores them so you never repeat yourself."] },
  { from: "memory", to: "diagnoser", label: "What we already know", why: ["Memory shares past visits and tools you adopted.", "So the Diagnostician doesn't re-solve problems you already fixed."] },
  ...SCOUTS.map((s, i) => ({
    from: "diagnoser",
    to: s,
    label: "One problem + what it costs you",
    why: [`Each of your top problems gets its own Scout (this is problem ${i + 1}).`, "The Scout knows what the problem costs, so it looks for tools worth that money."],
  })),
  ...SCOUTS.flatMap((s) =>
    ADVISORS.map((a) => ({
      from: s,
      to: a,
      label: "Shortlist of tools",
      why: ["Every shortlist is checked by all three advisors.", `This advisor looks at ${ADVISOR_FOCUS[a]}.`],
    })),
  ),
  ...ADVISORS.map((a) => ({
    from: a,
    to: "roi",
    label: "Concerns about each tool",
    why: [`Flags problems with ${ADVISOR_FOCUS[a]}.`, "Serious concerns lower a tool's chance of being recommended."],
  })),
  { from: "roi", to: "you", label: "Recommended stack", why: ["Picks one tool per problem, within your budget.", "Prefers fewer apps when one tool covers several problems."] },
  { from: "you", to: "planner", label: "Tools you approved", why: ["Nothing moves forward until you approve.", "Only the tools you approve get a rollout plan."] },
  { from: "planner", to: "memory", label: "Your plan and choices", why: ["Your approved tools and plan are saved.", "Next time, the advisors start from here."] },
  { from: "you", to: "memory", label: "Tools you adopted later", why: ["Tools you adopt from Discover are saved too.", "They show up in your plan and future advice."] },
];

export const AGENT_EDGES: [string, string][] = AGENT_LINKS.map((l) => [l.from, l.to]);

export function linkInfo(from: string, to: string): AgentLink | undefined {
  return AGENT_LINKS.find((l) => l.from === from && l.to === to);
}

/* ---------- message log ---------- */

export type Phase = "understand" | "find" | "debate" | "decide" | "plan";
export const PHASES: { id: Phase; label: string }[] = [
  { id: "understand", label: "Understand your business" },
  { id: "find", label: "Find tools" },
  { id: "debate", label: "Debate" },
  { id: "decide", label: "Decide" },
  { id: "plan", label: "Plan" },
];

export type Hop = { from: string; to: string[]; text: string; phase: Phase; tone?: "good" | "warn" };

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Turn a run's events into an ordered list of plain-language messages between agents. */
export function hopsFromEvents(events: RunEvent[], names: Record<string, string>): Hop[] {
  const scoutIdx: Record<string, number> = {};
  const hops: Hop[] = [];
  const nm = (id: string) => names[id] || id;
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case "intake.done":
        hops.push({ from: "intake", to: ["memory"], phase: "understand", text: short(d.profile?.summary ? `Understood your business: ${d.profile.summary}` : "Understood your business.") });
        break;
      case "memory.recalled":
        hops.push({ from: "memory", to: ["diagnoser"], phase: "understand", text: d.prior_facts ? "Shared what we remember from your earlier visits." : "First visit, so it started a fresh profile." });
        break;
      case "pain.ranked": {
        const pains = (d.pains || []).slice(0, 3) as { id: string; title: string }[];
        pains.forEach((p, i) => (scoutIdx[p.id] = i));
        hops.push({ from: "diagnoser", to: pains.map((_, i) => `scout${i}`), phase: "find", text: short(`Picked your biggest problems: ${list(pains.map((p) => p.title))}.`, 180) });
        break;
      }
      case "scout.result": {
        const i = scoutIdx[d.pain_id] ?? 0;
        const picks = (d.picks || []).map((p: { tool_id: string }) => nm(p.tool_id));
        hops.push({ from: `scout${i}`, to: ADVISORS, phase: "find", text: picks.length ? `Suggested ${list(picks)}.` : "Found no good match for this problem." });
        break;
      }
      case "guard.dropped": {
        const i = scoutIdx[d.pain_id] ?? 0;
        hops.push({ from: `scout${i}`, to: [], phase: "find", tone: "warn", text: "Skipped a suggestion that isn't in our checked list of tools." });
        break;
      }
      case "guard.security": {
        const i = scoutIdx[d.pain_id] ?? 0;
        const req = list(d.required || []);
        hops.push({ from: `scout${i}`, to: [], phase: "find", tone: "warn", text: d.unverified ? `Couldn't confirm ${req} for these tools. Check with the vendor.` : `Kept only tools that confirm ${req}.` });
        break;
      }
      case "mesh.message": {
        const worst = (d.critiques || []).find((c: { severity: string }) => c.severity === "high");
        hops.push({ from: d.key, to: ["roi"], phase: "debate", tone: worst ? "warn" : undefined, text: short(worst ? `${d.headline} Strong concern about ${nm(worst.tool_id)}.` : d.headline) });
        break;
      }
      case "stack.scored":
        hops.push({ from: "roi", to: ["you"], phase: "decide", tone: "good", text: `Recommends ${list((d.stack?.tool_ids || []).map(nm))}.` });
        break;
      case "plan.ready":
        hops.push({ from: "you", to: ["planner"], phase: "decide", text: (d.approved_tool_ids || []).length ? `You approved ${list((d.approved_tool_ids || []).map(nm))}.` : "You approved nothing yet." });
        break;
      case "memory.saved":
        hops.push({ from: "planner", to: ["memory"], phase: "plan", tone: "good", text: "Wrote your 30-day plan and saved your choices." });
        break;
    }
  }
  return hops;
}

/** Tools adopted after the analysis (from Discover or the War Room) appear at the end of the log. */
export function adoptionHops(items: { tool_id: string; source: string }[], names: Record<string, string>): Hop[] {
  return items
    .filter((a) => a.source === "manual")
    .map((a) => ({ from: "you", to: ["memory"], phase: "plan" as const, tone: "good" as const, text: `You adopted ${names[a.tool_id] || a.tool_id}. It's now part of your plan.` }));
}

/* ------------------------------------------------------------------ */
/* Coworker mesh (employees' AI coworkers working a task together)     */
/* ------------------------------------------------------------------ */

export type CwNodeKind = "coworker" | "off" | "new" | "person";
export type CwNode = { id: string; label: string; sub?: string; x: number; y: number; kind: CwNodeKind; role: "employee" | "tool" | "customer"; refId: string | null };
export type CwLink = { from: string; to: string; label: string; why: string[] };
export type CwPhase = "understand" | "route" | "share" | "plan" | "decide";
/** One "beat" of the run: a hand-off to animate plus a plain-language log line. */
export type CwBeat = { from?: string; to: string[]; who: string; text: string; tone?: "good" | "warn"; phase: CwPhase };
export const CW_PHASES: { id: CwPhase; label: string }[] = [
  { id: "understand", label: "Understand the task" },
  { id: "route", label: "Pick who handles it" },
  { id: "share", label: "Coworkers share context" },
  { id: "plan", label: "Plan with your AI tools" },
  { id: "decide", label: "Your decision" },
];

type CwEmployee = { id: string; name: string; role: string; status: "available" | "busy" | "off" };
type CwStep = { n: number; actor_type: "employee" | "tool" | "customer"; actor_id: string | null; action: string; tool_id: string | null; handoff_to: string | null; gap: boolean };
type CwMesh = { from_id: string; to_id: string; context_shared: string; should_check: string };
type CwRoute = { owner_id: string; human_id: string; substituted: boolean; substitution_note: string | null; owner_reason: string };

export const cwId = {
  emp: (id: string) => `e:${id}`,
  tool: (id: string) => `t:${id}`,
  customer: "customer",
};

const shortText = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstName = (name: string) => (name || "").split(" ")[0];

/** Layout: coworkers across the top row, AI tools along the bottom row, the customer on the left. */
export function buildCoworkerMesh(args: {
  employees: CwEmployee[];
  route: CwRoute | null;
  mesh: CwMesh[];
  workflow: CwStep[];
  toolName: (id: string) => string;
}): { nodes: CwNode[]; links: CwLink[]; w: number; h: number } {
  const { employees, route, mesh, workflow, toolName } = args;
  const byId: Record<string, CwEmployee> = Object.fromEntries(employees.map((e) => [e.id, e]));
  const involved: string[] = [];
  const add = (id?: string | null) => {
    if (id && byId[id] && !involved.includes(id)) involved.push(id);
  };
  add(route?.owner_id);
  add(route?.human_id);
  mesh.forEach((m) => {
    add(m.from_id);
    add(m.to_id);
  });
  workflow.forEach((s) => {
    if (s.actor_type === "employee") add(s.actor_id);
    add(s.handoff_to);
  });
  if (!involved.length) employees.slice(0, 4).forEach((e) => add(e.id));

  const tools: string[] = [];
  const addTool = (t?: string | null) => {
    if (t && !byId[t] && t !== "customer" && !tools.includes(t)) tools.push(t);
  };
  workflow.forEach((s) => {
    addTool(s.tool_id);
    if (s.actor_type === "tool") addTool(s.actor_id);
    addTool(s.handoff_to);
  });
  const toolSet = new Set(tools);
  const hasCustomer = workflow.some((s) => s.actor_type === "customer" || s.handoff_to === "customer");

  const w = 1000;
  const h = tools.length ? 440 : 300;
  const spread = (n: number, i: number, lo: number, hi: number) => (n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1));
  const left = hasCustomer ? 320 : 160;
  const nodes: CwNode[] = [
    ...involved.map((id, i): CwNode => {
      const e = byId[id];
      return {
        id: cwId.emp(id), label: e.name, sub: e.role, x: spread(involved.length, i, left, 860), y: 150,
        kind: e.status === "off" ? "off" : "coworker", role: "employee", refId: id,
      };
    }),
    ...tools.map((t, i): CwNode => ({ id: cwId.tool(t), label: toolName(t), sub: "AI tool", x: spread(tools.length, i, left, 860), y: 350, kind: "new", role: "tool", refId: t })),
  ];
  if (hasCustomer) nodes.push({ id: cwId.customer, label: "Customer", sub: "the person you serve", x: 120, y: tools.length ? 250 : 150, kind: "person", role: "customer", refId: null });

  const ref = (r: string | null): string | null => {
    if (!r) return null;
    if (r === "customer") return hasCustomer ? cwId.customer : null;
    if (byId[r]) return cwId.emp(r);
    if (toolSet.has(r)) return cwId.tool(r);
    return null;
  };
  const links = new Map<string, CwLink>();
  const put = (from: string, to: string, label: string, why: string) => {
    if (from === to) return;
    const k = `${from}>${to}`;
    const cur = links.get(k);
    if (cur) cur.why.push(why);
    else links.set(k, { from, to, label: shortText(label), why: [why] });
  };
  mesh.forEach((m) => {
    if (!byId[m.from_id] || !byId[m.to_id]) return;
    put(cwId.emp(m.from_id), cwId.emp(m.to_id), m.context_shared, `${firstName(byId[m.from_id].name)}'s coworker shared: ${m.context_shared}${m.should_check ? ` Check: ${m.should_check}` : ""}`);
  });
  workflow.forEach((s) => {
    const actor = s.actor_type === "customer" ? ref("customer") : ref(s.actor_id);
    const tool = s.tool_id ? cwId.tool(s.tool_id) : null;
    const next = ref(s.handoff_to);
    if (actor && tool && actor !== tool) put(actor, tool, s.action, `Step ${s.n}: ${s.action}`);
    const src = tool ?? actor;
    if (src && next) put(src, next, s.action, `Step ${s.n}: ${s.action}`);
  });
  return { nodes, links: [...links.values()], w, h };
}

/** Turn coworker-task events into animated beats with plain-language log lines. */
export function coworkerBeats(
  events: RunEvent[],
  ctx: { name: (employeeId: string) => string; toolName: (id: string) => string; toolIds: Set<string>; employeeIds: Set<string> },
): CwBeat[] {
  const beats: CwBeat[] = [];
  const nodeOf = (r: string | null): string | null => {
    if (!r) return null;
    if (r === "customer") return cwId.customer;
    if (ctx.employeeIds.has(r)) return cwId.emp(r);
    if (ctx.toolIds.has(r)) return cwId.tool(r);
    return null;
  };
  const coworker = (id: string) => `${firstName(ctx.name(id))}'s coworker`;
  for (const e of events) {
    const d = e.data || {};
    switch (e.type) {
      case "task.read":
        beats.push({ to: [], who: "StackSmith", text: d.intent ? `Understood the task: ${d.intent}` : "Read the task.", phase: "understand" });
        break;
      case "route.chosen": {
        const r = d.route || d;
        if (!r.owner_id) break;
        beats.push({ from: cwId.emp(r.owner_id), to: [], who: coworker(r.owner_id), text: r.owner_reason || `${firstName(ctx.name(r.owner_id))} knows this area best.`, phase: "route" });
        break;
      }
      case "route.substituted":
        beats.push({
          from: cwId.emp(d.owner_id),
          to: d.human_id ? [cwId.emp(d.human_id)] : [],
          who: `${coworker(d.owner_id)} → ${firstName(ctx.name(d.human_id))}`,
          text: d.note || `${firstName(ctx.name(d.owner_id))} is off today, so ${firstName(ctx.name(d.human_id))} takes the human step.`,
          tone: "warn",
          phase: "route",
        });
        break;
      case "mesh.message":
        if (!d.from_id || !d.to_id) break;
        beats.push({
          from: cwId.emp(d.from_id),
          to: [cwId.emp(d.to_id)],
          who: `${coworker(d.from_id)} → ${coworker(d.to_id)}`,
          text: d.should_check ? `${d.context_shared} Check: ${d.should_check}` : d.context_shared,
          phase: "share",
        });
        break;
      case "workflow.ready":
        for (const s of (d.workflow || []) as CwStep[]) {
          const actor = s.actor_type === "customer" ? cwId.customer : nodeOf(s.actor_id);
          const tool = s.tool_id ? cwId.tool(s.tool_id) : null;
          const next = nodeOf(s.handoff_to);
          const actorName = s.actor_type === "customer" ? "Customer" : s.actor_type === "tool" ? ctx.toolName(s.actor_id || "") : firstName(ctx.name(s.actor_id || ""));
          const to = [tool && tool !== actor ? tool : null, next].filter((x): x is string => !!x && x !== actor);
          beats.push({
            from: actor ?? undefined,
            to,
            who: tool && actor !== tool && s.tool_id ? `${actorName} + ${ctx.toolName(s.tool_id)}` : actorName,
            text: s.action,
            tone: s.gap ? "warn" : undefined,
            phase: "plan",
          });
        }
        break;
      case "gap.found":
        beats.push({ to: [], who: "StackSmith", text: `None of your tools covers "${d.capability}" yet. See the suggestions below.`, tone: "warn", phase: "plan" });
        break;
      case "drafts.ready": {
        const titles = ((d.drafts || []) as { title: string }[]).map((x) => x.title).join(", ");
        beats.push({ to: [], who: "StackSmith", text: titles ? `Wrote drafts: ${titles}.` : "Wrote drafts ready to copy.", tone: "good", phase: "plan" });
        break;
      }
      case "approval.waiting":
        beats.push({ to: [], who: "You", text: "Waiting for your OK before anything is assigned.", phase: "decide" });
        break;
      case "task.approved":
        beats.push({ to: [], who: "You", text: "Approved. Steps were assigned to your team.", tone: "good", phase: "decide" });
        break;
      case "task.rejected":
        beats.push({ to: [], who: "You", text: "Rejected. Nothing was assigned.", phase: "decide" });
        break;
      case "memory.saved": {
        const who = ((d.employees || []) as string[]).map((id) => `${firstName(ctx.name(id))}'s`).join(", ");
        beats.push({ to: [], who: "Memory", text: `Saved what happened to ${who || "your team's"} coworker notes.`, tone: "good", phase: "decide" });
        break;
      }
    }
  }
  return beats;
}
