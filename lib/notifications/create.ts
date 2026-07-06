// Not a "use server" action file — this is called from other server-only
// code (the gate-nags cron route today; potentially other Server Actions
// later), each of which supplies its own already-scoped Supabase client
// (admin client for the cron route, since it has no user session and RLS
// would otherwise silently return nothing).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationKind } from "@/lib/notifications/shared";
import type { Database, Json } from "@/lib/supabase/database.types";

export async function notifyUsers(
  supabase: SupabaseClient<Database>,
  orgId: string,
  userIds: string[],
  kind: NotificationKind,
  payload: Record<string, Json>
): Promise<void> {
  const uniqueUserIds = [...new Set(userIds)];
  if (uniqueUserIds.length === 0) return;

  const { error } = await supabase.from("notifications").insert(
    uniqueUserIds.map((userId) => ({
      org_id: orgId,
      user_id: userId,
      kind,
      payload,
    }))
  );
  if (error) throw error;
}
