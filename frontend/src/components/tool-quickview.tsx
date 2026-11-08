"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, ExternalLink, ShieldCheck, Sparkles, X } from "lucide-react";
import { money } from "@/lib/api";
import type { Tool } from "@/lib/types";
import { CAPABILITY_LABEL, ToolIcon, toolType } from "@/lib/tool-icons";
import { AdoptButton } from "@/components/adopt-button";
import { Stars } from "@/components/ui";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Price in plain words, e.g. "$49 per month, flat" or "$195 per month incl. 90 calls, then $2.10 per call". */
export function pricePlain(t: Tool) {
  if (t.price_monthly_typical === 0) return t.free_tier ? "Free plan available" : "Free";
  const base = `${money(t.price_monthly_typical)} per month`;
  if (t.pricing_model === "per_seat") return `${base} for ${t.seats_included ?? 1} user${(t.seats_included ?? 1) > 1 ? "s" : ""}, then $${(t.unit_price ?? 0).toFixed(2)} per extra user`;
  if (t.pricing_model === "usage") return `${base} incl. ${t.units_included} ${t.unit}s, then $${(t.unit_price ?? 0).toFixed(2)} per ${t.unit}`;
  return `${base}, flat${t.free_tier ? " (free plan available)" : ""}`;
}

export function trustSnapshot(t: Tool) {
  const facts = Object.values(t.trust || {});
  const sourced = facts.filter((f) => f.status !== "unknown").length;
  return { sourced, total: facts.length };
}

export function ToolQuickView({ tool, onClose }: { tool: Tool | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tool) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panel.current) {
        // basic focus trap
        const f = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [tool, onClose]);

  return (
    <AnimatePresence>
      {tool && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <div className="absolute inset-0 bg-stone-900/40" onClick={onClose} aria-hidden />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="qv-title"
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: EASE }}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl outline-none"
          >
            <div className="flex items-start justify-between gap-3 border-b border-stone-100 p-5">
              <div className="flex min-w-0 items-center gap-3">
                <ToolIcon category={tool.category} size={48} />
                <div className="min-w-0">
                  <h2 id="qv-title" className="font-display text-xl font-bold leading-tight">{tool.name}</h2>
                  <div className="mt-0.5 text-xs text-stone-500">
                    {toolType(tool.category).label}
                    {tool.capability && ` · ${CAPABILITY_LABEL[tool.capability] || tool.capability}`}
                  </div>
                </div>
              </div>
              <button className="btn-ghost px-2" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 text-sm">
              <p className="text-base leading-relaxed text-stone-800">{tool.description}</p>
              {tool.reviews && (
                <div className="flex items-center gap-1.5 text-xs text-stone-500">
                  <Stars value={tool.reviews.overall} size={12} /> {tool.reviews.overall.toFixed(1)} out of 5 from {tool.reviews.count} review{tool.reviews.count > 1 ? "s" : ""}
                </div>
              )}
              <section>
                <h3 className="eyebrow">What the AI does</h3>
                <ul className="mt-2 space-y-1.5">
                  {tool.ai_features.slice(0, 3).map((a) => (
                    <li key={a} className="flex gap-2"><Sparkles size={14} className="mt-0.5 shrink-0 text-emerald-600" /> {a}</li>
                  ))}
                </ul>
              </section>
              <dl className="divide-y divide-stone-100 rounded-xl border border-stone-200">
                <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-stone-500">Price</dt><dd className="text-right font-medium">{pricePlain(tool)}</dd></div>
                <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="flex items-center gap-1 text-stone-500"><Clock size={13} /> Setup</dt><dd className="font-medium">about {tool.setup_hours} hour{tool.setup_hours === 1 ? "" : "s"}</dd></div>
                {tool.integrates_with.length > 0 && (
                  <div className="flex justify-between gap-4 px-3.5 py-2.5"><dt className="text-stone-500">Works with</dt><dd className="text-right font-medium capitalize">{tool.integrates_with.join(", ").replace(/-/g, " ")}</dd></div>
                )}
                <div className="flex justify-between gap-4 px-3.5 py-2.5">
                  <dt className="flex items-center gap-1 text-stone-500"><ShieldCheck size={13} /> Trust facts</dt>
                  <dd className="text-right font-medium">
                    {(() => {
                      const s = trustSnapshot(tool);
                      return s.sourced ? `${s.sourced} of ${s.total} sourced from the vendor` : `Not yet verified (0 of ${s.total})`;
                    })()}
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-stone-500">Typical list price as of Nov 2026. Check the vendor&apos;s site before buying.</p>
            </div>

            <div className="space-y-3 border-t border-stone-100 p-5">
              <a href={tool.url} target="_blank" rel="noopener noreferrer" className="btn-primary w-full py-3">
                Visit {tool.name.replace(/ \(.*\)$/, "")} <ExternalLink size={15} />
              </a>
              <div className="flex items-center justify-between gap-3">
                <AdoptButton toolId={tool.id} />
                <Link href={`/tools/${tool.id}`} className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
                  Full details <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
