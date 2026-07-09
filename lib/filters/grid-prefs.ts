"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

// Per-grid display preferences (design pass v3 F2): column visibility +
// row density, persisted per user per grid — same localStorage pattern
// as use-filter-state.ts.

export type GridDensity = "comfortable" | "compact";

export interface GridPrefs {
  density: GridDensity;
  /** column keys the user has hidden */
  hidden: string[];
}

const EMPTY_PREFS: GridPrefs = { density: "comfortable", hidden: [] };
const CHANGE_EVENT = "handy-pm:grid-prefs-change";

function storageKey(gridKey: string): string {
  return `handy-pm:grid:${gridKey}`;
}

function readPrefs(gridKey: string): GridPrefs {
  try {
    const raw = window.localStorage.getItem(storageKey(gridKey));
    if (!raw) return EMPTY_PREFS;
    const parsed = JSON.parse(raw) as Partial<GridPrefs>;
    return {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      hidden: Array.isArray(parsed.hidden)
        ? parsed.hidden.filter((c): c is string => typeof c === "string")
        : [],
    };
  } catch {
    return EMPTY_PREFS;
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

export function useGridPrefs(gridKey: string) {
  const cache = useRef<{ raw: string | null; prefs: GridPrefs } | null>(null);
  const getSnapshot = useCallback(() => {
    const raw =
      typeof window === "undefined"
        ? null
        : window.localStorage.getItem(storageKey(gridKey));
    if (!cache.current || cache.current.raw !== raw) {
      cache.current = { raw, prefs: raw ? readPrefs(gridKey) : EMPTY_PREFS };
    }
    return cache.current.prefs;
  }, [gridKey]);
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_PREFS);

  const api = useMemo(() => {
    function set(next: GridPrefs) {
      window.localStorage.setItem(storageKey(gridKey), JSON.stringify(next));
      window.dispatchEvent(new Event(CHANGE_EVENT));
    }
    return {
      setDensity: (density: GridDensity) =>
        set({ ...readPrefs(gridKey), density }),
      toggleColumn: (column: string) => {
        const current = readPrefs(gridKey);
        set({
          ...current,
          hidden: current.hidden.includes(column)
            ? current.hidden.filter((c) => c !== column)
            : [...current.hidden, column],
        });
      },
    };
  }, [gridKey]);

  const isHidden = useCallback(
    (column: string) => prefs.hidden.includes(column),
    [prefs.hidden]
  );

  return { prefs, isHidden, ...api };
}
