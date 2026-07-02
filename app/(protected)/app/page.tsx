import type { Metadata } from "next";

import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectCard } from "@/components/projects/project-card";
import { listProjectsWithProgress } from "@/lib/projects/queries";

export const metadata: Metadata = {
  title: "Projects — Handy PM",
};

export default async function ProjectsPage() {
  const projects = await listProjectsWithProgress();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Projects
        </h1>
        <NewProjectDialog />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <p className="text-foreground">No projects yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first project to upload a layout drawing and start
            marking rows.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.project_id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}
