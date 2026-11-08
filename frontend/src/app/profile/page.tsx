"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, CheckCircle2, Save, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { CATEGORY_LABEL, categoryOfVertical } from "@/lib/categories";
import { AppHeader, HelpTip, PageHeader, PageState, Spinner, useTitle } from "@/components/ui";
import { BusinessForm, formFromBusiness, type BusinessPayload, type FormValue } from "@/components/business-form";

type Fact = { subject: string; predicate: string; object: string; confidence: number };
type BusinessWithDetails = Business & { details?: Record<string, unknown> | null };
type Const = { business: BusinessWithDetails; facts: Record<string, Fact[]>; episodes: { text: string }[] };

const FACT_GROUP: Record<string, string> = {
  identity: "Identity",
  operations: "How it runs",
  current_tools: "Tools in use",
  budget: "Budget",
  tech_comfort: "Tech comfort",
  pain: "Known problems",
  goal: "Goals",
};

const EASE = [0.23, 1, 0.32, 1] as const;

export default function ProfilePage() {
  useTitle("Profile");
  const router = useRouter();
  const [me, setMe] = useState<{ user: User; business: BusinessWithDetails | null } | null>(null);
  const [value, setValue] = useState<FormValue | null>(null);
  const [c, setC] = useState<Const | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "rerun" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadConstitution = () => api<Const>("/constitution").then(setC).catch(() => setC(null));
  const load = () => {
    setErr(null);
    api<{ user: User; business: BusinessWithDetails | null }>("/me")
      .then((m) => {
        setMe(m);
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

  const isDemo = !!me?.user.is_demo;
  const category = value?.details.category ? CATEGORY_LABEL[value.details.category] : null;

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={me?.business?.name} isDemo={isDemo} />
      <main className="mx-auto max-w-3xl px-4 pt-8">
        <PageHeader
          eyebrow="Profile"
          title={me?.business?.name || "Your business"}
          help="Keep this up to date. When you save, your dashboard, tool recommendations in Discover and the Compare scores use the new details right away. Re-run the analysis to get a fresh recommended stack."
        />
        {category && <p className="mt-2 text-sm text-stone-600">{category}{me?.business?.location ? ` · ${me.business.location}` : ""}</p>}

        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : !me ? (
          <PageState kind="loading" />
        ) : !me.business || !value ? (
          <PageState kind="empty" message="No business yet. Describe yours to get started.">
            <Link href="/onboard" className="btn-primary mt-4">Describe my business</Link>
          </PageState>
        ) : (
          <>
            {isDemo && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Sample businesses can&apos;t be edited.{" "}
                <Link href="/login?tab=register" className="font-semibold underline underline-offset-2">Create your own account</Link> to edit a profile.
              </div>
            )}
            <BusinessForm
              value={value}
              onChange={setValue}
              onSubmit={save}
              readOnly={isDemo}
              busy={busy === "save"}
              error={saveErr}
              submitLabel="Save changes"
              submitIcon={<Save size={18} />}
              secondaryAction={
                <button type="button" onClick={rerun} disabled={!!busy} className="btn-secondary py-3">
                  {busy === "rerun" ? <Spinner /> : <Sparkles size={16} />} Re-run analysis with these details
                </button>
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
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.entries(c.facts).map(([cat, facts]) => (
                      <div key={cat} className="card p-5">
                        <h3 className="eyebrow">{FACT_GROUP[cat] || cat}</h3>
                        <ul className="mt-3 space-y-2">
                          {facts.map((f, i) => (
                            <li key={i} className="text-sm">
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
