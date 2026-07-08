"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { BlockerForm } from "@/components/field/blocker-form";
import { DayLogPanel } from "@/components/field/day-log-panel";
import { FieldScopePanel } from "@/components/field/field-scope-panel";
import { MaterialStepper } from "@/components/field/material-stepper";
import { useCrewSelection } from "@/components/field/use-crew-selection";
import { useInstallLogger } from "@/components/field/use-install-logger";
import { Button } from "@/components/ui/button";
import type { TodayInstall } from "@/lib/field/queries";
import type { ScopeItemProgressRow } from "@/lib/scope/shared";
import type { BlockerCode, Tables, Views } from "@/lib/supabase/database.types";

type View = "rows" | "row" | "day" | "scope";

export function FieldWorkspace({
  project,
  rows,
  materials,
  rowMaterials,
  installedTotals,
  todayInstalls,
  phases,
  crews,
  dayLogs,
  todayBlockers,
  myCrewId,
  dayLogPhotoUrls,
  scopeItems,
  clearedForInstall,
}: {
  project: Tables<"projects">;
  rows: Views<"row_progress">[];
  materials: Tables<"materials">[];
  rowMaterials: Tables<"row_materials">[];
  installedTotals: Record<string, number>;
  todayInstalls: TodayInstall[];
  phases: Tables<"phases">[];
  crews: Tables<"crews">[];
  dayLogs: Tables<"day_logs">[];
  todayBlockers: Tables<"blockers">[];
  myCrewId: string | null;
  dayLogPhotoUrls: Record<string, string>;
  scopeItems: ScopeItemProgressRow[];
  clearedForInstall: boolean;
}) {
  const [crewId, setCrewId] = useCrewSelection(myCrewId);
  const { logDelta, pendingCount } = useInstallLogger(project.id, crewId);
  const [view, setView] = useState<View>("rows");
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [blockerContext, setBlockerContext] = useState<{
    rowId: string | null;
    rowLabel: string | null;
    initialNote?: string;
    initialCode?: BlockerCode | null;
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

  // My crew's net installs today, per (row, material) — the material
  // stepper's "today" figure and the day-close summary both read from
  // this same reduction rather than each filtering todayInstalls on
  // their own.
  const myTodayByRowMaterial = useMemo(() => {
    const totals = new Map<string, number>();
    for (const install of todayInstalls) {
      if (install.crewId !== crewId) continue;
      const key = `${install.rowId}:${install.materialId}`;
      totals.set(key, (totals.get(key) ?? 0) + install.qty);
    }
    return totals;
  }, [todayInstalls, crewId]);

  const myDayLog =
    dayLogs.find((log) => log.crew_id === crewId) ?? null;
  const myTodayBlockers = useMemo(
    () => todayBlockers.filter((b) => b.crew_id === crewId),
    [todayBlockers, crewId]
  );
  const selectedRow = rows.find((row) => row.row_id === selectedRowId) ?? null;

  // Today's net qty per (row, material), resolved to display names — the
  // day-close summary's review list.
  const todaySummary = useMemo(() => {
    const items: {
      rowLabel: string;
      materialName: string;
      unit: string;
      netQty: number;
    }[] = [];
    for (const [key, netQty] of myTodayByRowMaterial) {
      if (netQty === 0) continue;
      const [rowId, materialId] = key.split(":");
      const row = rows.find((r) => r.row_id === rowId);
      const material = materialsById.get(materialId);
      if (!row || !material) continue;
      items.push({
        rowLabel: row.label,
        materialName: material.name,
        unit: material.unit,
        netQty,
      });
    }
    return items;
  }, [myTodayByRowMaterial, rows, materialsById]);

  // "No verified material, no crew dispatch" — the crew-facing half of
  // the Mobilize hard lock (ADR-042). The whole working UI (install
  // steppers, day close, blockers, scope) is withheld, not just warned
  // over: the entire point of the gate is that nobody starts installing
  // out of an unverified BOM.
  if (!clearedForInstall) {
    return (
      <div className="flex min-h-screen flex-col pb-8">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background p-3">
          <Link href="/field" className="text-sm text-muted-foreground">
            ← Projects
          </Link>
          <span className="truncate font-medium text-foreground">
            {project.name}
          </span>
          <span aria-hidden className="w-10 shrink-0" />
        </div>
        <div className="flex flex-1 items-center justify-center p-6">
          <div
            data-testid="not-cleared-panel"
            className="max-w-sm rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center"
          >
            <p className="text-lg font-semibold text-destructive">
              Not cleared for install
            </p>
            <p className="mt-2 text-sm text-foreground">
              Materials for this job haven&apos;t been verified yet. The
              office completes the Materials gate (or an owner/PM overrides
              it with a reason) before crew work starts here — that&apos;s
              what keeps a shortage from being discovered mid-install at the
              customer&apos;s site.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col pb-8">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-background p-3">
        <Link href="/field" className="text-sm text-muted-foreground">
          ← Projects
        </Link>
        <span className="truncate font-medium text-foreground">
          {project.name}
        </span>
        {view === "rows" || view === "row" ? (
          // Reachable from a specific row's own detail screen too, not
          // just the rows list — restores the pre-existing shortcut of
          // jumping straight to Day (or now Scope) without detouring
          // back through "Rows" first. view === "row" additionally has
          // its own "← Rows" back button in the body.
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setView("scope")}
              className="text-sm font-medium text-info-fg"
            >
              Scope
            </button>
            <button
              type="button"
              onClick={() => setView("day")}
              className="text-sm font-medium text-info-fg"
            >
              Day
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setView("rows")}
            className="shrink-0 text-sm font-medium text-info-fg"
          >
            Rows
          </button>
        )}
      </div>

      {pendingCount > 0 ? (
        <div className="bg-brand-subtle px-3 py-1.5 text-center text-xs font-medium text-foreground">
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
                className="flex items-center gap-3 rounded-lg border border-border bg-card shadow-e1 p-3 text-left active:bg-accent"
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
          {myTodayBlockers.length > 0 ? (
            <p className="text-center text-xs text-muted-foreground">
              {myTodayBlockers.length} blocker
              {myTodayBlockers.length === 1 ? "" : "s"} logged today
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
            const key = `${selectedRow.row_id}:${rm.material_id}`;
            const installed = installedTotals[key] ?? 0;
            const installedToday = myTodayByRowMaterial.get(key) ?? 0;
            return (
              <MaterialStepper
                key={rm.material_id}
                rowId={selectedRow.row_id}
                rowLabel={selectedRow.label}
                material={material}
                required={rm.required_qty}
                installed={installed}
                installedToday={installedToday}
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

      {view === "scope" ? (
        <FieldScopePanel projectId={project.id} items={scopeItems} />
      ) : null}

      {view === "day" ? (
        <DayLogPanel
          projectId={project.id}
          crewId={crewId}
          dayLog={myDayLog}
          photoUrls={dayLogPhotoUrls}
          todaySummary={todaySummary}
          todayBlockerCount={myTodayBlockers.length}
          onBack={() => setView("rows")}
          onReportBlocker={(initialNote, initialCode) =>
            setBlockerContext({
              rowId: null,
              rowLabel: null,
              initialNote,
              initialCode,
            })
          }
        />
      ) : null}

      {blockerContext ? (
        <BlockerForm
          projectId={project.id}
          rowId={blockerContext.rowId}
          rowLabel={blockerContext.rowLabel}
          initialNote={blockerContext.initialNote}
          initialCode={blockerContext.initialCode}
          crewId={crewId}
          onClose={() => setBlockerContext(null)}
        />
      ) : null}
    </div>
  );
}
