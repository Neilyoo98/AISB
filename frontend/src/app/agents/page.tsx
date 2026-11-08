"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, cn } from "@/lib/api";
import type { Business, RunEvent, Scenario, Tool, User as UserT } from "@/lib/types";
import { AGENT_EDGES, AGENT_NODES, VIEW, adoptionHops, hopsFromEvents, type Hop } from "@/lib/agents";
import { Graph, PlayerControls, ToolsGraph, usePlayer } from "@/components/agent-graph";
import { useAdoptions, type Adoption } from "@/hooks/useAdoptions";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;

type Dash = {
  user: UserT;
  business: Business | null;
  latest: null | { run_id: string; scenarios: Scenario[]; approved: { id: string }[] };
};

function AdvisorTeam({ runId, catalog, adoptions }: { runId: string; catalog: Record<string, Tool>; adoptions: Adoption[] }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  useEffect(() => {
    api<{ events: RunEvent[] }>(`/runs/${runId}`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [runId]);
  const names = useMemo(() => Object.fromEntries(Object.values(catalog).map((t) => [t.id, t.name.replace(/ \(.*\)$/, "")])), [catalog]);
  const hops: Hop[] = useMemo(() => (events ? [...hopsFromEvents(events, names), ...adoptionHops(adoptions, names)] : []), [events, names, adoptions]);
  const p = usePlayer(hops.length);
  if (!events) return <PageState kind="loading" />;
  const cur = hops[p.i];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card p-3 sm:p-5">
        <Graph nodes={AGENT_NODES} edges={AGENT_EDGES} active={p.i} from={cur?.from} to={cur?.to || []} w={VIEW.w} h={VIEW.h} label="StackSmith advisor agents" />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <PlayerControls p={p} n={hops.length} />
          <Link href={`/war-room/${runId}`} className="text-sm font-semibold text-emerald-700 hover:underline">
            Open this analysis in the War Room →
          </Link>
        </div>
      </div>
      <div className="card flex max-h-[560px] flex-col p-4">
        <h2 className="text-sm font-semibold">Message log</h2>
        <ol className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {hops.slice(0, p.i + 1).map((h, k) => (
            <motion.li key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
              <button
                onClick={() => {
                  p.setI(k);
                  p.setPlaying(false);
                }}
                className={cn("w-full rounded-lg px-3 py-2 text-left text-xs", k === p.i ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-stone-50")}
              >
                <span className="font-semibold text-stone-800">
                  {AGENT_NODES.find((n) => n.id === h.from)?.label}
                  {h.to.length > 0 && ` → ${h.to.map((t) => AGENT_NODES.find((n) => n.id === t)?.label).join(", ")}`}
                </span>
                <span className={cn("mt-0.5 block leading-snug", h.tone === "warn" ? "text-amber-800" : h.tone === "good" ? "text-emerald-800" : "text-stone-600")}>{h.text}</span>
              </button>
            </motion.li>
          ))}
        </ol>
      </div>
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
              <b>Advisor team</b> replays how StackSmith&apos;s AI agents passed work to each other in your latest analysis, plus any tools you adopted since. <b>Your AI tools</b>{" "}
              shows how your adopted tools hand work to each other, and to the tools you already use, during a typical day. It updates whenever you adopt a tool.
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
