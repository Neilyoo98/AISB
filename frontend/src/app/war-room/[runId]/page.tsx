"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, Network, RotateCcw, Zap } from "lucide-react";
import { api, money } from "@/lib/api";
import type { Business, Tool, User } from "@/lib/types";
import { useRunStream } from "@/hooks/useRunStream";
import { AppHeader, FlowStepper, Spinner, useTitle } from "@/components/ui";
import { AdvisorTeamReplay } from "@/components/advisor-replay";
import { useAdoptions } from "@/hooks/useAdoptions";
import { MeshPanel, PainCards, Pipeline, PlanView, ProfileCard, ScoutGrid, Section, StackPanel } from "@/components/war-room";

export default function WarRoom() {
  useTitle("War Room");
  const router = useRouter();
  const { runId } = useParams<{ runId: string }>();
  const [retrying, setRetrying] = useState(false);
  const [retryErr, setRetryErr] = useState<string | null>(null);
  const { view, approve } = useRunStream(runId);
  const [catalog, setCatalog] = useState<Record<string, Tool>>({});
  const [me, setMe] = useState<{ user: User; business: Business | null } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approving, setApproving] = useState(false);
  const [approveErr, setApproveErr] = useState<string | null>(null);
  const { adopted } = useAdoptions();

  useEffect(() => {
    api<Tool[]>("/catalog").then((ts) => setCatalog(Object.fromEntries(ts.map((t) => [t.id, t]))));
    api<{ user: User; business: Business | null; account_role?: string }>("/me")
      .then((m) => {
        if (m.account_role === "employee") router.replace("/dashboard"); // owner-only workspace
        else setMe(m);
      })
      .catch(() => {});
  }, [router]);

  useEffect(() => {
    if (view.stack) setSelected(new Set(view.stack.tool_ids));
  }, [view.stack]);

  // Follow the newest section ONLY while the run is streaming and the owner isn't scrolling themselves;
  // never auto-scroll once the run is done (that fought the user's own scrolling).
  const sectionCount = [view.profile, view.pains.length, view.meshStarted, view.stack, view.plan].filter(Boolean).length;
  const firstRender = useRef(true);
  const lastUserScroll = useRef(0);
  useEffect(() => {
    const mark = () => (lastUserScroll.current = Date.now());
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(e.key)) mark();
    };
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (view.status !== "running") return;
    if (Date.now() - lastUserScroll.current < 2000) return;
    const ids = ["s-profile", "s-pains", "s-mesh", "s-stack", "s-plan"];
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
  const step: 0 | 1 | 2 | 3 | 4 =
    view.status === "complete" || view.plan ? 4 : view.agents.planner === "working" ? 3 : awaiting ? 2 : 1;

  const retry = async () => {
    setRetrying(true);
    setRetryErr(null);
    try {
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode: me?.user.is_demo ? "auto" : "live" } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setRetryErr((e as Error).message);
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-dvh pb-24">
      <AppHeader businessName={me?.business?.name} isDemo={me?.user.is_demo} />
      <div className="page-wrap grid gap-8 pt-6 lg:grid-cols-[230px_1fr]">
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
              </div>
            </div>
          </div>
          <div className="mt-4 hidden lg:block">
            <Pipeline agents={view.agents} />
          </div>
        </aside>

        <main className="min-w-0 space-y-10">
          <div className="space-y-4">
          <FlowStepper step={step} />
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
          {view.status === "error" && (
            <div role="alert" className="card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <div className="font-semibold">This analysis didn&apos;t finish.</div>
                <div className="text-stone-600">{retryErr || "Nothing was lost. You can start it again."}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href="/dashboard" className="btn-secondary">Back to dashboard</Link>
                <button onClick={retry} disabled={retrying} className="btn-primary">
                  {retrying ? <Spinner /> : <RotateCcw size={16} />} Try again
                </button>
              </div>
            </div>
          )}
          </div>

          {view.profile && (
            <Section id="s-profile" eyebrow="Step 1" title="What we heard">
              <ProfileCard profile={view.profile} memory={view.memory} facts={view.facts} />
            </Section>
          )}

          {view.pains.length > 0 && (
            <Section id="s-pains" eyebrow="Step 2" title="What's costing you money" help="Each card shows what the problem costs you per month, with the math. Below, scouts shortlist tools from our verified catalog.">
              <PainCards pains={view.pains} />
              <div className="mt-4">
                <ScoutGrid pains={view.pains} scouts={view.scouts} dropped={view.dropped} security={view.security} catalog={catalog} />
              </div>
            </Section>
          )}

          {view.meshStarted && (
            <Section id="s-mesh" eyebrow="Step 3" title="Advisors check the shortlist" help="Three advisors look at cost, ease of use, and fit with the tools you already use.">
              <MeshPanel mesh={view.mesh} catalog={catalog} waiting={!view.stack} />
            </Section>
          )}

          {view.stack && (
            <Section
              id="s-stack"
              eyebrow="Step 4"
              title="Recommended tools"
              help="Tools are compared per problem. Expand a tool to see why it was picked and how we estimated the savings."
            >
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
                adopted={view.status === "complete" ? adopted : undefined}
              />
            </Section>
          )}

          {awaiting && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
              className="sticky bottom-20 z-20 rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:bottom-4 sm:mr-48"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                  <div className="font-semibold">You&apos;re in control.</div>
                  <div className="text-stone-600">
                    {selected.size} tool{selected.size === 1 ? "" : "s"} · {money(selCost)}/month. Untick anything you don&apos;t want.
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

          {(view.status === "complete" || view.status === "awaiting_approval") && (
            <details className="card group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold">
                <span className="flex items-center gap-2"><Network size={18} className="text-emerald-700" /> How your advisors worked</span>
                <span className="text-sm font-normal text-emerald-700 group-open:hidden">Show replay</span>
              </summary>
              <div className="mt-4">
                <AdvisorTeamReplay runId={runId} catalog={catalog} showWarRoomLink={false} />
              </div>
            </details>
          )}

          {view.plan && (
            <Section id="s-plan" eyebrow="Your plan" title="Your setup plan, step by step">
              <PlanView plan={view.plan} catalog={catalog} />
              {view.memorySaved && (
                <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-stone-900 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 text-sm">
                    <BrainCircuit size={20} className="mt-0.5 shrink-0 text-emerald-400" />
                    <span>
                      Saved to your profile. Next time, your advisors start from here.
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Link href="/agents" className="btn border border-white/30 text-white hover:bg-white/10">
                      <Network size={16} /> See agents working together
                    </Link>
                    <Link href="/dashboard" className="btn bg-white text-stone-900 hover:bg-stone-100">
                      Go to dashboard <ArrowRight size={16} />
                    </Link>
                  </div>
                </div>
              )}
            </Section>
          )}
        </main>
      </div>
    </div>
  );
}
