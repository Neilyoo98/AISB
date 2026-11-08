import Link from "next/link";
import { Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center px-4">
        <Logo />
      </header>
      <main className="mx-auto grid max-w-md place-items-center px-4 py-24 text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-stone-600">That page doesn&apos;t exist or has moved.</p>
        <div className="mt-6 flex gap-2">
          <Link href="/" className="btn-primary">Go home</Link>
          <Link href="/tools" className="btn-secondary">Discover tools</Link>
        </div>
      </main>
    </div>
  );
}
