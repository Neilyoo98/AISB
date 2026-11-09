"use client";
// Coworkers now live inside Team → Tasks. Keep this route so old links still work.
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageState } from "@/components/ui";

export default function AgentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/team?tab=tasks");
  }, [router]);
  return <PageState kind="loading" />;
}
