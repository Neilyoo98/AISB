"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hammer, LayoutDashboard, LogOut, BookUser } from "lucide-react";
import { api, cn } from "@/lib/api";

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-display text-lg font-bold tracking-tight text-stone-900", className)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-700 text-white">
        <Hammer size={16} strokeWidth={2.5} />
      </span>
      StackSmith
    </Link>
  );
}

export function AppHeader({ businessName, isDemo }: { businessName?: string; isDemo?: boolean }) {
  const router = useRouter();
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#fafaf7]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {businessName && (
            <span className="hidden min-w-0 truncate border-l border-stone-300 pl-3 text-sm text-stone-600 sm:block">{businessName}</span>
          )}
        </div>
        <nav className="flex items-center gap-1">
          <Link href="/dashboard" className="btn-ghost px-3" aria-label="Dashboard">
            <LayoutDashboard size={16} /> <span className="hidden sm:inline">Dashboard</span>
          </Link>
          <Link href="/profile" className="btn-ghost px-3" aria-label="Business Constitution">
            <BookUser size={16} /> <span className="hidden sm:inline">Constitution</span>
          </Link>
          <button onClick={logout} className="btn-ghost px-3" aria-label="Log out">
            <LogOut size={16} /> <span className="hidden sm:inline">Log out</span>
          </button>
        </nav>
      </div>
      {isDemo && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">
          You&apos;re viewing a sample business.{" "}
          <Link href="/login?tab=register" className="font-semibold underline underline-offset-2">
            Create an account
          </Link>{" "}
          to analyze your own.
        </div>
      )}
    </header>
  );
}

export function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "good" | "warn" }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "mt-1 font-display text-2xl font-bold tabular-nums sm:text-3xl",
          tone === "good" && "text-emerald-700",
          tone === "warn" && "text-amber-700",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} aria-hidden />;
}

export const VERTICAL_LABEL: Record<string, string> = {
  cafe: "Café",
  restaurant: "Restaurant",
  hvac: "HVAC",
  landscaping: "Landscaping",
  home_services: "Home services",
  salon: "Salon",
  retail: "Retail",
  other: "Small business",
};

export const PAIN_LABEL = (tag: string) => tag.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
