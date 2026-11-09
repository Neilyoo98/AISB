"use client";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Check, CircleHelp, Compass, Hammer, LayoutDashboard, LogOut, Radio, Star, UserRound, Users2 } from "lucide-react";
import { api, cn } from "@/lib/api";

export function Logo({ className, light }: { className?: string; light?: boolean }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2 font-display text-lg font-bold tracking-tight", light ? "text-white" : "text-stone-900", className)}>
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
    accountRoleCache = null;
    router.push("/");
  };
  const accountRole = useAccountRole(!loggedOut);
  const links = loggedOut
    ? [{ href: "/tools", label: "Discover tools", icon: Compass }]
    : [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        // employees don't run business analyses, so the War Room is owner-only
        ...(accountRole === "employee" ? [] : [{ href: "/war-room", label: "War Room", icon: Radio }]),
        { href: "/team", label: "Team", icon: Users2 },
        { href: "/tools", label: "Discover", icon: Compass },
        { href: "/profile", label: "Profile", icon: UserRound },
      ];
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#fafaf7]/90 backdrop-blur [transform:translateZ(0)]">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          {businessName && (
            <span className="hidden min-w-0 max-w-[14rem] truncate border-l border-stone-300 pl-3 text-sm text-stone-600 xl:block">{businessName}</span>
          )}
        </div>
        <nav className="flex items-center gap-0.5">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link key={l.href} href={l.href} className={cn("btn-ghost px-2.5 sm:px-3", active && "bg-stone-100 text-stone-900")} aria-label={l.label}>
                <l.icon size={16} /> <span className="hidden lg:inline">{l.label}</span>
              </Link>
            );
          })}
          {loggedOut ? (
            <Link href="/login" className="btn-primary ml-1">
              Log in
            </Link>
          ) : (
            <button onClick={logout} className="btn-ghost px-2.5 sm:px-3" aria-label="Log out">
              <LogOut size={16} /> <span className="hidden xl:inline">Log out</span>
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

const PAIN_NAMES: Record<string, string> = { email_sms_marketing: "Email & SMS marketing", no_shows: "No-shows", admin_writing: "Admin & writing", invoicing_payments: "Invoices & payments", dispatch_routing: "Dispatch & routing" };
export const PAIN_LABEL = (tag: string) => PAIN_NAMES[tag] ?? tag.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());


/** Sets the browser tab title: "Dashboard · StackSmith". */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · StackSmith` : "StackSmith";
  }, [title]);
}

/** A small "?" button that reveals longer explanations on demand (click / Enter; Esc or outside click closes). */
export function HelpTip({ children, label = "More info", align = "left" }: { children: React.ReactNode; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placeAbove: boolean } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  // Position in viewport coordinates so no parent `overflow-hidden` can clip the popover.
  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const W = Math.min(288, window.innerWidth - 32);
    const H = popRef.current?.offsetHeight ?? 160;
    let left = align === "right" ? b.right - W : b.left;
    left = Math.max(16, Math.min(left, window.innerWidth - W - 16));
    const placeAbove = b.bottom + 8 + H > window.innerHeight - 8 && b.top - 8 - H > 8;
    const top = placeAbove ? b.top - 8 - H : b.bottom + 8;
    setPos({ top, left, placeAbove });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const raf = requestAnimationFrame(place); // re-measure once the popover has its real height
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn("grid h-6 w-6 place-items-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700", open && "bg-stone-100 text-stone-800")}
      >
        <CircleHelp size={16} />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            ref={popRef}
            id={id}
            role="dialog"
            aria-label={label}
            style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: "min(18rem, calc(100vw - 2rem))", visibility: pos ? "visible" : "hidden" }}
            className="z-[60] block max-h-[60vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-3.5 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-stone-700 shadow-xl"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}

/**
 * Keep the current row of a step log in view by scrolling ONLY the log container (never the page).
 * Following pauses for a few seconds after the user scrolls the log themselves.
 */
export function useLogFollow<T extends HTMLElement>(index: number) {
  const ref = useRef<T>(null);
  const userScrolledAt = useRef(0);
  const programmatic = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (programmatic.current) programmatic.current = false;
      else userScrolledAt.current = Date.now();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    const box = ref.current;
    if (!box || Date.now() - userScrolledAt.current < 4000) return;
    const row = box.querySelector<HTMLElement>(`[data-step="${index}"]`);
    if (!row) return;
    const top = row.offsetTop - box.offsetTop - 8;
    const visible = row.offsetTop - box.offsetTop >= box.scrollTop && row.offsetTop - box.offsetTop + row.offsetHeight <= box.scrollTop + box.clientHeight;
    if (visible) return;
    programmatic.current = true;
    box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [index]);
  return ref;
}

/** Standard page header: eyebrow, title (+ optional help), and actions on the right. */
export function PageHeader({ eyebrow, title, help, actions }: { eyebrow?: string; title: React.ReactNode; help?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 flex items-center gap-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          <span className="min-w-0">{title}</span>
          {help && <HelpTip label="About this page">{help}</HelpTip>}
        </h1>
      </div>
      {actions && <div className="flex shrink-0 flex-col gap-2 sm:flex-row">{actions}</div>}
    </div>
  );
}

/** Consistent loading / error / empty states. */
export function PageState({ kind, message, onRetry, children }: { kind: "loading" | "error" | "empty"; message?: string; onRetry?: () => void; children?: React.ReactNode }) {
  if (kind === "loading")
    return (
      <div className="space-y-4 py-8" aria-busy="true" aria-label="Loading">
        <div className="h-8 w-1/3 animate-pulse rounded-lg bg-stone-200/70" />
        <div className="h-28 animate-pulse rounded-2xl bg-stone-200/60" />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200/50" />
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200/50" />
        </div>
      </div>
    );
  if (kind === "error")
    return (
      <div role="alert" className="card mx-auto my-16 max-w-md p-8 text-center">
        <AlertTriangle className="mx-auto text-amber-600" />
        <p className="mt-3 font-semibold">Something went wrong</p>
        <p className="mt-1 text-sm text-stone-600">{message}</p>
        {onRetry && <button className="btn-primary mt-5" onClick={onRetry}>Try again</button>}
      </div>
    );
  return <div className="card mx-auto my-10 max-w-xl p-8 text-center">{message && <p className="text-stone-600">{message}</p>}{children}</div>;
}

const FLOW = ["Describe", "Advisors at work", "Review & approve", "Plan"];

/** The analysis journey stepper shown on onboarding and the War Room. */
export function FlowStepper({ step }: { step: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium sm:text-sm" aria-label="Analysis progress">
      {FLOW.map((label, i) => {
        const done = i < step;
        const current = i === step;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "grid h-6 w-6 place-items-center rounded-full border text-[11px] font-bold",
                done && "border-emerald-700 bg-emerald-700 text-white",
                current && "border-emerald-700 text-emerald-800",
                !done && !current && "border-stone-300 text-stone-400",
              )}
            >
              {done ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cn(current ? "text-stone-900" : done ? "text-stone-700" : "text-stone-400")}>{label}</span>
            {i < FLOW.length - 1 && <span className="mx-1 h-px w-6 bg-stone-300 sm:w-10" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export function Stars({ value, size = 14, label }: { value: number; size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={label || `${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-stone-300"} />
      ))}
    </span>
  );
}

