"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { recordMaterialReceipt, resolveMaterialFlag } from "@/lib/materials/actions";
import type { MaterialReceiptTotals, MaterialsReadiness } from "@/lib/materials/queries";
import type {
  MaterialReceiptStatus,
  Tables,
  Views,
} from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

function formatReceiptTimestamp(isoString: string): string {
  return new Date(isoString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUSES: MaterialReceiptStatus[] = [
  "ordered",
  "received",
  "verified",
  "staged",
  "short",
  "damaged",
  "wrong",
];

const FLAG_STATUSES = new Set<MaterialReceiptStatus>(["short", "damaged", "wrong"]);

// One unresolved short/damaged/wrong event, with its resolve control —
// resolving is what un-blocks the Materials gate (the flag stays in the
// history forever; resolution is a second pair of columns on the same
// row, not a deletion).
function OpenFlagRow({
  flag,
  projectId,
  onResolved,
}: {
  flag: Tables<"material_receipts">;
  projectId: string;
  onResolved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resolve() {
    setError(null);
    startTransition(async () => {
      try {
        await resolveMaterialFlag(flag.id, projectId);
        onResolved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not resolve flag.");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-2 text-xs">
      <span className="font-medium text-destructive">
        {flag.status} × {flag.qty}
      </span>
      {flag.note ? <span className="text-muted-foreground">— {flag.note}</span> : null}
      <span className="text-muted-foreground">
        {formatReceiptTimestamp(flag.created_at)}
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={isPending}
        onClick={resolve}
        data-testid={`resolve-flag-${flag.id}`}
      >
        {isPending ? "Resolving…" : "Resolve"}
      </Button>
      {error ? <span className="text-destructive">{error}</span> : null}
    </li>
  );
}

function CheckInForm({
  materialId,
  projectId,
  onLogged,
}: {
  materialId: string;
  projectId: string;
  onLogged: () => void;
}) {
  const [status, setStatus] = useState<MaterialReceiptStatus>("received");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const parsedQty = Number(qty);
    setError(null);
    startTransition(async () => {
      try {
        await recordMaterialReceipt(materialId, projectId, status, parsedQty, note);
        setQty("");
        setNote("");
        onLogged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not log receipt.");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Receipt status"
        value={status}
        onChange={(event) => setStatus(event.target.value as MaterialReceiptStatus)}
        disabled={isPending}
        className="h-8 rounded-md border border-border bg-background px-1.5 text-xs text-foreground"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Input
        type="number"
        min={1}
        placeholder="qty"
        value={qty}
        onChange={(event) => setQty(event.target.value)}
        disabled={isPending}
        className="h-8 w-16 text-xs"
      />
      <Input
        placeholder="note (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={isPending}
        className="h-8 w-32 text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending || !qty}
        onClick={submit}
      >
        {isPending ? "Logging…" : "Log"}
      </Button>
      {error ? <p className="w-full text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ReceivingPanel({
  projectId,
  materials,
  reconciliation,
  receiptTotals,
  receiptHistory,
  readiness,
}: {
  projectId: string;
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  receiptTotals: MaterialReceiptTotals[];
  receiptHistory: Record<string, Tables<"material_receipts">[]>;
  readiness: MaterialsReadiness;
}) {
  const router = useRouter();
  const reconByMaterial = new Map(reconciliation.map((r) => [r.material_id, r]));
  const totalsByMaterial = new Map(
    receiptTotals.map((r) => [r.materialId, r.totalsByStatus])
  );

  const reorderList = materials
    .map((material) => ({
      material,
      toOrder: reconByMaterial.get(material.id)?.to_order ?? 0,
    }))
    .filter((entry) => entry.toOrder > 0)
    .sort((a, b) => b.toOrder - a.toOrder);

  return (
    <div className="flex flex-col gap-6">
      <div
        data-testid="materials-gate-card"
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3",
          readiness.isReady
            ? "border-success/50 bg-success/10"
            : "border-border bg-card"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span
            className={cn(
              "font-semibold",
              readiness.isReady ? "text-success-fg" : "text-foreground"
            )}
          >
            {readiness.isReady
              ? "Materials gate: green"
              : "Materials gate: not ready"}
          </span>
          <span className="text-muted-foreground">
            {Math.round(readiness.pctReceived * 100)}% received
          </span>
          <span className="text-muted-foreground">
            {Math.round(readiness.pctVerified * 100)}% verified
          </span>
          <span
            className={cn(
              readiness.openFlagQty > 0
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            )}
          >
            {readiness.openFlagQty} flagged open
          </span>
        </div>
        <Link
          href={`/app/project/${projectId}/receiving/verify`}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Open verification worksheet
        </Link>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Reorder list ({reorderList.length})
        </h2>
        {reorderList.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing short — every material&apos;s received qty meets what&apos;s needed.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {reorderList.map(({ material, toOrder }) => (
              <li key={material.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{material.name}</span>
                <span className="font-medium text-destructive">{toOrder} to order</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          Material status
        </h2>
        {materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">No materials yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {materials.map((material) => {
              const recon = reconByMaterial.get(material.id);
              const totals = totalsByMaterial.get(material.id) ?? {};
              const openFlags = (receiptHistory[material.id] ?? []).filter(
                (entry) =>
                  FLAG_STATUSES.has(entry.status) && entry.resolved_at === null
              );
              return (
                <div
                  key={material.id}
                  className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{material.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Needed {material.total_needed} · Received {material.received} ·{" "}
                      {recon ? `To order ${recon.to_order}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {STATUSES.filter((s) => s !== "ordered" && s !== "received").map(
                      (s) => (
                        <span
                          key={s}
                          className={cn(
                            "rounded-full px-2 py-0.5",
                            FLAG_STATUSES.has(s) && (totals[s] ?? 0) > 0
                              ? "bg-destructive/15 text-destructive"
                              : "bg-muted"
                          )}
                        >
                          {s}: {totals[s] ?? 0}
                        </span>
                      )
                    )}
                  </div>
                  {openFlags.length > 0 ? (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2">
                      <p className="text-xs font-medium text-destructive">
                        Open flags — the Materials gate stays red until each is
                        resolved (replacement received, or accepted as-is):
                      </p>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {openFlags.map((flag) => (
                          <OpenFlagRow
                            key={flag.id}
                            flag={flag}
                            projectId={projectId}
                            onResolved={() => router.refresh()}
                          />
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <CheckInForm
                    materialId={material.id}
                    projectId={projectId}
                    onLogged={() => router.refresh()}
                  />
                  {(() => {
                    const history = receiptHistory[material.id] ?? [];
                    return (
                      <details data-testid={`material-history-${material.id}`}>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          History ({history.length})
                        </summary>
                        {history.length === 0 ? (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            No receipts logged yet.
                          </p>
                        ) : (
                          <ul className="mt-1.5 flex flex-col gap-1">
                            {history.map((entry) => (
                              <li
                                key={entry.id}
                                className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground"
                              >
                                <span className="font-medium text-foreground">
                                  {entry.status}
                                </span>
                                <span>{entry.qty}</span>
                                <span>{formatReceiptTimestamp(entry.created_at)}</span>
                                {entry.note ? <span>— {entry.note}</span> : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
