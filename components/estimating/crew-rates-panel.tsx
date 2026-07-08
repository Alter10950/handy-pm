"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { MIN_SAMPLES_FOR_CREW_RATE } from "@/lib/estimating/labor";
import { recomputeCrewRates } from "@/lib/estimating/actions";
import type { Tables } from "@/lib/supabase/database.types";

export function CrewRatesPanel({
  crews,
  rates,
}: {
  crews: Tables<"crews">[];
  rates: Tables<"crew_rates">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const ratesByCrew = new Map<string, Tables<"crew_rates">[]>();
  for (const rate of rates) {
    const list = ratesByCrew.get(rate.crew_id) ?? [];
    list.push(rate);
    ratesByCrew.set(rate.crew_id, list);
  }

  function handleRecompute() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await recomputeCrewRates();
        setMessage(
          result.crewsUpdated === 0
            ? "No qualifying install history found in the last 90 days."
            : `Updated ${result.crewsUpdated} crew(s) across ${result.taskKeysUpdated} task(s).`
        );
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Could not recompute.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Crew rates</h2>
          <p className="text-xs text-muted-foreground">
            Learned efficiency vs. standard pace (1.0 = standard), from the last
            90 days of install history. Needs {MIN_SAMPLES_FOR_CREW_RATE}+
            sampled days before a crew&apos;s own rate is trusted over the
            company blend.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={handleRecompute}
        >
          {isPending ? "Recomputing…" : "Recompute from install history"}
        </Button>
      </div>

      {message ? (
        <p className="mb-3 text-xs text-muted-foreground">{message}</p>
      ) : null}

      {crews.length === 0 ? (
        <p className="text-sm text-muted-foreground">No crews yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {crews.map((crew) => {
            const crewRates = ratesByCrew.get(crew.id) ?? [];
            return (
              <div
                key={crew.id}
                className="border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <p className="text-sm font-medium text-foreground">
                  {crew.name}
                </p>
                {crewRates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No learned rates yet — standard pace applies until enough
                    install history accumulates.
                  </p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-3">
                    {crewRates.map((rate) => (
                      <span
                        key={rate.task_key}
                        className="text-xs text-muted-foreground"
                      >
                        {rate.task_key}:{" "}
                        <span
                          className={
                            rate.samples >= MIN_SAMPLES_FOR_CREW_RATE
                              ? "font-medium text-foreground"
                              : "font-medium text-warning-fg"
                          }
                        >
                          {rate.units_per_hour?.toFixed(2) ?? "—"}×
                        </span>{" "}
                        ({rate.samples} day{rate.samples === 1 ? "" : "s"})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
