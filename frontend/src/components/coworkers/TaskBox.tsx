"use client";
import { useState } from "react";
import { Send } from "lucide-react";
import { api, cn } from "@/lib/api";
import { Spinner } from "@/components/ui";
import { TASK_STATUS_LABEL, type CoworkerTask, type TaskStatus } from "./types";

const TONE: Record<TaskStatus, string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-800",
  awaiting_approval: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-stone-200 bg-stone-50 text-stone-700",
  rejected: "border-stone-200 bg-stone-50 text-stone-500",
  error: "border-red-200 bg-red-50 text-red-800",
};

export function TaskStatusChip({ status }: { status: TaskStatus }) {
  return <span className={cn("chip shrink-0", TONE[status])}>{TASK_STATUS_LABEL[status]}</span>;
}

/** "What needs doing?" — starts a coworker task. */
export function TaskBox({ examples, onStarted, disabled }: { examples: string[]; onStarted: (id: string) => void; disabled?: string | null }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (t: string) => {
    const v = t.trim();
    if (v.length < 8) return setErr("Describe the task in a few words, e.g. who it's about and what needs to happen.");
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ id: string }>("/coworker-tasks", { method: "POST", json: { text: v.slice(0, 300) } });
      setText("");
      onStarted(r.id);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="card p-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <label htmlFor="cw-task" className="font-semibold text-stone-900">
          What needs doing?
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="cw-task"
            className="input"
            placeholder="e.g. A customer says the tech never showed up yesterday"
            value={text}
            maxLength={300}
            disabled={!!disabled}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn-primary shrink-0 px-5" disabled={busy || !!disabled}>
            {busy ? <Spinner /> : <Send size={16} />} Hand to coworkers
          </button>
        </div>
      </form>
      {disabled ? (
        <p className="mt-2 text-sm text-stone-500">{disabled}</p>
      ) : (
        examples.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-stone-500">Try:</span>
            {examples.slice(0, 3).map((x) => (
              <button key={x} type="button" disabled={busy} onClick={() => run(x)} className="rounded-full border border-stone-200 bg-white px-3 py-1 text-stone-700 hover:border-emerald-400 hover:text-emerald-800">
                {x}
              </button>
            ))}
          </div>
        )
      )}
      {err && (
        <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {err}
        </p>
      )}
    </div>
  );
}

/** Earlier tasks, newest first. */
export function PastTasks({ tasks, current, onOpen }: { tasks: CoworkerTask[]; current: string | null; onOpen: (id: string) => void }) {
  if (!tasks.length) return null;
  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold">Earlier tasks</h3>
      <ul className="mt-2 divide-y divide-stone-100">
        {tasks.slice(0, 8).map((t) => (
          <li key={t.id}>
            <button
              onClick={() => onOpen(t.id)}
              aria-current={t.id === current ? "true" : undefined}
              className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-stone-50", t.id === current && "bg-emerald-50/60")}
            >
              <span className="min-w-0 truncate text-stone-800">{t.text}</span>
              <TaskStatusChip status={t.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
