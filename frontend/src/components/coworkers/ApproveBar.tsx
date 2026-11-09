"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, ClipboardCheck } from "lucide-react";
import { Spinner } from "@/components/ui";
import type { AssignedTask, Employee } from "./types";

const EASE = [0.23, 1, 0.32, 1] as const;

/** Owner approval gate: nothing is assigned until you say so. */
export function ApproveBar({ onDecide }: { onDecide: (approve: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async (approve: boolean) => {
    setBusy(approve ? "yes" : "no");
    setErr(null);
    try {
      await onDecide(approve);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="sticky bottom-20 z-20 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:bottom-4 sm:mr-48"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <div className="font-semibold">Look good?</div>
          <div className="text-stone-600">
            Approving assigns the people steps to your team and saves what was learned. Nothing is sent to customers.
          </div>
          {err && <div className="mt-1 text-red-700">{err}</div>}
        </div>
        <div className="flex shrink-0 gap-2">
          <button className="btn-secondary" disabled={!!busy} onClick={() => go(false)}>
            {busy === "no" ? <Spinner /> : null} Reject
          </button>
          <button className="btn-primary px-5" disabled={!!busy} onClick={() => go(true)}>
            {busy === "yes" ? <Spinner /> : <CheckCircle2 size={18} />} Approve &amp; assign
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** After approval: who got which step. */
export function AssignedTasks({ tasks, employees }: { tasks: AssignedTask[]; employees: Employee[] }) {
  if (!tasks.length) return null;
  const emp = Object.fromEntries(employees.map((e) => [e.id, e]));
  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <ClipboardCheck size={18} className="text-emerald-700" /> Assigned to your team
        </h3>
        <Link href="/dashboard" className="flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">
          See on dashboard <ArrowRight size={14} />
        </Link>
      </div>
      <ul className="mt-3 space-y-2">
        {tasks.map((t) => (
          <li key={t.task_id} className="flex items-start gap-3 text-sm">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-stone-100 text-[11px] font-semibold text-stone-700">{emp[t.assignee_id]?.initials || "?"}</span>
            <span>
              <b className="font-semibold">{emp[t.assignee_id]?.name.split(" ")[0] || "Teammate"}</b> → {t.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
