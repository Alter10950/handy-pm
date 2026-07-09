"use client";

import {
  AlertTriangleIcon,
  GaugeIcon,
  PackageXIcon,
  UserXIcon,
  ZapIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import {
  acknowledgeAnomaly,
  recomputeAnomalies,
} from "@/lib/anomalies/actions";
import type { OpenAnomaly } from "@/lib/anomalies/queries";

const KIND_ICON: Record<string, typeof AlertTriangleIcon> = {
  spi_slipping: GaugeIcon,
  low_output: ZapIcon,
  material_shortfall: PackageXIcon,
  idle_crew: UserXIcon,
  estimate_drift: AlertTriangleIcon,
};

const SEVERITY_TONE: Record<string, PillTone> = {
  critical: "danger",
  warn: "warning",
  info: "info",
};

// Batch 5 Sub-phase D: the dashboard's exception strip — open anomaly
// flags with acknowledge, and a manual recompute (the same routine the
// nightly cron and close-of-day run). Rules-based, explainable.
export function AnomalyStrip({
  anomalies,
  available,
}: {
  anomalies: OpenAnomaly[];
  available: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [ackingId, setAckingId] = useState<string | null>(null);

  function refresh() {
    startTransition(async () => {
      try {
        const result = await recomputeAnomalies();
        toast.success(
          result.available
            ? `Checked — ${result.count} open anomal${result.count === 1 ? "y" : "ies"}.`
            : "Anomaly detection isn't available until the migration is applied."
        );
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not recompute."
        );
      }
    });
  }

  function acknowledge(id: string) {
    setAckingId(id);
    startTransition(async () => {
      try {
        await acknowledgeAnomaly(id);
        toast.success("Acknowledged.");
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not acknowledge."
        );
      } finally {
        setAckingId(null);
      }
    });
  }

  return (
    <div
      data-testid="anomaly-strip"
      className="rounded-lg border border-border bg-card p-4 shadow-e1"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <AlertTriangleIcon
            aria-hidden
            className={
              anomalies.length > 0
                ? "size-4 text-warning-fg"
                : "size-4 text-muted-foreground"
            }
          />
          Anomalies ({anomalies.length})
        </h2>
        <button
          type="button"
          data-testid="anomaly-recompute"
          disabled={busy}
          onClick={refresh}
          className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground shadow-e1 transition-colors hover:bg-muted disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check now"}
        </button>
      </div>

      {!available ? (
        <p className="text-sm text-muted-foreground">
          Anomaly detection activates once the Batch-5 migration is applied.
        </p>
      ) : anomalies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing unusual — no open anomalies across active jobs.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {anomalies.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? AlertTriangleIcon;
            return (
              <li
                key={a.id}
                className="flex items-center gap-2.5 rounded-md border border-border-subtle bg-surface px-3 py-2"
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <StatusPill tone={SEVERITY_TONE[a.severity] ?? "neutral"}>
                  {a.severity}
                </StatusPill>
                <span className="min-w-0 flex-1 text-sm text-foreground">
                  {a.summary}
                </span>
                <button
                  type="button"
                  disabled={busy && ackingId === a.id}
                  onClick={() => acknowledge(a.id)}
                  className="shrink-0 rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground shadow-e1 hover:text-foreground disabled:opacity-50"
                >
                  {busy && ackingId === a.id ? "…" : "Acknowledge"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
