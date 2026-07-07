import { notFound } from "next/navigation";

import { ConvertEstimateButton } from "@/components/estimating/convert-estimate-button";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  // handoff_surveys and change_orders are office-only both ways (RLS),
  // same posture as Team — hide those tabs entirely rather than show
  // them empty for a role that can never read the rows.
  const canViewOfficeTabs = profile?.role === "owner" || profile?.role === "pm";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {project.name}
        </h1>
        <div className="flex items-center gap-3">
          <ProjectStatusBadge status={project.status} />
          {project.status === "estimate" ? (
            <ConvertEstimateButton projectId={project.id} />
          ) : null}
        </div>
      </div>

      <ProjectTabs
        projectId={project.id}
        status={project.status}
        canViewOfficeTabs={canViewOfficeTabs}
      />

      {children}
    </div>
  );
}
