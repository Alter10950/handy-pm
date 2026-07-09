"use client";

import { FilterBar } from "@/components/ui/filter-bar";
import {
  matchesFacet,
  matchesSearch,
  useFilterState,
} from "@/lib/filters/use-filter-state";
import Link from "next/link";

import type { DashboardProject } from "@/lib/dashboard/queries";
import { RISK_TIER_CLASS, RISK_TIER_LABEL } from "@/lib/scheduler/spi";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ProjectRiskList({
  projects,
}: {
  projects: DashboardProject[];
}) {
  const filter = useFilterState("dashboard-projects");
  const matches = projects.filter(
    (p) =>
      matchesSearch(filter.state.search, p.name, p.pmName ?? undefined) &&
      matchesFacet(filter.state.facets.risk, p.riskTier)
  );

  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground">No active projects.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        screenLabel="dashboard-projects"
        state={filter.state}
        facets={[
          {
            key: "risk",
            label: "Health",
            options: [
              { value: "good", label: "On track" },
              { value: "watch", label: "Watch" },
              { value: "risk", label: "At risk" },
            ],
          },
        ]}
        resultCount={matches.length}
        resultNoun="projects"
        views={filter.views}
        activeCount={filter.activeCount}
        onSearch={filter.setSearch}
        onToggleFacet={filter.toggleFacet}
        onClearFacet={filter.clearFacet}
        onClearAll={filter.clearAll}
        onApplyView={filter.applyView}
        onSaveView={filter.saveView}
        onDeleteView={filter.deleteView}
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Project</th>
              <th className="pb-2">PM</th>
              <th className="pb-2">Status</th>
              <th className="pb-2 text-right">Complete</th>
              <th className="pb-2">Crew today</th>
              <th className="pb-2">Forecast finish</th>
              <th className="pb-2">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((project) => (
              <tr key={project.projectId} className="border-t border-border">
                <td className="py-2">
                  <Link
                    href={`/app/project/${project.projectId}`}
                    className="font-medium text-foreground hover:underline"
                  >
                    {project.name}
                  </Link>
                </td>
                <td className="py-2">
                  {project.pmName ? (
                    <span className="text-muted-foreground">
                      {project.pmName}
                    </span>
                  ) : (
                    <span className="font-medium text-warning-fg">
                      Unassigned
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_TIER_CLASS[project.riskTier]}`}
                  >
                    {RISK_TIER_LABEL[project.riskTier]}
                  </span>
                </td>
                <td className="py-2 text-right tabular-nums text-foreground">
                  {Math.round(project.pct * 100)}%
                </td>
                <td className="py-2 text-muted-foreground">
                  {project.assignedCrewNames.length > 0
                    ? project.assignedCrewNames.join(", ")
                    : "—"}
                </td>
                <td className="py-2 text-muted-foreground">
                  {formatDate(project.forecastFinish)}
                </td>
                <td className="py-2 text-muted-foreground">
                  {formatDate(project.deadline)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
