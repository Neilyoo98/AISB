"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, Spinner } from "@/components/ui";

const PROMPTS = [
  "What kind of business is it, and how many people work there?",
  "What eats your time each week, or slips through the cracks?",
  "What software or apps do you already use?",
  "Roughly how much could you spend per month on tools?",
  "How comfortable are you with technology?",
];

const EXAMPLE =
  "I own a hair salon in Laurel with 5 chairs. No-shows are killing us, maybe 8 a week at about $60 each, and I spend hours on the phone rebooking people. We take bookings by phone and Instagram DMs and write them in a paper book. I'd like to post more on Instagram but never have time. I could spend about $100 a month. I'm fine with phone apps.";

export default function Onboard() {
  const router = useRouter();
  const [me, setMe] = useState<{ user: User; business: Business | null } | null>(null);
  const [form, setForm] = useState({ name: "", location: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User; business: Business | null }>("/me").then((m) => {
      if (m.user.is_demo) return router.replace("/dashboard");
      setMe(m);
      if (m.business) setForm({ name: m.business.name, location: m.business.location || "", description: m.business.description || "" });
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api("/businesses", { method: "POST", json: form });
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode: "live", raw_input: form.description } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader businessName={me?.business?.name} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow">Step 1 of 2</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Tell us about your business</h1>
        <p className="mt-2 text-stone-600">Write it like you&apos;d explain it to a friend. Numbers help, but rough guesses are fine.</p>

        <form onSubmit={submit} className="card mt-8 space-y-5 p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="bname">Business name</label>
              <input id="bname" className="input" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="loc">Town / city</label>
              <input id="loc" className="input" maxLength={120} placeholder="College Park, MD" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </div>
          </div>
          <div>
            <div className="flex items-end justify-between gap-3">
              <label className="label" htmlFor="desc">How does your business run?</label>
              <button type="button" className="mb-1.5 text-xs font-semibold text-emerald-700 hover:underline" onClick={() => setForm({ name: form.name || "Bright Smile Salon", location: form.location || "Laurel, MD", description: EXAMPLE })}>
                Use an example
              </button>
            </div>
            <textarea
              id="desc"
              className="input min-h-[180px] resize-y leading-relaxed"
              required
              minLength={40}
              maxLength={3000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <ul className="mt-3 grid gap-1.5 text-sm text-stone-500 sm:grid-cols-2">
              {PROMPTS.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-stone-400" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          {err && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {err}
            </p>
          )}
          <button className="btn-primary w-full py-3 text-base" disabled={busy || form.description.length < 40}>
            {busy ? <Spinner /> : <Sparkles size={18} />} Meet your advisors
          </button>
          <p className="text-center text-xs text-stone-500">Takes about 30–60 seconds. You approve everything before anything is saved as a plan.</p>
        </form>
      </main>
    </div>
  );
}