export function Ease({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`needs tech comfort ${n} of 5`} title={`Tech comfort needed: ${n}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cn("h-1.5 w-3 rounded-full", i <= n ? "bg-stone-700" : "bg-stone-200")} />
      ))}
    </span>
  );
}

/**
 * A popover rendered in a portal with fixed positioning next to an anchor element, so no parent frame
 * (cards, tables, `overflow-hidden`) can clip it. Flips above / shifts left near viewport edges.
 */
export function AnchoredPopover({ anchorRef, open, onClose, width = 256, align = "end", label, children }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  align?: "start" | "end";
  label: string;
  children: React.ReactNode;
}) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const a = anchorRef.current?.getBoundingClientRect();
    if (!a) return;
    const W = Math.min(width, window.innerWidth - 32);
    const H = popRef.current?.offsetHeight ?? 180;
    let left = align === "end" ? a.right - W : a.left;
    left = Math.max(16, Math.min(left, window.innerWidth - W - 16));
    const above = a.bottom + 8 + H > window.innerHeight - 8 && a.top - 8 - H > 8;
    setPos({ top: above ? a.top - 8 - H : a.bottom + 8, left });
  }, [anchorRef, width, align]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={label}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: `min(${width}px, calc(100vw - 2rem))`, visibility: pos ? "visible" : "hidden" }}
      className="z-[60] rounded-xl border border-stone-200 bg-white p-3 text-left shadow-xl"
    >
      {children}
    </div>,
    document.body,
  );
}

// "owner" | "employee" for the signed-in account (null until known). Cached per page load so every header
// render doesn't refetch; a raw fetch (not api()) so a logged-out 401 never redirects.
let accountRoleCache: Promise<string | null> | null = null;
export function useAccountRole(enabled = true): "owner" | "employee" | null {
  const [role, setRole] = useState<"owner" | "employee" | null>(null);
  useEffect(() => {
    if (!enabled) return;
    accountRoleCache ??= fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => (m?.account_role as string | undefined) ?? null)
      .catch(() => null);
    let alive = true;
    accountRoleCache.then((r) => alive && setRole(r === "employee" ? "employee" : r === "owner" ? "owner" : null));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return role;
}
