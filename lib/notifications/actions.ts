"use server";

import { revalidatePath } from "next/cache";

import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(notificationId: string): Promise<void> {
  const { userId } = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("user_id", userId);
  if (error) throw error;
  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead(): Promise<void> {
  const { userId } = await requireOrg();
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  revalidatePath("/", "layout");
}
