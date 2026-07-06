import { redirect } from "next/navigation";

import { SiteHeader } from "@/components/site-header";
import { listMyNotifications } from "@/lib/notifications/queries";
import { createClient } from "@/lib/supabase/server";

// Forces this segment to render per-request instead of being statically
// generated at build time — see lib/supabase/server.ts.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // Best-effort — a user not yet assigned to an org (requireOrg's own
  // guard) shouldn't lose the whole header/nav over a non-critical
  // overlay feature; every other org-scoped gap in that state is
  // already handled per-action/per-page, not at the layout level.
  const notifications = await listMyNotifications().catch(() => []);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <SiteHeader
        userEmail={user.email ?? "Signed in"}
        role={profile?.role ?? null}
        notifications={notifications}
      />
      <main className="mx-auto w-full min-w-0 max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </div>
  );
}
