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
// authenticated identity (profiles has no crew_id link yet; see ADR-020's
// Sub-phase B notes). useSyncExternalStore, not useState+useEffect: reading
// localStorage only after mount and syncing it into state is exactly the
// "extra render" pattern React's own lint rule (react-hooks/set-state-in-
// effect) flags — this is what that hook exists for.
export function useCrewSelection(): [
  string | null,
  (id: string | null) => void,
] {
  const crewId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function updateCrewId(id: string | null) {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
    listeners.forEach((listener) => listener());
  }

  return [crewId, updateCrewId];
}
