"use client";
import { useEffect, useState } from "react";
import { BrainCircuit, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { HelpTip, PageState } from "@/components/ui";
import { Drawer } from "./Drawer";
import { STATUS_LABEL, type Constitution, type Employee } from "./types";

const CAT_LABEL: Record<string, string> = {
  skills: "Skills",
  expertise: "Skills",
  responsibilities: "What they handle",
  ownership: "What they handle",
  customers: "Customers they know",
  tools: "Tools they use",
  current_tools: "Tools they use",
  style: "How they work",
  collaboration: "How they work",
  known_issues: "Things to watch",
  episodes: "Past tasks",
};

/** An employee's Context Constitution: what their AI coworker knows about them. */
export function ConstitutionDrawer({
  employee, onClose, onEdit, onDelete, catalog, canEdit,
}: {
  employee: Employee | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  catalog: Record<string, Tool>;
  canEdit: boolean;
}) {
  const [c, setC] = useState<Constitution | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!employee) return;
    setC(null);
    setErr(null);
    api<Constitution>(`/employees/${employee.id}`).then(setC).catch((e) => setErr((e as Error).message));
  }, [employee]);

  const grouped: Record<string, string[]> = {};
  for (const f of c?.facts || []) {
    const k = CAT_LABEL[f.category] || f.category.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
    (grouped[k] ||= []).push(f.predicate ? `${f.predicate} ${f.object}` : f.object);
  }

  return (
    <Drawer
      open={!!employee}
      onClose={onClose}
      title={employee ? `${employee.name}'s coworker` : ""}
      footer={
        canEdit && employee ? (
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={onEdit}>
              <Pencil size={15} /> Edit
            </button>
            <button
              className="btn-ghost text-red-700 hover:bg-red-50"
              onClick={() => {
                if (window.confirm(`Remove ${employee.name} and their coworker?`)) onDelete();
              }}
            >
              <Trash2 size={15} /> Remove
            </button>
          </div>
        ) : undefined
      }
    >
      {employee && (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-stone-600">
              {employee.role} · {STATUS_LABEL[employee.status]}
            </p>
            <p className="mt-2 flex items-center gap-1 text-sm font-medium text-stone-800">
              <BrainCircuit size={15} className="text-emerald-700" /> What their coworker knows
              <HelpTip>This is their Context Constitution: a memory built from their skills, what they handle, and every task they helped with. It decides when their coworker is asked to help.</HelpTip>
            </p>
          </div>

          {err ? (
            <PageState kind="error" message={err} />
          ) : !c ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100" />
              ))}
            </div>
          ) : (
            <>
              {employee.skills.length > 0 && (
                <section>
                  <h3 className="eyebrow">Skills</h3>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {employee.skills.map((s) => (
                      <span key={s} className="chip">{s}</span>
                    ))}
                  </div>
                </section>
              )}
              {employee.responsibilities && (
                <section>
                  <h3 className="eyebrow">What they handle</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-700">{employee.responsibilities}</p>
                </section>
              )}
              {employee.tools.length > 0 && (
                <section>
                  <h3 className="eyebrow">Tools they use</h3>
                  <p className="mt-1.5 text-sm text-stone-700">{employee.tools.map((t) => catalog[t]?.name.replace(/ \(.*\)$/, "") || t).join(", ")}</p>
                </section>
              )}
              {Object.entries(grouped)
                .filter(([k]) => !["Skills", "What they handle", "Tools they use"].includes(k))
                .map(([k, items]) => (
                  <section key={k}>
                    <h3 className="eyebrow">{k}</h3>
                    <ul className="mt-1.5 space-y-1 text-sm text-stone-700">
                      {items.slice(0, 8).map((x, i) => (
                        <li key={i}>• {x}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              <section>
                <h3 className="eyebrow">Tasks they helped with</h3>
                {c.past_tasks.length ? (
                  <ul className="mt-1.5 space-y-2 text-sm">
                    {c.past_tasks.slice(0, 6).map((t) => (
                      <li key={t.id} className="rounded-lg bg-stone-50 px-3 py-2">
                        <span className="block text-stone-800">{t.text}</span>
                        {t.role_in_task && <span className="block text-xs text-stone-500">{t.role_in_task}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-sm text-stone-500">None yet. Give the team a task and their coworker will remember it.</p>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
