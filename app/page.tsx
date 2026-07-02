import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// Forces this route to render per-request instead of being statically
// generated at build time — see lib/supabase/server.ts.
export const dynamic = "force-dynamic";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/app" : "/login");
}
