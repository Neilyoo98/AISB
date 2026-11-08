"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Scenario } from "@/lib/types";

export type Adoption = { tool_id: string; source: "plan" | "manual"; adopted_at: string; run_id: string | null };
export type AdoptionState = {
  items: Adoption[];
  scenarios: Scenario[];
  scenarios_status: "ready" | "updating" | "none";
};

/** GET /adoptions, polling every 3s (max 60s) while the backend refreshes day-in-the-life scenarios. */
export function useAdoptions() {
  const [data, setData] = useState<AdoptionState | null>(null);
  const started = useRef<number | null>(null);

  const load = useCallback(() => {
    api<AdoptionState>("/adoptions")
      .then((d) => setData({ items: d.items || [], scenarios: d.scenarios || [], scenarios_status: d.scenarios_status || "none" }))
      .catch(() => setData((p) => p ?? { items: [], scenarios: [], scenarios_status: "none" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (data?.scenarios_status !== "updating") {
      started.current = null;
      return;
    }
    if (started.current === null) started.current = Date.now();
    if (Date.now() - started.current > 60_000) return;
    const id = setTimeout(load, 3000);
    return () => clearTimeout(id);
  }, [data, load]);

  const adopted = new Set((data?.items || []).map((a) => a.tool_id));
  return { data, adopted, reload: load };
}
