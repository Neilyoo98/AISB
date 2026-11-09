"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, Link2, Send, ShieldAlert, UserPlus, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, useTitle } from "@/components/ui";

type Member = { user_id: string; name: string; email: string; role: "admin" | "member"; owner: boolean };
type Impact = { adds: number; projected: number; cap: number | null; over_cap: boolean };
type Req = {
  id: number; tool_id: string; tool_name: string; reason: string; seats: number; est_monthly_cost: number;
  status: "pending" | "approved" | "denied"; override: boolean; source: string; requester: string; mine: boolean;
  decided_by: string | null; decided_at: string | null; created_at: string; impact: Impact | null;
};
type License = { id: number; tool_id: string; name: string; seats_bought: number; seats_assigned: number; renewal_date: string | null; monthly_cost: number | null };
type Shadow = { id: number; tool_name: string; note: string; status: "open" | "converted"; user: string; catalog_id: string | null };
type Spend = { cap: number | null; committed_monthly: number; headroom: number | null; over_cap: boolean; pct: number | null };
type Invite = { code: string; name: string | null; role: string; url: string; expires_at: string };
type Team = { role: "admin" | "member"; business_name: string; members: Member[]; invites: Invite[]; requests: Req[]; licenses: License[]; shadow: Shadow[]; spend: Spend };

const short = (n: string) => n.replace(/ \(.*\)$/, "");
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const HOWTO_KEY = "ss_team_howto_dismissed";

