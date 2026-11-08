// One icon + soft color per catalog tool type, used on cards, quick view, tool page and compare headers.
import {
  Bot, CalendarCheck, Calculator, ChefHat, CreditCard, Globe, Mail, MapPin, Megaphone, MessageCircle, Phone, PhoneCall,
  ShoppingBag, Star, Truck, Users, Workflow, Wrench, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/api";

type Meta = { icon: LucideIcon; label: string; tone: string };

export const TOOL_TYPES: Record<string, Meta> = {
  ai_receptionist: { icon: PhoneCall, label: "AI receptionist", tone: "bg-emerald-50 text-emerald-700" },
  business_phone: { icon: Phone, label: "Business phone", tone: "bg-teal-50 text-teal-700" },
  reviews: { icon: Star, label: "Reviews & reputation", tone: "bg-amber-50 text-amber-700" },
  local_listing: { icon: MapPin, label: "Local listing", tone: "bg-rose-50 text-rose-700" },
  marketing_content: { icon: Megaphone, label: "Marketing content", tone: "bg-fuchsia-50 text-fuchsia-700" },
  email_marketing: { icon: Mail, label: "Email & SMS marketing", tone: "bg-pink-50 text-pink-700" },
  general_assistant: { icon: Bot, label: "AI assistant", tone: "bg-violet-50 text-violet-700" },
  booking: { icon: CalendarCheck, label: "Booking", tone: "bg-sky-50 text-sky-700" },
  staff_scheduling: { icon: Users, label: "Staff scheduling", tone: "bg-indigo-50 text-indigo-700" },
  field_service: { icon: Truck, label: "Field service", tone: "bg-orange-50 text-orange-700" },
  bookkeeping: { icon: Calculator, label: "Bookkeeping", tone: "bg-lime-50 text-lime-800" },
  pos: { icon: CreditCard, label: "Point of sale", tone: "bg-cyan-50 text-cyan-700" },
  online_ordering: { icon: ShoppingBag, label: "Online ordering", tone: "bg-red-50 text-red-700" },
  restaurant_ops: { icon: ChefHat, label: "Kitchen & menu", tone: "bg-yellow-50 text-yellow-800" },
  customer_chat: { icon: MessageCircle, label: "Customer chat", tone: "bg-blue-50 text-blue-700" },
  website: { icon: Globe, label: "Website", tone: "bg-slate-100 text-slate-700" },
  automation: { icon: Workflow, label: "Automation", tone: "bg-stone-100 text-stone-700" },
};

const FALLBACK: Meta = { icon: Wrench, label: "Tool", tone: "bg-stone-100 text-stone-700" };

export const toolType = (category: string): Meta => TOOL_TYPES[category] || { ...FALLBACK, label: category.replace(/_/g, " ") };

export const CAPABILITY_LABEL: Record<string, string> = {
  automation_agent: "AI agent",
  generative: "Generative",
  assistant: "Assistant",
  predictive: "Predictive",
  platform: "Platform",
};

/** Rounded tile with the tool type's icon. */
export function ToolIcon({ category, size = 40, className }: { category: string; size?: number; className?: string }) {
  const m = toolType(category);
  const Icon = m.icon;
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-xl", m.tone, className)}
      style={{ width: size, height: size }}
      title={m.label}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </span>
  );
}
