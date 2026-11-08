"use client";
import { useEffect, useState } from "react";
import Image from "next/image";

// Marketing hero: crossfading photos of the kinds of businesses StackSmith serves.
// Purpose: explanation (shows the range of businesses). Seen once per visit, so a slow crossfade is fine.
export const HERO_SLIDES = [
  { src: "/hero/restaurant.jpg", label: "Restaurants" },
  { src: "/hero/salon.jpg", label: "Salons" },
  { src: "/hero/cafe.jpg", label: "Cafés" },
  { src: "/hero/trades.jpg", label: "Trades & field services" },
  { src: "/hero/landscaping.jpg", label: "Landscaping" },
  { src: "/hero/retail.jpg", label: "Retail shops" },
];

const SLIDE_MS = 6000;

export function HeroSlideshow({ onChange }: { onChange?: (i: number) => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) return; // static first image
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!id) id = setInterval(() => setI((x) => (x + 1) % HERO_SLIDES.length), SLIDE_MS);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => onChange?.(i), [i, onChange]);

  return (
    <div className="hero-slides absolute inset-0 overflow-hidden bg-stone-900" aria-hidden>
      {HERO_SLIDES.map((s, k) => (
        <div key={s.src} className="hero-slide absolute inset-0" data-active={k === i}>
          <Image src={s.src} alt="" fill priority={k === 0} sizes="100vw" className="object-cover" />
        </div>
      ))}
      {/* legibility: dark gradient under the headline */}
      <div className="absolute inset-0 bg-gradient-to-r from-stone-950/85 via-stone-950/60 to-stone-950/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-transparent to-transparent" />
      <div className="absolute bottom-4 right-4 flex items-center gap-3 text-xs text-white/70">
        <span className="hidden sm:flex sm:gap-1.5">
          {HERO_SLIDES.map((s, k) => (
            <span key={s.src} className="h-1.5 w-1.5 rounded-full bg-white transition-opacity duration-300" style={{ opacity: k === i ? 0.95 : 0.35 }} />
          ))}
        </span>
        <span>{HERO_SLIDES[i].label} · Photos: Unsplash</span>
      </div>
    </div>
  );
}
