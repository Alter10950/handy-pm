"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

// Pinned + recently-viewed projects (design pass v3 F2) — localStorage,
// same subscribe/snapshot-cache pattern as use-filter-state.ts. Entries
// carry the name so the sidebar can render without a fetch.

export interface ProjectRef {
  id: string;
  name: string;
}

const PINNED_KEY = "handy-pm:pinned-projects";
const RECENT_KEY = "handy-pm:recent-projects";
const CHANGE_EVENT = "handy-pm:projects-refs-change";
const MAX_RECENT = 5;

function read(key: string): ProjectRef[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ProjectRef[];
    return Array.isArray(parsed)
      ? parsed.filter((p) => p && typeof p.id === "string")
      : [];
  } catch {
    return [];
  }
}

function write(key: string, value: ProjectRef[]) {
  window.localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function useStoredRefs(key: string): ProjectRef[] {
  const cache = useRef<{ raw: string | null; refs: ProjectRef[] } | null>(null);
  const getSnapshot = useCallback(() => {
    const raw =
      typeof window === "undefined" ? null : window.localStorage.getItem(key);
    if (!cache.current || cache.current.raw !== raw) {
      cache.current = { raw, refs: raw ? read(key) : [] };
    }
    return cache.current.refs;
  }, [key]);
  return useSyncExternalStore(subscribe, getSnapshot, () => []);
}

export function usePinnedProjects(): ProjectRef[] {
  return useStoredRefs(PINNED_KEY);
}

export function useRecentProjects(): ProjectRef[] {
  return useStoredRefs(RECENT_KEY);
}

export function isPinned(pinned: ProjectRef[], id: string): boolean {
  return pinned.some((p) => p.id === id);
}

export function togglePinnedProject(project: ProjectRef): void {
  const pinned = read(PINNED_KEY);
  const next = pinned.some((p) => p.id === project.id)
    ? pinned.filter((p) => p.id !== project.id)
    : [...pinned, project];
  write(PINNED_KEY, next);
}

/** Called on project-page mount — newest first, deduped, capped. */
export function recordProjectVisit(project: ProjectRef): void {
  const recents = read(RECENT_KEY).filter((p) => p.id !== project.id);
  write(RECENT_KEY, [project, ...recents].slice(0, MAX_RECENT));
}

/** Deleted projects shouldn't haunt the sidebar. */
export function forgetProject(id: string): void {
  write(
    PINNED_KEY,
    read(PINNED_KEY).filter((p) => p.id !== id)
  );
  write(
    RECENT_KEY,
    read(RECENT_KEY).filter((p) => p.id !== id)
  );
}
