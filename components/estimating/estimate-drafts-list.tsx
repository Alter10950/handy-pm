"use client";

import { ProjectCard } from "@/components/projects/project-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import { matchesSearch, useFilterState } from "@/lib/filters/use-filter-state";
import type { Views } from "@/lib/supabase/database.types";

/** Draft-estimate cards behind the app-wide FilterBar (design pass v3 D2). */
export function EstimateDraftsList({
  estimates,
}: {
  estimates: Views<"project_progress">[];
}) {
  const filter = useFilterState("estimating-drafts");
  const matches = estimates.filter((project) =>
    matchesSearch(filter.state.search, project.name)
  );

  if (estimates.length === 0) {
    return (
      <EmptyState
        title="No draft estimates yet"
        description="Create one to paste a future job's material list and see estimated days before it's a real project."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FilterBar
        screenLabel="estimates"
        state={filter.state}
        facets={[]}
        resultCount={matches.length}
        resultNoun="drafts"
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {matches.map((project) => (
          <ProjectCard key={project.project_id} project={project} />
        ))}
      </div>
    </div>
  );
}
