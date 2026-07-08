"use client";

import { useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import { updateLaborStandard } from "@/lib/estimating/actions";
import type { Tables } from "@/lib/supabase/database.types";

export function LaborStandardsEditor({
  standards,
}: {
  standards: Tables<"labor_standards">[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
      <h2 className="mb-1 text-sm font-semibold text-foreground">
        Labor standards
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Standard hours to install one unit at a normal pace — 1 labor unit = 1
        hour at standard pace. Editing these reshapes every estimate that uses
        the company-wide or standard-pace fallback.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="pb-2">Task</th>
            <th className="pb-2">Unit basis</th>
            <th className="pb-2 text-right">Base labor units</th>
          </tr>
        </thead>
        <tbody>
          {standards.map((standard) => (
            <tr key={standard.id} className="border-t border-border">
              <td className="py-1.5 text-foreground">{standard.task_key}</td>
              <td className="py-1.5 text-muted-foreground">
                {standard.unit_basis}
              </td>
              <td className="py-1.5 text-right">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  defaultValue={standard.base_labor_units}
                  disabled={isPending}
                  onBlur={(event) => {
                    const value = Number(event.target.value);
                    if (
                      Number.isFinite(value) &&
                      value > 0 &&
                      value !== standard.base_labor_units
                    ) {
                      run(() =>
                        updateLaborStandard(standard.id, {
                          base_labor_units: value,
                        })
                      );
                    }
                  }}
                  className="h-8 w-24 text-right text-xs"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
