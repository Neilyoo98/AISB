"use client";
import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { Check, Clock, Plus, Send, Undo2 } from "lucide-react";
import { cn } from "@/lib/api";
import type { Adoption } from "@/lib/types";
import { AnchoredPopover, Spinner } from "@/components/ui";

/* One shared store per page, so every Adopt / Request button stays in sync with a single fetch.
   Owners adopt tools directly; team members send a request the owner approves on the Collaboration page. */
type Role = "admin" | "member" | null;
type State = { status: "idle" | "loading" | "ready" | "anon"; adopted: Set<string>; role: Role; requested: Set<string> };
let state: State = { status: "idle", adopted: new Set(), role: null, requested: new Set() };
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};

async function load() {
  if (state.status === "loading") return;
  set({ ...state, status: "loading" });
  try {
    const [a, t] = await Promise.all([fetch("/api/adoptions", { cache: "no-store" }), fetch("/api/team/me", { cache: "no-store" })]);
    if (a.status === 401) return set({ status: "anon", adopted: new Set(), role: null, requested: new Set() });
    const d: { items: Adoption[] } = a.ok ? await a.json() : { items: [] };
    // If the role lookup fails, fall back to the safe "member" path (Request) rather than owner-style Adopt.
    const me: { role: Role; my_pending_tool_ids?: string[] } = t.ok ? await t.json() : { role: "member" };
    set({ status: "ready", adopted: new Set(d.items.map((i) => i.tool_id)), role: me.role, requested: new Set(me.my_pending_tool_ids || []) });
  } catch {
    set({ status: "ready", adopted: new Set(), role: null, requested: new Set() });
  }
}

export function useAdoptions() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
  useEffect(() => {
    if (state.status === "idle") load();
  }, []);
  return s;
}

async function errorText(r: Response, fallback: string) {
  try {
    const d = await r.json();
    return typeof d.detail === "string" ? d.detail : fallback;
  } catch {
    return fallback;
  }
}

async function mutate(toolId: string, adopt: boolean): Promise<string | null> {
  const r = await fetch(adopt ? "/api/adoptions" : `/api/adoptions/${encodeURIComponent(toolId)}`, {
    method: adopt ? "POST" : "DELETE",
    headers: adopt ? { "content-type": "application/json" } : undefined,
    body: adopt ? JSON.stringify({ tool_id: toolId }) : undefined,
  });
  if (!r.ok && r.status !== 409) return errorText(r, "Couldn't update your stack.");
  const next = new Set(state.adopted);
  if (adopt) next.add(toolId);
  else next.delete(toolId);
  set({ ...state, status: "ready", adopted: next });
  return null;
}

async function sendRequest(toolId: string, reason: string, seats: number): Promise<string | null> {
  const r = await fetch("/api/team/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool_id: toolId, reason, seats }),
  });
  if (!r.ok) return errorText(r, "Couldn't send your request.");
  set({ ...state, requested: new Set(state.requested).add(toolId) });
  return null;
}

