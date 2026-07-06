import { notFound } from "next/navigation";

import { ConvertEstimateButton } from "@/components/estimating/convert-estimate-button";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { getProject } from "@/lib/projects/queries";

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

      <ProjectTabs projectId={project.id} status={project.status} />

      {children}
    </div>
  );
}
