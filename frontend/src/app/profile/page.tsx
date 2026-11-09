"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, Briefcase, CheckCircle2, Mail, Save, Sparkles } from "lucide-react";
import { api, cn } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { CATEGORY_LABEL, categoryOfVertical } from "@/lib/categories";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, useTitle } from "@/components/ui";
import { BusinessForm, formFromBusiness, type BusinessPayload, type FormValue } from "@/components/business-form";

type Fact = { subject: string; predicate: string; object: string; confidence: number };
type BusinessWithDetails = Business & { details?: Record<string, unknown> | null };
type Const = { business: BusinessWithDetails; facts: Record<string, Fact[]>; episodes: { text: string }[] };
type Me = { user: User; business: BusinessWithDetails | null; account_role?: "owner" | "employee"; person_id?: string | null };
type Status = "available" | "busy" | "off";
type Person = { id: string; name: string; role: string; initials: string; status: Status; skills: string[]; responsibilities: string };

const FACT_GROUP: Record<string, string> = {
  identity: "Identity",
  operations: "How it runs",
  current_tools: "Tools in use",
  budget: "Budget",
  tech_comfort: "Tech comfort",
  pain: "Known problems",
  goal: "Goals",
};
const STATUS: { id: Status; label: string; dot: string }[] = [
  { id: "available", label: "Available", dot: "bg-emerald-500" },
  { id: "busy", label: "Busy", dot: "bg-amber-500" },
  { id: "off", label: "Off today", dot: "bg-stone-400" },
];

const EASE = [0.23, 1, 0.32, 1] as const;

function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
}

