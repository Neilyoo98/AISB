"use client";
// One "agents working together" canvas, styled after AUBI's coworker mesh:
// light stone canvas with a faint grid, mono micro-labels, node cards with status dots,
// glowing links with a travelling pulse, and a click-to-open connection card that explains the link.
// - Graph: the canvas (used by the Agents page)
// - usePlayer / PlayerControls: step-by-step autoplay ("Step x of y")
// - ToolsGraph: the business's AI tools handing work to each other (Agents page, dashboard, War Room)
// - TourCallouts: first-visit numbered annotations over a canvas
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Pause, Play, RotateCcw, Sparkles, User, Wrench, X } from "lucide-react";
import { cn } from "@/lib/api";
import type { Scenario, Tool } from "@/lib/types";
import { actorKind, actorLabel, castOf, norm } from "@/lib/stack";

const EASE = [0.23, 1, 0.32, 1] as const;
const GREEN = "#059669";
const INK = "#44403c";

export type MeshKind = "core" | "scout" | "advisor" | "you" | "new" | "existing" | "person" | "coworker" | "off";
/** A dashed "covering for" arc: `from`'s coworker answers for an absent person, `to` does the human step. */
export type MeshCover = { from: string; to: string; note: string };
export type MeshNode = { id: string; label: string; sub?: string; x: number; y: number; kind: MeshKind; icon?: React.ReactNode };
export type MeshLink = { from: string; to: string; label: string; why?: string[]; detail?: React.ReactNode };
/** @deprecated kept for older imports */
export type GNode = MeshNode;

const KIND: Record<MeshKind, { tag: string; accent: string }> = {
  core: { tag: "agent", accent: INK },
  scout: { tag: "scout", accent: GREEN },
  advisor: { tag: "advisor", accent: "#b45309" },
  you: { tag: "you", accent: "#1c1917" },
  new: { tag: "new ai tool", accent: GREEN },
  existing: { tag: "already used", accent: "#78716c" },
  person: { tag: "person", accent: "#b45309" },
  coworker: { tag: "ai coworker", accent: GREEN },
  off: { tag: "off today", accent: "#a8a29e" },
};
const AMBER = "#d97706";

const NW = 156;
const NH = 58;

/** Quadratic curve between two nodes, bowed slightly so crossing links stay distinguishable. */
function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = Math.min(50, len * 0.1) * (a.y <= b.y ? 1 : -1);
  const cx = mx - (dy / len) * bow;
  const cy = my + (dx / len) * bow;
  const at = (t: number) => ({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t ** 2 * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t ** 2 * b.y });
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, at };
}

const key = (l: { from: string; to: string }) => `${l.from}>${l.to}`;

