"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Briefcase, MapPin, Store, UserRound } from "lucide-react";
import { api, cn } from "@/lib/api";
import { HelpTip, Logo, Spinner, VERTICAL_LABEL, useTitle } from "@/components/ui";

type Persona = {
  id: string;
  business_name: string;
  owner_name: string;
  vertical: string;
  emoji: string;
  tagline: string;
  location: string;
  employee?: { name: string; role: string } | null;
};
type AccountType = "owner" | "employee";

/** Accepts a bare code or a full pasted invite link like https://…/join/AbC123. */
function inviteCodeFrom(input: string): string {
  const s = input.trim();
  const m = s.match(/\/join\/([^/?#\s]+)/);
  return (m ? m[1] : s).trim();
}

function LoginInner() {
  useTitle("Log in");
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [tab, setTab] = useState<"login" | "register">(params.get("tab") === "register" ? "register" : "login");
  const [accountType, setAccountType] = useState<AccountType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", invite: params.get("invite") || "" });

  useEffect(() => {
    // already logged in? skip the login page
    fetch("/api/me", { cache: "no-store" })
      .then((r) => {
        if (r.ok) router.replace(next);
      })
      .catch(() => {});
    api<Persona[]>("/auth/demo-accounts").then(setPersonas).catch((e) => setErr(e.message));
  }, [router, next]);

  const demo = async (id: string, as: AccountType) => {
    setBusy(`${id}:${as}`);
    setErr(null);
    try {
      await api(`/auth/demo/${id}${as === "employee" ? "?as=employee" : ""}`, { method: "POST" });
      router.push(next);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const switchTab = (t: "login" | "register") => {
    setTab(t);
    setErr(null);
    setAccountType(null);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (tab === "register" && accountType === "employee" && !inviteCodeFrom(form.invite)) {
      setErr("Paste the invite link or code your manager sent you.");
      return;
    }
    setBusy("form");
    try {
      if (tab === "register") {
        const body: Record<string, string> = { name: form.name, email: form.email, password: form.password, account_type: accountType || "owner" };
        if (accountType === "employee") body.invite_code = inviteCodeFrom(form.invite);
        await api("/auth/register", { method: "POST", json: body });
        router.push(accountType === "employee" ? "/dashboard?welcome=1" : "/onboard");
      } else {
        await api("/auth/login", { method: "POST", json: { email: form.email, password: form.password } });
        router.push(next);
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const choosing = tab === "register" && !accountType;

  return (
    <div className="min-h-dvh">
      <header className="page-wrap flex h-16 items-center">
        <Logo />
      </header>
      <main className="page-wrap grid gap-8 pb-16 pt-4 lg:grid-cols-[1.25fr_1fr] lg:gap-12 lg:pt-10">
        <section aria-labelledby="samples">
          <p className="eyebrow">Sample businesses</p>
          <h1 id="samples" className="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Try it as an owner or an employee
          </h1>
          <p className="mt-2 flex items-center gap-1 text-stone-600">
            No password needed.
            <HelpTip label="About sample businesses">
              Owners see the full plan, spending and approvals. Employees see their own tasks, the AI tools they use, and can request new tools.
            </HelpTip>
          </p>
          <div className="mt-6 grid gap-3">
            {(personas || Array.from({ length: 3 }, () => null)).map((p, i) =>
              p ? (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="card p-4"
                >
                  <div className="flex items-start gap-4">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-stone-100 text-2xl" aria-hidden>
                      {p.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-stone-900">{p.business_name}</span>
                        <span className="chip">{VERTICAL_LABEL[p.vertical] || p.vertical}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-stone-600">{p.tagline}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-stone-500">
                        <MapPin size={12} /> {p.location}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => demo(p.id, "owner")}
                      disabled={!!busy}
                      className="btn-primary justify-start px-3 py-2 text-left"
                      aria-label={`Log in to ${p.business_name} as the owner, ${p.owner_name}`}
                    >
                      {busy === `${p.id}:owner` ? <Spinner /> : <Store size={16} />}
                      <span className="min-w-0">
                        <span className="block leading-tight">Log in as owner</span>
                        <span className="block truncate text-xs font-normal text-emerald-50">{p.owner_name}</span>
                      </span>
                    </button>
                    {p.employee && (
                      <button
                        onClick={() => demo(p.id, "employee")}
                        disabled={!!busy}
                        className="btn-secondary justify-start px-3 py-2 text-left"
                        aria-label={`Log in to ${p.business_name} as an employee, ${p.employee.name}`}
                      >
                        {busy === `${p.id}:employee` ? <Spinner /> : <UserRound size={16} className="text-stone-500" />}
                        <span className="min-w-0">
                          <span className="block leading-tight">Log in as employee</span>
                          <span className="block truncate text-xs font-normal text-stone-500">
                            {p.employee.name}, {p.employee.role}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : (
                <div key={i} className="card h-[132px] animate-pulse bg-stone-100" />
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
                onClick={() => switchTab(t)}
                className={cn("rounded-lg py-2 transition-colors", tab === t ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}
              >
                {t === "login" ? "Log in" : "Create account"}
              </button>
            ))}
          </div>

          {choosing ? (
            <div className="mt-6">
              <p className="text-sm font-medium text-stone-700">Which describes you?</p>
              <div className="mt-3 grid gap-3">
                {(
                  [
                    { id: "owner", icon: Store, title: "I own the business", body: "Set up your business, get an AI tool plan, and invite your staff." },
                    { id: "employee", icon: Briefcase, title: "I work at a business", body: "Join with the invite link your manager sent you." },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setAccountType(c.id);
                      setErr(null);
                    }}
                    className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-4 text-left transition-[border-color,box-shadow] hover:border-emerald-300 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <c.icon size={20} />
                    </span>
                    <span>
                      <span className="block font-semibold text-stone-900">{c.title}</span>
                      <span className="mt-0.5 block text-sm text-stone-600">{c.body}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-4">
              {tab === "register" && (
                <button type="button" onClick={() => setAccountType(null)} className="flex items-center gap-1 text-sm font-medium text-stone-500 hover:text-stone-800">
                  <ArrowLeft size={14} /> {accountType === "owner" ? "I own the business" : "I work at a business"}
                </button>
              )}
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
              {tab === "register" && accountType === "employee" && (
                <div>
                  <label className="label" htmlFor="invite">Invite link or code</label>
                  <input
                    id="invite"
                    className="input"
                    autoComplete="off"
                    placeholder="Paste the link your manager sent"
                    value={form.invite}
                    onChange={(e) => setForm({ ...form, invite: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-stone-500">Don&apos;t have one? Ask the owner to create an invite link on their People page.</p>
                </div>
              )}
              {err && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  {err}
                </p>
              )}
              <button className="btn-primary w-full py-3" disabled={!!busy}>
                {busy === "form" ? <Spinner /> : tab === "login" ? "Log in" : accountType === "employee" ? "Join my team" : "Create account & describe my business"}
              </button>
            </form>
          )}
          {err && choosing && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              {err}
            </p>
          )}
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
