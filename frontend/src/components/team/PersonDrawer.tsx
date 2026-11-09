"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Pencil, Trash2 } from "lucide-react";
import { api, money } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { ToolIcon } from "@/lib/tool-icons";
import { HelpTip, Spinner } from "@/components/ui";
import { Drawer } from "@/components/coworkers/Drawer";
import { STATUS_LABEL, TOOL_SOURCE_LABEL, copyText, day, fullUrl, short, type Person, type PersonDetail, type PersonToolSource } from "./types";

const SOURCE_ORDER: PersonToolSource[] = ["uses", "approved_request", "self_declared", "assigned_task"];

/** Everything about one person: the AI tools they use, what their AI coworker knows, their tasks and requests. */
export function PersonDrawer({
  person, catalog, isOwnerView, onClose, onEdit, onRemove, onInvite,
}: {
  person: Person | null;
  catalog: Record<string, Tool>;
  isOwnerView: boolean;
  onClose: () => void;
  onEdit: (p: Person) => void;
  onRemove: (p: Person) => void;
  onInvite: (p: Person) => Promise<string | null>;
}) {
  const [d, setD] = useState<PersonDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setD(null);
    setErr(null);
    if (!person) return;
    api<PersonDetail>(`/people/${person.id}`).then(setD).catch((e) => setErr((e as Error).message));
  }, [person]);

  const p = d || person;
  const tools = p?.ai_tools || [];
  const groups = SOURCE_ORDER.map((src) => ({ src, items: tools.filter((t) => t.source === src) })).filter((g) => g.items.length > 0);
  const monthly = tools.reduce((sum, t) => sum + (t.source !== "self_declared" && t.monthly_cost ? t.monthly_cost : 0), 0);

  const copyInvite = async () => {
    if (!p) return;
    const url = p.pending_invite_url || (await onInvite(p));
    if (url && (await copyText(fullUrl(url)))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Drawer
      open={!!person}
      onClose={onClose}
      title={
        p ? (
          <span className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-stone-100 text-sm font-semibold text-stone-700">{p.initials}</span>
            <span className="min-w-0">
              <span className="block leading-tight">{p.name}</span>
              <span className="block font-sans text-xs font-normal text-stone-500">
                {p.is_owner ? "Owner · " : ""}
                {p.role} · {STATUS_LABEL[p.status]}
              </span>
            </span>
          </span>
        ) : (
          "Person"
        )
      }
      footer={
        isOwnerView && p ? (
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={() => onEdit(p)}><Pencil size={14} /> Edit</button>
            {!p.is_owner && !p.has_login && (
              <button className="btn-secondary" onClick={copyInvite}>{copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy invite link</>}</button>
            )}
            {!p.is_owner && (
              <button className="btn-ghost ml-auto text-red-700 hover:bg-red-50" onClick={() => onRemove(p)}><Trash2 size={14} /> Remove</button>
            )}
          </div>
        ) : undefined
      }
    >
      {err ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
      ) : !p ? null : (
        <div className="space-y-6">
          <section>
            <h3 className="flex items-center gap-1 font-semibold">
              AI tools {p.name.split(" ")[0]} uses
              <HelpTip>
                Tools on their profile, tools you approved for them, tools they told us they use on their own, and tools named in tasks assigned to them.
              </HelpTip>
            </h3>
            {groups.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">No AI tools yet.</p>
            ) : (
              <div className="mt-2 space-y-3">
                {groups.map((g) => (
                  <div key={g.src}>
                    <p className={g.src === "self_declared" ? "text-xs font-semibold text-amber-700" : "text-xs font-semibold text-stone-500"}>{TOOL_SOURCE_LABEL[g.src]}</p>
                    <ul className="mt-1 divide-y divide-stone-100 rounded-xl border border-stone-200">
                      {g.items.map((t) => {
                        const tool = t.tool_id ? catalog[t.tool_id] : undefined;
                        return (
                          <li key={`${t.tool_id ?? t.name}-${g.src}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                            {tool ? <ToolIcon category={tool.category} size={26} /> : <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-stone-100 text-[10px] font-bold text-stone-500">AI</span>}
                            <span className="min-w-0 flex-1">
                              {tool ? (
                                <Link href={`/tools/${tool.id}`} className="font-medium hover:underline">{short(tool.name)}</Link>
                              ) : (
                                <span className="font-medium">{t.name}</span>
                              )}
                              {t.since && <span className="block text-xs text-stone-500">since {day(t.since)}</span>}
                            </span>
                            {t.monthly_cost != null && t.monthly_cost > 0 && <span className="shrink-0 text-xs text-stone-600">{money(t.monthly_cost)}/mo</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {monthly > 0 && <p className="text-xs text-stone-500">About {money(monthly)} per month in approved tools.</p>}
              </div>
            )}
          </section>

          {p.skills.length > 0 && (
            <section>
              <h3 className="font-semibold">Skills</h3>
              <div className="mt-2 flex flex-wrap gap-1">
                {p.skills.map((s) => <span key={s} className="chip">{s}</span>)}
              </div>
              {p.responsibilities && <p className="mt-2 text-sm text-stone-700">{p.responsibilities}</p>}
            </section>
          )}

          {!d ? (
            <div className="flex items-center gap-2 text-sm text-stone-500"><Spinner /> Loading their coworker…</div>
          ) : (
            <>
              <section>
                <h3 className="flex items-center gap-1 font-semibold">
                  What their AI coworker knows
                  <HelpTip>Their coworker uses this to answer for them on tasks, even when they&apos;re off today.</HelpTip>
                </h3>
                {d.memory.length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">Nothing yet. It learns from their profile and the tasks they work on.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-stone-700">
                    {d.memory.slice(0, 10).map((f, i) => (
                      <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald-600" />{f.predicate} {f.object}</li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="font-semibold">Open tasks</h3>
                {d.tasks.filter((t) => !t.done).length === 0 ? (
                  <p className="mt-2 text-sm text-stone-500">No open tasks.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {d.tasks.filter((t) => !t.done).slice(0, 8).map((t) => (
                      <li key={t.id} className="rounded-lg bg-stone-50 px-3 py-2">{t.text}</li>
                    ))}
                  </ul>
                )}
              </section>

              {d.requests.length > 0 && (
                <section>
                  <h3 className="font-semibold">Tool requests</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {d.requests.slice(0, 6).map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2">
                        <span>{short(r.name)}</span>
                        <span className={r.status === "approved" ? "text-xs font-medium text-emerald-700" : r.status === "pending" ? "text-xs font-medium text-amber-700" : "text-xs text-stone-500"}>
                          {r.status === "pending" ? "Waiting" : r.status === "approved" ? "Approved" : "Declined"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {d.coworker_tasks.length > 0 && (
                <section>
                  <h3 className="font-semibold">Recent team tasks</h3>
                  <ul className="mt-2 space-y-1 text-sm text-stone-700">
                    {d.coworker_tasks.slice(0, 5).map((t) => (
                      <li key={t.id}>
                        <Link href={`/team?tab=tasks&task=${t.id}`} className="hover:underline">{t.text}</Link>
                        {t.role_in_task && <span className="text-xs text-stone-500"> · {t.role_in_task}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
