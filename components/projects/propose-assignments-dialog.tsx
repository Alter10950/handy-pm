"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { applyProposedAssignments } from "@/lib/rows/actions";
import {
  buildAssignmentProposal,
  type ProposalMaterialInput,
  type ProposalRowInput,
} from "@/lib/rows/propose-assignments";
import type { Json } from "@/lib/supabase/database.types";

// Batch 5 Sub-phase B(2): propose per-row required quantities as an even
// split (bay-weighted when bays are known), shown as a reviewable preview
// over the current rows, applied only on confirm. Pure math, human-gated.

export function ProposeAssignmentsDialog({
  projectId,
  rows,
  materials,
  disabled,
}: {
  projectId: string;
  rows: ProposalRowInput[];
  materials: ProposalMaterialInput[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const { proposals, entries } = useMemo(
    () => buildAssignmentProposal(materials, rows),
    [materials, rows]
  );

  function apply() {
    setError(null);
    startTransition(async () => {
      try {
        await applyProposedAssignments(
          projectId,
          entries,
          {
            strategy: rows.some((r) => (r.bays ?? 0) > 0)
              ? "bay_weighted"
              : "even_split",
            rowCount: rows.length,
            materialCount: materials.length,
          } as unknown as Json
        );
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not apply the proposal."
        );
      }
    });
  }

  const canPropose = rows.length > 0 && materials.length > 0;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="propose-assignments-button"
        disabled={disabled || !canPropose}
        title={
          canPropose
            ? "Propose an even split of each material across the rows"
            : "Needs at least one row and one material"
        }
        onClick={() => setOpen(true)}
      >
        ⚖ Propose quantities
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Propose row quantities</DialogTitle>
            <DialogDescription>
              An even split of each material across all {rows.length} rows
              {rows.some((r) => (r.bays ?? 0) > 0)
                ? ", weighted by bay count where known"
                : ""}
              . Review before applying — this overwrites the required
              quantities for these rows.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
            <table
              data-testid="propose-preview-table"
              className="w-full text-xs"
            >
              <thead>
                <tr className="border-b border-border bg-muted text-left text-muted-foreground">
                  <th className="p-2 font-semibold">Material</th>
                  <th className="p-2 text-right font-semibold">Total</th>
                  <th className="p-2 font-semibold">Per row</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const qtys = p.perRow.map((c) => c.qty);
                  const min = Math.min(...qtys);
                  const max = Math.max(...qtys);
                  return (
                    <tr
                      key={p.materialId}
                      className="border-b border-border-subtle last:border-0"
                    >
                      <td className="p-2 font-medium text-foreground">
                        {p.name}
                      </td>
                      <td className="num p-2 text-right text-muted-foreground">
                        {p.totalNeeded}
                      </td>
                      <td className="num p-2 text-foreground">
                        {min === max ? `${min} each` : `${min}–${max} each`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              size="lg"
              onClick={apply}
              disabled={isPending || entries.length === 0}
            >
              {isPending
                ? "Applying…"
                : `Apply to ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
