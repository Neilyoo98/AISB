"use client";
// How the team actually works with AI: people → the AI tools/apps they use → customers.
// Built from real data (GET /workflow-map): profile tools ("uses", dashed) and approved team-task hand-offs ("handoff", solid).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, User, UserRound, Wrench } from "lucide-react";
import { api, cn } from "@/lib/api";
import { toolType } from "@/lib/tool-icons";
import { Graph, type MeshKind, type MeshLink, type MeshNode } from "@/components/agent-graph";
import { PageState } from "@/components/ui";

export type WFNode = {
  id: string;
  kind: "person" | "tool" | "customer";
  label: string;
  sub?: string;
  status?: "available" | "busy" | "off";
  tool_id?: string | null;
  category?: string | null;
  /** true = a tool the business already used before StackSmith (e.g. Google Calendar) */
  existing?: boolean;
};
export type WFExample = { task_text: string; action: string; task_id: string };
export type WFLink = { from: string; to: string; kind: "uses" | "handoff"; label: string; count: number; examples: WFExample[] };
export type WorkflowMap = { nodes: WFNode[]; links: WFLink[]; stats?: { tasks: number }; focus?: string | null };

const W = 980;
const COL = { person: 150, tool: 490, customer: 830 } as const;
const STATUS_TEXT = { available: "Available", busy: "Busy", off: "Off today" } as const;

function short(t: string, n = 42) {
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Keep only the focused person, the links touching them, and the nodes those links reach. */
function focusMap(map: WorkflowMap, focus: string | null): WorkflowMap {
  if (!focus || !map.nodes.some((n) => n.id === focus)) return map;
  const reach = new Set([focus]);
  // one hop from the person, plus the next hop out of their tools (tool → customer) so hand-offs stay readable
  const first = map.links.filter((l) => l.from === focus || l.to === focus);
  first.forEach((l) => reach.add(l.from === focus ? l.to : l.from));
  const second = map.links.filter((l) => reach.has(l.from) && map.nodes.find((n) => n.id === l.to)?.kind === "customer" && map.nodes.find((n) => n.id === l.from)?.kind === "tool");
  second.forEach((l) => reach.add(l.to));
  const links = [...first, ...second.filter((l) => !first.includes(l))];
  return { ...map, nodes: map.nodes.filter((n) => reach.has(n.id)), links };
}

function layout(map: WorkflowMap, compact: boolean) {
  const cols = { person: [] as WFNode[], tool: [] as WFNode[], customer: [] as WFNode[] };
  map.nodes.forEach((n) => cols[n.kind].push(n));
  if (compact) {
    // keep the busiest nodes so the card stays readable
    const deg = (id: string) => map.links.filter((l) => l.from === id || l.to === id).reduce((a, l) => a + l.count, 0);
    cols.person = [...cols.person].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, 4);
    cols.tool = [...cols.tool].sort((a, b) => deg(b.id) - deg(a.id)).slice(0, 5);
  }
  const rows = Math.max(1, cols.person.length, cols.tool.length, cols.customer.length);
  const gap = compact ? 78 : 86;
  const h = Math.max(compact ? 220 : 280, rows * gap + 60);
  const place = (list: WFNode[], x: number): MeshNode[] =>
    list.map((n, i) => {
      const y = ((i + 1) * h) / (list.length + 1);
      const kind: MeshKind = n.kind === "tool" ? (n.existing ? "existing" : "new") :n.kind === "customer" ? "person" : n.status === "off" ? "off" : "coworker";
      const meta = n.kind === "tool" && n.category ? toolType(n.category) : null;
      const Icon = meta?.icon;
      return {
        id: n.id,
        label: n.label,
        sub: n.kind === "person" ? [n.sub, n.status ? STATUS_TEXT[n.status] : null].filter(Boolean).join(" · ") : n.sub,
        x,
        y,
        kind,
        icon: n.kind === "tool" ? (Icon ? <Icon size={14} /> : <Wrench size={14} />) : n.kind === "customer" ? <User size={14} /> : <UserRound size={14} />,
      };
    });
  const nodes = [...place(cols.person, COL.person), ...place(cols.tool, COL.tool), ...place(cols.customer, COL.customer)];
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, h, ids };
}

export function useWorkflowMap(personId: string | null, enabled = true) {
  const [map, setMap] = useState<WorkflowMap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    if (!enabled) return;
    setErr(null);
    const q = personId ? `?person_id=${encodeURIComponent(personId)}` : "?scope=team";
    api<WorkflowMap>(`/workflow-map${q}`)
      .then(setMap)
      .catch((e) => setErr((e as Error).message));
  };
  useEffect(load, [personId, enabled]);
  return { map, err, reload: load };
}

