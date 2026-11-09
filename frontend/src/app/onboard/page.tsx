"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import type { Business, User } from "@/lib/types";
import { AppHeader, FlowStepper, HelpTip, useTitle } from "@/components/ui";
import { BusinessForm, EMPTY_FORM, formFromBusiness, type BusinessPayload, type FormValue } from "@/components/business-form";

export default function Onboard() {
  useTitle("Describe your business");
  const router = useRouter();
  const [me, setMe] = useState<{ user: User; business: Business | null } | null>(null);
  const [value, setValue] = useState<FormValue>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api<{ user: User; business: (Business & { details?: Record<string, unknown> | null }) | null; account_role?: "owner" | "employee" }>("/me").then((m) => {
      // only owners describe the business; demo accounts and employees go to their dashboard
      if (m.user.is_demo || m.account_role === "employee") return router.replace("/dashboard");
      setMe(m);
      if (m.business) setValue(formFromBusiness(m.business));
    });
  }, [router]);

  const submit = async (p: BusinessPayload) => {
    setBusy(true);
    setErr(null);
    try {
      await api("/businesses", { method: "POST", json: p });
      const r = await api<{ run_id: string }>("/runs", { method: "POST", json: { mode: "live", raw_input: p.description } });
      router.push(`/war-room/${r.run_id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh">
      <AppHeader businessName={me?.business?.name} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <FlowStepper step={0} />
        <h1 className="mt-6 flex items-center gap-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Tell us about your business
          <HelpTip label="How this works">
            Write it like you&apos;d explain it to a friend. Rough numbers are fine. Your advisors estimate what each problem costs, compare real tools, and you approve
            everything before a plan is saved.
          </HelpTip>
        </h1>
        <BusinessForm
          value={value}
          onChange={setValue}
          onSubmit={submit}
          showTemplates
          busy={busy}
          error={err}
          submitLabel="Meet your advisors"
          submitIcon={<Sparkles size={18} />}
          footnote={<p className="text-center text-xs text-stone-500">Takes about 30–60 seconds. You approve everything.</p>}
        />
      </main>
    </div>
  );
}
