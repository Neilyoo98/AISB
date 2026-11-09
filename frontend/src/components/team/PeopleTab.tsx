"use client";
import { Plus, UserPlus } from "lucide-react";
import type { Tool } from "@/lib/types";
import { DeclareTool, RequestsList } from "./RequestsList";
import { PersonCard } from "./PersonCard";
import type { Act, Person, PersonStatus, TeamData } from "./types";

/** Everyone on the team, once each. Employees also get "My requests" here. */
export function PeopleTab({
  people, catalog, isOwnerView, myPersonId, statusBusy, onOpen, onStatus, onInvite, onAdd, team, busy, act,
}: {
  people: Person[];
  catalog: Record<string, Tool>;
  isOwnerView: boolean;
  myPersonId: string | null;
  statusBusy: string | null;
  onOpen: (p: Person) => void;
  onStatus: (p: Person, s: PersonStatus) => void;
  onInvite: (p: Person) => Promise<string | null>;
  onAdd: () => void;
  team: TeamData | null;
  busy: string | null;
  act: Act;
}) {
  return (
    <div className="space-y-6">
      {people.length === 0 ? (
        <div className="card p-8 text-center">
          <h2 className="font-display text-xl font-bold">Add your first two people</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-stone-600">Tell us what each person does. Each one gets an AI coworker, and you can invite them to log in.</p>
          {isOwnerView && (
            <button className="btn-primary mt-4" onClick={onAdd}><Plus size={16} /> Add a person</button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {people.map((p) => (
            <PersonCard
              key={p.id}
              p={p}
              catalog={catalog}
              onOpen={() => onOpen(p)}
              onStatus={(s) => onStatus(p, s)}
              onInvite={() => onInvite(p)}
              canStatus={isOwnerView || p.id === myPersonId}
              isOwnerView={isOwnerView}
              statusBusy={statusBusy === p.id}
            />
          ))}
          {isOwnerView && (
            <button onClick={onAdd} className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 text-sm font-semibold text-stone-500 transition-colors hover:border-emerald-500 hover:text-emerald-700">
              <UserPlus size={20} /> Add a person
            </button>
          )}
        </div>
      )}

      {!isOwnerView && team && (
        <section className="card space-y-4 p-6">
          <div>
            <h2 className="font-display text-xl font-bold">My requests</h2>
            <p className="mt-0.5 text-sm text-stone-600">Tools you asked for and what your owner decided.</p>
          </div>
          <RequestsList requests={team.requests} admin={false} busy={busy} act={act} />
          <DeclareTool busy={busy} act={act} />
        </section>
      )}
    </div>
  );
}
