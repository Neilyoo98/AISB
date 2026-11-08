"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, Zap } from "lucide-react";
import { api, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { useRunStream } from "@/hooks/useRunStream";
import { AppHeader, Spinner } from "@/components/ui";
import { StackFlow } from "@/components/stack-flow";
import { MeshPanel, PainCards, Pipeline, PlanView, ProfileCard, ScoutGrid, Section, StackPanel } from "@/components/war-room";

export default function WarRoom() {
  const { runId } = useParams<{ runId: string }>();
  const { view, approve } = useRunStream(runId);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [me, setMe] = useState<{ user: User; business: Business | null } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t]))));
    api<{ user: User; business: Business | null }>("/me").then(setMe).catch(() => {});
  }, []);

  useEffect(() => {
    if (view.stack) setSelected(new Set(view.stack.tool_ids));
  }, [view.stack]);

  // elapsed timer while agents work
  useEffect(() => {
    if (view.status !== "running") return;
    const start = Date.now() - elapsed * 1000;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.status]);

  // follow the newest section while the run is streaming
  const sectionCount = [view.profile, view.pains.length, view.meshStarted, view.stack, view.plan].filter(Boolean).length;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (view.status !== "running" && view.status !== "awaiting_approval") return;
    const ids = ["s-profile", "s-pains", "s-mesh", "s-stack", view.plan?.scenarios?.length ? "s-flow" : "s-plan"];
    const el = document.getElementById(ids[sectionCount - 1]);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionCount]);

  const selCost = useMemo(() => [...selected].reduce((a, id) => a + (catalog[id]?.price_monthly_typical || 0), 0), [selected, catalog]);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const doApprove = async () => {
    setApproving(true);
    setApproveErr(null);
    try {
      await approve([...selected]);
    } catch (e) {
      setApproveErr((e as Error).message);
    }
    setApproving(false);
  };

  const awaiting = view.status === "awaiting_approval";

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name} isDemo={me?.user.is_demo} />
      <div className="mx-auto grid max-w-6xl gap-8 px-4 pt-6 lg:grid-cols-[230px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:h-fit">
          <div className="flex items-center justify-between lg:block">
            <div>
              <p className="eyebrow">War Room</p>
              <div className="mt-1 flex items-center gap-2 text-sm">
                {view.mode === "live" ? (
                  <span className="chip border-amber-200 bg-amber-50 text-amber-800">
                    <Zap size={12} /> Live AI
                  </span>
                ) : view.mode === "replay" ? (
                  <span className="chip">Sample replay</span>
                ) : null}
                {(view.status === "running" || elapsed > 0) && <span className="tabular-nums text-stone-500">{elapsed}s</span>}
              </div>
            </div>
          </div>
          <div className="mt-4 hidden lg:block">
            <Pipeline agents={view.agents} />
          </div>
        </aside>

        <main className="min-w-0 space-y-10">
          <div className="card flex items-center gap-3 p-4" aria-live="polite">
            {view.status === "complete" ? (
              <CheckCircle2 className="text-emerald-700" size={20} />
            ) : view.status === "error" ? (
              <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
            ) : awaiting ? (
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
            ) : (
              <Spinner className="text-emerald-700" />
            )}
            <span className="text-sm font-medium">{view.status === "error" ? view.error : view.label}</span>
          </div>

          {view.profile && (
            <Section id="s-profile" eyebrow="Intake Analyst · Memory" title="What we heard">
              <ProfileCard profile={view.profile} memory={view.memory} facts={view.facts} />
            </Section>
          )}

          {view.pains.length > 0 && (
            <Section id="s-pains" eyebrow="Pain Diagnostician · Tool Scouts" title="What it's costing you, and what could fix it">
              <PainCards pains={view.pains} />
              <div className="mt-4">
                <ScoutGrid pains={view.pains} scouts={view.scouts} dropped={view.dropped} catalog={catalog} />
              </div>
            </Section>
          )}

          {view.meshStarted && (
            <Section id="s-mesh" eyebrow="Advisor Panel" title="Your advisors challenge the shortlist">
              <MeshPanel mesh={view.mesh} catalog={catalog} waiting={!view.stack} />
            </Section>
          )}

          {view.stack && (
            <Section id="s-stack" eyebrow="ROI Calculator" title="Recommended stack">
              <StackPanel
                pains={view.pains}
                scored={view.scored}
                stack={view.stack}
                verdicts={view.verdicts}
                catalog={catalog}
                mesh={view.mesh}
                selectable={awaiting}
                selected={awaiting ? selected : new Set(view.approved || view.stack.tool_ids)}
                onToggle={toggle}
              />
            </Section>
          )}

          {awaiting && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="sticky bottom-4 z-20 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <div className="font-semibold">You&apos;re in control.</div>
                  <div className="text-stone-600">
                    {selected.size} tool{selected.size === 1 ? "" : "s"} selected · {money(selCost)}/mo. Tick or untick tools in the table, then approve.
                  </div>
                  {approveErr && <div className="mt-1 text-red-700">{approveErr}</div>}
                </div>
                <button onClick={doApprove} disabled={approving || selected.size === 0} className="btn-primary shrink-0 px-5 py-3">
                  {approving ? <Spinner /> : <CheckCircle2 size={18} />} Approve &amp; build my 30-day plan
                </button>
              </div>
            </motion.div>
          )}

          {view.agents.planner === "working" && !view.plan && (
            <div className="card flex items-center gap-3 p-5 text-sm text-stone-600">
              <Spinner className="text-emerald-700" /> The Adoption Coach is writing your plan…
            </div>
          )}

          {view.plan && (view.plan.scenarios?.length ?? 0) > 0 && (
            <Section id="s-flow" eyebrow="Stack in action" title="Your AI tools, working together">
              <p className="-mt-2 mb-4 text-sm text-stone-600">
                A typical day after adoption: watch the new AI tools hand work to each other and to the tools you already use.
              </p>
              <StackFlow scenarios={view.plan.scenarios!} catalog={catalog} approved={view.approved || []} />
            </Section>
          )}

          {view.plan && (
            <Section id="s-plan" eyebrow="Adoption Coach" title="Your 30-day adoption plan">
              <PlanView plan={view.plan} catalog={catalog} />
              {view.memorySaved && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-stone-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 text-sm">
                    <BrainCircuit size={20} className="mt-0.5 shrink-0 text-emerald-400" />
                    <span>
                      Saved to your Business Constitution: {view.memorySaved.facts} facts and {view.memorySaved.episodes} adoption
                      {view.memorySaved.episodes === 1 ? "" : "s"}. Next time, your advisors start from here.
                    </span>
                  </div>
                  <Link href="/dashboard" className="btn shrink-0 bg-white text-stone-900 hover:bg-stone-100">
                    Go to dashboard <ArrowRight size={16} />
                  </Link>
                </div>
              )}
            </Section>
          )}
        </main>
      </div>
    </div>
  );
}
