"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import { logInstallDelta } from "@/lib/field/actions";
import {
  enqueueInstall,
  getDeviceId,
  getPendingCount,
  peekQueue,
  removeFromQueue,
  subscribeQueue,
  type QueuedInstall,
} from "@/lib/field/offline-queue";

function getServerPendingCount() {
  return 0;
}

// Logs an install delta immediately when possible; when it isn't (offline,
// or the request itself fails — a dropped connection mid-request looks the
// same to the caller as never having sent it), queues it in localStorage
// instead of losing the tap. Drains the queue on mount and whenever the
// browser regains connectivity, in FIFO order, stopping at the first
// failure so a still-offline queue doesn't get hammered entry by entry.
// pendingCount reads the queue via useSyncExternalStore (subscribeQueue
// notifies on every enqueue/dequeue) rather than mirroring it into its own
// state, so nothing here needs to call setState from inside an effect.
export function useInstallLogger(projectId: string, crewId: string | null) {
  const pendingCount = useSyncExternalStore(
    subscribeQueue,
    getPendingCount,
    getServerPendingCount
  );
  // A mutex, not render state — never displayed, so a ref (not useState)
  // is the right tool, and it sidesteps the "setState in an effect"
  // concern entirely rather than working around it.
  const drainingRef = useRef(false);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      for (const item of peekQueue()) {
        try {
          await logInstallDelta(
            item.rowId,
            item.projectId,
            item.materialId,
            item.qty,
            item.crewId,
            item.idempotencyKey,
            getDeviceId()
          );
          removeFromQueue(item.idempotencyKey);
        } catch {
          break;
        }
      }
    } finally {
      drainingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void drain();
    window.addEventListener("online", drain);
    return () => window.removeEventListener("online", drain);
    // Only wire this up once per mount — `drain` closes over state that
    // changes as it runs, but the listener itself shouldn't churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logDelta = useCallback(
    async (
      rowId: string,
      rowLabel: string,
      materialId: string,
      materialName: string,
      qty: number
    ) => {
      const item: QueuedInstall = {
        idempotencyKey: crypto.randomUUID(),
        rowId,
        projectId,
        materialId,
        qty,
        crewId,
        rowLabel,
        materialName,
      };
      if (!navigator.onLine) {
        enqueueInstall(item);
        return "queued" as const;
      }
      try {
        await logInstallDelta(
          rowId,
          projectId,
          materialId,
          qty,
          crewId,
          item.idempotencyKey,
          getDeviceId()
        );
        return "logged" as const;
      } catch {
        enqueueInstall(item);
        return "queued" as const;
      }
    },
    [projectId, crewId]
  );

  return { logDelta, pendingCount, drain };
}
