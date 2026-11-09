"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { HelpTip } from "@/components/ui";
import type { Draft } from "./types";

const KIND_LABEL: Record<Draft["kind"], string> = {
  customer_reply: "Reply to customer",
  staff_message: "Message to staff",
  review_response: "Review response",
  quote: "Quote",
  other: "Draft",
};

/** Copy-ready drafts. Nothing is sent from StackSmith. */
export function DraftCards({ drafts }: { drafts: Draft[] }) {
  if (!drafts.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1 font-semibold">
        Ready-to-use drafts
        <HelpTip>Written by the coworkers from what your team knows. Copy, adjust if needed, and send from your usual phone, email or tool. StackSmith never sends anything for you.</HelpTip>
      </h3>
      <div className="grid gap-3 md:grid-cols-2">
        {drafts.map((d, i) => (
          <DraftCard key={i} d={d} />
        ))}
      </div>
    </section>
  );
}

function DraftCard({ d }: { d: Draft }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {}
  };
  return (
    <article className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="eyebrow">{KIND_LABEL[d.kind] || "Draft"}</p>
          <h4 className="mt-0.5 font-semibold leading-snug">{d.title}</h4>
          {d.to && <p className="text-xs text-stone-500">To: {d.to}</p>}
        </div>
        <button onClick={copy} className="btn-secondary shrink-0 px-3 py-1.5 text-xs" aria-label={`Copy ${d.title}`}>
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-3 whitespace-pre-line rounded-lg bg-stone-50 p-3 text-sm leading-relaxed text-stone-800">{d.body}</p>
    </article>
  );
}
