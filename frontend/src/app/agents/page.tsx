"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Pause, Play, RotateCcw, Sparkles, User, Wrench } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, RunEvent, Scenario, Tool, User as UserT } from "@/lib/types";
import { AGENT_EDGES, AGENT_NODES, VIEW, hopsFromEvents, type Hop } from "@/lib/agents";
import { actorKind, actorLabel, castOf, norm } from "@/lib/stack";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;
type GNode = { id: string; label: string; sub?: string; x: number; y: number; tone: string };

type Dash = {
  user: UserT;
  business: Business | null;
  latest: null | { run_id: string; scenarios: Scenario[]; approved: { id: string }[] };
};

/* ---------- generic animated graph ---------- */

const TONE: Record<string, { fill: string; stroke: string; text: string }> = {
  core: { fill: "#ffffff", stroke: "#a8a29e", text: "#1c1917" },
  scout: { fill: "#f0fdf4", stroke: "#86efac", text: "#14532d" },
  persona: { fill: "#fffbeb", stroke: "#fcd34d", text: "#78350f" },
  you: { fill: "#1c1917", stroke: "#1c1917", text: "#ffffff" },
  new: { fill: "#ecfdf5", stroke: "#059669", text: "#064e3b" },
  existing: { fill: "#ffffff", stroke: "#a8a29e", text: "#292524" },
  person: { fill: "#fffbeb", stroke: "#f59e0b", text: "#78350f" },
};

