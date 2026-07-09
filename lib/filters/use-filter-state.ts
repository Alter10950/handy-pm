"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

// Per-screen filter state with localStorage persistence (design pass v3
// D2). One hook powers every FilterBar: instant search, multi-select
// facets, saved views. State survives reloads per user per screen.

export interface FilterState {
  search: string;
  /** facetKey -> selected option values */
  facets: Record<string, string[]>;
}

export interface SavedView {
  name: string;
  state: FilterState;
}

export const EMPTY_FILTER_STATE: FilterState = { search: "", facets: {} };

const CHANGE_EVENT = "handy-pm:filters-change";

function storageKey(screenKey: string): string {
  return `handy-pm:filters:${screenKey}`;
}
function viewsKey(screenKey: string): string {
  return `handy-pm:views:${screenKey}`;
}

function readState(screenKey: string): FilterState {
  try {
    const raw = window.localStorage.getItem(storageKey(screenKey));
    if (!raw) return EMPTY_FILTER_STATE;
    const parsed = JSON.parse(raw) as Partial<FilterState>;
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      facets:
        parsed.facets && typeof parsed.facets === "object" ? parsed.facets : {},
    };
  } catch {
    return EMPTY_FILTER_STATE;
  }
}

function readViews(screenKey: string): SavedView[] {
  try {
    const raw = window.localStorage.getItem(viewsKey(screenKey));
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

export function useFilterState(screenKey: string) {
  // Cache the parsed snapshot: useSyncExternalStore requires referential
  // stability between store versions.
  const cache = useRef<{ raw: string | null; state: FilterState } | null>(null);
  const getSnapshot = useCallback(() => {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(storageKey(screenKey));
    if (!cache.current || cache.current.raw !== raw) {
      cache.current = {
        raw,
        state: raw ? readState(screenKey) : EMPTY_FILTER_STATE,
      };
    }
    return cache.current.state;
  }, [screenKey]);

  const state = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_FILTER_STATE
  );

  const viewsCache = useRef<{ raw: string | null; views: SavedView[] } | null>(
    null
  );
  const getViews = useCallback(() => {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(viewsKey(screenKey));
    if (!viewsCache.current || viewsCache.current.raw !== raw) {
      viewsCache.current = { raw, views: raw ? readViews(screenKey) : [] };
    }
    return viewsCache.current.views;
  }, [screenKey]);
  const views = useSyncExternalStore(subscribe, getViews, () => []);

  const set = useCallback(
    (next: FilterState) => {
      window.localStorage.setItem(storageKey(screenKey), JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [screenKey]
  );

  const api = useMemo(
    () => ({
      setSearch: (search: string) => set({ ...state, search }),
      toggleFacet: (facetKey: string, value: string) => {
        const current = state.facets[facetKey] ?? [];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        set({ ...state, facets: { ...state.facets, [facetKey]: next } });
      },
      clearFacet: (facetKey: string, value: string) => {
        const next = (state.facets[facetKey] ?? []).filter((v) => v !== value);
        set({ ...state, facets: { ...state.facets, [facetKey]: next } });
      },
      clearAll: () => set(EMPTY_FILTER_STATE),
      applyView: (view: SavedView) => set(view.state),
      saveView: (name: string) => {
        const next = [
          ...views.filter((v) => v.name !== name),
          { name, state } satisfies SavedView,
        ];
        window.localStorage.setItem(viewsKey(screenKey), JSON.stringify(next));
        window.dispatchEvent(new Event(CHANGE_EVENT));
      },
      deleteView: (name: string) => {
        const next = views.filter((v) => v.name !== name);
        window.localStorage.setItem(viewsKey(screenKey), JSON.stringify(next));
        window.dispatchEvent(new Event(CHANGE_EVENT));
      },
    }),
    [state, views, set, screenKey]
  );

  const activeCount =
    (state.search.trim() ? 1 : 0) +
    Object.values(state.facets).reduce((sum, list) => sum + list.length, 0);

  return { state, views, activeCount, ...api };
}

/** Case-insensitive substring match over the given fields. */
export function matchesSearch(
  search: string,
  ...fields: (string | null | undefined)[]
): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

/** True when the item's value passes the facet selection (empty = all). */
export function matchesFacet(
  selected: string[] | undefined,
  value: string | null | undefined
): boolean {
  if (!selected || selected.length === 0) return true;
  return value != null && selected.includes(value);
}
