"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, MapPin } from "lucide-react";
import { api, cn } from "@/lib/api";
import { HelpTip, Logo, Spinner, VERTICAL_LABEL, useTitle } from "@/components/ui";

type Persona = { id: string; business_name: string; owner_name: string; vertical: string; emoji: string; tagline: string; location: string };

function LoginInner() {
  useTitle("Log in");
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [tab, setTab] = useState<"login" | "register">(params.get("tab") === "register" ? "register" : "login");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  useEffect(() => {
    // already logged in? skip the login page
    fetch("/api/me", { cache: "no-store" })
      .then((r) => {
        if (r.ok) router.replace(next);
      })
      .catch(() => {});
    api<Persona[]>("/auth/demo-accounts").then(setPersonas).catch((e) => setErr(e.message));
  }, [router, next]);

  const demo = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await api(`/auth/demo/${id}`, { method: "POST" });
      router.push(next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy("form");
    setErr(null);
    try {
      if (tab === "register") {
        await api("/auth/register", { method: "POST", json: form });
        router.push("/onboard");
      } else {
        await api("/auth/login", { method: "POST", json: { email: form.email, password: form.password } });
        router.push(next);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <Logo />
      </header>
      <main className="mx-auto grid max-w-6xl gap-8 px-4 pb-16 pt-4 lg:grid-cols-[1.25fr_1fr] lg:gap-12 lg:pt-10">
        <section aria-labelledby="samples">
          <p className="eyebrow">Sample businesses</p>
          <h1 id="samples" className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Log in instantly as a real-world owner
          </h1>
          <p className="mt-2 flex items-center gap-1 text-stone-600">
            No password needed.
            <HelpTip label="About sample businesses">
              Each sample comes with a saved profile, a past recommendation, verified reviews and a 30-day plan in progress, so you can explore every feature right away.
            </HelpTip>
          </p>
          <div className="mt-6 grid gap-3">
            {(personas || Array.from({ length: 3 }, () => null)).map((p, i) =>
              p ? (
                <motion.button
                  key={p.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  onClick={() => demo(p.id)}
                  disabled={!!busy}
                  className="card group flex items-center gap-4 p-4 text-left transition-[border-color,box-shadow] hover:border-emerald-300 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 disabled:opacity-60"
                >
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-stone-100 text-3xl" aria-hidden>
                    {p.emoji}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-stone-900">{p.business_name}</span>
                      <span className="chip">{VERTICAL_LABEL[p.vertical] || p.vertical}</span>
                    </span>
                    <span className="mt-0.5 block text-sm text-stone-600">{p.tagline}</span>
                    <span className="mt-1 flex items-center gap-1 text-xs text-stone-500">
                      <MapPin size={12} /> {p.location} · owner {p.owner_name}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-sm font-semibold text-emerald-700 sm:flex">
                    {busy === p.id ? <Spinner /> : <>Log in as {p.owner_name.split(" ")[0]} <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" /></>}
                  </span>
                </motion.button>
              ) : (
                <div key={i} className="card h-[92px] animate-pulse bg-stone-100" />
              ),
            )}
          </div>
        </section>

        <section className="card h-fit p-6 sm:p-8" aria-label="Your account">
          <div role="tablist" className="grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold">
            {(["login", "register"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setErr(null);
                }}
                className={cn("rounded-lg py-2 transition-colors", tab === t ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
              >
                {t === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="mt-6 space-y-4">
            {tab === "register" && (
              <div>
                <label className="label" htmlFor="name">Your name</label>
                <input id="name" className="input" autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                autoComplete={tab === "register" ? "new-password" : "current-password"}
                minLength={tab === "register" ? 8 : undefined}
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              {tab === "register" && <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>}
            </div>
            {err && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                {err}
              </p>
            )}
            <button className="btn-primary w-full py-3" disabled={!!busy}>
              {busy === "form" ? <Spinner /> : tab === "login" ? "Log in" : "Create account & describe my business"}
            </button>
          </form>
          <p className="mt-4 text-center text-xs text-stone-500">Just exploring? The sample businesses need no password.</p>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
