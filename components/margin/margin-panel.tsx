"use client";

import { useState, useTransition } from "react";

import { StatTile } from "@/components/ui/stat-tile";
import { setProjectQuote } from "@/lib/margin/actions";
import type { ProjectMargin } from "@/lib/margin/queries";

// Batch 5 Sub-phase F: per-project margin (owner-only). Quote is manual
// entry (QuickBooks fills it when connected — see NEEDS-YOU); actual and
// forecast come from crew hours × cost. Works fully with no integration.

function money(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function MarginPanel({
  projectId,
  margin,
  quickbooksConnected,
}: {
  projectId: string;
  margin: ProjectMargin;
  quickbooksConnected: boolean;
}) {
  const [quote, setQuote] = useState(
    margin.quotedAmount !== null ? String(margin.quotedAmount) : ""
  );
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    setMessage(null);
    startTransition(async () => {
      try {
        const value = quote.trim() ? Number(quote) : null;
        await setProjectQuote(projectId, value);
        setMessage("Quote saved.");
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  const forecastNegative =
    margin.forecastMargin !== null && margin.forecastMargin < 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-overline text-muted-foreground">
          Job cost &amp; margin
        </h2>
        <span className="text-xs text-muted-foreground">
          {quickbooksConnected
            ? "Quote synced from QuickBooks"
            : "Manual quote · connect QuickBooks in Settings to sync"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Contract quote</span>
          <input
            type="number"
            min={0}
            step={100}
            value={quote}
            onChange={(e) => setQuote(e.target.value)}
            disabled={quickbooksConnected}
            data-testid="margin-quote-input"
            className="h-9 w-40 rounded-lg border border-border bg-background px-2.5 text-sm"
            placeholder="e.g. 48000"
          />
        </label>
        {!quickbooksConnected ? (
          <button
            type="button"
            data-testid="margin-quote-save"
            disabled={isPending}
            onClick={save}
            className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-e1 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save quote"}
          </button>
        ) : null}
        {margin.approvedChangeOrders > 0 ? (
          <span className="text-xs text-muted-foreground">
            + {money(margin.approvedChangeOrders)} approved change orders
          </span>
        ) : null}
      </div>
      {message ? (
        <p
          className={
            /saved/i.test(message)
              ? "text-xs text-success-fg"
              : "text-xs text-destructive"
          }
        >
          {message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Quote" value={money(margin.quote)} />
        <StatTile
          label="Cost to date"
          value={money(margin.laborCostToDate)}
        />
        <StatTile
          label="Forecast cost"
          value={money(margin.forecastCost)}
        />
        <StatTile
          label="Forecast margin"
          value={money(margin.forecastMargin)}
          tone={forecastNegative ? "danger" : "default"}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Cost is crew hours × crew rate ({margin.laborHoursToDate.toFixed(0)} h
        logged
        {margin.blendedRate !== null
          ? ` at ~${money(margin.blendedRate)}/h`
          : ""}
        ); forecast adds {margin.remainingHours.toFixed(0)} remaining hours
        from the estimate. Material cost isn&apos;t tracked yet, so this is
        labor margin.
        {margin.crewsMissingRate > 0
          ? ` ${margin.crewsMissingRate} crew${margin.crewsMissingRate === 1 ? "" : "s"} on this job ${margin.crewsMissingRate === 1 ? "has" : "have"} no cost rate set — add it on the crew for a complete number.`
          : ""}
        {!margin.quoteColumnAvailable
          ? " (Set-quote needs the quote migration applied.)"
          : ""}
      </p>
    </div>
  );
}
