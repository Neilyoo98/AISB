"use client";
import { ArrowRight, Bot, TriangleAlert, User } from "lucide-react";
import { cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { ToolIcon } from "@/lib/tool-icons";
import { AdoptButton } from "@/components/adopt-button";
import { HelpTip } from "@/components/ui";
import type { CoworkerView } from "@/hooks/useCoworkerTask";
import type { Employee, WorkflowStep } from "./types";

type Lane = { key: string; label: string; sub: string; kind: "employee" | "tool" | "customer"; icon: React.ReactNode };

/** Swimlanes (people, AI tools, customer) with numbered steps; tool steps show the manual work they replace. */
export function WorkflowMap({ view, employees, catalog }: { view: CoworkerView; employees: Employee[]; catalog: Record<string, Tool> }) {
  const steps = view.workflow;
  if (!steps.length) return null;
  const emp = Object.fromEntries(employees.map((e) => [e.id, e]));
  const toolName = (id: string) => catalog[id]?.name.replace(/ \(.*\)$/, "") || id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const first = (id: string | null) => (id && emp[id] ? emp[id].name.split(" ")[0] : "Someone");

  const laneOf = (s: WorkflowStep): string => (s.actor_type === "customer" ? "customer" : s.actor_type === "tool" ? `t:${s.actor_id}` : s.tool_id ? `t:${s.tool_id}` : `e:${s.actor_id}`);
  const lanes: Lane[] = [];
  const addLane = (k: string) => {
    if (lanes.some((l) => l.key === k)) return;
    if (k === "customer") lanes.push({ key: k, label: "Customer", sub: "", kind: "customer", icon: <User size={15} /> });
    else if (k.startsWith("t:")) {
      const id = k.slice(2);
      lanes.push({ key: k, label: toolName(id), sub: "AI tool", kind: "tool", icon: catalog[id] ? <ToolIcon category={catalog[id].category} size={28} /> : <Bot size={15} /> });
    } else {
      const id = k.slice(2);
      const e = emp[id];
      lanes.push({ key: k, label: e?.name || "Teammate", sub: e ? `${e.role}${e.status === "off" ? " · off today" : ""}` : "", kind: "employee", icon: <span className="text-xs font-semibold">{e?.initials || "?"}</span> });
    }
  };
  steps.forEach((s) => addLane(laneOf(s)));

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 border-b border-stone-100 px-5 py-3">
        <h3 className="flex items-center gap-1 font-semibold">
          The workflow
          <HelpTip>Each row is a person, an AI tool, or your customer. Numbers show the order. Green steps are done by one of your AI tools instead of by hand; amber steps have no tool yet.</HelpTip>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[640px] divide-y divide-stone-100">
          {lanes.map((lane) => {
            const own = steps.filter((s) => laneOf(s) === lane.key);
            return (
              <div key={lane.key} className="grid grid-cols-[170px_1fr]">
                <div className="flex items-center gap-2.5 bg-stone-50/70 px-4 py-3">
                  <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", lane.kind === "employee" ? "bg-stone-200 text-stone-700" : lane.kind === "customer" ? "bg-amber-100 text-amber-800" : "")}>
                    {lane.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{lane.label}</span>
                    {lane.sub && <span className="block truncate text-[11px] text-stone-500">{lane.sub}</span>}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 px-3 py-3">
                  {own.map((s) => {
                    const gap = view.gaps[s.n] || (s.gap ? { capability: s.gap_capability || "this step", recommendations: s.recommendations } : null);
                    return (
                      <div
                        key={s.n}
                        className={cn(
                          "w-full max-w-[340px] rounded-xl border px-3 py-2.5 text-sm",
                          gap ? "border-amber-300 bg-amber-50" : s.tool_id || s.actor_type === "tool" ? "border-emerald-200 bg-emerald-50/60" : "border-stone-200 bg-white",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold", gap ? "bg-amber-500 text-white" : "bg-stone-900 text-white")}>{s.n}</span>
                          <span className="min-w-0 text-stone-900">{s.action}</span>
                        </div>
                        {s.manual_before && (s.tool_id || s.actor_type === "tool") && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-stone-600">
                            <span className="line-through decoration-stone-400">{s.manual_before}</span>
                            <ArrowRight size={12} className="text-emerald-600" />
                            <span className="font-medium text-emerald-800">{toolName(s.tool_id || s.actor_id || "")} does it</span>
                          </p>
                        )}
                        {s.handoff_to && (
                          <p className="mt-1 text-[11px] text-stone-500">
                            Then → {s.handoff_to === "customer" ? "Customer" : emp[s.handoff_to] ? first(s.handoff_to) : toolName(s.handoff_to)}
                          </p>
                        )}
                        {gap && (
                          <div className="mt-2 space-y-1.5 border-t border-amber-200 pt-2">
                            <p className="flex items-center gap-1 text-xs font-medium text-amber-900">
                              <TriangleAlert size={12} /> No tool you use covers {gap.capability}
                            </p>
                            {gap.recommendations.slice(0, 2).map((rec) => (
                              <div key={rec.tool_id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                                <span className="min-w-0">
                                  <span className="block text-xs font-semibold text-stone-900">{toolName(rec.tool_id)}</span>
                                  <span className="block text-[11px] leading-snug text-stone-600">{rec.reason}</span>
                                </span>
                                <AdoptButton toolId={rec.tool_id} compact />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
