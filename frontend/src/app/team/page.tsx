"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Check, Plus, ShieldAlert, UserPlus, X } from "lucide-react";
import { api, cn, money } from "@/lib/api";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, useTitle } from "@/components/ui";

type Member = { user_id: string; name: string; email: string; role: "admin" | "member"; owner: boolean };
type Req = { id: number; tool_id: string; tool_name: string; reason: string; seats: number; est_monthly_cost: number; status: "pending" | "approved" | "denied"; override: boolean; source: string; requester: string; decided_by: string | null; decided_at: string | null; created_at: string };
type License = { id: number; tool_id: string; name: string; seats_bought: number; seats_assigned: number; renewal_date: string | null; monthly_cost: number | null };
type Shadow = { id: number; tool_name: string; note: string; status: "open" | "converted"; user: string; catalog_id: string | null; created_at: string };
type Spend = { cap: number | null; committed_monthly: number; headroom: number | null; over_cap: boolean; pct: number | null };
type Team = { role: "admin" | "member"; business_name: string; me: string; members: Member[]; requests: Req[]; licenses: License[]; shadow: Shadow[]; adopted: string[]; spend: Spend };
type CatalogTool = { id: string; name: string; price_monthly_typical: number };

const short = (n: string) => n.replace(/ \(.*\)$/, "");
const date = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