/** The AUBI-style canvas (light stone/emerald). `from`/`to` mark the hand-off happening right now. */
export function Graph({
  nodes, links, from, to = [], step = 0, w, h, title, status, columns, legend, overlay, label = "Agents working together", cover, highlight = [],
}: {
  /** optional "covering for" arc + annotation (coworker mesh substitution) */
  cover?: MeshCover | null;
  /** nodes to ring even when no hand-off is running (e.g. the task's owner coworker) */
  highlight?: string[];
  nodes: MeshNode[];
  links: MeshLink[];
  from?: string;
  to?: string[];
  /** changes every step so the pulse restarts */
  step?: number;
  w: number;
  h: number;
  /** mono header, e.g. "Advisor team" */
  title: string;
  status?: string;
  columns?: { x: number; label: string }[];
  legend?: { kind: MeshKind; label: string }[];
  overlay?: React.ReactNode;
  label?: string;
}) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const pos = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  // Measured canvas width, used to keep the connection card inside the visible area.
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(720);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoxW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const activeKeys = new Set(from ? to.map((t) => `${from}>${t}`) : []);
  const openLink = links.find((l) => key(l) === open);
  const samples = Array.from({ length: 13 }, (_, i) => i / 12);

  return (
    // No overflow-hidden on the frame: connection cards and tour callouts may extend past the canvas edge.
    // Only the decorative grid/vignette layers are clipped to the rounded frame.
    <div className="relative rounded-2xl border border-stone-200 bg-stone-50 shadow-[0_1px_2px_rgba(28,25,23,0.04)]" onClick={() => setOpen(null)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div
          className="absolute inset-0 opacity-70"
          style={{ backgroundImage: "linear-gradient(rgba(168,162,158,0.16) 1px, transparent 1px), linear-gradient(90deg, rgba(168,162,158,0.16) 1px, transparent 1px)", backgroundSize: "48px 48px" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,transparent_45%,#fafaf9_94%)]" />
      </div>

      <div className="relative flex items-center justify-between px-4 pt-3 sm:px-5">
        <p className="font-mono text-[10px] uppercase tracking-[3px] text-emerald-700">{`// ${title}`}</p>
        {status && (
          <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[2px] text-stone-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" /> {status}
          </span>
        )}
      </div>

      {columns && (
        <div className="relative mt-2 hidden sm:block" style={{ height: 14 }}>
          {columns.map((c) => (
            <span key={c.label} className="absolute -translate-x-1/2 font-mono text-[9px] uppercase tracking-[2px] text-stone-500" style={{ left: `${(c.x / w) * 100}%` }}>
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative" ref={boxRef}>
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={label} style={{ overflow: "visible" }}>
          <defs>
            <filter id="mesh-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {links.map((l) => {
            const a = pos[l.from];
            const b = pos[l.to];
            if (!a || !b) return null;
            const k = key(l);
            const hot = activeKeys.has(k) || open === k;
            const lit = hot || hover === k;
            const c = curve(a, b);
            return (
              <g
                key={k}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(k)}
                onMouseLeave={() => setHover((x) => (x === k ? null : x))}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(open === k ? null : k);
                }}
              >
                <path d={c.d} fill="none" stroke={GREEN} strokeOpacity={hot ? 0.18 : lit ? 0.1 : 0} strokeWidth={hot ? 10 : 8} />
                <motion.path
                  d={c.d}
                  fill="none"
                  stroke={hot ? GREEN : lit ? "#34d399" : "#d6d3d1"}
                  strokeWidth={hot ? 2.6 : 1.4}
                  strokeDasharray={hot ? "none" : "6 9"}
                  animate={!reduce && !hot ? { strokeDashoffset: [0, -30] } : undefined}
                  transition={{ duration: 1.6, ease: "linear", repeat: Infinity }}
                />
                <path d={c.d} fill="none" stroke="transparent" strokeWidth={18} />
              </g>
            );
          })}

          {/* labels for the hovered / active / opened link (one at a time keeps it readable) */}
          {links
            .filter((l) => key(l) === (hover ?? open ?? (activeKeys.size === 1 ? [...activeKeys][0] : "")))
            .map((l) => {
              const a = pos[l.from];
              const b = pos[l.to];
              if (!a || !b) return null;
              const m = curve(a, b).at(0.5);
              return (
                <foreignObject key={`lbl-${key(l)}`} x={m.x - 120} y={m.y - 13} width={240} height={26} style={{ pointerEvents: "none", overflow: "visible" }}>
                  <div className="flex h-full items-center justify-center">
                    <span className="whitespace-nowrap rounded-md border border-emerald-200 bg-white px-2 py-0.5 font-mono text-[10px] text-stone-700 shadow-sm">{l.label}</span>
                  </div>
                </foreignObject>
              );
            })}

          {cover && pos[cover.from] && pos[cover.to] && (() => {
            const a = pos[cover.from];
            const b = pos[cover.to];
            // bow the arc away from straight links so it reads as a separate "covering" relationship
            const mx = (a.x + b.x) / 2;
            const my = Math.min(a.y, b.y) - Math.max(60, Math.abs(a.x - b.x) * 0.18);
            const d = `M ${a.x} ${a.y - NH / 2} Q ${mx} ${my} ${b.x} ${b.y - NH / 2}`;
            return (
              <g key="cover">
                <motion.path
                  d={d}
                  fill="none"
                  stroke={AMBER}
                  strokeWidth={2.2}
                  strokeDasharray="7 6"
                  initial={reduce ? false : { pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.9, ease: EASE }}
                />
                <foreignObject x={mx - 150} y={my - 34} width={300} height={44} style={{ overflow: "visible", pointerEvents: "none" }}>
                  <div className="flex h-full items-end justify-center">
                    <span className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-center text-[11px] font-medium leading-snug text-amber-900 shadow-sm">
                      {cover.note}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })()}

          {from &&
            !reduce &&
            to.map((t) => {
              if (!pos[from] || !pos[t]) return null;
              const pts = samples.map(curve(pos[from], pos[t]).at);
              return (
                <motion.circle
                  key={`${step}-${t}`}
                  r={6}
                  fill={GREEN}
                  filter="url(#mesh-glow)"
                  initial={{ cx: pts[0].x, cy: pts[0].y, opacity: 0 }}
                  animate={{ cx: pts.map((p) => p.x), cy: pts.map((p) => p.y), opacity: [0, 1, 1, 1, 0] }}
                  transition={{ duration: 1.1, ease: "easeInOut" }}
                />
              );
            })}

          {nodes.map((n) => {
            const k = KIND[n.kind];
            const hot = n.id === from || to.includes(n.id) || highlight.includes(n.id);
            return (
              <foreignObject key={n.id} x={n.x - NW / 2} y={n.y - NH / 2} width={NW} height={NH} style={{ overflow: "visible" }}>
                <div
                  className={cn(
                    "flex h-full items-center gap-2 rounded-lg border px-2.5 transition-[border-color,box-shadow] duration-300",
                    n.kind === "off" ? "border-dashed bg-stone-100" : "bg-white",
                    hot ? "border-emerald-500 shadow-[0_0_0_3px_rgba(5,150,105,0.12),0_4px_14px_rgba(5,150,105,0.18)]" : "border-stone-200 shadow-[0_1px_2px_rgba(28,25,23,0.06)]",
                  )}
                >
                  {n.icon && (
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-stone-200 bg-stone-50" style={{ color: k.accent }}>
                      {n.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", hot ? "bg-emerald-500" : "bg-stone-300")} />
                      <span className="truncate font-mono text-[8.5px] uppercase tracking-[1.5px]" style={{ color: k.accent }}>{k.tag}</span>
                    </span>
                    <span className="block truncate text-[12.5px] font-semibold leading-tight text-stone-900">{n.label}</span>
                    {n.sub && <span className="block truncate text-[10px] leading-tight text-stone-500">{n.sub}</span>}
                  </span>
                </div>
              </foreignObject>
            );
          })}
        </svg>

        <AnimatePresence>
          {openLink && pos[openLink.from] && pos[openLink.to] && (
            <ConnectionCard
              key={key(openLink)}
              link={openLink}
              fromLabel={pos[openLink.from].label}
              toLabel={pos[openLink.to].label}
              at={curve(pos[openLink.from], pos[openLink.to]).at(0.5)}
              w={w}
              h={h}
              boxW={boxW}
              onClose={() => setOpen(null)}
            />
          )}
        </AnimatePresence>
        {overlay}
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-2 rounded-b-2xl border-t border-stone-200 bg-white/70 px-4 py-2.5 sm:px-5">
        <span className="font-mono text-[9.5px] uppercase tracking-[1.5px] text-stone-500">Tap a line to see what it carries</span>
        {legend && (
          <span className="flex flex-wrap gap-3">
            {legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[1.5px] text-stone-500">
                <span className="h-2 w-2 rounded-sm border" style={{ borderColor: KIND[l.kind].accent, background: `${KIND[l.kind].accent}22` }} />
                {l.label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function ConnectionCard({ link, fromLabel, toLabel, at, w, h, boxW, onClose }: { link: MeshLink; fromLabel: string; toLabel: string; at: { x: number; y: number }; w: number; h: number; boxW: number; onClose: () => void }) {
  // Clamp in pixels against the measured canvas width so the card is never cut off, even on phones.
  const cardW = Math.max(200, Math.min(288, boxW - 16));
  const centerX = (at.x / w) * boxW;
  const left = Math.max(8, Math.min(centerX - cardW / 2, boxW - cardW - 8));
  const below = at.y / h < 0.55;
  return (
    <motion.div
      role="dialog"
      aria-label={`${fromLabel} to ${toLabel}`}
      // framer-motion owns `transform`, so the -50% centering must go through motion (a Tailwind translate class would be overwritten)
      initial={{ opacity: 0, y: below ? -6 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: EASE }}
      onClick={(e) => e.stopPropagation()}
      className="absolute z-30 rounded-xl border border-stone-200 bg-white shadow-xl"
      style={{ left, width: cardW, ...(below ? { top: `calc(${(at.y / h) * 100}% + 16px)` } : { bottom: `calc(${100 - (at.y / h) * 100}% + 16px)` }) }}
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[2px] text-stone-500">
          {fromLabel} <span className="text-emerald-600">→</span> {toLabel}
        </span>
        <button onClick={onClose} aria-label="Close" className="text-stone-400 hover:text-stone-800">
          <X size={13} />
        </button>
      </div>
      <div className="space-y-2 px-3 py-2.5">
        <div>
          <p className="font-mono text-[8.5px] uppercase tracking-[2px] text-emerald-700">What it carries</p>
          <p className="mt-0.5 text-[13px] text-stone-900">{link.label}</p>
        </div>
        {link.why && link.why.length > 0 && (
          <div>
            <p className="font-mono text-[8.5px] uppercase tracking-[2px] text-emerald-700">Why they&apos;re linked</p>
            <ul className="mt-1 space-y-1">
              {link.why.map((y, i) => (
                <li key={i} className="flex gap-2 text-[12px] leading-snug text-stone-600">
                  <span className="font-mono text-emerald-600">›</span>
                  {y}
                </li>
              ))}
            </ul>
          </div>
        )}
        {link.detail}
      </div>
    </motion.div>
  );
}

/** Numbered first-visit annotations over a canvas; dismissed once per browser. */
export function TourCallouts({ storageKey, items }: { storageKey: string; items: { x: number; y: number; text: string }[] }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(!localStorage.getItem(storageKey));
    } catch {
      setShow(true);
    }
  }, [storageKey]);
  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(storageKey, "1");
    } catch {}
  };
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} className="absolute inset-0 z-10 bg-stone-50/80 backdrop-blur-[1px]">
          {items.map((it, i) => (
            <div key={i} className="absolute w-48 -translate-x-1/2 -translate-y-1/2" style={{ left: `${it.x}%`, top: `${it.y}%` }}>
              <div className="rounded-xl border border-emerald-200 bg-white px-3 py-2 shadow-lg">
                <span className="font-mono text-[10px] font-semibold text-emerald-700">0{i + 1}</span>
                <p className="mt-0.5 text-[12.5px] leading-snug text-stone-800">{it.text}</p>
              </div>
            </div>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
            className="btn-primary absolute bottom-3 left-1/2 -translate-x-1/2 px-4 py-1.5 text-xs"
          >
            Got it
          </button>
        </motion.div>
      )}
    </AnimatePresence>
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
      <button className="btn-ghost px-2.5 py-1.5" onClick={p.restart} aria-label="Start over">
        <RotateCcw size={15} />
      </button>
      <span className="text-xs tabular-nums text-stone-500">
        Step {Math.min(p.i + 1, n)} of {n}
      </span>
    </div>
  );
}

const TOOL_ICON: Record<string, React.ReactNode> = {
  new: <Sparkles size={14} />,
  existing: <Wrench size={14} />,
  person: <User size={14} />,
};

/** A typical day: people → new AI tools → tools already in use, with animated hand-offs. */
export function ToolsGraph({
  scenarios, approved, catalog, compact = false, note,
}: {
  scenarios: Scenario[];
  approved: string[];
  catalog: Record<string, Tool>;
  /** dashboard preview: shorter, links to the full view */
  compact?: boolean;
  /** e.g. "Updating with your new tool…" */
  note?: string | null;
}) {
  const [s, setS] = useState(0);
  const sc = scenarios[Math.min(s, scenarios.length - 1)];
  const p = usePlayer(sc?.steps.length || 0, 2300);
  if (!sc) return null;
  const cast = castOf(sc, approved);
  const W = 1000;
  const cols: Record<string, number> = { person: 150, new: 500, existing: 850 };
  const groups: Record<string, string[]> = { person: [], new: [], existing: [] };
  cast.forEach((a) => groups[actorKind(a, approved)].push(a));
  const H = Math.max(compact ? 220 : 280, Math.max(...Object.values(groups).map((g) => g.length)) * 92 + 50);
  const nodes: MeshNode[] = cast.map((a) => {
    const k = actorKind(a, approved);
    const g = groups[k];
    return { id: a, label: actorLabel(a, catalog), x: cols[k], y: ((g.indexOf(a) + 1) * H) / (g.length + 1), kind: k, icon: TOOL_ICON[k] };
  });
  // One link per pair; its card lists every hand-off between those two in this scenario.
  const pairs = new Map<string, typeof sc.steps>();
  sc.steps.forEach((st) => {
    const t = norm(st.handoff_to);
    if (!t) return;
    const k = `${st.actor}>${t}`;
    pairs.set(k, [...(pairs.get(k) || []), st]);
  });
  const links: MeshLink[] = [...pairs.entries()].map(([k, steps]) => {
    const [from, to] = k.split(">");
    return {
      from,
      to,
      label: steps[0].action.length > 38 ? `${steps[0].action.slice(0, 37).trimEnd()}…` : steps[0].action,
      why: steps.map((st) => `${st.time}: ${st.action}${st.result ? ` (${st.result})` : ""}`),
    };
  });
  const cur = sc.steps[Math.min(p.i, sc.steps.length - 1)];
  const curTo = norm(cur?.handoff_to);

  return (
    <div className="space-y-3">
      {scenarios.length > 1 && (
        <div role="tablist" aria-label="Moments in your day" className="flex flex-wrap gap-1">
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
      {note && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900" aria-live="polite">{note}</div>}
      <Graph
        nodes={nodes}
        links={links}
        from={cur?.actor}
        to={curTo ? [curTo] : []}
        step={p.i}
        w={W}
        h={H}
        title="Your AI tools"
        status={p.playing ? "Playing" : undefined}
        columns={[
          { x: cols.person, label: "People" },
          { x: cols.new, label: "New AI tools" },
          { x: cols.existing, label: "Tools you already use" },
        ]}
        legend={compact ? undefined : [
          { kind: "person", label: "People" },
          { kind: "new", label: "New AI tool" },
          { kind: "existing", label: "Already used" },
        ]}
        label="Your AI tools working together"
      />
      <AnimatePresence mode="wait">
        {cur && (
          <motion.div key={`${s}-${p.i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: EASE }} className="card p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-stone-500">{cur.time}</span>
              <b>{actorLabel(cur.actor, catalog)}</b>
              {curTo && (
                <>
                  <ArrowRight size={14} className="text-emerald-600" />
                  <b>{actorLabel(curTo, catalog)}</b>
                </>
              )}
            </div>
            <p className="mt-1 text-stone-900">{cur.action}</p>
            {!compact && cur.result && <p className="mt-1 text-sm font-medium text-emerald-700">✓ {cur.result}</p>}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PlayerControls p={p} n={sc.steps.length} />
        {compact && (
          <Link href="/agents" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
            Full view <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  );
}