/** Who you are: name, email, Owner/Employee, job role, business and availability. */
function YouCard({ me, person, onStatus, statusBusy }: { me: Me; person: Person | null; onStatus: (s: Status) => void; statusBusy: boolean }) {
  const isEmployee = me.account_role === "employee";
  const role = person?.role || (isEmployee ? "Team member" : "Owner");
  return (
    <section className="card p-6" aria-labelledby="you">
      <p className="eyebrow">You</p>
      <div className="mt-3 flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-emerald-700 text-lg font-bold text-white">{person?.initials || initialsOf(me.user.name)}</span>
        <div className="min-w-0">
          <h2 id="you" className="truncate font-display text-xl font-bold">{me.user.name}</h2>
          <span
            className={cn(
              "mt-1 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
              isEmployee ? "bg-sky-50 text-sky-800 ring-1 ring-sky-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
            )}
          >
            {isEmployee ? "Employee" : "Owner"}
          </span>
        </div>
      </div>
      <dl className="mt-5 space-y-2.5 text-sm">
        <div className="flex items-center gap-2.5">
          <dt className="sr-only">Job role</dt>
          <Briefcase size={15} className="shrink-0 text-stone-400" />
          <dd className="min-w-0 break-words">
            {role} {me.business && <span className="text-stone-500">at {me.business.name}</span>}
          </dd>
        </div>
        <div className="flex items-center gap-2.5">
          <dt className="sr-only">Email</dt>
          <Mail size={15} className="shrink-0 text-stone-400" />
          <dd className="min-w-0 break-all text-stone-700">{me.user.email}</dd>
        </div>
      </dl>

      {person && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-stone-500">Today</p>
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-xl bg-stone-100 p-1" role="radiogroup" aria-label="Your availability today">
            {STATUS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={person.status === s.id}
                disabled={statusBusy}
                onClick={() => person.status !== s.id && onStatus(s.id)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors",
                  person.status === s.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800",
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden /> {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-stone-500">When you&apos;re off, your AI coworker covers for you and tasks go to a free colleague.</p>
        </div>
      )}

      {person && person.skills.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-stone-500">Skills</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {person.skills.map((s) => (
              <span key={s} className="chip">{s}</span>
            ))}
          </div>
          {person.responsibilities && <p className="mt-2 text-sm text-stone-600">{person.responsibilities}</p>}
          {isEmployee && <p className="mt-2 text-xs text-stone-500">Your owner keeps your skills up to date on the People page.</p>}
        </div>
      )}
    </section>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [person, setPerson] = useState<Person | null>(null);
  const [value, setValue] = useState<FormValue | null>(null);
  const [c, setC] = useState<Const | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "rerun" | "status" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const isEmployee = me?.account_role === "employee";
  useTitle(isEmployee ? "Your profile" : "Profile");

  const loadConstitution = () => api<Const>("/constitution").then(setC).catch(() => setC(null));
  const load = () => {
    setErr(null);
    api<Me>("/me")
      .then((m) => {
        setMe(m);
        if (m.person_id) api<Person>(`/people/${m.person_id}`).then(setPerson).catch(() => setPerson(null));
        if (m.business) {
          const v = formFromBusiness(m.business);
          // older businesses have no general category yet: infer it from the AI profile
          if (!v.details.category) v.details.category = categoryOfVertical(m.business.profile?.vertical || m.business.vertical) || "";
          setValue(v);
          loadConstitution();
        }
      })
      .catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(id);
  }, [toast]);

  const save = async (p: BusinessPayload) => {
    setBusy("save");
    setSaveErr(null);
    try {
      await api("/businesses/me", { method: "PATCH", json: p });
      setToast("Saved. Dashboard, Discover and Compare now use your new details.");
      load();
    } catch (e) {
      setSaveErr((e as Error).message);
    }
    setBusy(null);
  };

  const rerun = async () => {
    setBusy("rerun");
    setSaveErr(null);
    try {
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode: "live" } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setSaveErr((e as Error).message);
      setBusy(null);
    }
  };

  const setStatus = async (s: Status) => {
    if (!person) return;
    const prev = person.status;
    setPerson({ ...person, status: s });
    setBusy("status");
    try {
      await api(`/people/${person.id}/status`, { method: "PATCH", json: { status: s } });
      setToast(s === "off" ? "Marked off today. Your AI coworker covers for you." : `Status set to ${STATUS.find((x) => x.id === s)?.label}.`);
    } catch (e) {
      setPerson((p) => (p ? { ...p, status: prev } : p));
      setToast((e as Error).message);
    }
    setBusy(null);
  };

  const isDemo = !!me?.user.is_demo;
  const readOnly = isDemo || isEmployee;
  const category = value?.details.category ? CATEGORY_LABEL[value.details.category] : null;

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={me?.business?.name} isDemo={isDemo} />
      <main className="page-wrap pt-8">
        <PageHeader
          eyebrow="Profile"
          title={isEmployee ? "Your profile" : "Your profile & business"}
          help={
            isEmployee
              ? "Your account and availability. The business details are managed by the owner."
              : "Keep your business details up to date. When you save, your dashboard, tool recommendations in Discover and the Compare scores use them right away. Re-run the analysis to get a fresh recommended stack."
          }
        />

        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !me ? (
          <PageState kind="loading" />
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(300px,380px)_1fr] [&>*]:min-w-0">
            <div className="lg:sticky lg:top-20 lg:self-start">
              <YouCard me={me} person={person} onStatus={setStatus} statusBusy={busy === "status"} />
            </div>

            <div>
              {!me.business || !value ? (
                <PageState kind="empty" message="No business yet. Describe yours to get started.">
                  <Link href="/onboard" className="btn-primary mt-4">Describe my business</Link>
                </PageState>
              ) : (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-display text-2xl font-bold">{me.business.name}</h2>
                    {category && <p className="text-sm text-stone-600">{category}{me.business.location ? ` · ${me.business.location}` : ""}</p>}
                  </div>
                  {isEmployee ? (
                    <p className="mt-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">Only the business owner can change these details.</p>
                  ) : (
                    isDemo && (
                      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                        Sample businesses can&apos;t be edited.{" "}
                        <Link href="/login?tab=register" className="font-semibold underline underline-offset-2">Create your own account</Link> to edit a profile.
                      </div>
                    )
                  )}
                  <BusinessForm
                    value={value}
                    onChange={setValue}
                    onSubmit={save}
                    readOnly={readOnly}
                    busy={busy === "save"}
                    error={saveErr}
                    submitLabel="Save changes"
                    submitIcon={<Save size={18} />}
                    secondaryAction={
                      readOnly ? undefined : (
                        <button type="button" onClick={rerun} disabled={!!busy} className="btn-secondary py-3">
                          {busy === "rerun" ? <Spinner /> : <Sparkles size={16} />} Re-run analysis with these details
                        </button>
                      )
                    }
                  />

                  <section className="mt-10 space-y-4" aria-labelledby="constitution">
                    <h2 id="constitution" className="flex items-center gap-2 font-display text-xl font-bold">
                      <BrainCircuit size={18} className="text-emerald-700" /> What your advisors remember
                      <HelpTip>Your Business Constitution: facts the advisors learned from your answers and analyses, plus the tools you adopted. They read it before every new analysis, so advice gets sharper over time.</HelpTip>
                    </h2>
                    {!c ? (
                      <p className="text-sm text-stone-500">Run an analysis to start building this memory.</p>
                    ) : (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                          {Object.entries(c.facts).map(([cat, facts]) => (
                            <div key={cat} className="card p-5">
                              <h3 className="eyebrow">{FACT_GROUP[cat] || cat}</h3>
                              <ul className="mt-3 space-y-2">
                                {facts.map((f, i) => (
                                  <li key={i} className="break-words text-sm">
                                    <span className="text-stone-500">{f.predicate}</span> <span className="font-medium">{f.object}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                          {Object.keys(c.facts).length === 0 && <p className="text-sm text-stone-500">No facts yet. Run an analysis first.</p>}
                        </div>
                        {c.episodes.length > 0 && (
                          <div className="card p-5">
                            <h3 className="eyebrow">Adoption history</h3>
                            <ul className="mt-3 space-y-1.5 text-sm">
                              {c.episodes.map((e, i) => <li key={i}>• {e.text}</li>)}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>
        )}
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, transform: "translateY(12px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transform: "translateY(12px)" }}
            transition={{ duration: 0.2, ease: EASE }}
            className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white shadow-xl"
          >
            <CheckCircle2 size={16} className="shrink-0 text-emerald-400" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
