"use client";

import { UsersIcon } from "lucide-react";

import { TeamMemberRow } from "@/components/team/team-member-row";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  matchesFacet,
  matchesSearch,
  useFilterState,
} from "@/lib/filters/use-filter-state";
import type { TeamMember } from "@/lib/team/queries";
import type { Tables } from "@/lib/supabase/database.types";

/** Team roster with the app-wide FilterBar (design pass v3 D2). */
export function TeamList({
  members,
  crews,
  currentUserId,
}: {
  members: TeamMember[];
  crews: Tables<"crews">[];
  currentUserId: string;
}) {
  const filter = useFilterState("team");

  const matches = members.filter(
    (member) =>
      matchesSearch(filter.state.search, member.fullName, member.email) &&
      matchesFacet(filter.state.facets.role, member.role) &&
      matchesFacet(filter.state.facets.crew, member.crewId ?? "none") &&
      matchesFacet(
        filter.state.facets.status,
        member.isActive ? "active" : "inactive"
      )
  );

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        screenLabel="team"
        state={filter.state}
        facets={[
          {
            key: "role",
            label: "Role",
            options: [
              { value: "owner", label: "Owner" },
              { value: "pm", label: "PM" },
              { value: "scheduler", label: "Scheduler" },
              { value: "crew", label: "Crew" },
            ],
          },
          {
            key: "crew",
            label: "Crew",
            options: [
              { value: "none", label: "No crew" },
              ...crews.map((crew) => ({ value: crew.id, label: crew.name })),
            ],
          },
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "inactive", label: "Deactivated" },
            ],
          },
        ]}
        resultCount={matches.length}
        resultNoun="people"
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

      {matches.length === 0 ? (
        <EmptyState
          icon={<UsersIcon aria-hidden />}
          title="Nobody matches"
          description="Loosen the search or filters above."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {matches.map((member) => (
            <TeamMemberRow
              key={member.id}
              member={member}
              crews={crews}
              isSelf={member.id === currentUserId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
