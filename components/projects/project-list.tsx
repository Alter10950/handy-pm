"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { ProjectCard } from "@/components/projects/project-card";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterBar } from "@/components/ui/filter-bar";
import {
  matchesFacet,
  matchesSearch,
  useFilterState,
} from "@/lib/filters/use-filter-state";
import { ProgressBar } from "@/components/ui/progress-meter";
import type { Views } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

type ViewMode = "cards" | "list";
type ProjectRow = Views<"project_progress">;

const VIEW_STORAGE_KEY = "handy-pm:projects-view";
const VIEW_CHANGE_EVENT = "handy-pm:projects-view-change";

// The chosen view lives in localStorage so it sticks between visits —
// read via useSyncExternalStore (hydration-safe: the server snapshot is
// always "cards", the client snapshot is whatever's stored; no
// setState-in-effect and no first-frame flash).
function subscribeToView(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(VIEW_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(VIEW_CHANGE_EVENT, callback);
  };
}

function readStoredView(): ViewMode {
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === "list"
    ? "list"
    : "cards";
}

function formatDeadline(deadline: string | null): string {
  if (!deadline) return "—";
  return new Date(`${deadline}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function byName(a: ProjectRow, b: ProjectRow): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

// Compact table rows — one row per project, click anywhere to open (the
// name is also a real link for middle-click/keyboard).
function ProjectTable({
  projects,
  pmLabelById,
  muted,
}: {
  projects: ProjectRow[];
  pmLabelById: Record<string, string>;
  muted?: boolean;
}) {
  const router = useRouter();

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-e1">
      <table
        data-testid="projects-list-table"
        className={cn("w-full text-sm", muted ? "opacity-70" : "")}
      >
        <thead>
          <tr className="border-b border-border bg-surface-sunken text-left text-xs font-semibold text-muted-foreground">
            <th className="px-3 py-2 font-semibold">Project</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="min-w-32 px-3 py-2 font-semibold">Complete</th>
            <th className="px-3 py-2 font-semibold">Target</th>
            <th className="px-3 py-2 font-semibold">PM</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const pct = Math.round(project.pct * 100);
            const pmLabel = project.pm_user_id
              ? (pmLabelById[project.pm_user_id] ?? null)
              : null;
            return (
              <tr
                key={project.project_id}
                onClick={() =>
                  router.push(`/app/project/${project.project_id}`)
                }
                className="cursor-pointer border-b border-border-subtle transition-colors last:border-0 hover:bg-accent/50"
              >
                <td className="px-3 py-2.5">
                  <Link
                    href={`/app/project/${project.project_id}`}
                    className="font-medium text-foreground hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {project.name}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <ProjectStatusBadge status={project.status} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <ProgressBar
                      pct={pct}
                      size="sm"
                      className="w-20 shrink-0"
                    />
                    <span className="num text-xs text-muted-foreground">
                      {pct}%
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                  {formatDeadline(project.deadline)}
                </td>
                <td className="max-w-40 truncate px-3 py-2.5">
                  {pmLabel ? (
                    <span className="text-muted-foreground">{pmLabel}</span>
                  ) : (
                    <span className="font-medium text-warning-fg">
                      No PM assigned
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProjectCards({
  projects,
  pmLabelById,
  muted,
}: {
  projects: ProjectRow[];
  pmLabelById: Record<string, string>;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
        muted ? "opacity-70" : ""
      )}
    >
      {projects.map((project) => (
        <ProjectCard
          key={project.project_id}
          project={project}
          pmLabel={
            project.pm_user_id
              ? (pmLabelById[project.pm_user_id] ?? null)
              : null
          }
        />
      ))}
    </div>
  );
}

export function ProjectList({
  projects,
  pmLabelById,
  currentUserId,
}: {
  projects: ProjectRow[];
  pmLabelById: Record<string, string>;
  currentUserId: string;
}) {
  const [myProjectsOnly, setMyProjectsOnly] = useState(false);
  const filter = useFilterState("projects");
  const search = filter.state.search;
  const [completedOpen, setCompletedOpen] = useState(false);
  const view = useSyncExternalStore(
    subscribeToView,
    readStoredView,
    () => "cards"
  );

  function switchView(next: ViewMode) {
    window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    window.dispatchEvent(new Event(VIEW_CHANGE_EVENT));
  }

  const query = search.trim().toLowerCase();
  const scoped = myProjectsOnly
    ? projects.filter((project) => project.pm_user_id === currentUserId)
    : projects;
  const matches = scoped.filter(
    (project) =>
      matchesSearch(search, project.name) &&
      matchesFacet(filter.state.facets.status, project.status) &&
      matchesFacet(filter.state.facets.pm, project.pm_user_id ?? "unassigned")
  );

  const activeProjects = matches
    .filter((project) => project.status !== "complete")
    .sort(byName);
  const completedProjects = matches
    .filter((project) => project.status === "complete")
    .sort(byName);

  // Searching auto-expands Completed when it holds matches — a hit the
  // user can't see isn't a hit.
  const completedExpanded =
    completedOpen || (query.length > 0 && completedProjects.length > 0);

  const Renderer = view === "cards" ? ProjectCards : ProjectTable;

  return (
    <div className="flex flex-col gap-4">
      <FilterBar
        screenLabel="projects"
        searchTestId="projects-search"
        state={filter.state}
        facets={[
          {
            key: "status",
            label: "Status",
            options: [
              { value: "active", label: "Active" },
              { value: "on_hold", label: "On hold" },
              { value: "estimate", label: "Estimate" },
              { value: "complete", label: "Complete" },
            ],
          },
          {
            key: "pm",
            label: "PM",
            options: [
              { value: "unassigned", label: "No PM assigned" },
              ...Object.entries(pmLabelById).map(([id, label]) => ({
                value: id,
                label,
              })),
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
      >
        {/* Raised-chip active state on a sunken track (design system), not
              a yellow slab. Hand-rolled rather than <Segmented> to keep the
              E2E testids and icon-only buttons. */}
        <div
          role="group"
          aria-label="View mode"
          className="flex items-center gap-0.5 rounded-lg bg-surface-sunken p-0.5"
        >
          <button
            type="button"
            data-testid="view-toggle-cards"
            aria-label="Card view"
            aria-pressed={view === "cards"}
            onClick={() => switchView("cards")}
            className={cn(
              "flex h-7 w-9 items-center justify-center rounded-md transition-all",
              view === "cards"
                ? "bg-surface text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              aria-hidden
            >
              <rect x="0" y="0" width="6" height="6" rx="1" />
              <rect x="8" y="0" width="6" height="6" rx="1" />
              <rect x="0" y="8" width="6" height="6" rx="1" />
              <rect x="8" y="8" width="6" height="6" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            data-testid="view-toggle-list"
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => switchView("list")}
            className={cn(
              "flex h-7 w-9 items-center justify-center rounded-md transition-all",
              view === "list"
                ? "bg-surface text-foreground shadow-e1"
                : "text-muted-foreground hover:text-foreground"
            )}
            style={{ transitionDuration: "var(--duration-fast)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="currentColor"
              aria-hidden
            >
              <rect x="0" y="1" width="14" height="2.5" rx="1" />
              <rect x="0" y="5.75" width="14" height="2.5" rx="1" />
              <rect x="0" y="10.5" width="14" height="2.5" rx="1" />
            </svg>
          </button>
        </div>

        <label className="flex w-fit items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={myProjectsOnly}
            onChange={(event) => setMyProjectsOnly(event.target.checked)}
            className="size-4 rounded border-border"
          />
          My projects only
        </label>
      </FilterBar>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Create your first project to upload a layout drawing and start marking rows."
        />
      ) : matches.length === 0 ? (
        <div data-testid="no-matches">
          <EmptyState
            title={
              query ? "No projects match." : "No projects assigned to you."
            }
            action={
              query ? (
                <button
                  type="button"
                  onClick={() => filter.clearAll()}
                  className="text-sm font-medium text-info-fg hover:underline"
                >
                  Clear search
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div data-testid="active-projects-section">
            {activeProjects.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
                {query
                  ? "No active projects match — see Completed below."
                  : "No active projects."}
              </p>
            ) : (
              <Renderer projects={activeProjects} pmLabelById={pmLabelById} />
            )}
          </div>

          {completedProjects.length > 0 ? (
            <div data-testid="completed-projects-section" className="mt-2">
              <button
                type="button"
                data-testid="completed-toggle"
                aria-expanded={completedExpanded}
                onClick={() => setCompletedOpen((open) => !open)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              >
                <span
                  aria-hidden
                  className={cn(
                    "inline-block transition-transform",
                    completedExpanded ? "rotate-90" : ""
                  )}
                >
                  ▸
                </span>
                Completed ({completedProjects.length})
              </button>
              {completedExpanded ? (
                <div className="mt-3">
                  <Renderer
                    projects={completedProjects}
                    pmLabelById={pmLabelById}
                    muted
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
