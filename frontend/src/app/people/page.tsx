"use client";
// People: each person once — their AI coworker, status, the AI tools they use, and invite links.
// (Split out of Team, which now holds the task queue, workflow and spending.)
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Send, UserPlus, X } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { useAdoptions } from "@/hooks/useAdoptions";
import { AppHeader, PageHeader, PageState, useTitle } from "@/components/ui";
import { PeopleTab } from "@/components/team/PeopleTab";
import { PersonDrawer } from "@/components/team/PersonDrawer";
import { AddPersonDrawer } from "@/components/team/AddPersonDrawer";
import type { Person, PersonStatus, TeamData } from "@/components/team/types";

type Me = { user: User; business: Business | null; account_role?: "owner" | "employee"; person_id?: string | null };

export default function PeoplePage() {
  useTitle("People");
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
  const { adopted } = useAdoptions();

  const isOwnerView = me ? (me.account_role ? me.account_role === "owner" : team?.role !== "member") : false;

  const loadPeople = useCallback(() => api<Person[]>("/people").then(setPeople), []);
  const loadTeam = useCallback(() => api<TeamData>("/team").then(setTeam).catch(() => setTeam(null)), []);
  const load = useCallback(() => {
    setErr(null);
    Promise.all([api<Me>("/me").then(setMe), loadPeople(), loadTeam()]).catch((e) => setErr((e as Error).message));
  }, [loadPeople, loadTeam]);

  useEffect(() => {
    load();
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t])))).catch(() => {});
  }, [load]);

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
    if (!window.confirm(`Remove ${p.name}? Their AI coworker is removed too.`)) return;
    setOpen(null);
    await act(`rm-${p.id}`, () => api(`/people/${p.id}`, { method: "DELETE" }), `${p.name} removed.`);
  };

  const addPerson = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name || team?.business_name} isDemo={me?.user.is_demo} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 pt-8">
        <PageHeader
          eyebrow="People"
          title={isOwnerView || !team ? "Your people" : `Your people at ${team.business_name}`}
          help={
            isOwnerView ? (
              <>Add each person once. They get an AI coworker that knows their skills, and you can invite them to log in. Tap a person to see the AI tools they use and their tasks.</>
            ) : (
              <>See who&apos;s on your team and set your own availability. Find a tool in Discover and press <b>Request</b>; your owner approves it.</>
            )
          }
          actions={
            isOwnerView ? (
              <button className="btn-primary" onClick={addPerson}>
                <UserPlus size={16} /> Add a person
              </button>
            ) : (
              <Link href="/tools" className="btn-primary"><Send size={16} /> Find a tool to request</Link>
            )
          }
        />

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
        ) : (
          <PeopleTab
            people={people}
            catalog={catalog}
            isOwnerView={isOwnerView}
            myPersonId={me.person_id ?? null}
            statusBusy={statusBusy}
            onOpen={setOpen}
            onStatus={setStatus}
            onInvite={invite}
            onAdd={addPerson}
            team={team}
            busy={busy}
            act={act}
          />
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
