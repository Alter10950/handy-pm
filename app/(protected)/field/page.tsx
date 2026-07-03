import type { Metadata } from "next";
import Link from "next/link";

import { listActiveProjectsForField } from "@/lib/field/queries";

export const metadata: Metadata = {
  title: "Field — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function FieldPage() {
  const projects = await listActiveProjectsForField();

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-foreground">Field</h1>
      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          No active projects yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((project) => (
            <Link
              key={project.project_id}
              href={`/field/${project.project_id}`}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 active:bg-accent"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {project.name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {Math.round(project.pct * 100)}%
                </span>
              </div>
              {project.site_address ? (
                <span className="text-sm text-muted-foreground">
                  {project.site_address}
                </span>
              ) : null}
              <div className="h-2 overflow-hidden rounded-full bg-background">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round(project.pct * 100)}%` }}
                />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
