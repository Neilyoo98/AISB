import Link from "next/link";
import { ArrowRight, BadgeDollarSign, BrainCircuit, CheckCircle2, MessageSquareText, Scale, ShieldCheck, Users } from "lucide-react";
import { HelpTip, Logo } from "@/components/ui";

const steps = [
  { icon: MessageSquareText, title: "Tell us in your own words", body: "Describe your week, or start from a template." },
  { icon: BadgeDollarSign, title: "See what each problem costs", body: "Every pain gets a monthly dollar figure." },
  { icon: Users, title: "Advisors debate the options", body: "Three AI advisors challenge every tool." },
  { icon: CheckCircle2, title: "Approve, then adopt in 30 days", body: "You approve; we write the rollout plan." },
];

const trust = [
  { icon: ShieldCheck, title: "No made-up tools", body: "Only real tools from a verified catalog." },
  { icon: Scale, title: "Discover & compare", body: "Search in plain words; compare cost, fit and reviews side by side." },
  { icon: BadgeDollarSign, title: "ROI you can audit", body: "A plain calculator does the math, not the AI." },
  { icon: BrainCircuit, title: "It remembers you", body: "Advice gets sharper with every visit." },
];

export default function Home() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Logo />
        <div className="flex items-center gap-1">
          <Link href="/tools" className="btn-ghost">Discover tools</Link>
          <Link href="/login" className="btn-secondary">Log in</Link>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
          <p className="chip mb-5 border-emerald-200 bg-emerald-50 text-emerald-800">For cafés, restaurants, HVAC, landscapers &amp; other local businesses</p>
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.05] tracking-tight text-stone-900 sm:text-6xl">
            The right AI tools for your business, picked, priced and planned.
          </h1>
          <p className="mt-5 flex max-w-2xl items-center gap-2 text-lg leading-relaxed text-stone-600">
            A team of AI advisors that finds the few tools that pay for themselves.
            <HelpTip label="What is StackSmith?">
              StackSmith listens to how your business actually runs, puts a dollar figure on what&apos;s slowing you down, compares real tools, and recommends a small stack that pays
              for itself, with a 30-day plan to adopt it. You approve everything.
            </HelpTip>
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="btn-primary px-5 py-3 text-base">
              Try a sample business <ArrowRight size={18} />
            </Link>
            <Link href="/login?tab=register" className="btn-secondary px-5 py-3 text-base">
              Analyze my business
            </Link>
            <Link href="/tools" className="btn-ghost px-5 py-3 text-base">
              Browse the tool catalog
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
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
