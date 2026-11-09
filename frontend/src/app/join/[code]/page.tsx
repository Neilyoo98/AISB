"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, Send, Users } from "lucide-react";
import { api, cn } from "@/lib/api";
import { Logo, Spinner, useTitle } from "@/components/ui";

type Info = { business_name: string | null; invited_by: string | null; name: string | null; status: "valid" | "used" | "expired" | "revoked"; message: string | null };

export default function JoinPage() {
  useTitle("Join your team");
  const { code } = useParams<{ code: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState<{ name: string; business: string | null } | null>(null);
  const [tab, setTab] = useState<"new" | "login">("new");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  useEffect(() => {
    api<Info>(`/team/invite/${code}`)
      .then((i) => {
        setInfo(i);
        if (i.name) setForm((f) => ({ ...f, name: i.name || "" }));
      })
      .catch((e) => setLoadErr(e.message));
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => m && setLoggedIn({ name: m.user.name, business: m.business?.name ?? null }))
      .catch(() => {});
  }, [code]);

  const join = async () => {
    const r = await api<{ business_name: string }>(`/team/join/${code}`, { method: "POST" });
    setJoined(r.business_name);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (tab === "new") await api("/auth/register", { method: "POST", json: form });
      else await api("/auth/login", { method: "POST", json: { email: form.email, password: form.password } });
      await join();
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  const joinAsCurrent = async () => {
    setBusy(true);
    setErr(null);
    try {
      await join();
    } catch (x) {
      setErr((x as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-5xl items-center px-4"><Logo /></header>
      <main className="mx-auto max-w-md px-4 pb-16 pt-6">
        {loadErr ? (
          <Card><p className="text-stone-700">{loadErr}</p><Link href="/" className="btn-secondary mt-5">Go to StackSmith</Link></Card>
        ) : !info ? (
          <div className="grid place-items-center py-24 text-stone-500"><Spinner /></div>
        ) : joined ? (
          <Card>
            <CheckCircle2 className="mx-auto text-emerald-700" size={36} />
            <h1 className="mt-3 text-center font-display text-2xl font-bold">You&apos;re on the {joined} team</h1>
            <p className="mt-2 text-center text-stone-600">Find an AI tool that would help your work and press <b>Request</b>. Your owner approves it.</p>
            <div className="mt-6 grid gap-2">
              <Link href="/tools" className="btn-primary py-3"><Send size={16} /> Find a tool to request</Link>
              <Link href="/team" className="btn-secondary">See your team</Link>
            </div>
          </Card>
        ) : info.status !== "valid" ? (
          <Card>
            <h1 className="font-display text-2xl font-bold">This link can&apos;t be used</h1>
            <p className="mt-2 text-stone-600">{info.message}</p>
            <Link href="/" className="btn-secondary mt-5">Go to StackSmith</Link>
          </Card>
        ) : (
          <Card>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><Users size={22} /></span>
            <h1 className="mt-3 text-center font-display text-2xl font-bold">Join {info.business_name} on StackSmith</h1>
            <p className="mt-1 text-center text-sm text-stone-600">
              {info.invited_by ? `${info.invited_by} invited you. ` : ""}You&apos;ll be able to request AI tools for your work.
            </p>

            {loggedIn ? (
              <div className="mt-6 space-y-3">
                <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                  You&apos;re logged in as <b>{loggedIn.name}</b>{loggedIn.business ? ` (already part of ${loggedIn.business})` : ""}.
                </p>
                {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
                <button className="btn-primary w-full py-3" onClick={joinAsCurrent} disabled={busy}>{busy ? <Spinner /> : `Join ${info.business_name}`}</button>
                <button className="w-full text-center text-sm text-stone-500 hover:underline" onClick={async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); setLoggedIn(null); }}>
                  Use a different account
                </button>
              </div>
            ) : (
              <>
                <div role="tablist" className="mt-6 grid grid-cols-2 rounded-xl bg-stone-100 p-1 text-sm font-semibold">
                  {(["new", "login"] as const).map((k) => (
                    <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr(null); }}
                      className={cn("rounded-lg py-2", tab === k ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800")}>
                      {k === "new" ? "I'm new here" : "I have an account"}
                    </button>
                  ))}
                </div>
                <form onSubmit={submit} className="mt-5 space-y-3">
                  {tab === "new" && (
                    <label className="block">
                      <span className="label">Your name</span>
                      <input className="input" required autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </label>
                  )}
                  <label className="block">
                    <span className="label">Email</span>
                    <input className="input" type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </label>
                  <label className="block">
                    <span className="label">Password</span>
                    <input className="input" type="password" required minLength={tab === "new" ? 8 : undefined} autoComplete={tab === "new" ? "new-password" : "current-password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  </label>
                  {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
                  <button className="btn-primary w-full py-3" disabled={busy}>{busy ? <Spinner /> : tab === "new" ? "Create account & join" : "Log in & join"}</button>
                </form>
              </>
            )}
          </Card>
        )}
      </main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card p-6 text-center sm:p-8 [&_form]:text-left [&_label]:text-left">{children}</div>;
}