export default function TeamPage() {
  useTitle("Team");
  const [t, setT] = useState<Team | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tools, setTools] = useState<CatalogTool[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api<Team>("/team").then(setT).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    load();
    api<CatalogTool[]>("/catalog").then(setTools).catch(() => {});
  }, []);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      if (ok) setFlash(ok);
      load();
    } catch (e) {
      setFlash((e as Error).message);
    }
    setBusy(null);
  };

  const admin = t?.role === "admin";
  const pending = t?.requests.filter((r) => r.status === "pending") || [];
  const decided = t?.requests.filter((r) => r.status !== "pending") || [];
  const openShadow = t?.shadow.filter((s) => s.status === "open") || [];

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={t?.business_name} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Team"
          title="AI tools across your team"
          help={
            <>
              Teammates request tools, and the admin approves them against a monthly AI spend cap. Approved tools are adopted into your workflow and show up in the
              Dashboard, War Room and Agents pages. Licenses track seats you pay for; &ldquo;unapproved in use&rdquo; lists tools people already use on their own.
            </>
          }
        />
        {flash && (
          <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm shadow-sm">
            <span>{flash}</span>
            <button onClick={() => setFlash(null)} aria-label="Dismiss" className="text-stone-400 hover:text-stone-700"><X size={16} /></button>
          </div>
        )}
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !t ? (
          <PageState kind="loading" />
        ) : (
          <>
            <SpendCard spend={t.spend} admin={admin} onSave={(cap) => act("cap", () => api("/team/spend-cap", { method: "PUT", json: { monthly_cap: cap } }), "Spend cap saved.")} busy={busy === "cap"} />

            <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <section className="card p-5">
                <div className="flex items-center gap-1">
                  <h2 className="font-semibold">Approval queue</h2>
                  <HelpTip>Approving adds the tool to your stack. If it would push monthly AI spend over the cap, you&apos;ll be asked to confirm an override.</HelpTip>
                  <span className="ml-auto text-xs text-stone-500">{pending.length} pending</span>
                </div>
                {pending.length === 0 ? (
                  <p className="mt-4 text-sm text-stone-500">Nothing waiting.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-stone-100">
                    {pending.map((r) => (
                      <RequestRow key={r.id} r={r} admin={admin} spend={t.spend} busy={busy === `r${r.id}`}
                        onDecide={(approve, override) =>
                          act(`r${r.id}`, () => api(`/team/requests/${r.id}/decide`, { method: "POST", json: { approve, override } }), approve ? `${short(r.tool_name)} approved and added to your stack.` : `${short(r.tool_name)} request denied.`)
                        } />
                    ))}
                  </ul>
                )}
                {decided.length > 0 && (
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer text-stone-500">History ({decided.length})</summary>
                    <ul className="mt-2 space-y-1.5">
                      {decided.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
                          <span className={cn("chip", r.status === "approved" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "text-stone-500")}>{r.status}</span>
                          <b>{short(r.tool_name)}</b> for {r.requester}, decided by {r.decided_by} on {date(r.decided_at)}
                          {r.override && <span className="chip border-amber-200 bg-amber-50 text-amber-800">over cap</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>

              <RequestForm tools={tools} adopted={t.adopted} busy={busy === "req"}
                onSubmit={(body) => act("req", () => api("/team/requests", { method: "POST", json: body }), "Request sent to your admin.")} />
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <LicensesCard licenses={t.licenses} admin={admin} tools={tools} busy={busy}
                onAssign={(id, n) => act(`l${id}`, () => api(`/team/licenses/${id}`, { method: "PATCH", json: { seats_assigned: n } }))}
                onAdd={(body) => act("lic", () => api("/team/licenses", { method: "POST", json: body }), "License added.")} />
              <ShadowCard items={openShadow} admin={admin} busy={busy}
                onDeclare={(body) => act("sh", () => api("/team/shadow", { method: "POST", json: body }), "Thanks, your admin can now see it.")}
                onConvert={(id) => act(`s${id}`, () => api(`/team/shadow/${id}/approve`, { method: "POST" }), "Moved to the approval queue.")} />
            </div>

            <MembersCard members={t.members} admin={admin} busy={busy === "mem"}
              onAdd={async (body) => {
                setBusy("mem");
                setFlash(null);
                try {
                  const r = await api<{ invite_password: string | null }>("/team/members", { method: "POST", json: body });
                  setFlash(r.invite_password ? `Added. One-time password for ${body.email}: ${r.invite_password} (shown only once).` : "Added to your team.");
                  load();
                } catch (e) {
                  setFlash((e as Error).message);
                }
                setBusy(null);
              }} />
          </>
        )}
      </main>
    </div>
  );
}

function SpendCard({ spend, admin, onSave, busy }: { spend: Spend; admin: boolean; onSave: (cap: number | null) => void; busy: boolean }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(spend.cap?.toString() || "");
  const pct = spend.pct ?? 0;
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="font-semibold">Monthly AI spend</h2>
        <HelpTip>Committed = typical monthly price of every adopted tool, plus extra seats on licenses. Prices are typical list prices; check your invoices.</HelpTip>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {edit ? (
            <>
              <span className="text-stone-500">Cap $</span>
              <input className="input w-28 py-1.5" type="number" min={0} value={val} onChange={(e) => setVal(e.target.value)} aria-label="Monthly cap in dollars" />
              <button className="btn-primary py-1.5" disabled={busy} onClick={() => { onSave(val ? Number(val) : null); setEdit(false); }}>Save</button>
              <button className="btn-ghost py-1.5" onClick={() => setEdit(false)}>Cancel</button>
            </>
          ) : (
            admin && <button className="btn-secondary py-1.5" onClick={() => { setVal(spend.cap?.toString() || ""); setEdit(true); }}>{spend.cap ? "Edit cap" : "Set a cap"}</button>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-baseline gap-x-2">
        <span className={cn("font-display text-3xl font-bold tabular-nums", spend.over_cap && "text-red-700")}>{money(spend.committed_monthly)}</span>
        <span className="text-sm text-stone-500">{spend.cap ? `of ${money(spend.cap)} cap per month` : "per month · no cap set"}</span>
      </div>
      {spend.cap && (
        <>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn("h-full rounded-full transition-[width] duration-500", spend.over_cap ? "bg-red-600" : pct > 85 ? "bg-amber-500" : "bg-emerald-600")} style={{ width: `${pct}%` }} />
          </div>
          <div className={cn("mt-1.5 text-xs", spend.over_cap ? "text-red-700" : "text-stone-500")}>
            {spend.over_cap ? `${money(-(spend.headroom ?? 0))} over the cap` : `${money(spend.headroom)} left this month`}
          </div>
        </>
      )}
    </section>
  );
}

function RequestRow({ r, admin, spend, busy, onDecide }: { r: Req; admin: boolean; spend: Spend; busy: boolean; onDecide: (approve: boolean, override: boolean) => void }) {
  const over = !!spend.cap && spend.committed_monthly + r.est_monthly_cost > spend.cap;
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{short(r.tool_name)}</span>
            {r.source === "shadow" && <span className="chip border-amber-200 bg-amber-50 text-amber-800">already in use</span>}
            {over && <span className="chip border-red-200 bg-red-50 text-red-800">over cap</span>}
          </div>
          <div className="mt-0.5 text-xs text-stone-500">
            {r.requester} · {r.seats} seat{r.seats > 1 ? "s" : ""} · ~{money(r.est_monthly_cost)}/mo · {date(r.created_at)}
          </div>
          {r.reason && <p className="mt-1 text-sm text-stone-700">&ldquo;{r.reason}&rdquo;</p>}
        </div>
        {admin && !confirm && (
          <div className="flex shrink-0 gap-1.5">
            <button className="btn-ghost px-2.5 py-1.5 text-xs" disabled={busy} onClick={() => onDecide(false, false)}>Deny</button>
            <button className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => (over ? setConfirm(true) : onDecide(true, false))}>
              {busy ? <Spinner /> : <Check size={14} />} Approve
            </button>
          </div>
        )}
      </div>
      {confirm && (
        <div role="alertdialog" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          <AlertTriangle size={16} /> This pushes spend to {money(spend.committed_monthly + r.est_monthly_cost)}/mo, over your {money(spend.cap)} cap.
          <span className="ml-auto flex gap-1.5">
            <button className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setConfirm(false)}>Cancel</button>
            <button className="btn px-2.5 py-1 text-xs bg-red-700 text-white hover:bg-red-800" onClick={() => { setConfirm(false); onDecide(true, true); }}>Approve anyway</button>
          </span>
        </div>
      )}
    </li>
  );
}

