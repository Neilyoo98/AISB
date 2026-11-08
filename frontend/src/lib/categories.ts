// General business categories (mirrors backend/categories.py). Never filter by specific business types in the UI.
import { Briefcase, Hammer, Scissors, ShoppingBag, Store, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { Tool } from "@/lib/types";

export type CategoryId = "food_drink" | "home_field" | "beauty_wellness" | "retail" | "professional" | "other";

export const CATEGORIES: { id: CategoryId; label: string; icon: LucideIcon; verticals: string[] }[] = [
  { id: "food_drink", label: "Food & drink", icon: UtensilsCrossed, verticals: ["cafe", "restaurant"] },
  { id: "home_field", label: "Home & field services", icon: Hammer, verticals: ["hvac", "landscaping", "home_services"] },
  { id: "beauty_wellness", label: "Beauty & wellness", icon: Scissors, verticals: ["salon"] },
  { id: "retail", label: "Retail & e-commerce", icon: ShoppingBag, verticals: ["retail"] },
  { id: "professional", label: "Professional & office", icon: Briefcase, verticals: [] },
  { id: "other", label: "Other", icon: Store, verticals: ["other"] },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

/** Categories a tool serves: from the API when present, else derived from its verticals ("all" = every category). */
export function toolCategories(t: Pick<Tool, "verticals" | "categories">): CategoryId[] {
  if (t.categories?.length) return t.categories as CategoryId[];
  if (t.verticals.includes("all")) return CATEGORIES.map((c) => c.id);
  return CATEGORIES.filter((c) => c.verticals.some((v) => t.verticals.includes(v))).map((c) => c.id);
}

export function isForAnyBusiness(t: Pick<Tool, "verticals" | "categories">) {
  return t.verticals.includes("all") || toolCategories(t).length === CATEGORIES.length;
}

/** Map an internal vertical (from the AI profile) to its general category. */
export function categoryOfVertical(v?: string | null): CategoryId | null {
  if (!v) return null;
  return CATEGORIES.find((c) => c.verticals.includes(v))?.id ?? null;
}
