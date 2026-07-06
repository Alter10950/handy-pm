import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ChangePasswordForm } from "@/components/account/change-password-form";
import { UpdateNameForm } from "@/components/account/update-name-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Account — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        Account
      </h1>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Display name
        </h2>
        <UpdateNameForm initialName={profile?.full_name ?? ""} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">
          Change password
        </h2>
        <ChangePasswordForm />
      </div>
    </div>
  );
}
