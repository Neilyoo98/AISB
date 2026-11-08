"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookUser, Compass, Hammer, LayoutDashboard, LogOut, Radio } from "lucide-react";
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

export function AppHeader({ businessName, isDemo, loggedOut }: { businessName?: string; isDemo?: boolean; loggedOut?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
  };
  const links = loggedOut
    ? [{ href: "/tools", label: "Discover tools", icon: Compass }]
    : [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/war-room", label: "War Room", icon: Radio },
        { href: "/tools", label: "Discover", icon: Compass },
        { href: "/profile", label: "Constitution", icon: BookUser },
      ];
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#fafaf7]/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {businessName && (
            <span className="hidden min-w-0 truncate border-l border-stone-300 pl-3 text-sm text-stone-600 lg:block">{businessName}</span>
          )}
        </div>
        <nav className="flex items-center gap-0.5">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} className={cn("btn-ghost px-2.5 sm:px-3", active && "bg-stone-100 text-stone-900")} aria-label={l.label}>
                <l.icon size={16} /> <span className="hidden md:inline">{l.label}</span>
              </Link>
            );
          })}
          {loggedOut ? (
            <Link href="/login" className="btn-primary ml-1">
              Log in
            </Link>
          ) : (
            <button onClick={logout} className="btn-ghost px-2.5 sm:px-3" aria-label="Log out">
              <LogOut size={16} /> <span className="hidden md:inline">Log out</span>
            </button>
          )}
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
