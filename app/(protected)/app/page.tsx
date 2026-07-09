import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ImportFromZohoDialog } from "@/components/projects/import-from-zoho-dialog";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectList } from "@/components/projects/project-list";
import { PageHeader } from "@/components/ui/page-header";
import { computeProjectHealthMap } from "@/lib/dashboard/health";
import { listProjectsWithProgress } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";
import { listPmCandidates, listTeamMembers } from "@/lib/team/queries";

export const metadata: Metadata = {
  title: "Projects — Handy PM",
};

export default async function ProjectsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [projects, pmCandidates, teamMembers, healthById] = await Promise.all([
    listProjectsWithProgress(),
    listPmCandidates(),
    listTeamMembers(),
    computeProjectHealthMap(),
  ]);
  const pmLabelById = Object.fromEntries(
    teamMembers.map((member) => [member.id, member.fullName || member.email])
  );
  const { data: viewer } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const canCreate = viewer?.role === "owner" || viewer?.role === "pm";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Handy Equip"
        title="Projects"
        description="Every active install, its progress, and who's running it."
        actions={
          canCreate ? (
            <>
              <ImportFromZohoDialog />
              <NewProjectDialog
                pmCandidates={pmCandidates}
                currentUserId={user.id}
              />
            </>
          ) : undefined
        }
      />

      <ProjectList
        projects={projects}
        pmLabelById={pmLabelById}
        currentUserId={user.id}
        healthById={healthById}
      />
    </div>
  );
}
