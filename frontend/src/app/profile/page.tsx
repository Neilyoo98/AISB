"use client";
import { useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, Spinner, VERTICAL_LABEL } from "@/components/ui";

type Fact = { subject: string; predicate: string; object: string; confidence: number };
type Const = { business: Business; facts: Record<string, Fact[]>; episodes: { text: string }[] };

const CAT_LABEL: Record<string, string> = {
  identity: "Identity",
  operations: "How it runs",
  current_tools: "Tools in use",
  budget: "Budget",
  tech_comfort: "Tech comfort",
  pain: "Known pains",
  goal: "Goals",
};

export default function ProfilePage() {
  const [c, setC] = useState<Const | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User }>("/me").then((m) => setMe(m.user));
    api<Const>("/constitution").then(setC).catch((e) => setErr(e.message));
  }, []);

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={c?.business.name} isDemo={me?.is_demo} />
      <main className="mx-auto max-w-4xl px-4 pt-8">
        <p className="eyebrow">Business Constitution</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">What your advisors remember</h1>
        <p className="mt-2 max-w-2xl text-stone-600">
          Every analysis adds durable facts and adoption outcomes here, stored as vector memory, so the advisors never start from zero.
        </p>
        {!c ? (
          <div className="grid place-items-center py-24 text-stone-500">{err ? <p role="alert">{err}</p> : <Spinner />}</div>
        ) : (
          <div className="mt-8 space-y-6">
            <div className="card p-6">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{c.business.name}</h2>
                {c.business.vertical && <span className="chip">{VERTICAL_LABEL[c.business.vertical] || c.business.vertical}</span>}
              </div>
              {c.business.profile?.summary && <p className="mt-2 text-stone-700">{c.business.profile.summary}</p>}
              {c.business.description && (
                <details className="mt-3 text-sm text-stone-600">
                  <summary className="cursor-pointer font-medium text-stone-700">Owner&apos;s own words</summary>
                  <p className="mt-2 whitespace-pre-line leading-relaxed">{c.business.description}</p>
                </details>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(c.facts).map(([cat, facts]) => (
                <div key={cat} className="card p-5">
                  <h3 className="eyebrow">{CAT_LABEL[cat] || cat}</h3>
                  <ul className="mt-3 space-y-2">
                    {facts.map((f, i) => (
                      <li key={i} className="flex items-start justify-between gap-3 text-sm">
                        <span>
                          <span className="text-stone-500">{f.predicate}</span> <span className="font-medium">{f.object}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-stone-400" title="confidence">
                          {Math.round(f.confidence * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {Object.keys(c.facts).length === 0 && <p className="text-sm text-stone-500">No facts yet. Run an analysis first.</p>}
            </div>

            {c.episodes.length > 0 && (
              <div className="card p-5">
                <h3 className="eyebrow flex items-center gap-1.5">
                  <BrainCircuit size={14} /> Adoption history
                </h3>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {c.episodes.map((e, i) => (
                    <li key={i}>• {e.text}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
