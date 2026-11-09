"use client";
// Team → Workflow: people, the AI tools they use, and how work moves between them in approved team tasks.
import { useState } from "react";
import { cn } from "@/lib/api";
import { HelpTip, PageState } from "@/components/ui";
import { WorkflowGraph, useWorkflowMap } from "@/components/workflow-graph";

export function WorkflowTab({ isOwnerView, myPersonId }: { isOwnerView: boolean; myPersonId: string | null }) {
  // Employees start focused on themselves and can widen to the whole team; owners see everyone and can focus by tapping.
  const [scope, setScope] = useState<"me" | "team">(isOwnerView || !myPersonId ? "team" : "me");
  const [focus, setFocus] = useState<string | null>(null);
  const personFilter = scope === "me" ? myPersonId : null;
  const { map, err, reload } = useWorkflowMap(personFilter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1 font-semibold">
          {scope === "me" ? "Your workflow" : "How your team works with AI"}
          <HelpTip>
            Dashed lines show which AI tools each person uses. Solid lines show real hand-offs from approved team tasks, and get thicker the more often they happen.
            Tap a line to see examples; tap a person to focus on them.
          </HelpTip>
        </h2>
        {!isOwnerView && myPersonId && (
          <div role="tablist" aria-label="Show workflow for" className="inline-grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-xs font-semibold">
            {(["me", "team"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                onClick={() => {
                  setScope(s);
                  setFocus(null);
                }}
                className={cn("rounded-md px-3 py-1.5", scope === s ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
              >
                {s === "me" ? "Me" : "Whole team"}
              </button>
            ))}
          </div>
        )}
      </div>
      {err ? (
        <PageState kind="error" message={err} onRetry={reload} />
      ) : !map ? (
        <PageState kind="loading" />
      ) : (
        <WorkflowGraph
          map={map}
          focus={scope === "me" ? myPersonId : focus}
          onFocus={scope === "team" ? setFocus : undefined}
          title={scope === "me" ? "Your workflow" : "Team workflow"}
        />
      )}
    </div>
  );
}
