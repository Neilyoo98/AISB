"use client";
// One animated network component for everything "agents / tools working together":
// - Graph: nodes + curved edges + a pulse that travels along the active hand-off
// - usePlayer / PlayerControls: step-by-step autoplay with "Step x of y"
// - ToolsGraph: day-in-the-life scenarios for the business's AI tools (Agents page + compact dashboard preview)
import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Pause, Play, RotateCcw, Sparkles, User, Wrench } from "lucide-react";
import { cn } from "@/lib/api";
import type { Scenario, Tool } from "@/lib/types";
import { actorKind, actorLabel, castOf, norm } from "@/lib/stack";

const EASE = [0.23, 1, 0.32, 1] as const;
export type GNode = { id: string; label: string; sub?: string; x: number; y: number; tone: string };

const TONE: Record<string, { fill: string; stroke: string; text: string }> = {
  core: { fill: "#ffffff", stroke: "#a8a29e", text: "#1c1917" },
  scout: { fill: "#f0fdf4", stroke: "#86efac", text: "#14532d" },
  persona: { fill: "#fffbeb", stroke: "#fcd34d", text: "#78350f" },
  you: { fill: "#1c1917", stroke: "#1c1917", text: "#ffffff" },
  new: { fill: "#ecfdf5", stroke: "#059669", text: "#064e3b" },
  existing: { fill: "#ffffff", stroke: "#a8a29e", text: "#292524" },
  person: { fill: "#fffbeb", stroke: "#f59e0b", text: "#78350f" },
};
const NW = 150;
const NH = 46;

/** Quadratic curve between two nodes, bowed slightly so crossing edges stay distinguishable. */
function curve(a: GNode, b: GNode) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(60, len * 0.12) * (a.y <= b.y ? 1 : -1);
  const cx = mx - (dy / len) * bow;
  const cy = my + (dx / len) * bow;
  const at = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t ** 2 * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t ** 2 * b.y });
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, at };
}

