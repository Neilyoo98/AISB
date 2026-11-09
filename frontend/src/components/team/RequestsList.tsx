"use client";
import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { day, short, type Act, type Req } from "./types";

/** Owner: approve/decline queue with spend impact. Employee: their own requests. */
export function RequestsList({ requests, admin, busy, act }: { requests: Req[]; admin: boolean; busy: string | null; act: Act }) {
  const pending = requests.filter((r) => r.status === "pending" && (admin || r.mine));
  const decided = requests.filter((r) => r.status !== "pending" && (admin || r.mine)).slice(0, 5);
  const decide = (r: Req, approve: boolean) => {
    if (approve && r.impact?.over_cap) {
      const ok = window.confirm(`Approving ${short(r.tool_name)} brings monthly AI spend to ${money(r.impact.projected)}, over your ${money(r.impact.cap)} limit. Approve anyway?`);
      if (!ok) return;
    }
    act(
      `req-${r.id}`,
      () => api(`/team/requests/${r.id}/decide`, { method: "POST", json: { approve, override: approve && !!r.impact?.over_cap } }),
      approve ? `${short(r.tool_name)} approved and added to your stack.` : `${short(r.tool_name)} declined.`,
    );
  };

  return (
    <div>
      {pending.length === 0 ? (
        <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          {admin ? "No requests waiting." : <>Nothing waiting. <Link href="/tools" className="font-semibold text-emerald-700 hover:underline">Find a tool to request</Link>.</>}
        </p>
      ) : (
        <ul className="space-y-3">
          {pending.map((r) => (
            <li key={r.id} className="rounded-xl border border-stone-200 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="font-semibold">
                    <Link href={`/tools/${r.tool_id}`} className="hover:underline">{short(r.tool_name)}</Link>
                    <span className="font-normal text-stone-500"> · {money(r.est_monthly_cost)} per month{r.seats > 1 ? ` for ${r.seats} people` : ""}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-stone-600">
                    {admin ? <><b className="font-medium text-stone-800">{r.requester}</b> asked {day(r.created_at)}</> : <>Asked {day(r.created_at)}, waiting for your owner</>}
                    {r.source === "shadow" && " · already using it"}
                  </div>
                  {r.reason && <p className="mt-1 text-sm text-stone-700">&ldquo;{r.reason}&rdquo;</p>}
                  {admin && r.impact && (
                    <p className={cn("mt-2 flex items-center gap-1.5 text-sm", r.impact.over_cap ? "text-amber-800" : "text-stone-600")}>
                      {r.impact.over_cap && <AlertTriangle size={14} />}
                      {r.impact.adds === 0
                        ? "Already in your stack, so no extra cost."
                        : r.impact.cap
                          ? `Brings monthly AI spend to ${money(r.impact.projected)} of your ${money(r.impact.cap)} limit.`
                          : `Brings monthly AI spend to ${money(r.impact.projected)}.`}
                    </p>
                  )}
                </div>
                {admin && (
                  <div className="flex shrink-0 gap-2">
                    <button className="btn-secondary" disabled={busy === `req-${r.id}`} onClick={() => decide(r, false)}>Decline</button>
                    <button className="btn-primary" disabled={busy === `req-${r.id}`} onClick={() => decide(r, true)}>
                      {busy === `req-${r.id}` ? <Spinner /> : <Check size={16} />} Approve
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {decided.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-stone-500">Recently decided</h4>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {decided.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className={cn("chip", r.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "text-stone-500")}>{r.status === "approved" ? "Approved" : "Declined"}</span>
                <span className="font-medium">{short(r.tool_name)}</span>
                <span className="text-stone-500">{admin ? `for ${r.requester}` : ""}{r.decided_at ? ` · ${day(r.decided_at)}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Employees: tell the owner about an AI tool they already use on their own. */
export function DeclareTool({ busy, act }: { busy: string | null; act: Act }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  if (!open)
    return (
      <button className="text-sm font-semibold text-emerald-700 hover:underline" onClick={() => setOpen(true)}>
        Already using an AI tool on your own? Let your owner know
      </button>
    );
  return (
    <form
      className="flex flex-col gap-2 rounded-xl bg-stone-50 p-3 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        act("declare", () => api("/team/shadow", { method: "POST", json: { tool_name: name, note } }), "Thanks. Your owner will review it.").then(() => {
          setOpen(false);
          setName("");
          setNote("");
        });
      }}
    >
      <input className="input" required maxLength={120} placeholder="Tool name, e.g. ChatGPT" value={name} onChange={(e) => setName(e.target.value)} aria-label="Tool name" />
      <input className="input" maxLength={300} placeholder="What you use it for (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="What you use it for" />
      <button className="btn-primary shrink-0" disabled={busy === "declare"}>Tell owner</button>
    </form>
  );
}