export function WorkflowGraph({
  map,
  focus: rawFocus = null,
  onFocus,
  compact = false,
  title = "How your team works with AI",
}: {
  map: WorkflowMap;
  /** person id to focus on; null = whole team */
  focus?: string | null;
  /** clicking a person card toggles focus; omit to disable */
  onFocus?: (id: string | null) => void;
  compact?: boolean;
  title?: string;
}) {
  // The API names person nodes "p:<person_id>"; callers may pass either the node id or the raw person id.
  const focusProp = rawFocus && !map.nodes.some((n) => n.id === rawFocus) && map.nodes.some((n) => n.id === `p:${rawFocus}`) ? `p:${rawFocus}` : rawFocus;
  const view = useMemo(() => focusMap(map, focusProp), [map, focusProp]);
  const { nodes, h, ids } = useMemo(() => layout(view, compact), [view, compact]);
  const byId = useMemo(() => Object.fromEntries(view.nodes.map((n) => [n.id, n])), [view]);

  const links: MeshLink[] = useMemo(
    () =>
      view.links
        .filter((l) => ids.has(l.from) && ids.has(l.to))
        .map((l) => ({
          from: l.from,
          to: l.to,
          label: l.label,
          variant: l.kind === "handoff" ? "solid" : "dashed",
          weight: 1.2 + Math.min(4, Math.max(0, l.count - 1)) * 0.7,
          why: [
            l.kind === "uses"
              ? `${byId[l.from]?.label ?? "They"} use${byId[l.from]?.kind === "person" ? "s" : ""} ${byId[l.to]?.label ?? "this tool"} in their day-to-day work.`
              : `Handed off ${l.count === 1 ? "once" : `${l.count} times`} in approved team tasks.`,
          ],
          detail:
            l.examples.length > 0 ? (
              <div>
                <p className="font-mono text-[8.5px] uppercase tracking-[2px] text-emerald-700">In your tasks</p>
                <ul className="mt-1 space-y-1.5">
                  {l.examples.slice(0, 3).map((ex, i) => (
                    <li key={i} className="text-[12px] leading-snug text-stone-600">
                      In &ldquo;{short(ex.task_text)}&rdquo;: {ex.action}{" "}
                      <Link href={`/team?tab=tasks&task=${ex.task_id}`} className="whitespace-nowrap font-semibold text-emerald-700 hover:underline">
                        Open task
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : undefined,
        })),
    [view.links, ids, byId],
  );

  const handoffs = view.links.filter((l) => l.kind === "handoff").length;
  const focusedName = focusProp ? map.nodes.find((n) => n.id === focusProp)?.label : null;

  if (view.nodes.length === 0) return <PageState kind="empty" message="Add your people and their tools to see how your team works with AI." />;

  return (
    <div className="space-y-2">
      <Graph
        nodes={nodes}
        links={links}
        w={W}
        h={h}
        title={focusedName ? `${title} · ${focusedName}` : title}
        label="How people, AI tools and customers connect"
        columns={[
          { x: COL.person, label: "People" },
          { x: COL.tool, label: "AI tools & apps" },
          { x: COL.customer, label: "Customers" },
        ]}
        legend={[
          { kind: "coworker", label: "Person" },
          { kind: "new", label: "AI tool" },
          { kind: "existing", label: "Already used" },
          { kind: "off", label: "Off today" },
        ]}
        hint={onFocus ? "Tap a person to focus · tap a line for examples" : "Tap a line for examples"}
        onNodeClick={
          onFocus
            ? (id) => {
                if (byId[id]?.kind !== "person") return;
                onFocus(focusProp === id ? null : id);
              }
            : undefined
        }
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-stone-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-6 border-t-2 border-dashed border-stone-300" /> Uses this tool
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-6 border-t-2 border-stone-400" /> Hands work off in team tasks
        </span>
        {handoffs === 0 && <span className="text-amber-700">Approve a team task to see hand-offs here.</span>}
        {focusProp && onFocus && (
          <button onClick={() => onFocus(null)} className={cn("ml-auto font-semibold text-emerald-700 hover:underline")}>
            Show whole team
          </button>
        )}
      </div>
    </div>
  );
}

/** Small dashboard card: fetches its own map. */
export function WorkflowCard({ personId = null, title, href = "/team?tab=workflow" }: { personId?: string | null; title: string; href?: string }) {
  const { map, err } = useWorkflowMap(personId);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-xl font-bold">{title}</h2>
        <Link href={href} className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
          Full view <ArrowRight size={14} />
        </Link>
      </div>
      {err ? (
        <p className="text-sm text-stone-500">Couldn&apos;t load the workflow map right now.</p>
      ) : !map ? (
        <div className="h-56 animate-pulse rounded-2xl bg-stone-200/50" />
      ) : (
        <WorkflowGraph map={map} focus={personId} compact title={title} />
      )}
    </section>
  );
}
