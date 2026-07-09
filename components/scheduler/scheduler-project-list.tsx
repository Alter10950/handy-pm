"use client";

import Link from "next/link";

import { FilterBar } from "@/components/ui/filter-bar";
import { matchesSearch, useFilterState } from "@/lib/filters/use-filter-state";
import type { Views } from "@/lib/supabase/database.types";

export function SchedulerProjectList({
  projects,
}: {
  projects: Views<"project_progress">[];
}) {
  const filter = useFilterState("scheduler-projects");
  const matches = projects.filter((p) =>
    matchesSearch(filter.state.search, p.name)
  );

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-muted-foreground">
        No active projects yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        screenLabel="schedule-projects"
        state={filter.state}
        facets={[]}
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
      <div className="flex flex-col gap-2">
        {matches.map((project) => (
          <Link
            key={project.project_id}
            href={`/scheduler/${project.project_id}`}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card shadow-e1 p-3 hover:bg-accent"
          >
            <span className="font-medium text-foreground">{project.name}</span>
            <span className="text-sm text-muted-foreground">
              {Math.round(project.pct * 100)}%
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