function Graph({ nodes, edges, active, from, to, w, h }: { nodes: GNode[]; edges: [string, string][]; active: number; from?: string; to: string[]; w: number; h: number }) {
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const NW = 150;
  const NH = 46;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Agents network">
      {edges.map(([a, b]) => {
        const A = pos[a];
        const B = pos[b];
        if (!A || !B) return null;
        const hot = from === a && to.includes(b);
        return <line key={`${a}-${b}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={hot ? "#059669" : "#e7e5e4"} strokeWidth={hot ? 2.5 : 1.25} />;
      })}
      {from &&
        to.map((t) => {
          const A = pos[from];
          const B = pos[t];
          if (!A || !B) return null;
          return (
            <motion.circle
              key={`${active}-${t}`}
              r={7}
              fill="#059669"
              initial={{ cx: A.x, cy: A.y, opacity: 0 }}
              animate={{ cx: B.x, cy: B.y, opacity: [0, 1, 1, 0] }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
            />
          );
        })}
      {nodes.map((n) => {
        const t = TONE[n.tone] || TONE.core;
        const hot = n.id === from || to.includes(n.id);
        return (
          <g key={n.id} transform={`translate(${n.x - NW / 2}, ${n.y - NH / 2})`}>
            <motion.rect
              width={NW}
              height={NH}
              rx={12}
              fill={t.fill}
              stroke={hot ? "#059669" : t.stroke}
              animate={{ strokeWidth: hot ? 3 : 1.25 }}
              transition={{ duration: 0.25 }}
            />
            <text x={NW / 2} y={n.sub ? 20 : 28} textAnchor="middle" fontSize="13" fontWeight={700} fill={t.text}>
              {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
            </text>
            {n.sub && (
              <text x={NW / 2} y={36} textAnchor="middle" fontSize="10.5" fill={n.tone === "you" ? "#d6d3d1" : "#78716c"}>
                {n.sub.length > 22 ? `${n.sub.slice(0, 21)}…` : n.sub}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function usePlayer(length: number, ms = 1900) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || length === 0) return;
    const id = setTimeout(() => (i < length - 1 ? setI(i + 1) : setPlaying(false)), ms);
    return () => clearTimeout(id);
  }, [i, playing, length, ms]);
  return { i, setI, playing, setPlaying, restart: () => { setI(0); setPlaying(true); } };
}

function Controls({ p, n }: { p: ReturnType<typeof usePlayer>; n: number }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary px-3 py-1.5" onClick={() => p.setPlaying(!p.playing)} aria-label={p.playing ? "Pause" : "Play"}>
        {p.playing ? <Pause size={15} /> : <Play size={15} />} {p.playing ? "Pause" : "Play"}
      </button>
      <button className="btn-ghost px-2.5 py-1.5" onClick={p.restart} aria-label="Restart"><RotateCcw size={15} /></button>
      <span className="text-xs tabular-nums text-stone-500">{Math.min(p.i + 1, n)} / {n}</span>
    </div>
  );
}

/* ---------- tab 1: advisor team ---------- */

function AdvisorTeam({ runId, catalog }: { runId: string; catalog: Record<string, Tool> }) {
  const [events, setEvents] = useState<RunEvent[] | null>(null);
  useEffect(() => {
    api<{ events: RunEvent[] }>(`/runs/${runId}`).then((r) => setEvents(r.events)).catch(() => setEvents([]));
  }, [runId]);
  const names = useMemo(() => Object.fromEntries(Object.values(catalog).map((t) => [t.id, t.name.replace(/ \(.*\)$/, "")])), [catalog]);
  const hops: Hop[] = useMemo(() => (events ? hopsFromEvents(events, names) : []), [events, names]);
  const p = usePlayer(hops.length);
  if (!events) return <PageState kind="loading" />;
  const cur = hops[p.i];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="card p-3 sm:p-5">
        <Graph nodes={AGENT_NODES} edges={AGENT_EDGES} active={p.i} from={cur?.from} to={cur?.to || []} w={VIEW.w} h={VIEW.h} />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <Controls p={p} n={hops.length} />
          <Link href={`/war-room/${runId}`} className="text-sm font-semibold text-emerald-700 hover:underline">Open this run in the War Room →</Link>
        </div>
      </div>
      <div className="card flex max-h-[560px] flex-col p-4">
        <h2 className="text-sm font-semibold">Message log</h2>
        <ol className="mt-3 flex-1 space-y-2 overflow-y-auto pr-1">
          {hops.slice(0, p.i + 1).map((h, k) => (
            <motion.li key={k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }}>
              <button
                onClick={() => { p.setI(k); p.setPlaying(false); }}
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

/* ---------- tab 2: your AI tools ---------- */

function ToolsTeam({ scenarios, approved, catalog }: { scenarios: Scenario[]; approved: string[]; catalog: Record<string, Tool> }) {
  const [s, setS] = useState(0);
  const sc = scenarios[s];
  const p = usePlayer(sc?.steps.length || 0, 2300);
  const cast = castOf(sc, approved);
  const W = 980;
  const cols: Record<string, number> = { person: 140, new: 490, existing: 840 };
  const groups: Record<string, string[]> = { person: [], new: [], existing: [] };
  cast.forEach((a) => groups[actorKind(a, approved)].push(a));
  const H = Math.max(260, Math.max(...Object.values(groups).map((g) => g.length)) * 90 + 60);
  const nodes: GNode[] = cast.map((a) => {
    const k = actorKind(a, approved);
    const g = groups[k];
    const idx = g.indexOf(a);
    return { id: a, label: actorLabel(a, catalog), sub: k === "new" ? "new AI tool" : k === "existing" ? "already used" : "person", x: cols[k], y: ((idx + 1) * H) / (g.length + 1), tone: k };
  });
  const edges = Array.from(new Set(sc?.steps.filter((st) => norm(st.handoff_to)).map((st) => `${st.actor}|${st.handoff_to}`) || [])).map((e) => e.split("|") as [string, string]);
  const cur = sc?.steps[p.i];
  if (!sc) return <PageState kind="empty" message="Approve a stack to see your tools working together." />;
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1">
        {scenarios.map((x, k) => (
          <button key={k} role="tab" aria-selected={k === s} onClick={() => { setS(k); p.restart(); }}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", k === s ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")}>
            {x.title}
          </button>
        ))}
      </div>
      <div className="card p-3 sm:p-5">
        <div className="mb-1 hidden grid-cols-3 text-center text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid">
          <span>People</span><span>New AI tools</span><span>Tools you already use</span>
        </div>
        <Graph nodes={nodes} edges={edges} active={p.i} from={cur?.actor} to={norm(cur?.handoff_to) ? [cur!.handoff_to!] : []} w={W} h={H} />
        <AnimatePresence mode="wait">
          {cur && (
            <motion.div key={`${s}-${p.i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="mt-3 rounded-xl bg-stone-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular-nums text-stone-500">{cur.time}</span>
                <b>{actorLabel(cur.actor, catalog)}</b>
                {norm(cur.handoff_to) && <><ArrowRight size={14} className="text-emerald-600" /><b>{actorLabel(cur.handoff_to!, catalog)}</b></>}
              </div>
              <p className="mt-1 text-stone-900">{cur.action}</p>
              <p className="mt-1 text-sm font-medium text-emerald-700">✓ {cur.result}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <Controls p={p} n={sc.steps.length} />
          <div className="flex flex-wrap gap-3 text-xs text-stone-500">
            <span className="flex items-center gap-1"><Sparkles size={12} className="text-emerald-700" /> New AI tool</span>
            <span className="flex items-center gap-1"><Wrench size={12} /> Already used</span>
            <span className="flex items-center gap-1"><User size={12} className="text-amber-700" /> People</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export default function AgentsPage() {
  useTitle("Agents");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [tab, setTab] = useState<"advisors" | "tools">("advisors");

  const load = () => {
    setErr(null);
    api<Dash>("/dashboard").then(setD).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t]))));
  }, []);

  const latest = d?.latest;
  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={d?.business?.name} isDemo={d?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Agents"
          title="See the agents work together"
          help={
            <>
              <b>Advisor team</b> replays how StackSmith&apos;s AI agents passed work to each other in your latest analysis. <b>Your AI tools</b> shows how the tools you approved
              hand work to each other, and to the tools you already use, during a typical day.
            </>
          }
          actions={latest && <Link href={`/war-room/${latest.run_id}`} className="btn-secondary">Open War Room</Link>}
        />
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !d ? (
          <PageState kind="loading" />
        ) : !latest ? (
          <PageState kind="empty" message="Run your first analysis to see your agents in action.">
            <Link href="/onboard" className="btn-primary mt-4">Start an analysis</Link>
          </PageState>
        ) : (
          <>
            <div role="tablist" className="inline-grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold">
              {([["advisors", "Advisor team"], ["tools", "Your AI tools"]] as const).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={cn("rounded-lg px-4 py-2 transition-colors", tab === k ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}>
                  {l}
                </button>
              ))}
            </div>
            {tab === "advisors" ? (
              <AdvisorTeam runId={latest.run_id} catalog={catalog} />
            ) : (
              <ToolsTeam scenarios={latest.scenarios || []} approved={latest.approved.map((a) => a.id)} catalog={catalog} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
