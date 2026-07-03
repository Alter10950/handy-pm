import { useState } from "react";

export interface UndoEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

/**
 * Generic command-pattern undo/redo stack: each entry carries its own
 * self-contained undo/redo closures (constructed at the call site, which
 * already has whatever "before"/"after" data it needs), rather than a
 * central dispatcher keyed on action type. Rows persist to the DB
 * immediately, so undo/redo both make real Server Action calls — this
 * hook only manages the stack bookkeeping, not persistence itself.
 *
 * Deliberately not memoized with useCallback: undo/redo read `past`/
 * `future` directly from this render's closure, so a consumer must use
 * whichever reference came from the latest render (e.g. include them in
 * a useEffect's dependency array) rather than capturing one from mount.
 */
export function useUndoStack() {
  const [past, setPast] = useState<UndoEntry[]>([]);
  const [future, setFuture] = useState<UndoEntry[]>([]);

  function push(entry: UndoEntry) {
    setPast((prev) => [...prev, entry]);
    setFuture([]);
  }

  async function undo(): Promise<string | null> {
    if (past.length === 0) return null;
    const entry = past[past.length - 1];
    await entry.undo();
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [...prev, entry]);
    return entry.label;
  }

  async function redo(): Promise<string | null> {
    if (future.length === 0) return null;
    const entry = future[future.length - 1];
    await entry.redo();
    setFuture((prev) => prev.slice(0, -1));
    setPast((prev) => [...prev, entry]);
    return entry.label;
  }

  return {
    push,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
