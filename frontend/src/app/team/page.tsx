"use client";
// Team: give your people work and track it.
// Tabs: Task queue (default; finished vs unfinished, auto-assigned) · Workflow (people ↔ AI tools ↔ customers) · Spending (owner only).
// People (profiles, AI coworkers, invites) live on their own page: /people.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Send, UserPlus, X } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";
import { TaskQueue } from "@/components/team/TaskQueue";
import { SpendingTab } from "@/components/team/SpendingTab";
import { WorkflowTab } from "@/components/team/WorkflowTab";
import type { TeamData } from "@/components/team/types";

type Me = { user: User; business: Business | null; account_role?: "owner" | "employee"; person_id?: string | null };
type Tab = "queue" | "workflow" | "spending";
const STEPS_KEY = "ss_team_steps_dismissed";

function TeamInner() {
  useTitle("Team");
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [peopleCount, setPeopleCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);

  const isOwnerView = me ? (me.account_role ? me.account_role === "owner" : team?.role !== "member") : false;

  // old links: ?tab=people → /people, ?tab=tasks(&task=ID) → queue / task page
  const raw = params.get("tab");
  const legacyTask = params.get("task");
  useEffect(() => {
    if (raw === "people") router.replace("/people");
    else if (legacyTask) router.replace(`/team/tasks/${legacyTask}`);
  }, [raw, legacyTask, router]);
  const requested: Tab = raw === "workflow" || raw === "spending" ? raw : "queue";
  const tab: Tab = requested === "spending" && !isOwnerView ? "queue" : requested;

  const loadTeam = useCallback(() => api<TeamData>("/team").then(setTeam).catch(() => setTeam(null)), []);
  const load = useCallback(() => {
    setErr(null);
    Promise.all([
      api<Me>("/me").then(setMe),
      api<unknown[]>("/people").then((p) => setPeopleCount(p.length)).catch(() => setPeopleCount(0)),
      loadTeam(),
    ]).catch((e) => setErr((e as Error).message));
  }, [loadTeam]);

  useEffect(() => {
    load();
    try {
      setShowSteps(localStorage.getItem(STEPS_KEY) !== "1");
    } catch {
      setShowSteps(true);
    }
  }, [load]);

  const setTab = (t: Tab) => {
    const q = new URLSearchParams(params.toString());
    q.set("tab", t);
    q.delete("task");
    router.replace(`/team?${q.toString()}`, { scroll: false });
  };

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      if (ok) setFlash({ ok: true, text: ok });
      loadTeam();
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  };

  const dismissSteps = () => {
    setShowSteps(false);
    try {
      localStorage.setItem(STEPS_KEY, "1");
    } catch {}
  };

  const pendingRequests = team?.requests.filter((r) => r.status === "pending").length ?? 0;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "queue", label: "Task queue" },
    { id: "workflow", label: "Workflow" },
    ...(isOwnerView ? [{ id: "spending" as Tab, label: "Spending", badge: pendingRequests }] : []),
  ];

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name || team?.business_name} isDemo={me?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Team"
          title={isOwnerView || !team ? "Your team's work" : `Your work at ${team.business_name}`}
          help={
            isOwnerView ? (
              <>
                Describe a task and it&apos;s assigned to the best-fit person automatically. Track every task from planning to done in the <b>Task queue</b>. Manage people and invites on
                the <b>People</b> page.
              </>
            ) : (
              <>Your tasks are under <b>Mine</b>; tick steps off as you finish them. Find a tool in Discover and press <b>Request</b>; your owner approves it.</>
            )
          }
          actions={
            isOwnerView ? (
              <Link href="/people" className="btn-secondary">
                <UserPlus size={16} /> Add a person
              </Link>
            ) : (
              <Link href="/tools" className="btn-primary">
                <Send size={16} /> Find a tool to request
              </Link>
            )
          }
        />

        {showSteps && isOwnerView && <Steps onClose={dismissSteps} />}

        <div role="tablist" aria-label="Team sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-stone-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                tab === t.id ? "border-emerald-700 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-800",
              )}
            >
              {t.label}
              {t.badge ? <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{t.badge}</span> : null}
            </button>
          ))}
        </div>

        {flash && (
          <div role="status" className={cn("flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm", flash.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
            <span>{flash.text}</span>
            <button onClick={() => setFlash(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X size={16} /></button>
          </div>
        )}

        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !me ? (
          <PageState kind="loading" />
        ) : tab === "queue" ? (
          <TaskQueue isOwnerView={isOwnerView} myPersonId={me.person_id ?? null} peopleCount={peopleCount} />
        ) : tab === "workflow" ? (
          <WorkflowTab isOwnerView={isOwnerView} myPersonId={me.person_id ?? null} />
        ) : team ? (
          <SpendingTab t={team} busy={busy} act={act} />
        ) : (
          <PageState kind="loading" />
        )}
      </main>
    </div>
  );
}

function Steps({ onClose }: { onClose: () => void }) {
  const steps = [
    ["Describe a task", "It goes to the best-fit person automatically."],
    ["Approve the plan", "Coworkers plan it with your AI tools."],
    ["Track progress", "Steps get ticked off until it's done."],
  ];
  return (
    <div className="card relative grid gap-4 p-5 pr-10 sm:grid-cols-3">
      <button onClick={onClose} className="absolute right-3 top-3 text-stone-400 hover:text-stone-700" aria-label="Hide these steps"><X size={16} /></button>
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

export default function TeamPage() {
  return (
    <Suspense>
      <TeamInner />
    </Suspense>
  );
}
