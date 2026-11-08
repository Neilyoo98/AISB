"use client";
import { useEffect, useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { Check, Plus, Undo2 } from "lucide-react";
import { cn } from "@/lib/api";
import type { Adoption } from "@/lib/types";
import { Spinner } from "@/components/ui";

/* One shared adoption store per page, so every Adopt button stays in sync with a single fetch. */
type State = { status: "idle" | "loading" | "ready" | "anon"; adopted: Set<string> };
let state: State = { status: "idle", adopted: new Set() };
const subs = new Set<() => void>();
const set = (s: State) => {
  state = s;
  subs.forEach((f) => f());
};

async function load() {
  if (state.status === "loading") return;
  set({ ...state, status: "loading" });
  try {
    const r = await fetch("/api/adoptions", { cache: "no-store" });
    if (r.status === 401) return set({ status: "anon", adopted: new Set() });
    if (!r.ok) return set({ status: "ready", adopted: new Set() });
    const d: { items: Adoption[] } = await r.json();
    set({ status: "ready", adopted: new Set(d.items.map((i) => i.tool_id)) });
  } catch {
    set({ status: "ready", adopted: new Set() });
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

async function mutate(toolId: string, adopt: boolean): Promise<string | null> {
  const r = await fetch(adopt ? "/api/adoptions" : `/api/adoptions/${encodeURIComponent(toolId)}`, {
    method: adopt ? "POST" : "DELETE",
    headers: adopt ? { "content-type": "application/json" } : undefined,
    body: adopt ? JSON.stringify({ tool_id: toolId }) : undefined,
  });
  if (!r.ok && r.status !== 409) {
    try {
      const d = await r.json();
      return typeof d.detail === "string" ? d.detail : "Couldn't update your stack.";
    } catch {
      return "Couldn't update your stack.";
    }
  }
  const next = new Set(state.adopted);
  if (adopt) next.add(toolId);
  else next.delete(toolId);
  set({ status: "ready", adopted: next });
  return null;
}

export function AdoptButton({ toolId, compact = false, className }: { toolId: string; compact?: boolean; className?: string }) {
  const s = useAdoptions();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const adopted = s.adopted.has(toolId);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(id);
  }, [msg]);

  if (s.status === "anon")
    return (
      <Link href="/login" className={cn(compact ? "btn-ghost px-2 py-1 text-xs" : "btn-secondary", className)}>
        <Plus size={compact ? 13 : 16} /> {compact ? "Adopt" : "Log in to adopt"}
      </Link>
    );

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
          <span className={cn("inline-flex items-center gap-1 rounded-xl bg-emerald-50 font-semibold text-emerald-800", compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm")}>
            <Check size={compact ? 13 : 15} strokeWidth={3} /> Adopted
          </span>
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
