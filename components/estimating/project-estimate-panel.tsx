"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { sendFinishChangedNotice } from "@/lib/comms/actions";
import {
  computeEstimatePreview,
  saveProjectEstimate,
} from "@/lib/estimating/actions";
import type { ComputedEstimate } from "@/lib/estimating/queries";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// Confidence renders as a StatusPill chip in the stat header (design pass
// v3 D3) — a tone-mapped chip, not a line of red text.
const CONFIDENCE_TONE: Record<ComputedEstimate["confidence"], PillTone> = {
  high: "success",
  medium: "warning",
  low: "danger",
};

// Per-SKU line source labels + tones (Phase 13 engine).
const LINE_SOURCE: Record<string, { label: string; tone: PillTone }> = {
  learned: { label: "learned", tone: "success" },
  sku: { label: "SKU standard", tone: "info" },
  category: { label: "category default", tone: "neutral" },
  none: { label: "no standard", tone: "danger" },
};

function formatNumber(n: number, digits = 1): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-e1">
      <p className="type-overline text-muted-foreground">{label}</p>
      <p data-testid={testId} className="num type-stat mt-1.5 text-foreground">
        {value}
      </p>
    </div>
  );
}

export function ProjectEstimatePanel({
  projectId,
  initialEstimate,
  history,
  crews,
  aiExplainAvailable,
}: {
  projectId: string;
  initialEstimate: ComputedEstimate;
  history: Tables<"project_estimates">[];
  crews: Tables<"crews">[];
  aiExplainAvailable: boolean;
}) {
  const [estimate, setEstimate] = useState(initialEstimate);
  const [crewCount, setCrewCount] = useState(initialEstimate.crewCount);
  const [selectedCrewIds, setSelectedCrewIds] = useState<string[]>(
    initialEstimate.crewIds
  );
  const [isPending, startTransition] = useTransition();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [finishPrompt, setFinishPrompt] = useState<{
    oldFinish: string;
    newFinish: string;
  } | null>(null);
  const [finishReason, setFinishReason] = useState("");
  const [finishError, setFinishError] = useState<string | null>(null);

  function recompute(nextCrewCount: number, nextCrewIds: string[]) {
    startTransition(async () => {
      const next = await computeEstimatePreview(projectId, {
        crewCount: nextCrewCount,
        crewIds: nextCrewIds,
      });
      setEstimate(next);
      setExplanation(null);
    });
  }

  function toggleCrew(crewId: string) {
    const next = selectedCrewIds.includes(crewId)
      ? selectedCrewIds.filter((id) => id !== crewId)
      : [...selectedCrewIds, crewId];
    setSelectedCrewIds(next);
    const nextCount = next.length > 0 ? next.length : crewCount;
    setCrewCount(nextCount);
    recompute(nextCount, next);
  }

  function handleCrewCountChange(value: number) {
    const clamped = Math.max(1, value);
    setCrewCount(clamped);
    recompute(clamped, selectedCrewIds);
  }

  function handleSave() {
    setSaveMessage(null);
    startTransition(async () => {
      try {
        await saveProjectEstimate(projectId, {
          crewCount,
          crewIds: selectedCrewIds,
        });
        setSaveMessage("Estimate saved.");
        // Schedule slips get communicated proactively, not discovered
        // (Sub-phase H): the expected finish just changed vs the last
        // SAVED estimate — offer to notify the customer, with a
        // human-worded, customer-safe reason. history[0] is the latest
        // save BEFORE this one (newest-first).
        const previousFinish = history[0]?.forecast_finish ?? null;
        const newFinish = estimate.forecastFinish;
        if (newFinish && previousFinish && newFinish !== previousFinish) {
          setFinishPrompt({ oldFinish: previousFinish, newFinish });
        }
      } catch (err) {
        setSaveMessage(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function handleSendFinishNotice() {
    if (!finishPrompt) return;
    setFinishError(null);
    startTransition(async () => {
      try {
        await sendFinishChangedNotice(projectId, {
          oldFinish: finishPrompt.oldFinish,
          newFinish: finishPrompt.newFinish,
          reason: finishReason,
        });
        setFinishPrompt(null);
        setFinishReason("");
        setSaveMessage("Customer notified of the new expected finish.");
      } catch (err) {
        setFinishError(
          err instanceof Error ? err.message : "Could not send the notice."
        );
      }
    });
  }

  async function handleExplain() {
    setExplaining(true);
    setExplainError(null);
    setExplanation(null);
    try {
      const response = await fetch("/api/estimates/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ estimate }),
      });
      const data = (await response.json()) as {
        explanation?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error ?? "Could not explain this estimate.");
      }
      setExplanation(data.explanation ?? null);
    } catch (err) {
      setExplainError(
        err instanceof Error ? err.message : "Could not explain this estimate."
      );
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {estimate.engineWarnings.length > 0 ? (
        <div
          role="alert"
          data-testid="estimate-warnings"
          className="rounded-lg border border-warning/40 bg-warning-subtle p-3 text-sm text-foreground"
        >
          <p className="font-semibold text-warning-fg">
            Check these before trusting the forecast
          </p>
          <ul className="mt-1 list-disc pl-5">
            {estimate.engineWarnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Full scope"
            value={`${formatNumber(estimate.fullScopeLaborUnits)} hrs`}
            testId="estimate-stat-full-scope"
          />
          <Stat
            label="Remaining to finish"
            value={`${formatNumber(estimate.remainingLaborUnits)} hrs`}
            testId="estimate-stat-remaining"
          />
          <Stat
            label="At this rate"
            value={`${formatNumber(estimate.estimatedDays)} crew-days`}
            testId="estimate-stat-days"
          />
          <Stat
            label="Forecast finish"
            value={formatDate(estimate.forecastFinish)}
            testId="estimate-stat-forecast-finish"
          />
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone={CONFIDENCE_TONE[estimate.confidence]}>
            Confidence: {estimate.confidence}
          </StatusPill>
          {isPending ? (
            <span className="text-sm text-muted-foreground">recomputing…</span>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">What-if</h3>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="crew-count"
              className="text-xs text-muted-foreground"
            >
              Crews in parallel
            </label>
            <Input
              id="crew-count"
              type="number"
              min={1}
              value={crewCount}
              disabled={selectedCrewIds.length > 0}
              onChange={(event) =>
                handleCrewCountChange(Number(event.target.value) || 1)
              }
              className="h-9 w-24"
            />
            {selectedCrewIds.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Locked to the {selectedCrewIds.length} crew(s) picked below.
              </p>
            ) : null}
          </div>

          {crews.length > 0 ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Use specific crews&apos; own rates (optional)
              </span>
              <div className="flex flex-wrap gap-2">
                {crews.map((crew) => (
                  <button
                    key={crew.id}
                    type="button"
                    onClick={() => toggleCrew(crew.id)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium",
                      selectedCrewIds.includes(crew.id)
                        ? "border-brand bg-brand-subtle text-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {crew.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={isPending}
            onClick={handleSave}
          >
            Save this estimate
          </Button>
          {aiExplainAvailable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={explaining}
              onClick={() => void handleExplain()}
            >
              {explaining ? "Explaining…" : "✨ Explain this estimate"}
            </Button>
          ) : null}
          {saveMessage ? (
            <span className="text-xs text-muted-foreground">{saveMessage}</span>
          ) : null}
        </div>

        {explainError ? (
          <p className="mt-2 text-sm text-destructive">{explainError}</p>
        ) : null}
        {explanation ? (
          <p className="mt-3 whitespace-pre-line rounded-md bg-muted p-3 text-sm text-foreground">
            {explanation}
          </p>
        ) : null}

        {finishPrompt ? (
          <div
            data-testid="finish-changed-prompt"
            className="mt-3 flex flex-col gap-2 rounded-md border border-primary/50 bg-primary/10 p-3"
          >
            <p className="text-sm font-medium text-foreground">
              Expected finish moved: {finishPrompt.oldFinish} →{" "}
              {finishPrompt.newFinish}. Tell the customer proactively?
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                aria-label="Customer-facing reason"
                placeholder="Customer-facing reason (e.g. material logistics)"
                value={finishReason}
                onChange={(event) => setFinishReason(event.target.value)}
                disabled={isPending}
                className="h-8 w-72 text-sm"
              />
              <Button
                type="button"
                size="sm"
                disabled={isPending || !finishReason.trim()}
                onClick={handleSendFinishNotice}
              >
                {isPending ? "Sending…" : "Notify customer"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => setFinishPrompt(null)}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Write it how the customer should read it — &ldquo;material
              logistics,&rdquo; not internal detail.
            </p>
            {finishError ? (
              <p className="text-sm text-destructive">{finishError}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="mb-1 text-sm font-semibold text-foreground">
          Remaining hours by SKU
        </h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Each line resolves its own standard — learned crew rate first, then a
          per-SKU standard, then the category default with size modifiers. No
          more one-rate-fits-all.
        </p>
        {estimate.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No materials yet — paste or import a material list first.
          </p>
        ) : (
          <div className="max-h-[28rem] overflow-auto rounded-md border border-border-subtle">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="sticky top-0 border-b border-border bg-surface-sunken px-2 py-1.5 font-semibold">
                    Material
                  </th>
                  <th className="sticky top-0 border-b border-border bg-surface-sunken px-2 py-1.5 text-right font-semibold">
                    Remaining
                  </th>
                  <th className="sticky top-0 border-b border-border bg-surface-sunken px-2 py-1.5 text-right font-semibold">
                    h/unit
                  </th>
                  <th className="sticky top-0 border-b border-border bg-surface-sunken px-2 py-1.5 text-right font-semibold">
                    Hours
                  </th>
                  <th className="sticky top-0 border-b border-border bg-surface-sunken px-2 py-1.5 text-right font-semibold">
                    Standard
                  </th>
                </tr>
              </thead>
              <tbody data-testid="estimate-sku-lines">
                {[...estimate.lines]
                  .sort((a, b) => b.remainingHours - a.remainingHours)
                  .map((line, i) => {
                    const source = LINE_SOURCE[line.source] ?? LINE_SOURCE.none;
                    return (
                      <tr key={line.skuId ?? `${line.name}-${i}`}>
                        <td className="border-b border-border-subtle px-2 py-1.5 text-foreground">
                          <span
                            className="block max-w-64 truncate"
                            title={line.name}
                          >
                            {line.name}
                          </span>
                          <span className="text-[11px] capitalize text-muted-foreground">
                            {line.category.replace("_", " ")}
                            {line.modifiers.length > 0
                              ? ` · ${line.modifiers.join(", ")}`
                              : ""}
                          </span>
                        </td>
                        <td className="num border-b border-border-subtle px-2 py-1.5 text-right text-foreground">
                          {formatNumber(line.remainingQuantity)}
                        </td>
                        <td className="num border-b border-border-subtle px-2 py-1.5 text-right text-foreground">
                          {formatNumber(line.hoursPerUnit, 4)}
                        </td>
                        <td className="num border-b border-border-subtle px-2 py-1.5 text-right font-medium text-foreground">
                          {formatNumber(line.remainingHours, 2)}
                        </td>
                        <td className="border-b border-border-subtle px-2 py-1.5 text-right">
                          <StatusPill tone={source.tone}>
                            {source.label}
                          </StatusPill>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}

        {estimate.breakdown.some(
          (entry) =>
            !estimate.lines.some((line) => line.category === entry.taskKey)
        ) ? (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              Other scope work (teardown, relocation, …)
            </p>
            <ul className="flex flex-col gap-0.5 text-sm text-foreground">
              {estimate.breakdown
                .filter(
                  (entry) =>
                    !estimate.lines.some(
                      (line) => line.category === entry.taskKey
                    )
                )
                .map((entry) => (
                  <li key={entry.taskKey} className="flex justify-between">
                    <span className="capitalize">
                      {entry.taskKey.replace("_", " ")}
                    </span>
                    <span className="num">
                      {formatNumber(entry.hours, 2)} h
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">
          Estimate history
        </h3>
        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No saved estimates yet — use &quot;Save this estimate&quot; above to
            start a history.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0"
              >
                <span className="text-muted-foreground">
                  {new Date(entry.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <span className="text-foreground">
                  {formatNumber(entry.estimated_days)} crew-days
                </span>
                <span className="text-muted-foreground">
                  {entry.forecast_finish
                    ? formatDate(entry.forecast_finish)
                    : "—"}
                </span>
                {entry.confidence ? (
                  <StatusPill
                    tone={
                      CONFIDENCE_TONE[
                        entry.confidence as ComputedEstimate["confidence"]
                      ]
                    }
                  >
                    {entry.confidence}
                  </StatusPill>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
