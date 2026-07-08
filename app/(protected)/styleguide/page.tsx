import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StyleguideView } from "@/components/styleguide/styleguide-view";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Style guide — Handy PM",
};

export const dynamic = "force-dynamic";

// The design system's source of truth and visual test surface (Phase 10).
// Role-gated to the office — it exposes nothing sensitive, but it's an
// internal tool, not a product screen.
export default async function StyleguidePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "owner" && profile?.role !== "pm") {
    redirect("/app");
  }

  return <StyleguideView />;
}