function RequestForm({ tools, adopted, busy, onSubmit }: { tools: CatalogTool[]; adopted: string[]; busy: boolean; onSubmit: (b: { tool_id: string; reason: string; seats: number }) => void }) {
  const [f, setF] = useState({ tool_id: "", reason: "", seats: 1 });
  const choices = tools.filter((x) => !adopted.includes(x.id)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="card p-5">
      <h2 className="font-semibold">Request a tool</h2>
      <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.tool_id) { onSubmit(f); setF({ tool_id: "", reason: "", seats: 1 }); } }}>
        <div>
          <label className="label text-xs" htmlFor="rq-tool">Tool</label>
          <select id="rq-tool" className="input" required value={f.tool_id} onChange={(e) => setF({ ...f, tool_id: e.target.value })}>
            <option value="">Choose a tool…</option>
            {choices.map((x) => <option key={x.id} value={x.id}>{short(x.name)} ({x.price_monthly_typical ? `${money(x.price_monthly_typical)}/mo` : "free"})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-3">
          <div>
            <label className="label text-xs" htmlFor="rq-why">Why do you need it?</label>
            <input id="rq-why" className="input" maxLength={600} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. answer calls during lunch rush" />
          </div>
          <div>
            <label className="label text-xs" htmlFor="rq-seats">Seats</label>
            <input id="rq-seats" className="input" type="number" min={1} max={500} value={f.seats} onChange={(e) => setF({ ...f, seats: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy || !f.tool_id}>{busy ? <Spinner /> : <Plus size={16} />} Send request</button>
      </form>
    </section>
  );
}

function LicensesCard({ licenses, admin, tools, busy, onAssign, onAdd }: { licenses: License[]; admin: boolean; tools: CatalogTool[]; busy: string | null; onAssign: (id: number, n: number) => void; onAdd: (b: { tool_id: string; seats_bought: number; renewal_date: string | null }) => void }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ tool_id: "", seats_bought: 1, renewal_date: "" });
  return (
    <section className="card p-5">
      <div className="flex items-center gap-1">
        <h2 className="font-semibold">Licenses</h2>
        <HelpTip>Seats you pay for vs. seats actually given to someone. Unassigned seats are money you could save at renewal.</HelpTip>
        {admin && !adding && <button className="btn-ghost ml-auto px-2.5 py-1 text-xs" onClick={() => setAdding(true)}><Plus size={14} /> Add</button>}
      </div>
      {licenses.length === 0 && !adding && <p className="mt-4 text-sm text-stone-500">No licenses tracked yet.</p>}
      <ul className="mt-3 divide-y divide-stone-100">
        {licenses.map((l) => {
          const idle = l.seats_bought - l.seats_assigned;
          return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{short(l.name)}</div>
                <div className="text-xs text-stone-500">Renews {date(l.renewal_date)}{l.monthly_cost != null && ` · ${money(l.monthly_cost)}/mo`}</div>
              </div>
              <div className="flex items-center gap-2">
                {admin ? (
                  <input type="number" min={0} max={l.seats_bought} defaultValue={l.seats_assigned} aria-label={`Seats assigned for ${l.name}`} disabled={busy === `l${l.id}`}
                    className="input w-16 py-1 text-center" onBlur={(e) => { const n = Number(e.target.value); if (n !== l.seats_assigned) onAssign(l.id, n); }} />
                ) : (
                  <span className="tabular-nums">{l.seats_assigned}</span>
                )}
                <span className="text-xs text-stone-500">of {l.seats_bought} seats used</span>
                {idle > 0 && <span className="chip border-amber-200 bg-amber-50 text-amber-800">{idle} idle</span>}
              </div>
            </li>
          );
        })}
      </ul>
      {adding && (
        <form className="mt-3 grid gap-2 sm:grid-cols-[1fr_80px_140px_auto]" onSubmit={(e) => { e.preventDefault(); if (f.tool_id) { onAdd({ ...f, renewal_date: f.renewal_date || null }); setAdding(false); setF({ tool_id: "", seats_bought: 1, renewal_date: "" }); } }}>
          <select className="input" required aria-label="Tool" value={f.tool_id} onChange={(e) => setF({ ...f, tool_id: e.target.value })}>
            <option value="">Tool…</option>
            {[...tools].sort((a, b) => a.name.localeCompare(b.name)).map((x) => <option key={x.id} value={x.id}>{short(x.name)}</option>)}
          </select>
          <input className="input" type="number" min={1} aria-label="Seats bought" value={f.seats_bought} onChange={(e) => setF({ ...f, seats_bought: Math.max(1, Number(e.target.value) || 1) })} />
          <input className="input" type="date" aria-label="Renewal date" value={f.renewal_date} onChange={(e) => setF({ ...f, renewal_date: e.target.value })} />
          <span className="flex gap-1">
            <button className="btn-primary px-3" disabled={busy === "lic"}>Add</button>
            <button type="button" className="btn-ghost px-2" onClick={() => setAdding(false)} aria-label="Cancel"><X size={16} /></button>
          </span>
        </form>
      )}
    </section>
  );
}

