"use client";
// The StackSmith advisor-team replay (moved out of the Agents page so the War Room can host it).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeDollarSign, BookOpen, BrainCircuit, Calculator, ClipboardList, Hand, PiggyBank, Plug, Search, Smile,
} from "lucide-react";
import { api, cn } from "@/lib/api";
import type { RunEvent, Tool } from "@/lib/types";
import { AGENT_LABEL, AGENT_LINKS, AGENT_NODES, PHASES, VIEW, adoptionHops, hopsFromEvents, type AgentIcon, type Hop } from "@/lib/agents";
import { Graph, PlayerControls, TourCallouts, usePlayer, type MeshNode } from "@/components/agent-graph";
import { useAdoptions } from "@/hooks/useAdoptions";
import { PageState, useLogFollow } from "@/components/ui";

const ICONS: Record<AgentIcon, typeof Search> = {
  intake: BookOpen,
  memory: BrainCircuit,
  diagnoser: BadgeDollarSign,
  scout: Search,
  budget: PiggyBank,
  ease: Smile,
  integration: Plug,
  roi: Calculator,
  you: Hand,
  planner: ClipboardList,
};
const iconFor = (id: string) => ICONS[AGENT_NODES.find((n) => n.id === id)?.icon || "intake"];

const MESH_NODES: MeshNode[] = AGENT_NODES.map((n) => {
  const Icon = ICONS[n.icon];
  return { id: n.id, label: n.label, sub: n.sub, x: n.x, y: n.y, kind: n.kind, icon: <Icon size={14} /> };
});

function who(h: Hop) {
  const from = AGENT_LABEL[h.from] || h.from;
  if (!h.to.length) return from;
  const scouts = h.to.filter((t) => t.startsWith("scout"));
  const to =
    scouts.length > 1
      ? "Scouts"
      : h.to.length === 3 && h.to.every((t) => ["budget_hawk", "ease_coach", "integration_checker"].includes(t))
        ? "Advisors"
        : h.to.map((t) => AGENT_LABEL[t] || t).join(", ");
  return `${from} → ${to}`;
}

/** Replays how StackSmith's advisor agents passed an analysis along, with a plain-language step log. */
export function AdvisorTeamReplay({ runId, catalog, showWarRoomLink = false }: { runId: string; catalog: Record<string, Tool>; showWarRoomLink?: boolean }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  const { data: adoptions } = useAdoptions();
  useEffect(() => {
    api<{ events: RunEvent[] }>(`/runs/${runId}`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [runId]);
  const names = useMemo(() => Object.fromEntries(Object.values(catalog).map((t) => [t.id, t.name.replace(/ \(.*\)$/, "")])), [catalog]);
  const hops: Hop[] = useMemo(
    () => (events ? [...hopsFromEvents(events, names), ...adoptionHops(adoptions?.items || [], names)] : []),
    [events, names, adoptions],
  );
  const p = usePlayer(hops.length, 2200);
  // Follow the current step inside the log box only (scrollIntoView would scroll the whole page while the user scrolls).
  const logRef = useLogFollow<HTMLOListElement>(p.i);

  if (!events) return <PageState kind="loading" />;
  if (!hops.length) return <p className="text-sm text-stone-500">Nothing to replay for this analysis yet.</p>;
  const cur = hops[p.i];
  const phaseNow = cur?.phase;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px] [&>*]:min-w-0">
      <div className="space-y-3">
        <Graph
          nodes={MESH_NODES}
          links={AGENT_LINKS}
          from={cur?.from}
          to={cur?.to || []}
          step={p.i}
          w={VIEW.w}
          h={VIEW.h}
          title="Advisor team"
          status={p.playing ? "Replaying your analysis" : undefined}
          legend={[
            { kind: "core", label: "Agent" },
            { kind: "scout", label: "Scout" },
            { kind: "advisor", label: "Advisor" },
            { kind: "you", label: "You" },
          ]}
          overlay={
            <TourCallouts
              storageKey="ss_agents_tour_v1"
              items={[
                { x: 14, y: 30, text: "Your story goes in here. The Intake Analyst and Memory learn your business." },
                { x: 57, y: 50, text: "Scouts look for tools for each problem. Advisors push back on price, ease and fit." },
                { x: 84, y: 72, text: "You approve; the Adoption Coach writes your 30-day plan." },
              ]}
            />
          }
          label="StackSmith advisor agents"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PlayerControls p={p} n={hops.length} />
          {showWarRoomLink && (
            <Link href={`/war-room/${runId}`} className="text-sm font-semibold text-emerald-700 hover:underline">
              Open this analysis in the War Room →
            </Link>
          )}
        </div>
      </div>

      <section className="card flex max-h-[600px] flex-col p-4" aria-label="What the advisors said">
        <h3 className="text-sm font-semibold">What happened, step by step</h3>
        <ol ref={logRef} className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
          {PHASES.map((ph) => {
            const rows = hops.map((h, k) => ({ h, k })).filter(({ h }) => h.phase === ph.id);
            if (!rows.length) return null;
            return (
              <li key={ph.id}>
                <p className={cn("eyebrow mb-1.5", phaseNow === ph.id && "text-emerald-700")}>{ph.label}</p>
                <ol className="space-y-1">
                  {rows.map(({ h, k }) => {
                    const Icon = iconFor(h.from);
                    const isCur = k === p.i;
                    return (
                      <li key={k} data-step={k}>
                        <button
                          onClick={() => {
                            p.setI(k);
                            p.setPlaying(false);
                          }}
                          aria-current={isCur ? "step" : undefined}
                          className={cn(
                            "flex w-full gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                            isCur ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-stone-50",
                            k > p.i && "opacity-45",
                          )}
                        >
                          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", isCur ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-600")}>
                            <Icon size={13} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-stone-800">{who(h)}</span>
                            <span className={cn("block text-[13px] leading-snug", h.tone === "warn" ? "text-amber-800" : h.tone === "good" ? "text-emerald-800" : "text-stone-600")}>
                              {h.text}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
