"use client";

import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FilterState, SavedView } from "@/lib/filters/use-filter-state";
import { cn } from "@/lib/utils";

// The one filter pattern for every list in the app (design pass v3 D2):
// instant search, multi-select facet chips, active-filter chips with ×,
// result count, clear-all, saved views. State comes from useFilterState —
// this component is pure UI.

export interface FilterFacet {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export function FilterBar({
  screenLabel,
  state,
  facets,
  resultCount,
  resultNoun = "results",
  views,
  activeCount,
  onSearch,
  onToggleFacet,
  onClearFacet,
  onClearAll,
  onApplyView,
  onSaveView,
  onDeleteView,
  searchTestId,
  children,
}: {
  screenLabel: string;
  state: FilterState;
  facets: FilterFacet[];
  resultCount: number;
  resultNoun?: string;
  views: SavedView[];
  activeCount: number;
  onSearch: (value: string) => void;
  onToggleFacet: (facetKey: string, value: string) => void;
  onClearFacet: (facetKey: string, value: string) => void;
  onClearAll: () => void;
  onApplyView: (view: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (name: string) => void;
  searchTestId?: string;
  /** extra controls rendered at the right edge (e.g. view toggles) */
  children?: React.ReactNode;
}) {
  const [viewName, setViewName] = useState("");

  const activeChips = facets.flatMap((facet) =>
    (state.facets[facet.key] ?? []).map((value) => ({
      facet,
      value,
      label:
        facet.options.find((option) => option.value === value)?.label ?? value,
    }))
  );

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`filter-bar-${screenLabel}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-xs">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            data-testid={searchTestId ?? `filter-search-${screenLabel}`}
            aria-label={`Search ${screenLabel}`}
            placeholder={`Search ${screenLabel}…`}
            value={state.search}
            onChange={(event) => onSearch(event.target.value)}
            className="pl-8 pr-8 [&::-webkit-search-cancel-button]:hidden"
          />
          {state.search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>

        {facets.map((facet) => {
          const selected = state.facets[facet.key] ?? [];
          return (
            <Popover key={facet.key}>
              <PopoverTrigger
                data-testid={`filter-facet-${facet.key}`}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium shadow-e1 transition-colors",
                  selected.length > 0
                    ? "border-brand bg-brand-subtle text-foreground"
                    : "border-border bg-surface text-muted-foreground hover:text-foreground"
                )}
              >
                {facet.label}
                {selected.length > 0 ? (
                  <span className="num rounded-full bg-surface px-1.5 text-xs">
                    {selected.length}
                  </span>
                ) : null}
                <ChevronDownIcon aria-hidden className="size-3.5" />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-1.5">
                <div className="flex flex-col gap-0.5">
                  {facet.options.map((option) => {
                    const isOn = selected.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={isOn}
                        onClick={() => onToggleFacet(facet.key, option.value)}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                          isOn ? "text-foreground" : "text-text-secondary"
                        )}
                      >
                        <span
                          className={cn(
                            "grid size-4 place-items-center rounded border",
                            isOn
                              ? "border-brand bg-brand text-primary-foreground"
                              : "border-border-strong bg-surface"
                          )}
                        >
                          {isOn ? <CheckIcon className="size-3" /> : null}
                        </span>
                        <span className="truncate">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          );
        })}

        {/* Saved views */}
        <Popover>
          <PopoverTrigger
            data-testid={`filter-views-${screenLabel}`}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
          >
            <BookmarkIcon aria-hidden className="size-3.5" />
            Views
            {views.length > 0 ? (
              <span className="num rounded-full bg-surface-sunken px-1.5 text-xs">
                {views.length}
              </span>
            ) : null}
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="flex flex-col gap-1.5">
              {views.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {views.map((view) => (
                    <div key={view.name} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onApplyView(view)}
                        className="flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
                      >
                        {view.name}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete view ${view.name}`}
                        onClick={() => onDeleteView(view.name)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <XIcon className="size-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Save the current search + filters as a view you can recall.
                </p>
              )}
              <div className="flex items-center gap-1.5 border-t border-border-subtle pt-1.5">
                <Input
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  placeholder="Name this view…"
                  className="h-8 text-sm"
                  data-testid={`filter-view-name-${screenLabel}`}
                />
                <button
                  type="button"
                  data-testid={`filter-view-save-${screenLabel}`}
                  disabled={!viewName.trim() || activeCount === 0}
                  onClick={() => {
                    onSaveView(viewName.trim());
                    setViewName("");
                  }}
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground shadow-e1 disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {children ? (
          <div className="ml-auto flex items-center gap-2">{children}</div>
        ) : null}
      </div>

      {/* Active chips + count row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="num text-xs text-muted-foreground"
          data-testid={`filter-count-${screenLabel}`}
        >
          {resultCount} {resultNoun}
        </span>
        {activeChips.map(({ facet, value, label }) => (
          <button
            key={`${facet.key}:${value}`}
            type="button"
            onClick={() => onClearFacet(facet.key, value)}
            className="flex items-center gap-1 rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-brand-subtle/70"
          >
            {facet.label}: {label}
            <XIcon aria-hidden className="size-3" />
          </button>
        ))}
        {activeCount > 0 ? (
          <button
            type="button"
            data-testid={`filter-clear-${screenLabel}`}
            onClick={onClearAll}
            className="text-xs font-medium text-info-fg hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>
    </div>
  );
}
