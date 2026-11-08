// Shared helpers for "Stack in action" scenarios (used by components/agent-graph.tsx).
import type { Scenario, Tool } from "@/lib/types";

export type ActorKind = "new" | "existing" | "person";

const PEOPLE = new Set(["customer", "owner", "staff", "manager", "crew", "tech", "technician", "front staff"]);

export function norm(a?: string | null): string | null {
  if (!a || a.toLowerCase() === "none" || a.toLowerCase() === "null") return null;
  return a;
}

export function pretty(a: string) {
  return a.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function actorKind(a: string, approved: string[]): ActorKind {
  if (approved.includes(a)) return "new";
  return PEOPLE.has(a.toLowerCase()) ? "person" : "existing";
}

export function actorLabel(a: string, catalog: Record<string, Tool>) {
  return catalog[a]?.name?.replace(/ \(.*\)$/, "") || pretty(a);
}

/** Everyone who appears in a scenario: people first, then new AI tools, then existing tools. */
export function castOf(sc: Scenario | undefined, approved: string[]): string[] {
  if (!sc) return [];
  const seen: string[] = [];
  for (const st of sc.steps) for (const a of [st.actor, norm(st.handoff_to)]) if (a && !seen.includes(a)) seen.push(a);
  const order: Record<ActorKind, number> = { person: 0, new: 1, existing: 2 };
  return seen.sort((x, y) => order[actorKind(x, approved)] - order[actorKind(y, approved)]);
}
