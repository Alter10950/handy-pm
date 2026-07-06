import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AddTeamMemberDialog } from "@/components/team/add-team-member-dialog";
import { TeamMemberRow } from "@/components/team/team-member-row";
import { listCrews } from "@/lib/crews/queries";
import { createClient } from "@/lib/supabase/server";
import { listTeamMembers } from "@/lib/team/queries";

export const metadata: Metadata = {
  title: "Team — Handy PM",
};

export default async function TeamPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();

  if (!profile?.org_id || (profile.role !== "owner" && profile.role !== "pm")) {
    redirect("/app");
  }

  const [members, crews] = await Promise.all([listTeamMembers(), listCrews()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Team
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create logins for your team — there&apos;s no public sign-up, so
            every account starts here.
          </p>
        </div>
        <AddTeamMemberDialog />
      </div>

      <div className="flex flex-col gap-3">
        {members.map((member) => (
          <TeamMemberRow
            key={member.id}
            member={member}
            crews={crews}
            isSelf={member.id === user.id}
          />
        ))}
      </div>
    </div>
  );
}
