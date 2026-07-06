import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export * from "@/lib/notifications/shared";

// RLS (notifications_select) already scopes strictly to user_id =
// auth.uid() — the explicit .eq below is defense-in-depth, matching this
// codebase's usual "RLS is the real boundary, app code re-checks anyway"
// convention (see lib/auth/session.ts).
export async function listMyNotifications(limit = 20) {
  const { userId } = await requireOrg();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function getUnreadNotificationCount(): Promise<number> {
  const { userId } = await requireOrg();
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}