export function AdoptButton({ toolId, compact = false, className }: { toolId: string; compact?: boolean; className?: string }) {
  const s = useAdoptions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const reqBtnRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [seats, setSeats] = useState(1);
  const adopted = s.adopted.has(toolId);
  const member = s.role === "member";

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(id);
  }, [msg]);

  if (s.status === "anon")
    return (
      <Link href="/login" className={cn(compact ? "btn-ghost px-2 py-1 text-xs" : "btn-secondary", className)}>
        <Plus size={compact ? 13 : 16} /> {compact ? "Adopt" : "Log in to adopt"}
      </Link>
    );

  const pill = (icon: React.ReactNode, text: string, tone: "green" | "amber") => (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xl font-semibold",
        tone === "green" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800",
        compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm",
      )}
    >
      {icon} {text}
    </span>
  );

  /* ----- team member: request instead of adopt ----- */
  if (member) {
    if (adopted) return <span className={className}>{pill(<Check size={compact ? 13 : 15} strokeWidth={3} />, "In your team's stack", "green")}</span>;
    if (s.requested.has(toolId))
      return (
        <span className={cn("inline-flex flex-col", compact ? "items-end" : "items-start", className)}>
          {pill(<Clock size={compact ? 13 : 15} />, "Requested", "amber")}
          {msg && <span role="status" className="mt-1 text-xs text-emerald-700">{msg.text}</span>}
        </span>
      );
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      const err = await sendRequest(toolId, reason.trim(), seats);
      setBusy(false);
      if (err) setMsg({ ok: false, text: err });
      else {
        setAsking(false);
        setMsg({ ok: true, text: "Sent. Your owner will see it on the Collaboration page." });
      }
    };
    return (
      <span className={cn("inline-flex flex-col", compact ? "items-end" : "items-start", className)}>
        <button
          ref={reqBtnRef}
          onClick={() => setAsking((a) => !a)}
          disabled={s.status !== "ready"}
          aria-expanded={asking}
          className={cn(compact ? "btn border border-emerald-600 bg-white px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-50" : "btn-primary")}
        >
          <Send size={compact ? 13 : 16} /> {compact ? "Request" : "Request this tool"}
        </button>
        {/* Rendered in a portal so small card footers can't clip the form. */}
        <AnchoredPopover anchorRef={reqBtnRef} open={asking} onClose={() => setAsking(false)} width={272} label="Request this tool">
          <form onSubmit={submit} className="space-y-2">
            <label className="block text-xs font-medium text-stone-700">
              What would you use it for?
              <input autoFocus className="input mt-1 py-1.5" maxLength={300} placeholder="e.g. answer calls during lunch" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs font-medium text-stone-700">
              People who need it
              <input type="number" min={1} max={500} className="input w-20 py-1.5" value={seats} onChange={(e) => setSeats(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            <div className="flex justify-end gap-1">
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => setAsking(false)}>Cancel</button>
              <button className="btn-primary px-3 py-1 text-xs" disabled={busy}>{busy ? <Spinner className="h-3 w-3" /> : "Send request"}</button>
            </div>
          </form>
        </AnchoredPopover>
        {msg && <span role="status" className={cn("mt-1 text-xs", msg.ok ? "text-emerald-700" : "text-red-700")}>{msg.text}</span>}
      </span>
    );
  }

  /* ----- owner: adopt directly ----- */
  const run = async (adopt: boolean) => {
    setBusy(true);
    const err = await mutate(toolId, adopt);
    setBusy(false);
    setMsg(err ? { ok: false, text: err } : adopt ? { ok: true, text: "Added to your stack. War Room and Agents updated." } : { ok: true, text: "Removed from your stack." });
  };

  return (
    <span className={cn("inline-flex flex-col", compact ? "items-end" : "items-start", className)}>
      {adopted ? (
        <span className="inline-flex items-center gap-1">
          {pill(<Check size={compact ? 13 : 15} strokeWidth={3} />, "Adopted", "green")}
          <button onClick={() => run(false)} disabled={busy} className="btn-ghost px-1.5 py-1 text-xs" aria-label="Undo adoption" title="Remove from my stack">
            {busy ? <Spinner className="h-3 w-3" /> : <Undo2 size={13} />}
          </button>
        </span>
      ) : (
        <button
          onClick={() => run(true)}
          disabled={busy || s.status !== "ready"}
          className={cn(compact ? "btn border border-emerald-600 bg-white px-2.5 py-1 text-xs text-emerald-800 hover:bg-emerald-50" : "btn-primary")}
        >
          {busy ? <Spinner className={compact ? "h-3 w-3" : undefined} /> : <Plus size={compact ? 13 : 16} />} {compact ? "Adopt" : "Adopt into my workflow"}
        </button>
      )}
      {msg && (
        <span role="status" className={cn("mt-1 text-xs", msg.ok ? "text-emerald-700" : "text-red-700")}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
