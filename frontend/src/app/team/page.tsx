"use client";
// Team: add your people once → give them work → approve what they need.
// Tabs: People (each person + their AI coworker + the AI tools they use) · Tasks (coworker mesh) · Spending (owner only).
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Send, UserPlus, X } from "lucide-react";
import Link from "next/link";
import { api, cn } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { useAdoptions } from "@/hooks/useAdoptions";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";
import { PeopleTab } from "@/components/team/PeopleTab";
import { TasksTab } from "@/components/team/TasksTab";
import { SpendingTab } from "@/components/team/SpendingTab";
import { PersonDrawer } from "@/components/team/PersonDrawer";
import { AddPersonDrawer } from "@/components/team/AddPersonDrawer";
import type { Person, PersonStatus, TeamData } from "@/components/team/types";

type Me = { user: User; business: Business | null; account_role?: "owner" | "employee"; person_id?: string | null };
type Tab = "people" | "tasks" | "spending";
const STEPS_KEY = "ss_team_steps_dismissed";

function TeamInner() {
  useTitle("Team");
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<Me | null>(null);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [err, setErr] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<Person | null>(null);
  const [editing, setEditing] = useState<Person | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const { adopted } = useAdoptions();

  const isOwnerView = me ? (me.account_role ? me.account_role === "owner" : team?.role !== "member") : false;
  const requested = (params.get("tab") as Tab) || "people";
  const tab: Tab = requested === "spending" && !isOwnerView ? "people" : ["people", "tasks", "spending"].includes(requested) ? requested : "people";

  const loadPeople = useCallback(() => api<Person[]>("/people").then(setPeople), []);
  const loadTeam = useCallback(() => api<TeamData>("/team").then(setTeam).catch(() => setTeam(null)), []);
  const load = useCallback(() => {
    setErr(null);
    Promise.all([api<Me>("/me").then(setMe), loadPeople(), loadTeam()]).catch((e) => setErr((e as Error).message));
  }, [loadPeople, loadTeam]);

  useEffect(() => {
    load();
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
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
      loadPeople().catch(() => {});
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  };

  const setStatus = async (p: Person, status: PersonStatus) => {
    setStatusBusy(p.id);
    setPeople((list) => list && list.map((x) => (x.id === p.id ? { ...x, status } : x)));
    try {
      await api(`/people/${p.id}/status`, { method: "PATCH", json: { status } });
    } catch (e) {
      setPeople((list) => list && list.map((x) => (x.id === p.id ? { ...x, status: p.status } : x)));
      setFlash({ ok: false, text: (e as Error).message });
    }
    setStatusBusy(null);
  };

  const invite = async (p: Person): Promise<string | null> => {
    try {
      const r = await api<{ invite_url: string }>(`/people/${p.id}/invite`, { method: "POST" });
      setPeople((list) => list && list.map((x) => (x.id === p.id ? { ...x, pending_invite_url: r.invite_url } : x)));
      return r.invite_url;
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
      return null;
    }
  };

  const remove = async (p: Person) => {
    if (!window.confirm(`Remove ${p.name} from the team? Their AI coworker is removed too.`)) return;
    setOpen(null);
    await act(`rm-${p.id}`, () => api(`/people/${p.id}`, { method: "DELETE" }), `${p.name} removed.`);
  };

  const dismissSteps = () => {
    setShowSteps(false);
    try {
      localStorage.setItem(STEPS_KEY, "1");
    } catch {}
  };

  const pendingRequests = team?.requests.filter((r) => r.status === "pending").length ?? 0;
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "people", label: "People" },
    { id: "tasks", label: "Tasks" },
    ...(isOwnerView ? [{ id: "spending" as Tab, label: "Spending", badge: pendingRequests }] : []),
  ];

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name || team?.business_name} isDemo={me?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="Team"
          title={isOwnerView || !team ? "Your team" : `Your team at ${team.business_name}`}
          help={
            isOwnerView ? (
              <>
                Add each person once. They get an AI coworker that knows their skills, and you can invite them to log in. Hand the team a task in <b>Tasks</b>; employees request
                tools from Discover and you approve them in <b>Spending</b>.
              </>
            ) : (
              <>
                See who&apos;s on your team and set your own availability. Find a tool in Discover and press <b>Request</b>; your owner approves it.
              </>
            )
          }
          actions={
            isOwnerView ? (
              tab === "people" ? (
                <button className="btn-primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
                  <UserPlus size={16} /> Add a person
                </button>
              ) : undefined
            ) : (
              <Link href="/tools" className="btn-primary"><Send size={16} /> Find a tool to request</Link>
            )
          }
        />

        {showSteps && isOwnerView && <Steps onClose={dismissSteps} />}

        <div role="tablist" aria-label="Team sections" className="flex gap-1 border-b border-stone-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
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
        ) : !people || !me ? (
          <PageState kind="loading" />
        ) : tab === "people" ? (
          <PeopleTab
            people={people}
            catalog={catalog}
            isOwnerView={isOwnerView}
            myPersonId={me.person_id ?? null}
            statusBusy={statusBusy}
            onOpen={setOpen}
            onStatus={setStatus}
            onInvite={invite}
            onAdd={() => { setEditing(null); setFormOpen(true); }}
            team={team}
            busy={busy}
            act={act}
          />
        ) : tab === "tasks" ? (
          <TasksTab catalog={catalog} isOwnerView={isOwnerView} initialTaskId={params.get("task")} peopleCount={people.length} />
        ) : team ? (
          <SpendingTab t={team} busy={busy} act={act} />
        ) : (
          <PageState kind="loading" />
        )}
      </main>

      <PersonDrawer
        person={open}
        catalog={catalog}
        isOwnerView={isOwnerView}
        onClose={() => setOpen(null)}
        onEdit={(p) => { setOpen(null); setEditing(p); setFormOpen(true); }}
        onRemove={remove}
        onInvite={invite}
      />
      <AddPersonDrawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editing={editing}
        catalog={catalog}
        adoptedIds={[...adopted]}
        onSaved={(p) => {
          setPeople((list) => {
            const l = list || [];
            return l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p];
          });
          if (editing) setFormOpen(false);
          loadPeople().catch(() => {});
        }}
      />
    </div>
  );
}

function Steps({ onClose }: { onClose: () => void }) {
  const steps = [
    ["Add your people", "Each gets an AI coworker that knows their skills."],
    ["Give them tasks", "Coworkers plan it with your AI tools."],
    ["Approve what they need", "Tool requests and plans wait for your OK."],
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
