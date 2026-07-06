"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "handy-pm-field-crew-id";
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY);
}

function getServerSnapshot() {
  return null;
}

// Which crew this device is logging field work as — remembered locally so
// a crew doesn't have to re-pick it every visit, not modeled as an
// authenticated identity (matches a shared job-site phone/tablet better
// than a personal login would). useSyncExternalStore, not
// useState+useEffect: reading localStorage only after mount and syncing
// it into state is exactly the "extra render" pattern React's own lint
// rule (react-hooks/set-state-in-effect) flags — this is what that hook
// exists for.
//
// defaultCrewId (added with profiles.crew_id, Batch 3 sub-phase A): when
// this device has never picked a crew, fall back to the signed-in user's
// own assigned crew rather than "no crew selected" — still overridable
// per-device (a shared tablet logging as someone else's crew), since an
// explicit pick always wins once one is stored.
export function useCrewSelection(
  defaultCrewId: string | null = null
): [string | null, (id: string | null) => void] {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const crewId = stored ?? defaultCrewId;

  function updateCrewId(id: string | null) {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    listeners.forEach((listener) => listener());
  }

  return [crewId, updateCrewId];
}
