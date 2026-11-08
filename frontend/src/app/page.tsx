import Link from "next/link";
import { ArrowRight, BadgeDollarSign, BrainCircuit, CheckCircle2, MessageSquareText, ShieldCheck, Users } from "lucide-react";
import { Logo } from "@/components/ui";

const steps = [
  { icon: MessageSquareText, title: "Tell us in your own words", body: "No forms full of jargon. Describe your week, what slips through the cracks, and your budget." },
  { icon: BadgeDollarSign, title: "See what each problem costs", body: "A diagnostician turns “we miss calls” into “~$4,500/month in lost jobs”, with the math shown." },
  { icon: Users, title: "Advisors debate the options", body: "A Budget Hawk, an Ease-of-Use Coach and an Integration Checker challenge every tool before you see it." },
  { icon: CheckCircle2, title: "Approve, then adopt in 30 days", body: "You stay in control. Approve the stack you like and get a week-by-week rollout plan." },
];

const trust = [
  { icon: ShieldCheck, title: "No made-up tools", body: "Advisors can only recommend from a verified catalog of real tools. Anything else is blocked." },
  { icon: BadgeDollarSign, title: "ROI you can audit", body: "AI estimates the impact; a plain calculator does the math. Every number is traceable." },
  { icon: BrainCircuit, title: "It remembers your business", body: "Your Business Constitution grows with each visit, so advice gets sharper over time." },
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo />
        <Link href="/login" className="btn-secondary">
          Log in
        </Link>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
          <p className="chip mb-5 border-emerald-200 bg-emerald-50 text-emerald-800">For cafés, restaurants, HVAC, landscapers &amp; other local businesses</p>
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-stone-900 sm:text-6xl">
            The right AI tools for your business, picked, priced and planned.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">
            StackSmith is a team of AI advisors that listens to how your business actually runs, puts a dollar figure on what&apos;s
            slowing you down, and recommends a small stack of proven tools that pays for itself, with a 30-day plan to adopt it.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="btn-primary px-5 py-3 text-base">
              Try a sample business <ArrowRight size={18} />
            </Link>
            <Link href="/login?tab=register" className="btn-secondary px-5 py-3 text-base">
              Analyze my business
            </Link>
          </div>
          <p className="mt-3 text-sm text-stone-500">One click, no signup needed for the samples.</p>
        </section>

        <section className="border-y border-stone-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="eyebrow">How it works</h2>
            <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {steps.map((s, i) => (
                <li key={s.title} className="relative">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <s.icon size={20} />
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-stone-400">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 font-semibold text-stone-900">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="max-w-xl font-display text-2xl font-bold sm:text-3xl">Not another directory of 5,000 AI tools.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {trust.map((t) => (
              <div key={t.title} className="card p-5">
                <t.icon size={20} className="text-emerald-700" />
                <h3 className="mt-3 font-semibold">{t.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{t.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-stone-200 px-4 py-8 text-center text-xs text-stone-500">
        StackSmith prototype · AISB Hack-a-thon, University of Maryland · Tool prices as of Nov 2026. Verify before buying.
      </footer>
    </div>
  );
}
