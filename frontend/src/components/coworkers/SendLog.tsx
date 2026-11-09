"use client";
import { FlaskConical, Send } from "lucide-react";
import type { Tool } from "@/lib/types";
import type { SendLogEntry } from "./types";

/** What *would* go out through your tools. Always labeled simulated: StackSmith sends nothing. */
export function SendLog({ entries, catalog }: { entries: SendLogEntry[]; catalog: Record<string, Tool> }) {
  if (!entries.length) return null;
  return (
    <section className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-5">
      <h3 className="flex flex-wrap items-center gap-2 font-semibold">
        <Send size={16} className="text-stone-500" /> Send log
        <span className="chip border-amber-200 bg-amber-50 text-amber-800">
          <FlaskConical size={12} /> Simulated — nothing was sent
        </span>
      </h3>
      <ul className="mt-3 space-y-2 text-sm">
        {entries.map((e, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-stone-700">
            <span className="font-medium text-stone-900">{e.channel}</span>
            {e.via_tool_id && <span className="text-stone-500">via {catalog[e.via_tool_id]?.name.replace(/ \(.*\)$/, "") || e.via_tool_id}</span>}
            <span className="text-stone-500">to {e.to}:</span>
            <span>{e.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
