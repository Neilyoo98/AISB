"use client";
import { useState } from "react";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import { HelpTip } from "@/components/ui";
import { RequestsList } from "./RequestsList";
import { day, short, type Act, type TeamData } from "./types";

/** Owner only: approve tool requests, keep monthly AI spend under a limit, spot unused seats and unapproved tools. */
export function SpendingTab({ t, busy, act }: { t: TeamData; busy: string | null; act: Act }) {
  const s = t.spend;
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(s.cap ?? ""));
  const openShadow = t.shadow.filter((x) => x.status === "open");
  const pending = t.requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold">Tool requests</h2>
          {pending > 0 && <span className="chip border-amber-200 bg-amber-50 text-amber-800">{pending} waiting</span>}
        </div>
        <p className="mb-4 mt-0.5 text-sm text-stone-600">Employees press Request on a tool in Discover. Approve to add it to your stack.</p>
        <RequestsList requests={t.requests} admin busy={busy} act={act} />
      </section>

      <section className="card p-6">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold">Monthly AI spend</h2>
          <HelpTip>The typical price of every tool in your stack plus any extra seats you bought. With a limit set, you&apos;re warned before approving something that goes over it.</HelpTip>
        </div>
        <div className="mt-4 rounded-xl bg-stone-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="font-display text-2xl font-bold tabular-nums">{money(s.committed_monthly)}</span>
              <span className="text-sm text-stone-600"> per month{s.cap ? ` of your ${money(s.cap)} limit` : ""}</span>
            </div>
            {!editing ? (
              <button className="btn-ghost px-2.5 py-1 text-sm" onClick={() => { setCap(String(s.cap ?? "")); setEditing(true); }}>{s.cap ? "Change limit" : "Set a limit"}</button>
            ) : (
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); act("cap", () => api("/team/spend-cap", { method: "PUT", json: { monthly_cap: cap ? Number(cap) : null } }), "Limit saved.").then(() => setEditing(false)); }}>
                <span className="text-sm text-stone-500">$</span>
                <input type="number" min={0} className="input w-28 py-1.5" value={cap} onChange={(e) => setCap(e.target.value)} aria-label="Monthly limit in dollars" autoFocus />
                <button className="btn-primary py-1.5 text-sm" disabled={busy === "cap"}>Save</button>
                <button type="button" className="btn-ghost py-1.5 text-sm" onClick={() => setEditing(false)}>Cancel</button>
              </form>
            )}
          </div>
          {s.cap ? (
            <div className="mt-3 h-2 rounded-full bg-stone-200">
              <div className={cn("h-full rounded-full", s.over_cap ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${Math.min(100, s.pct ?? 0)}%` }} />
            </div>
          ) : null}
        </div>

        {t.licenses.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-stone-500">Paid seats</h3>
            <ul className="mt-2 divide-y divide-stone-100">
              {t.licenses.map((l) => {
                const idle = l.seats_bought - l.seats_assigned;
                return (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span>
                      <Link href={`/tools/${l.tool_id}`} className="font-medium hover:underline">{short(l.name)}</Link>
                      <span className="text-stone-500"> · {l.seats_assigned} of {l.seats_bought} seats in use{l.renewal_date ? ` · renews ${day(l.renewal_date)}` : ""}</span>
                    </span>
                    {idle > 0 && <span className="chip border-amber-200 bg-amber-50 text-amber-800">{idle} unused {idle === 1 ? "seat" : "seats"}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      {openShadow.length > 0 && (
        <section className="card p-6">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold">Used without approval</h2>
            <HelpTip>Employees told us they already use these on their own. Review them so customer data stays in tools you trust.</HelpTip>
          </div>
          <ul className="mt-4 space-y-2">
            {openShadow.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
                <span className="flex items-start gap-2">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-700" />
                  <span><b className="font-semibold">{x.tool_name}</b> <span className="text-stone-600">· {x.user}{x.note ? `: ${x.note}` : ""}</span></span>
                </span>
                {x.catalog_id ? (
                  <button className="btn-secondary py-1.5 text-xs" disabled={busy === `sh-${x.id}`}
                    onClick={() => act(`sh-${x.id}`, () => api(`/team/shadow/${x.id}/approve`, { method: "POST" }), `${x.tool_name} moved to Tool requests for your decision.`)}>
                    Review as a request
                  </button>
                ) : (
                  <span className="text-xs text-stone-500">Not in our catalog yet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
