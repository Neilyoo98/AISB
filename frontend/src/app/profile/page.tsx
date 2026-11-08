"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BrainCircuit } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, PageHeader, PageState, VERTICAL_LABEL, useTitle } from "@/components/ui";

type Fact = { subject: string; predicate: string; object: string; confidence: number };
type Details = {
  business_type?: string | null;
  team_size?: number | null;
  budget?: string | null;
  tech_comfort?: number | null;
  current_tools?: string[];
  security_must_haves?: string[];
  goals?: string[];
};
type BusinessWithDetails = Business & { details?: Details | null };
type Const = { business: BusinessWithDetails; facts: Record<string, Fact[]>; episodes: { text: string }[] };

const CAT_LABEL: Record<string, string> = {
  identity: "Identity",
  operations: "How it runs",
  current_tools: "Tools in use",
  budget: "Budget",
  tech_comfort: "Tech comfort",
  pain: "Known pains",
  goal: "Goals",
};
const MUST_LABEL: Record<string, string> = { no_training: "No training on our data", soc2: "SOC 2" };

function Answers({ d }: { d: Details }) {
  const rows: [string, string][] = [
    ["Type of business", d.business_type || ""],
    ["Team size", d.team_size ? `${d.team_size} people` : ""],
    ["Monthly budget", d.budget || ""],
    ["Tech comfort", d.tech_comfort ? `${d.tech_comfort} / 5` : ""],
    ["Tools already used", (d.current_tools || []).join(", ")],
    ["Security must-haves", (d.security_must_haves || []).map((m) => MUST_LABEL[m] || m).join(", ")],
    ["Goals", (d.goals || []).join(", ")],
  ];
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return (
    <div className="card p-5">
      <h2 className="eyebrow">Your answers</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {shown.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-stone-100 pb-2">
            <dt className="text-stone-500">{k}</dt>
            <dd className="text-right font-medium text-stone-800">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ProfilePage() {
  useTitle("Business Constitution");
  const [c, setC] = useState<Const | null>(null);
  const [me, setMe] = useState<User | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api<Const>("/constitution").then(setC).catch((e) => setErr(e.message));
  };
  useEffect(() => {
    api<{ user: User }>("/me").then((m) => setMe(m.user)).catch(() => {});
    load();
  }, []);

  return (
    <div className="min-h-dvh pb-16">
      <AppHeader businessName={c?.business.name} isDemo={me?.is_demo} />
      <main className="mx-auto max-w-4xl px-4 pt-8">
        <PageHeader
          eyebrow="Business Constitution"
          title="What your advisors remember"
          help="Every analysis adds durable facts and adoption outcomes here, stored as vector memory, so your advisors never start from zero."
          actions={
            !me?.is_demo && (
              <Link href="/onboard" className="btn-secondary">
                Edit business
              </Link>
            )
          }
        />
        {err ? (
          err.toLowerCase().includes("no business") ? (
            <PageState kind="empty" message="No business yet. Describe yours to start your Constitution.">
              <Link href="/onboard" className="btn-primary mt-4">
                Describe my business
              </Link>
            </PageState>
          ) : (
            <PageState kind="error" message={err} onRetry={load} />
          )
        ) : !c ? (
          <PageState kind="loading" />
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

            {c.business.details && <Answers d={c.business.details} />}

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
