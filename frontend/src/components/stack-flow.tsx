"use client";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Pause, Play, RotateCcw, Sparkles, User, Wrench } from "lucide-react";
import { cn } from "@/lib/api";
import type { Scenario, Tool } from "@/lib/types";

const PEOPLE = new Set(["customer", "owner", "staff", "manager", "crew", "tech", "technician"]);
const EASE = [0.23, 1, 0.32, 1] as const;

type Kind = "new" | "existing" | "person";

function norm(a?: string | null) {
  if (!a || a.toLowerCase() === "none" || a.toLowerCase() === "null") return null;
  return a;
}

function pretty(a: string) {
  return a.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StackFlow({ scenarios, catalog, approved }: { scenarios: Scenario[]; catalog: Record<string, Tool>; approved: string[] }) {
  const [sIdx, setSIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const sc = scenarios[Math.min(sIdx, scenarios.length - 1)];

  const kind = (a: string): Kind => (approved.includes(a) ? "new" : PEOPLE.has(a.toLowerCase()) ? "person" : "existing");
  const label = (a: string) => catalog[a]?.name?.replace(/ \(.*\)$/, "") || pretty(a);

  const cast = useMemo(() => {
    if (!sc) return [];
    const seen: string[] = [];
    for (const st of sc.steps) for (const a of [st.actor, norm(st.handoff_to)]) if (a && !seen.includes(a)) seen.push(a);
    const order: Record<Kind, number> = { person: 0, new: 1, existing: 2 };
    return seen.sort((x, y) => order[kind(x)] - order[kind(y)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sc, approved]);

  useEffect(() => {
    if (!playing || !sc) return;
    const id = setTimeout(() => {
      if (step < sc.steps.length - 1) setStep(step + 1);
      else setPlaying(false);
    }, 2200);
    return () => clearTimeout(id);
  }, [playing, step, sc]);

  if (!sc) return null;
  const cur = sc.steps[step];
  const from = cur.actor;
  const to = norm(cur.handoff_to);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-3">
        <div role="tablist" className="flex flex-wrap gap-1">
          {scenarios.map((s, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === sIdx}
              onClick={() => {
                setSIdx(i);
                setStep(0);
                setPlaying(true);
              }}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition-colors", i === sIdx ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100")}
            >
              {s.title}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2.5 py-1.5" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="btn-ghost px-2.5 py-1.5"
            onClick={() => {
              setStep(0);
              setPlaying(true);
            }}
            aria-label="Replay"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Cast: every tool and person in this scenario; the active hand-off lights up */}
      <div className="flex flex-wrap items-center justify-center gap-2.5 bg-stone-50/70 px-5 py-6">
        {cast.map((a) => {
          const k = kind(a);
          const active = a === from || a === to;
          return (
            <motion.div
              key={a}
              animate={{ scale: active ? 1.06 : 1, opacity: active ? 1 : 0.55 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm",
                k === "new" && "border-emerald-300 bg-white text-emerald-900",
                k === "existing" && "border-stone-300 bg-white text-stone-800",
                k === "person" && "border-amber-200 bg-amber-50 text-amber-900",
                a === from && "ring-2 ring-emerald-500 ring-offset-2",
                a === to && a !== from && "ring-2 ring-sky-400 ring-offset-2",
              )}
            >
              {k === "person" ? <User size={14} /> : k === "new" ? <Sparkles size={14} /> : <Wrench size={14} />}
              {label(a)}
              {k === "new" && <span className="rounded bg-emerald-100 px-1 text-[10px] uppercase text-emerald-800">new</span>}
            </motion.div>
          );
        })}
      </div>

      <div className="px-5 py-5">
        <AnimatePresence mode="wait">
          <motion.div key={`${sIdx}-${step}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25, ease: EASE }}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="tabular-nums text-stone-500">{cur.time}</span>
              <span className="font-semibold">{label(from)}</span>
              {to && (
                <>
                  <ArrowRight size={16} className="text-sky-500" />
                  <span className="font-semibold">{label(to)}</span>
                </>
              )}
            </div>
            <p className="mt-1.5 text-lg leading-snug text-stone-900">{cur.action}</p>
            <p className="mt-1 text-sm font-medium text-emerald-700">✓ {cur.result}</p>
          </motion.div>
        </AnimatePresence>

        <ol className="mt-5 space-y-1 border-t border-stone-100 pt-4">
          {sc.steps.map((st, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  setStep(i);
                  setPlaying(false);
                }}
                className={cn("flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", i === step ? "bg-emerald-50" : "hover:bg-stone-50")}
              >
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", i < step ? "bg-emerald-600" : i === step ? "bg-emerald-500 ring-4 ring-emerald-100" : "bg-stone-300")} />
                <span className="w-16 shrink-0 tabular-nums text-stone-500">{st.time}</span>
                <span className={cn("min-w-0", i > step && "text-stone-400")}>
                  <b className="font-semibold">{label(st.actor)}</b>
                  {norm(st.handoff_to) && <> → {label(st.handoff_to!)}</>}: {st.action}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap gap-3 text-xs text-stone-500">
          <span className="flex items-center gap-1"><Sparkles size={12} className="text-emerald-700" /> New AI tool</span>
          <span className="flex items-center gap-1"><Wrench size={12} /> Tool you already use</span>
          <span className="flex items-center gap-1"><User size={12} className="text-amber-700" /> People</span>
        </div>
      </div>
    </div>
  );
}
