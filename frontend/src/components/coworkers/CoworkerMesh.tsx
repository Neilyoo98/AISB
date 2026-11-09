"use client";
import { useEffect, useMemo } from "react";
import { useLogFollow } from "@/components/ui";
import { Bot, Moon, User } from "lucide-react";
import { cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { toolType } from "@/lib/tool-icons";
import { CW_PHASES, buildCoworkerMesh, coworkerBeats, cwId, type CwBeat } from "@/lib/agents";
import { Graph, PlayerControls, usePlayer, type MeshNode } from "@/components/agent-graph";
import type { CoworkerView } from "@/hooks/useCoworkerTask";
import type { Employee } from "./types";

/** The coworker mesh for one task: who handles it, who covers for whom, and how work moves through your AI tools. */
export function CoworkerMesh({ view, employees, catalog }: { view: CoworkerView; employees: Employee[]; catalog: Record<string, Tool> }) {
  const empById = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const toolName = useMemo(() => (id: string) => catalog[id]?.name.replace(/ \(.*\)$/, "") || id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), [catalog]);

  const layout = useMemo(
    () => buildCoworkerMesh({ employees, route: view.route, mesh: view.mesh, workflow: view.workflow, toolName }),
    [employees, view.route, view.mesh, view.workflow, toolName],
  );
  const toolIds = useMemo(() => new Set(layout.nodes.filter((n) => n.role === "tool").map((n) => n.refId as string)), [layout]);
  const beats: CwBeat[] = useMemo(
    () => coworkerBeats(view.events, { name: (id) => empById[id]?.name || "A teammate", toolName, toolIds, employeeIds: new Set(employees.map((e) => e.id)) }),
    [view.events, empById, toolName, toolIds, employees],
  );

  const p = usePlayer(beats.length, 2000);
  const running = view.status === "running";
  // while the task is still running, follow the newest beat
  useEffect(() => {
    if (running && beats.length) p.setI(beats.length - 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, beats.length]);

  // Follow the current step inside the log box only (never scrolls the page; pauses after a manual scroll).
  const logRef = useLogFollow<HTMLOListElement>(p.i);

  const nodes: MeshNode[] = layout.nodes.map((n) => {
    let icon: React.ReactNode = <User size={14} />;
    if (n.role === "employee") icon = n.kind === "off" ? <Moon size={14} /> : <Bot size={14} />;
    if (n.role === "tool") {
      const Icon = toolType(catalog[n.refId || ""]?.category || "").icon;
      icon = <Icon size={14} />;
    }
    const sub = n.role === "employee" && n.refId === view.route?.owner_id ? "knows this best" : n.sub;
    return { id: n.id, label: n.label, sub, x: n.x, y: n.y, kind: n.kind, icon };
  });

  const r = view.route;
  const cover =
    r?.substituted && r.owner_id && r.human_id && r.owner_id !== r.human_id
      ? {
          from: cwId.emp(r.owner_id),
          to: cwId.emp(r.human_id),
          note: r.substitution_note || `${empById[r.owner_id]?.name.split(" ")[0] || "They"}'s off today; their coworker shares what they know and ${empById[r.human_id]?.name.split(" ")[0] || "a colleague"} does the work.`,
        }
      : null;
  const cur = beats[Math.min(p.i, beats.length - 1)];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
      <div className="space-y-3">
        <Graph
          nodes={nodes}
          links={layout.links}
          from={cur?.from}
          to={cur?.to || []}
          step={p.i}
          w={layout.w}
          h={layout.h}
          title="Coworker mesh"
          status={running ? "Working on it" : undefined}
          highlight={r ? [cwId.emp(r.owner_id)] : []}
          cover={cover}
          legend={[
            { kind: "coworker", label: "AI coworker" },
            { kind: "off", label: "Off today" },
            { kind: "new", label: "AI tool" },
            { kind: "person", label: "Customer" },
          ]}
          label="Your team's AI coworkers working on this task"
        />
        {beats.length > 0 && !running && <PlayerControls p={p} n={beats.length} />}
      </div>

      <section className="card flex max-h-[560px] flex-col p-4" aria-label="What the coworkers did">
        <h3 className="text-sm font-semibold">What happened, step by step</h3>
        {!beats.length ? (
          <p className="mt-3 text-sm text-stone-500">Reading the task…</p>
        ) : (
          <ol ref={logRef} className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            {CW_PHASES.map((ph) => {
              const rows = beats.map((b, k) => ({ b, k })).filter(({ b }) => b.phase === ph.id);
              if (!rows.length) return null;
              return (
                <li key={ph.id}>
                  <p className={cn("eyebrow mb-1.5", cur?.phase === ph.id && "text-emerald-700")}>{ph.label}</p>
                  <ol className="space-y-1">
                    {rows.map(({ b, k }) => (
                      <li key={k} data-step={k}>
                        <button
                          onClick={() => {
                            p.setI(k);
                            p.setPlaying(false);
                          }}
                          aria-current={k === p.i ? "step" : undefined}
                          className={cn("w-full rounded-lg px-2.5 py-2 text-left transition-colors", k === p.i ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-stone-50", k > p.i && "opacity-45")}
                        >
                          <span className="block text-xs font-semibold text-stone-800">{b.who}</span>
                          <span className={cn("block text-[13px] leading-snug", b.tone === "warn" ? "text-amber-800" : b.tone === "good" ? "text-emerald-800" : "text-stone-600")}>{b.text}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
