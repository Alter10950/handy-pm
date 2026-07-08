"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  flagMaterial,
  logVerifiedReceipt,
  type MaterialFlagStatus,
} from "@/lib/materials/actions";
import type { Tables, Views } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const FLAG_OPTIONS: { value: MaterialFlagStatus; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong", label: "Wrong item" },
];

// One packing-slip line: big tap targets on purpose — this screen is for
// the warehouse guy standing at the dock with a tablet, not a desk. The
// qty field prefills with what's still outstanding so the common case
// ("the whole remaining delivery arrived and checks out") is one tap.
function WorksheetLine({
  material,
  recon,
  canManage,
  onDone,
}: {
  material: Tables<"materials">;
  recon: Views<"material_reconciliation"> | undefined;
  canManage: boolean;
  onDone: () => void;
}) {
  const outstanding = Math.max(0, material.total_needed - material.received);
  const [qty, setQty] = useState(outstanding > 0 ? String(outstanding) : "");
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagStatus, setFlagStatus] = useState<MaterialFlagStatus>("short");
  const [flagQty, setFlagQty] = useState("");
  const [flagNote, setFlagNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const verified = recon?.verified ?? 0;
  const openFlagQty = recon?.open_flag_qty ?? 0;
  const fullyVerified =
    material.total_needed > 0 &&
    material.received >= material.total_needed &&
    verified >= material.total_needed;

  function confirm() {
    const parsed = Number(qty);
    setError(null);
    startTransition(async () => {
      try {
        await logVerifiedReceipt(material.id, material.project_id, parsed, "");
        setQty("");
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not log receipt.");
      }
    });
  }

  function submitFlag() {
    const parsed = Number(flagQty);
    setError(null);
    startTransition(async () => {
      try {
        await flagMaterial(
          material.id,
          material.project_id,
          flagStatus,
          parsed,
          flagNote
        );
        setFlagQty("");
        setFlagNote("");
        setFlagOpen(false);
        onDone();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not flag material."
        );
      }
    });
  }

  return (
    <div
      data-testid={`worksheet-line-${material.id}`}
      className={cn(
        "rounded-lg border bg-card p-4",
        fullyVerified && openFlagQty === 0
          ? "border-success/50"
          : openFlagQty > 0
            ? "border-destructive/50"
            : "border-border"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-foreground">
            {material.name}
          </p>
          <p className="text-sm text-muted-foreground">
            {[material.profile, material.size].filter(Boolean).join(" · ") ||
              "—"}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="text-foreground">
            <span className="font-semibold tabular-nums">
              {material.received}
            </span>
            <span className="text-muted-foreground">
              {" "}
              / {material.total_needed} received
            </span>
          </p>
          <p className="text-muted-foreground">
            {verified >= material.total_needed && material.total_needed > 0
              ? "Verified ✓"
              : `${Math.min(verified, material.total_needed)} verified`}
            {openFlagQty > 0 ? (
              <span className="font-medium text-destructive">
                {" "}
                · {openFlagQty} flagged
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {fullyVerified && openFlagQty === 0 ? (
        <p className="mt-3 text-sm font-medium text-success-fg">
          Fully received and verified.
        </p>
      ) : canManage ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              aria-label={`Quantity for ${material.name}`}
              value={qty}
              onChange={(event) => setQty(event.target.value)}
              disabled={isPending}
              className="h-12 w-28 text-lg"
            />
            <Button
              type="button"
              size="lg"
              disabled={isPending || !qty || Number(qty) <= 0}
              onClick={confirm}
              className="h-12 flex-1 text-base sm:flex-none sm:px-6"
            >
              {isPending ? "Logging…" : "✓ Received + verified"}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              disabled={isPending}
              onClick={() => setFlagOpen((open) => !open)}
              className="h-12 text-base"
            >
              Flag problem
            </Button>
          </div>

          {flagOpen ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <div className="flex flex-wrap gap-2">
                {FLAG_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFlagStatus(option.value)}
                    disabled={isPending}
                    className={cn(
                      "h-11 rounded-md border px-4 text-sm font-medium",
                      flagStatus === option.value
                        ? "border-destructive bg-destructive/15 text-destructive"
                        : "border-border text-muted-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="qty"
                  aria-label={`Flagged quantity for ${material.name}`}
                  value={flagQty}
                  onChange={(event) => setFlagQty(event.target.value)}
                  disabled={isPending}
                  className="h-11 w-24"
                />
                <Input
                  placeholder="what's wrong? (optional)"
                  value={flagNote}
                  onChange={(event) => setFlagNote(event.target.value)}
                  disabled={isPending}
                  className="h-11 flex-1"
                />
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending || !flagQty || Number(flagQty) <= 0}
                  onClick={submitFlag}
                  className="h-11"
                >
                  {isPending ? "Flagging…" : "Log flag"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Flags block the Materials gate until resolved, land on the
                reorder list, and notify the PM right away.
              </p>
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          Only an owner/PM can log receiving.
        </p>
      )}
    </div>
  );
}

export function VerificationWorksheet({
  materials,
  reconciliation,
  canManage,
}: {
  materials: Tables<"materials">[];
  reconciliation: Views<"material_reconciliation">[];
  canManage: boolean;
}) {
  const router = useRouter();
  const reconByMaterial = new Map(
    reconciliation.map((r) => [r.material_id, r])
  );

  // Outstanding lines first (the ones the person at the dock is here
  // for), fully-verified ones sink to the bottom as confirmation.
  const sorted = [...materials].sort((a, b) => {
    const aDone = a.total_needed > 0 && a.received >= a.total_needed;
    const bDone = b.total_needed > 0 && b.received >= b.total_needed;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  if (materials.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
        No materials loaded yet — add the BOM on the Materials tab first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((material) => (
        <WorksheetLine
          key={material.id}
          material={material}
          recon={reconByMaterial.get(material.id)}
          canManage={canManage}
          onDone={() => router.refresh()}
        />
      ))}
    </div>
  );
}
