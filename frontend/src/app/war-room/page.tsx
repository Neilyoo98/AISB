"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { AppHeader, Spinner } from "@/components/ui";

// /war-room → opens the latest analysis, or invites the owner to start one.
export default function WarRoomIndex() {
  const router = useRouter();
  const [empty, setEmpty] = useState<{ user: User } | null>(null);

  useEffect(() => {
    api<{ user: User; runs: { id: string }[]; business: unknown }>("/dashboard").then((d) => {
      if (d.runs.length) router.replace(`/war-room/${d.runs[0].id}`);
      else if (!d.business && !d.user.is_demo) router.replace("/onboard");
      else setEmpty({ user: d.user });
    });
  }, [router]);

  return (
    <div className="min-h-dvh">
      <AppHeader isDemo={empty?.user.is_demo} />
      <div className="grid place-items-center px-4 py-32 text-center text-stone-500">
        {empty ? (
          <div>
            <Radio className="mx-auto text-emerald-700" />
            <h1 className="mt-3 font-display text-2xl font-bold text-stone-900">No analysis yet</h1>
            <p className="mt-1">The War Room is where your AI advisors work together on your business.</p>
            <Link href="/onboard" className="btn-primary mt-5">Start an analysis</Link>
          </div>
        ) : (
          <Spinner />
        )}
      </div>
    </div>
  );
}
