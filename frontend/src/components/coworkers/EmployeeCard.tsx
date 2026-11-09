"use client";
import { Bot } from "lucide-react";
import { cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { ToolIcon } from "@/lib/tool-icons";
import { STATUS_LABEL, type Employee, type EmployeeStatus } from "./types";

const STATUS_TONE: Record<EmployeeStatus, string> = {
  available: "bg-emerald-600 text-white",
  busy: "bg-amber-500 text-white",
  off: "bg-stone-600 text-white",
};
const DOT: Record<EmployeeStatus, string> = { available: "bg-emerald-500", busy: "bg-amber-500", off: "bg-stone-400" };

/** One employee + their AI coworker: skills, tools they use, and an availability toggle. */
export function EmployeeCard({
  e, catalog, onOpen, onStatus, busy, canEdit, highlight,
}: {
  e: Employee;
  catalog: Record<string, Tool>;
  onOpen: () => void;
  onStatus: (s: EmployeeStatus) => void;
  busy: boolean;
  canEdit: boolean;
  highlight?: boolean;
}) {
  return (
    <div className={cn("card flex flex-col p-4 transition-[border-color,box-shadow]", highlight && "border-emerald-500 ring-2 ring-emerald-500/20", e.status === "off" && "bg-stone-50")}>
      <button onClick={onOpen} className="flex items-start gap-3 text-left" aria-label={`Open ${e.name}'s coworker`}>
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 font-semibold text-stone-700">
          {e.initials}
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white", DOT[e.status])} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-stone-900 hover:underline">{e.name}</span>
          <span className="block truncate text-xs text-stone-500">{e.role}</span>
          <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <Bot size={12} /> AI coworker
          </span>
        </span>
      </button>

      {e.skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {e.skills.slice(0, 4).map((s) => (
            <span key={s} className="chip">{s}</span>
          ))}
        </div>
      )}

      {e.tools.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Tools they use">
          {e.tools.slice(0, 5).map((t) =>
            catalog[t] ? (
              <span key={t} title={catalog[t].name}>
                <ToolIcon category={catalog[t].category} size={24} />
              </span>
            ) : (
              <span key={t} className="rounded-md border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600">{t}</span>
            ),
          )}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div role="radiogroup" aria-label={`${e.name}'s availability`} className="grid grid-cols-3 rounded-lg bg-stone-100 p-0.5 text-[11px] font-semibold">
          {(["available", "busy", "off"] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={e.status === s}
              disabled={!canEdit || busy}
              onClick={() => e.status !== s && onStatus(s)}
              className={cn("rounded-md py-1.5 transition-colors disabled:cursor-default", e.status === s ? STATUS_TONE[s] : "text-stone-500 hover:text-stone-800")}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
