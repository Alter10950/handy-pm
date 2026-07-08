"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  emailAutopsyToOwners,
  generateAutopsy,
  saveAutopsyNarrative,
} from "@/lib/autopsy/actions";
import {
  parseBlockerBreakdown,
  parseMaterialVariance,
  verdict,
  type AutopsyRow,
} from "@/lib/autopsy/shared";
import { cn } from "@/lib/utils";

const VERDICT_CLASS = {
  under: "text-success-fg",
  on: "text-foreground",
  over: "text-destructive",
} as const;

function DimensionRow({
  label,
  estimated,
  actual,
  unit,
}: {
  label: string;
  estimated: number | null;
  actual: number | null;
  unit: string;
}) {
  const v = verdict(estimated, actual);
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 text-foreground">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
        {estimated ?? "—"} {estimated !== null ? unit : ""}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-foreground">
        {actual ?? "—"} {actual !== null ? unit : ""}
      </td>
      <td
        className={cn(
          "py-2 pl-3 text-right text-sm font-medium",
          v ? VERDICT_CLASS[v.kind] : "text-muted-foreground"
        )}
      >
        {v ? v.label : "no estimate"}
      </td>
    </tr>
  );
}

export function AutopsyPanel({
  projectId,
  autopsy,
  canManage,
  aiAvailable,
  resendConfigured,
}: {
  projectId: string;
  autopsy: AutopsyRow | null;
  canManage: boolean;
  aiAvailable: boolean;
  resendConfigured: boolean;
}) {
  const [narrative, setNarrative] = useState(autopsy?.narrative ?? "");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function run(fn: () => Promise<void>, successNotice?: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        await fn();
        if (successNotice) setNotice(successNotice);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  async function draftWithAi() {
    setDrafting(true);
    setError(null);
    try {
      const response = await fetch("/api/autopsy/narrative", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = (await response.json()) as {
        narrative?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? "Could not draft the narrative.");
      // Lands in the editable textarea only — review, edit, then Save.
      setNarrative(data.narrative ?? "");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not draft the narrative."
      );
    } finally {
      setDrafting(false);
    }
  }

  const materialVariance = autopsy
    ? parseMaterialVariance(autopsy.material_variance)
    : [];
  const blockerBreakdown = autopsy
    ? parseBlockerBreakdown(autopsy.blocker_breakdown)
    : {};
  const mismatchedMaterials = materialVariance.filter(
    (m) => m.installed !== m.needed || m.received !== m.needed
  );

  return (
    <div
      data-testid="autopsy-panel"
      className="rounded-lg border border-border bg-card shadow-e1 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Closeout autopsy
        </h3>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={autopsy ? "outline" : "default"}
              disabled={isPending}
              onClick={() =>
                run(
                  () => generateAutopsy(projectId),
                  "Autopsy generated from actuals."
                )
              }
            >
              {isPending
                ? "Working…"
                : autopsy
                  ? "Regenerate from actuals"
                  : "Generate autopsy"}
            </Button>
            {autopsy && resendConfigured ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => emailAutopsyToOwners(projectId),
                    "Emailed to owners."
                  )
                }
              >
                Email to owners
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!autopsy ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Not generated yet — estimated vs actual across days, hours, labor,
          materials, change orders, and blockers. Generate it at closeout (it
          also ticks the &ldquo;Autopsy generated&rdquo; gate item).
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Dimension</th>
                  <th className="px-3 pb-2 text-right font-medium">
                    Estimated
                  </th>
                  <th className="px-3 pb-2 text-right font-medium">Actual</th>
                  <th className="pb-2 pl-3 text-right font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody data-testid="autopsy-dimensions">
                <DimensionRow
                  label="Days on site"
                  estimated={autopsy.estimated_days}
                  actual={autopsy.actual_days}
                  unit="d"
                />
                <DimensionRow
                  label="Productive hours"
                  estimated={autopsy.estimated_hours}
                  actual={autopsy.actual_labor_hours}
                  unit="h"
                />
                <DimensionRow
                  label="Labor units"
                  estimated={autopsy.estimated_labor_units}
                  actual={autopsy.actual_labor_units}
                  unit="lu"
                />
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Change orders</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {autopsy.change_order_count}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  (+{autopsy.change_order_days} day
                  {autopsy.change_order_days === 1 ? "" : "s"})
                </span>
              </p>
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Blocker-affected days
              </p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {autopsy.blocker_days}
              </p>
              {Object.keys(blockerBreakdown).length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {Object.entries(blockerBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([code, days]) => `${code}: ${days}d`)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Materials off-plan
              </p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {mismatchedMaterials.length}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  of {materialVariance.length}
                </span>
              </p>
              {mismatchedMaterials.slice(0, 3).map((m) => (
                <p
                  key={m.name}
                  className="mt-0.5 truncate text-xs text-muted-foreground"
                >
                  {m.name}: {m.installed}/{m.needed} installed, {m.received}{" "}
                  received
                </p>
              ))}
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Narrative — what to do differently next time
                </p>
                {aiAvailable ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={drafting || isPending}
                    onClick={() => void draftWithAi()}
                  >
                    {drafting ? "Drafting…" : "✨ Draft with AI"}
                  </Button>
                ) : null}
              </div>
              <textarea
                aria-label="Autopsy narrative"
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={5}
                disabled={isPending || drafting}
                placeholder="Max 5 lines: what ran over, why, and what changes on the next bid."
                className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
              />
              <Button
                type="button"
                size="sm"
                disabled={isPending || drafting}
                onClick={() =>
                  run(
                    () => saveAutopsyNarrative(projectId, narrative),
                    "Narrative saved."
                  )
                }
                className="self-start"
              >
                Save narrative
              </Button>
            </div>
          ) : autopsy.narrative ? (
            <p className="whitespace-pre-line border-t border-border pt-3 text-sm text-foreground">
              {autopsy.narrative}
            </p>
          ) : null}
        </div>
      )}

      {notice ? <p className="mt-2 text-sm text-success-fg">{notice}</p> : null}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