export default function TeamPage() {
  useTitle("Team");
  const [t, setT] = useState<Team | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showHowto, setShowHowto] = useState(false);

  const load = () => {
    setErr(null);
    api<Team>("/team").then(setT).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    try {
      setShowHowto(localStorage.getItem(HOWTO_KEY) !== "1");
    } catch {
      setShowHowto(true);
    }
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      if (ok) setFlash({ ok: true, text: ok });
      load();
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  };

  const dismissHowto = () => {
    setShowHowto(false);
    try {
      localStorage.setItem(HOWTO_KEY, "1");
    } catch {}
  };

  const admin = t?.role === "admin";

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={t?.business_name} />
      <main className="mx-auto max-w-5xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Team"
          title={admin || !t ? "Your team" : `Your team at ${t.business_name}`}
          help={
            admin ? (
              <>Invite employees with a link. They browse Discover and press <b>Request</b> on any tool; you approve or decline here. Approved tools are added to your stack everywhere in StackSmith.</>
            ) : (
              <>Find a tool in Discover and press <b>Request</b>. Your owner approves it here, then it appears in your team&apos;s stack.</>
            )
          }
          actions={!admin && t ? <Link href="/tools" className="btn-primary"><Send size={16} /> Find a tool to request</Link> : undefined}
        />

        {showHowto && t && <HowItWorks admin={!!admin} onClose={dismissHowto} />}

        {flash && (
          <div role="status" className={cn("flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm", flash.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
            <span>{flash.text}</span>
            <button onClick={() => setFlash(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X size={16} /></button>
          </div>
        )}

        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !t ? (
          <PageState kind="loading" />
        ) : (
          <>
            <Requests t={t} admin={!!admin} busy={busy} act={act} />
            <TeamMembers t={t} admin={!!admin} busy={busy} act={act} />
            {admin && <Spending t={t} busy={busy} act={act} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------- How it works (dismissible) ---------- */

function HowItWorks({ admin, onClose }: { admin: boolean; onClose: () => void }) {
  const steps = admin
    ? [["Invite", "Send an employee your invite link."], ["They request", "They press Request on a tool in Discover."], ["You approve", "Approve here and it joins your stack."]]
    : [["Find a tool", "Browse Discover."], ["Request it", "Press Request and say what it's for."], ["Owner approves", "It then joins your team's stack."]];
  return (
    <div className="card relative grid gap-4 p-5 sm:grid-cols-3">
      <button onClick={onClose} className="absolute right-3 top-3 text-stone-400 hover:text-stone-700" aria-label="Hide how it works"><X size={16} /></button>
      {steps.map(([title, body], i) => (
        <div key={title} className="flex items-start gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-700 text-sm font-bold text-white">{i + 1}</span>
          <div>
            <div className="text-sm font-semibold">{title}</div>
            <div className="text-sm text-stone-600">{body}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

type Act = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/* ---------- Tool requests ---------- */

function Requests({ t, admin, busy, act }: { t: Team; admin: boolean; busy: string | null; act: Act }) {
  const pending = t.requests.filter((r) => r.status === "pending");
  const decided = t.requests.filter((r) => r.status !== "pending").slice(0, 6);
  const decide = (r: Req, approve: boolean) => {
    if (approve && r.impact?.over_cap) {
      const ok = window.confirm(`Approving ${short(r.tool_name)} brings monthly AI spend to ${money(r.impact.projected)}, over your ${money(r.impact.cap)} limit. Approve anyway?`);
      if (!ok) return;
    }
    act(`req-${r.id}`, () => api(`/team/requests/${r.id}/decide`, { method: "POST", json: { approve, override: approve && !!r.impact?.over_cap } }),
      approve ? `${short(r.tool_name)} approved and added to your stack.` : `${short(r.tool_name)} declined.`);
  };
  return (
    <section className="card p-6">
      <h2 className="font-display text-xl font-bold">{admin ? "Tool requests" : "My requests"}</h2>
      <p className="mt-0.5 text-sm text-stone-600">{admin ? "Employees ask for tools here. Approve to add them to your stack." : "Tools you asked for and what your owner decided."}</p>

      {pending.length === 0 ? (
        <p className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600">
          {admin ? "No requests waiting." : <>Nothing waiting. <Link href="/tools" className="font-semibold text-emerald-700 hover:underline">Find a tool to request</Link>.</>}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
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
                          ? `This brings monthly AI spend to ${money(r.impact.projected)} of your ${money(r.impact.cap)} limit.`
                          : `This brings monthly AI spend to ${money(r.impact.projected)}.`}
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

      {!admin && <DeclareTool busy={busy} act={act} />}

      {decided.length > 0 && (
        <div className="mt-5 border-t border-stone-100 pt-4">
          <h3 className="text-sm font-semibold text-stone-500">Recently decided</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
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
    </section>
  );
}

function DeclareTool({ busy, act }: { busy: string | null; act: Act }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  if (!open)
    return (
      <button className="mt-4 text-sm font-semibold text-emerald-700 hover:underline" onClick={() => setOpen(true)}>
        Already using an AI tool on your own? Let your owner know
      </button>
    );
  return (
    <form
      className="mt-4 flex flex-col gap-2 rounded-xl bg-stone-50 p-3 sm:flex-row"
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

/* ---------- Members + invites ---------- */

function TeamMembers({ t, admin, busy, act }: { t: Team; admin: boolean; busy: string | null; act: Act }) {
  const [inviteName, setInviteName] = useState("");
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const full = (url: string) => (typeof window !== "undefined" ? `${window.location.origin}${url}` : url);
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(full(url));
      setCopied(url);
      setTimeout(() => setCopied(null), 1800);
    } catch {}
  };
  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    await act("invite", async () => {
      const r = await api<{ url: string }>("/team/invites", { method: "POST", json: { name: inviteName.trim(), role: "member" } });
      setNewLink(r.url);
      setInviteName("");
    });
  };

  return (
    <section className="card p-6">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl font-bold">People</h2>
        {admin && <HelpTip>Each invite link works once and expires after 14 days. Anyone with the link can join, so send it straight to the person.</HelpTip>}
      </div>
      <p className="mt-0.5 text-sm text-stone-600">{admin ? "Invite employees so they can request tools." : "Who's on your team."}</p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {t.members.map((m) => (
          <li key={m.user_id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-4 py-3">
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-sm font-bold text-stone-600">{m.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{m.name}</span>
                <span className="block text-xs text-stone-500">{m.owner ? "Owner" : m.role === "admin" ? "Admin" : "Employee"}</span>
              </span>
            </span>
            {admin && !m.owner && (
              <button className="text-xs text-stone-400 hover:text-red-700" onClick={() => window.confirm(`Remove ${m.name} from the team?`) && act(`rm-${m.user_id}`, () => api(`/team/members/${m.user_id}`, { method: "DELETE" }), `${m.name} removed.`)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {admin && (
        <div className="mt-5 border-t border-stone-100 pt-5">
          <form onSubmit={createInvite} className="flex flex-col gap-2 sm:flex-row">
            <input className="input" placeholder="Employee's name (optional)" maxLength={100} value={inviteName} onChange={(e) => setInviteName(e.target.value)} aria-label="Employee's name" />
            <button className="btn-primary shrink-0" disabled={busy === "invite"}>{busy === "invite" ? <Spinner /> : <UserPlus size={16} />} Create invite link</button>
          </form>
          {newLink && (
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center">
              <Link2 size={16} className="shrink-0 text-emerald-700" />
              <code className="min-w-0 flex-1 truncate text-sm text-emerald-900">{full(newLink)}</code>
              <button className="btn-secondary shrink-0 py-1.5 text-xs" onClick={() => copy(newLink)}>{copied === newLink ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}</button>
            </div>
          )}
          {t.invites.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-stone-500">Waiting to join</h3>
              <ul className="mt-2 space-y-1.5">
                {t.invites.map((i) => (
                  <li key={i.code} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>{i.name || "Unnamed invite"} <span className="text-stone-500">· link expires {day(i.expires_at)}</span></span>
                    <span className="flex gap-1">
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => copy(i.url)}>{copied === i.url ? "Copied" : "Copy link"}</button>
                      <button className="btn-ghost px-2 py-1 text-xs text-stone-500" onClick={() => act(`rv-${i.code}`, () => api(`/team/invites/${i.code}`, { method: "DELETE" }), "Invite cancelled.")}>Cancel</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Spending & licenses (owner only) ---------- */

function Spending({ t, busy, act }: { t: Team; busy: string | null; act: Act }) {
  const s = t.spend;
  const [editing, setEditing] = useState(false);
  const [cap, setCap] = useState(String(s.cap ?? ""));
  const openShadow = t.shadow.filter((x) => x.status === "open");
  return (
    <section className="card p-6">
      <div className="flex items-center gap-2">
        <h2 className="font-display text-xl font-bold">Spending & licenses</h2>
        <HelpTip>Monthly AI spend adds up the typical price of every tool in your stack plus any extra seats you bought. Set a limit and you&apos;ll be warned before approving something that goes over it.</HelpTip>
      </div>
      <p className="mt-0.5 text-sm text-stone-600">What your AI tools cost each month.</p>

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
        {s.cap && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-200">
            <div className={cn("h-full rounded-full", s.over_cap ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${Math.min(100, s.pct ?? 0)}%` }} />
          </div>
        )}
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

      {openShadow.length > 0 && (
        <div className="mt-5">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-stone-500">
            Used without approval
            <HelpTip>Employees told us they already use these on their own. Review them so customer data stays in tools you trust.</HelpTip>
          </h3>
          <ul className="mt-2 space-y-2">
            {openShadow.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm">
                <span className="flex items-start gap-2">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-700" />
                  <span><b className="font-semibold">{x.tool_name}</b> <span className="text-stone-600">· {x.user}{x.note ? `: ${x.note}` : ""}</span></span>
                </span>
                {x.catalog_id ? (
                  <button className="btn-secondary py-1.5 text-xs" disabled={busy === `sh-${x.id}`} onClick={() => act(`sh-${x.id}`, () => api(`/team/shadow/${x.id}/approve`, { method: "POST" }), `${x.tool_name} moved to Tool requests for your decision.`)}>
                    Review as a request
                  </button>
                ) : (
                  <span className="text-xs text-stone-500">Not in our catalog yet</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
