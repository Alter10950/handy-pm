"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { BlockerForm } from "@/components/field/blocker-form";
import { DayLogPanel } from "@/components/field/day-log-panel";
import { MaterialStepper } from "@/components/field/material-stepper";
import { useCrewSelection } from "@/components/field/use-crew-selection";
import { useInstallLogger } from "@/components/field/use-install-logger";
import { Button } from "@/components/ui/button";
import type { Tables, Views } from "@/lib/supabase/database.types";

type View = "rows" | "row" | "day";

export function FieldWorkspace({
  project,
  rows,
  materials,
  rowMaterials,
  installedTotals,
  phases,
  crews,
  dayLogs,
  todayBlockers,
}: {
  project: Tables<"projects">;
  rows: Views<"row_progress">[];
  materials: Tables<"materials">[];
  rowMaterials: Tables<"row_materials">[];
  installedTotals: Record<string, number>;
  phases: Tables<"phases">[];
  crews: Tables<"crews">[];
  dayLogs: Tables<"day_logs">[];
  todayBlockers: Tables<"blockers">[];
}) {
  const [crewId, setCrewId] = useCrewSelection();
  const { logDelta, pendingCount } = useInstallLogger(project.id, crewId);
  const [view, setView] = useState<View>("rows");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [blockerContext, setBlockerContext] = useState<{
    rowId: string | null;
    rowLabel: string | null;
  } | null>(null);

  const materialsById = useMemo(
    () => new Map(materials.map((material) => [material.id, material])),
    [materials]
  );
  const phasesById = useMemo(
    () => new Map(phases.map((phase) => [phase.id, phase])),
    [phases]
  );
  const rowMaterialsByRow = useMemo(() => {
    const map = new Map<string, Tables<"row_materials">[]>();
    for (const rm of rowMaterials) {
      const list = map.get(rm.row_id) ?? [];
      list.push(rm);
      map.set(rm.row_id, list);
    }
    return map;
  }, [rowMaterials]);

  const myDayLog =
    dayLogs.find((log) => log.crew_id === crewId) ?? null;
  const selectedRow = rows.find((row) => row.row_id === selectedRowId) ?? null;

  return (
    <div className="flex min-h-screen flex-col pb-8">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background p-3">
        <Link href="/field" className="text-sm text-muted-foreground">
          ← Projects
        </Link>
        <span className="truncate font-medium text-foreground">
          {project.name}
        </span>
        <button
          type="button"
          onClick={() => setView(view === "day" ? "rows" : "day")}
          className="text-sm font-medium text-primary"
        >
          {view === "day" ? "Rows" : "Day"}
        </button>
      </div>

      {pendingCount > 0 ? (
        <div className="bg-primary/20 px-3 py-1.5 text-center text-xs font-medium text-primary">
          {pendingCount} update{pendingCount === 1 ? "" : "s"} pending sync…
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-b border-border p-3">
        <label className="text-sm text-muted-foreground" htmlFor="crew-select">
          Logging as
        </label>
        <select
          id="crew-select"
          value={crewId ?? ""}
          onChange={(event) => setCrewId(event.target.value || null)}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          <option value="">No crew selected</option>
          {crews.map((crew) => (
            <option key={crew.id} value={crew.id}>
              {crew.name}
            </option>
          ))}
        </select>
      </div>

      {view === "rows" ? (
        <div className="flex flex-col gap-2 p-3">
          {rows.map((row) => {
            const phase = row.phase_id ? phasesById.get(row.phase_id) : null;
            const pctInt = Math.round(row.pct * 100);
            return (
              <button
                key={row.row_id}
                type="button"
                onClick={() => {
                  setSelectedRowId(row.row_id);
                  setView("row");
                }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left active:bg-accent"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: phase?.color ?? "#3a3a3a" }}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {row.label}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {row.has_materials ? `${pctInt}%` : "No materials"}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
                    <div
                      className={
                        row.is_complete
                          ? "h-full bg-success"
                          : "h-full bg-primary"
                      }
                      style={{ width: `${pctInt}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() => setBlockerContext({ rowId: null, rowLabel: null })}
          >
            Report a blocker
          </Button>
          {todayBlockers.length > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              {todayBlockers.length} blocker
              {todayBlockers.length === 1 ? "" : "s"} logged today
            </p>
          ) : null}
        </div>
      ) : null}

      {view === "row" && selectedRow ? (
        <div className="flex flex-col gap-3 p-3">
          <button
            type="button"
            onClick={() => setView("rows")}
            className="self-start text-sm text-muted-foreground"
          >
            ← Rows
          </button>
          <h2 className="font-semibold text-foreground">
            {selectedRow.label}
          </h2>
          {(rowMaterialsByRow.get(selectedRow.row_id) ?? []).map((rm) => {
            const material = materialsById.get(rm.material_id);
            if (!material) return null;
            const installed =
              installedTotals[`${selectedRow.row_id}:${rm.material_id}`] ?? 0;
            return (
              <MaterialStepper
                key={rm.material_id}
                rowId={selectedRow.row_id}
                rowLabel={selectedRow.label}
                material={material}
                required={rm.required_qty}
                installed={installed}
                onLog={logDelta}
              />
            );
          })}
          {(rowMaterialsByRow.get(selectedRow.row_id) ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground">
              No materials assigned to this row yet.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setBlockerContext({
                rowId: selectedRow.row_id,
                rowLabel: selectedRow.label,
              })
            }
          >
            Report a blocker for this row
          </Button>
        </div>
      ) : null}

      {view === "day" ? (
        <DayLogPanel
          projectId={project.id}
          crewId={crewId}
          dayLog={myDayLog}
          onBack={() => setView("rows")}
        />
      ) : null}

      {blockerContext ? (
        <BlockerForm
          projectId={project.id}
          rowId={blockerContext.rowId}
          rowLabel={blockerContext.rowLabel}
          crewId={crewId}
          onClose={() => setBlockerContext(null)}
        />
      ) : null}
    </div>
  );
}
