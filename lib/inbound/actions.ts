"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/session";

const OFFICE = ["owner", "pm", "scheduler"] as const;

// Triage actions for inbound SMS/WhatsApp (Batch 5 Sub-phase C(3)). These
// never apply a message to installs/materials automatically — they only
// move the message through its own review states. "Apply" means an office
// user has taken the content into the field log by hand; "reject" dismisses
// spam / wrong-numbers.

export async function setInboundStatus(
  id: string,
  status: "applied" | "rejected"
): Promise<void> {
  await requireRole(OFFICE);
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { error } = await supabase
    .from("inbound_messages")
    .update({ status })
    .eq("id", id);
  if (error) throw error;
  revalidatePath("/app/dashboard");
}