export function Graph({ nodes, edges, active, from, to, w, h, label = "Agents network" }: { nodes: GNode[]; edges: [string, string][]; active: number; from?: string; to: string[]; w: number; h: number; label?: string }) {
  const pos = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const samples = Array.from({ length: 13 }, (_, i) => i / 12);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={label}>
      {edges.map(([a, b]) => {
        if (!pos[a] || !pos[b]) return null;
        const hot = from === a && to.includes(b);
        return <path key={`${a}-${b}`} d={curve(pos[a], pos[b]).d} fill="none" stroke={hot ? "#059669" : "#e7e5e4"} strokeWidth={hot ? 2.5 : 1.25} />;
      })}
      {from &&
        to.map((t) => {
          if (!pos[from] || !pos[t]) return null;
          const c = curve(pos[from], pos[t]);
          const pts = samples.map(c.at);
          return (
            <motion.circle
              key={`${active}-${t}`}
              r={7}
              fill="#059669"
              initial={{ cx: pts[0].x, cy: pts[0].y, opacity: 0 }}
              animate={{ cx: pts.map((p) => p.x), cy: pts.map((p) => p.y), opacity: [0, 1, 1, 1, 0] }}
              transition={{ duration: 1.1, ease: "easeInOut" }}
            />
          );
        })}
      {nodes.map((n) => {
        const t = TONE[n.tone] || TONE.core;
        const hot = n.id === from || to.includes(n.id);
        return (
          <g key={n.id} transform={`translate(${n.x - NW / 2}, ${n.y - NH / 2})`}>
            <motion.rect width={NW} height={NH} rx={12} fill={t.fill} stroke={hot ? "#059669" : t.stroke} animate={{ strokeWidth: hot ? 3 : 1.25 }} transition={{ duration: 0.25 }} />
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

export function usePlayer(length: number, ms = 1900) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing || length === 0) return;
    const id = setTimeout(() => (i < length - 1 ? setI(i + 1) : setPlaying(false)), ms);
    return () => clearTimeout(id);
  }, [i, playing, length, ms]);
  return {
    i,
    setI,
    playing,
    setPlaying,
    restart: () => {
      setI(0);
      setPlaying(true);
    },
  };
}
export type Player = ReturnType<typeof usePlayer>;

export function PlayerControls({ p, n }: { p: Player; n: number }) {
  return (
    <div className="flex items-center gap-2">
      <button className="btn-secondary px-3 py-1.5" onClick={() => p.setPlaying(!p.playing)} aria-label={p.playing ? "Pause" : "Play"}>
        {p.playing ? <Pause size={15} /> : <Play size={15} />} {p.playing ? "Pause" : "Play"}
      </button>
      <button className="btn-ghost px-2.5 py-1.5" onClick={p.restart} aria-label="Restart from step 1">
        <RotateCcw size={15} />
      </button>
      <span className="text-xs tabular-nums text-stone-500">
        Step {Math.min(p.i + 1, n)} of {n}
      </span>
    </div>
  );
}

/** Day-in-the-life scenarios: people → new AI tools → tools already in use, with animated hand-offs. */
export function ToolsGraph({
  scenarios, approved, catalog, compact = false, note,
}: {
  scenarios: Scenario[];
  approved: string[];
  catalog: Record<string, Tool>;
  /** dashboard preview: no step card or legend, links to the full view */
  compact?: boolean;
  /** e.g. "Updating with your new tool…" */
  note?: string | null;
}) {
  const [s, setS] = useState(0);
  const sc = scenarios[Math.min(s, scenarios.length - 1)];
  const p = usePlayer(sc?.steps.length || 0, 2300);
  if (!sc) return null;
  const cast = castOf(sc, approved);
  const W = 980;
  const cols: Record<string, number> = { person: 140, new: 490, existing: 840 };
  const groups: Record<string, string[]> = { person: [], new: [], existing: [] };
  cast.forEach((a) => groups[actorKind(a, approved)].push(a));
  const H = Math.max(compact ? 220 : 260, Math.max(...Object.values(groups).map((g) => g.length)) * 90 + 60);
  const nodes: GNode[] = cast.map((a) => {
    const k = actorKind(a, approved);
    const g = groups[k];
    return { id: a, label: actorLabel(a, catalog), sub: k === "new" ? "new AI tool" : k === "existing" ? "already used" : "person", x: cols[k], y: ((g.indexOf(a) + 1) * H) / (g.length + 1), tone: k };
  });
  const edges = Array.from(new Set(sc.steps.filter((st) => norm(st.handoff_to)).map((st) => `${st.actor}|${st.handoff_to}`))).map((e) => e.split("|") as [string, string]);
  const cur = sc.steps[Math.min(p.i, sc.steps.length - 1)];
  const curTo = norm(cur?.handoff_to);

  return (
    <div className="space-y-3">
      {scenarios.length > 1 && (
        <div role="tablist" aria-label="Scenarios" className="flex flex-wrap gap-1">
          {scenarios.map((x, k) => (
            <button
              key={k}
              role="tab"
              aria-selected={k === s}
              onClick={() => {
                setS(k);
                p.restart();
              }}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", k === s ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")}
            >
              {x.title}
            </button>
          ))}
        </div>
      )}
      <div className="card p-3 sm:p-5">
        {note && <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900" aria-live="polite">{note}</div>}
        <div className="mb-1 hidden grid-cols-3 text-center text-xs font-semibold uppercase tracking-wide text-stone-400 sm:grid">
          <span>People</span>
          <span>New AI tools</span>
          <span>Tools you already use</span>
        </div>
        <Graph nodes={nodes} edges={edges} active={p.i} from={cur?.actor} to={curTo ? [curTo] : []} w={W} h={H} label="Your AI tools working together" />
        <AnimatePresence mode="wait">
          {cur && (
            <motion.div key={`${s}-${p.i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="mt-3 rounded-xl bg-stone-50 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular-nums text-stone-500">{cur.time}</span>
                <b>{actorLabel(cur.actor, catalog)}</b>
                {curTo && (
                  <>
                    <ArrowRight size={14} className="text-emerald-600" />
                    <b>{actorLabel(curTo, catalog)}</b>
                  </>
                )}
              </div>
              <p className="mt-1 text-stone-900">{cur.action}</p>
              {!compact && <p className="mt-1 text-sm font-medium text-emerald-700">✓ {cur.result}</p>}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <PlayerControls p={p} n={sc.steps.length} />
          {compact ? (
            <Link href="/agents" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
              Full view <ArrowRight size={14} />
            </Link>
          ) : (
            <div className="flex flex-wrap gap-3 text-xs text-stone-500">
              <span className="flex items-center gap-1"><Sparkles size={12} className="text-emerald-700" /> New AI tool</span>
              <span className="flex items-center gap-1"><Wrench size={12} /> Already used</span>
              <span className="flex items-center gap-1"><User size={12} className="text-amber-700" /> People</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