function ShadowCard({ items, admin, busy, onDeclare, onConvert }: { items: Shadow[]; admin: boolean; busy: string | null; onDeclare: (b: { tool_name: string; note: string }) => void; onConvert: (id: number) => void }) {
  const [f, setF] = useState({ tool_name: "", note: "" });
  return (
    <section className="card p-5">
      <div className="flex items-center gap-1">
        <h2 className="font-semibold">Unapproved in use</h2>
        <HelpTip>Tools people already use on their own (&ldquo;shadow AI&rdquo;). Declaring them is safe and helps the admin check what data goes where.</HelpTip>
      </div>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">Nothing declared.</p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium"><ShieldAlert size={14} className="text-amber-600" /> {s.tool_name}</div>
                <div className="text-xs text-stone-500">{s.user}{s.note && ` · ${s.note}`}</div>
              </div>
              {admin && (
                s.catalog_id ? (
                  <button className="btn-secondary px-2.5 py-1 text-xs" disabled={busy === `s${s.id}`} onClick={() => onConvert(s.id)}>Review for approval</button>
                ) : (
                  <span className="text-xs text-stone-400">Not in our catalog</span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3" onSubmit={(e) => { e.preventDefault(); if (f.tool_name.trim()) { onDeclare(f); setF({ tool_name: "", note: "" }); } }}>
        <input className="input min-w-0 flex-1 py-2" placeholder="Tool you use, e.g. ChatGPT" maxLength={120} value={f.tool_name} onChange={(e) => setF({ ...f, tool_name: e.target.value })} aria-label="Tool name" />
        <input className="input min-w-0 flex-1 py-2" placeholder="What for? (optional)" maxLength={600} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} aria-label="What for" />
        <button className="btn-secondary py-2" disabled={busy === "sh" || !f.tool_name.trim()}>Declare</button>
      </form>
    </section>
  );
}

function MembersCard({ members, admin, busy, onAdd }: { members: Member[]; admin: boolean; busy: boolean; onAdd: (b: { email: string; name: string; role: string }) => void }) {
  const [f, setF] = useState({ email: "", name: "", role: "member" });
  return (
    <section className="card p-5">
      <div className="flex items-center gap-1">
        <h2 className="font-semibold">Members</h2>
        <HelpTip>Members can request tools and declare tools they already use. Admins approve requests, manage licenses and set the spend cap.</HelpTip>
        <span className="ml-auto text-xs text-stone-500">{members.length} people</span>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-stone-100 text-sm font-semibold text-stone-700">{m.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{m.name}</span>
              <span className="block truncate text-xs text-stone-500">{m.owner ? "Owner · admin" : m.role}</span>
            </span>
          </li>
        ))}
      </ul>
      {admin && (
        <form className="mt-4 grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-[1fr_1fr_120px_auto]" onSubmit={(e) => { e.preventDefault(); if (f.email) { onAdd(f); setF({ email: "", name: "", role: "member" }); } }}>
          <input className="input py-2" type="email" required placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email" />
          <input className="input py-2" placeholder="Name (optional)" maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
          <select className="input py-2" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn-primary py-2" disabled={busy}>{busy ? <Spinner /> : <UserPlus size={16} />} Add</button>
        </form>
      )}
    </section>
  );
}
