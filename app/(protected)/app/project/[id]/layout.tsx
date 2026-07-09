import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConvertEstimateButton } from "@/components/estimating/convert-estimate-button";
import { PinProjectButton } from "@/components/projects/pin-project-button";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { RecentProjectTracker } from "@/components/projects/recent-project-tracker";
import { PageHeader } from "@/components/ui/page-header";
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
    ? await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  // handoff_surveys and change_orders are office-only both ways (RLS),
  // same posture as Team — hide those tabs entirely rather than show
  // them empty for a role that can never read the rows.
  const canViewOfficeTabs = profile?.role === "owner" || profile?.role === "pm";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Link
          href="/app"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon aria-hidden className="size-3.5" />
          Projects
        </Link>
        <RecentProjectTracker id={project.id} name={project.name} />
        <PageHeader
          title={project.name}
          status={<ProjectStatusBadge status={project.status} />}
          actions={
            <>
              <PinProjectButton id={project.id} name={project.name} />
              {project.status === "estimate" ? (
                <ConvertEstimateButton projectId={project.id} />
              ) : null}
            </>
          }
        />
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
