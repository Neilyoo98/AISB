"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { AppHeader, PageState, useTitle } from "@/components/ui";

// /war-room → opens the latest analysis, or invites the owner to start one.
export default function WarRoomIndex() {
  useTitle("War Room");
  const router = useRouter();
  const [empty, setEmpty] = useState<{ user: User } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api<{ user: User; runs: { id: string }[]; business: unknown }>("/dashboard")
      .then((d) => {
        if (d.runs.length) router.replace(`/war-room/${d.runs[0].id}`);
        else if (!d.business && !d.user.is_demo) router.replace("/onboard");
        else setEmpty({ user: d.user });
      })
      .catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-dvh">
      <AppHeader isDemo={empty?.user.is_demo} />
      <main className="page-wrap pt-8">
        {err ? (
          <PageState kind="error" message={err} onRetry={load} />
        ) : empty ? (
          <PageState kind="empty">
            <Radio className="mx-auto text-emerald-700" />
            <h1 className="mt-3 font-display text-2xl font-bold text-stone-900">No analysis yet</h1>
            <p className="mt-1 text-stone-600">The War Room is where your AI advisors work together on your business.</p>
            <Link href="/onboard" className="btn-primary mt-5">Start an analysis</Link>
          </PageState>
        ) : (
          <PageState kind="loading" />
        )}
      </main>
    </div>
  );
}
