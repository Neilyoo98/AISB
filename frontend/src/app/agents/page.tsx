"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BadgeDollarSign, BookOpen, BrainCircuit, Calculator, ClipboardList, Hand, PiggyBank, Plug, Search, Smile,
} from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, RunEvent, Scenario, Tool, User as UserT } from "@/lib/types";
import { AGENT_LABEL, AGENT_LINKS, AGENT_NODES, PHASES, VIEW, adoptionHops, hopsFromEvents, type AgentIcon, type Hop } from "@/lib/agents";
import { Graph, PlayerControls, ToolsGraph, TourCallouts, usePlayer, type MeshNode } from "@/components/agent-graph";
import { useAdoptions, type Adoption } from "@/hooks/useAdoptions";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";

type Dash = {
  user: UserT;
  business: Business | null;
  latest: null | { run_id: string; scenarios: Scenario[]; approved: { id: string }[] };
};

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
  const to = scouts.length > 1 ? "Scouts" : h.to.length === 3 && h.to.every((t) => ["budget_hawk", "ease_coach", "integration_checker"].includes(t)) ? "Advisors" : h.to.map((t) => AGENT_LABEL[t] || t).join(", ");
  return `${from} → ${to}`;
}

function AdvisorTeam({ runId, catalog, adoptions }: { runId: string; catalog: Record<string, Tool>; adoptions: Adoption[] }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  useEffect(() => {
    api<{ events: RunEvent[] }>(`/runs/${runId}`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [runId]);
  const names = useMemo(() => Object.fromEntries(Object.values(catalog).map((t) => [t.id, t.name.replace(/ \(.*\)$/, "")])), [catalog]);
  const hops: Hop[] = useMemo(() => (events ? [...hopsFromEvents(events, names), ...adoptionHops(adoptions, names)] : []), [events, names, adoptions]);
  const p = usePlayer(hops.length, 2200);
  const logRef = useRef<HTMLOListElement>(null);

  // keep the current step visible in the log
  useEffect(() => {
    logRef.current?.querySelector<HTMLElement>(`[data-step="${p.i}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.i]);

  if (!events) return <PageState kind="loading" />;
  const cur = hops[p.i];
  const phaseNow = cur?.phase;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
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
          <Link href={`/war-room/${runId}`} className="text-sm font-semibold text-emerald-700 hover:underline">
            Open this analysis in the War Room →
          </Link>
        </div>
      </div>

      <section className="card flex max-h-[640px] flex-col p-4" aria-label="What the agents said">
        <h2 className="text-sm font-semibold">What happened, step by step</h2>
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
                    const future = k > p.i;
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
                            future && "opacity-45",
                          )}
                        >
                          <span className={cn("mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md", isCur ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-600")}>
                            <Icon size={13} />
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-semibold text-stone-800">{who(h)}</span>
                            <span className={cn("block text-[13px] leading-snug", h.tone === "warn" ? "text-amber-800" : h.tone === "good" ? "text-emerald-800" : "text-stone-600")}>{h.text}</span>
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

export default function AgentsPage() {
  useTitle("Agents");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [tab, setTab] = useState<"advisors" | "tools">("advisors");
  const { data: adoptions, adopted } = useAdoptions();

  const load = () => {
    setErr(null);
    api<Dash>("/dashboard").then(setD).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t]))));
  }, []);

  const latest = d?.latest;
  // Prefer the business-level scenarios (refreshed whenever a tool is adopted); fall back to the latest plan's.
  const scenarios = adoptions?.scenarios?.length ? adoptions.scenarios : latest?.scenarios || [];
  const approvedIds = adopted.size ? [...adopted] : latest?.approved.map((a) => a.id) || [];
  const updating = adoptions?.scenarios_status === "updating";

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={d?.business?.name} isDemo={d?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Agents"
          title="See the agents work together"
          help={
            <>
              <b>Advisor team</b> replays how StackSmith&apos;s agents passed your analysis along. <b>Your AI tools</b> shows how the tools you adopted hand work to each other during a
              typical day. Tap any line to see what it carries.
            </>
          }
          actions={latest && <Link href={`/war-room/${latest.run_id}`} className="btn-secondary">Open War Room</Link>}
        />
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !d ? (
          <PageState kind="loading" />
        ) : !latest && !adopted.size ? (
          <PageState kind="empty" message="Run your first analysis, or adopt a tool from Discover, to see your agents in action.">
            <div className="mt-4 flex justify-center gap-2">
              <Link href="/onboard" className="btn-primary">Start an analysis</Link>
              <Link href="/tools" className="btn-secondary">Discover tools</Link>
            </div>
          </PageState>
        ) : (
          <>
            <div role="tablist" className="inline-grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold">
              {([["advisors", "Advisor team"], ["tools", "Your AI tools"]] as const).map(([k, l]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn("rounded-lg px-4 py-2 transition-colors", tab === k ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
                >
                  {l}
                </button>
              ))}
            </div>
            {tab === "advisors" ? (
              latest ? (
                <AdvisorTeam runId={latest.run_id} catalog={catalog} adoptions={adoptions?.items || []} />
              ) : (
                <PageState kind="empty" message="The advisor team appears after your first analysis.">
                  <Link href="/onboard" className="btn-primary mt-4">Start an analysis</Link>
                </PageState>
              )
            ) : scenarios.length ? (
              <ToolsGraph key={scenarios.map((s) => s.title).join("|")} scenarios={scenarios} approved={approvedIds} catalog={catalog} note={updating ? "Updating with your new tool…" : null} />
            ) : (
              <PageState kind="empty" message={updating ? "Updating with your new tool…" : "Approve a stack or adopt a tool to see your tools working together."} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
