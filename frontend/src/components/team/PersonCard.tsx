"use client";
import { Bot, Check, Copy, KeyRound, UserPlus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { ToolIcon } from "@/lib/tool-icons";
import { STATUS_LABEL, copyText, fullUrl, type Person, type PersonStatus } from "./types";

const STATUS_TONE: Record<PersonStatus, string> = {
  available: "bg-emerald-600 text-white",
  busy: "bg-amber-500 text-white",
  off: "bg-stone-600 text-white",
};
const DOT: Record<PersonStatus, string> = { available: "bg-emerald-500", busy: "bg-amber-500", off: "bg-stone-400" };

/** One person: who they are, their AI coworker, the AI tools they use, and today's availability. */
export function PersonCard({
  p, catalog, onOpen, onStatus, onInvite, canStatus, isOwnerView, statusBusy,
}: {
  p: Person;
  catalog: Record<string, Tool>;
  onOpen: () => void;
  onStatus: (s: PersonStatus) => void;
  onInvite: () => Promise<string | null>;
  canStatus: boolean;
  isOwnerView: boolean;
  statusBusy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [inviting, setInviting] = useState(false);
  const tools = p.ai_tools.slice(0, 6);

  const invite = async () => {
    setInviting(true);
    const url = p.pending_invite_url || (await onInvite());
    if (url && (await copyText(fullUrl(url)))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setInviting(false);
  };

  return (
    <div className={cn("card flex flex-col p-4", p.status === "off" && "bg-stone-50")}>
      <button onClick={onOpen} className="flex items-start gap-3 text-left" aria-label={`Open ${p.name}`}>
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-stone-100 font-semibold text-stone-700">
          {p.initials}
          <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-white", DOT[p.status])} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug text-stone-900 hover:underline">{p.name}</span>
          <span className="block text-xs text-stone-500">{p.is_owner ? `Owner · ${p.role}` : p.role}</span>
          <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-700">
            <Bot size={12} /> Has an AI coworker
          </span>
        </span>
      </button>

      {p.skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {p.skills.slice(0, 3).map((s) => (
            <span key={s} className="chip">{s}</span>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <button onClick={onOpen} className="mt-3 flex flex-wrap items-center gap-1.5 text-left" aria-label={`AI tools ${p.name} uses`}>
          {tools.map((t) =>
            t.tool_id && catalog[t.tool_id] ? (
              <span key={`${t.tool_id}-${t.source}`} title={`${catalog[t.tool_id].name}`}>
                <ToolIcon category={catalog[t.tool_id].category} size={24} />
              </span>
            ) : (
              <span key={`${t.name}-${t.source}`} className="rounded-md border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-600">{t.name}</span>
            ),
          )}
          {p.ai_tools.length > tools.length && <span className="text-[11px] text-stone-500">+{p.ai_tools.length - tools.length} more</span>}
        </button>
      )}

      <div className="mt-auto space-y-2 pt-4">
        <div role="radiogroup" aria-label={`${p.name}'s availability`} className="grid grid-cols-3 rounded-lg bg-stone-100 p-0.5 text-[11px] font-semibold">
          {(["available", "busy", "off"] as const).map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={p.status === s}
              disabled={!canStatus || statusBusy}
              onClick={() => p.status !== s && onStatus(s)}
              className={cn("rounded-md py-1.5 transition-colors disabled:cursor-default", p.status === s ? STATUS_TONE[s] : "text-stone-500 hover:text-stone-800")}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        {isOwnerView && !p.is_owner && (
          p.has_login ? (
            <p className="flex items-center gap-1.5 text-xs text-stone-500"><KeyRound size={12} /> Has a login</p>
          ) : (
            <button onClick={invite} disabled={inviting} className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 hover:underline disabled:opacity-60">
              {copied ? <><Check size={12} /> Invite link copied</> : p.pending_invite_url ? <><Copy size={12} /> Copy invite link</> : <><UserPlus size={12} /> Invite to log in</>}
            </button>
          )
        )}
      </div>
    </div>
  );
}
