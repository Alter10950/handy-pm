"use client";

import {
  CheckIcon,
  Columns3Icon,
  DownloadIcon,
  Rows2Icon,
  Rows4Icon,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { useGridPrefs } from "@/lib/filters/grid-prefs";
import { cn } from "@/lib/utils";

// Grid display controls (design pass v3 F2): column chooser + density
// toggle (persisted via useGridPrefs) and a CSV export button — rendered
// in a FilterBar's right-edge slot.

export interface GridColumn {
  key: string;
  label: string;
}

export function ColumnChooser({
  columns,
  grid,
  testId,
}: {
  columns: GridColumn[];
  grid: ReturnType<typeof useGridPrefs>;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-testid={testId}
        aria-label="Choose columns"
        className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
      >
        <Columns3Icon aria-hidden className="size-4" />
        <span className="hidden sm:inline">Columns</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5">
        <div className="flex flex-col gap-0.5">
          {columns.map((column) => {
            const on = !grid.isHidden(column.key);
            return (
              <button
                key={column.key}
                type="button"
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => grid.toggleColumn(column.key)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
              >
                <span
                  className={cn(
                    "grid size-4 place-items-center rounded border",
                    on
                      ? "border-brand bg-brand text-primary-foreground"
                      : "border-border-strong bg-surface"
                  )}
                >
                  {on ? <CheckIcon className="size-3" /> : null}
                </span>
                {column.label}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DensityToggle({
  grid,
}: {
  grid: ReturnType<typeof useGridPrefs>;
}) {
  const compact = grid.prefs.density === "compact";
  return (
    <button
      type="button"
      aria-label={compact ? "Comfortable rows" : "Compact rows"}
      aria-pressed={compact}
      title={compact ? "Comfortable rows" : "Compact rows"}
      onClick={() => grid.setDensity(compact ? "comfortable" : "compact")}
      className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
    >
      {compact ? (
        <Rows2Icon aria-hidden className="size-4" />
      ) : (
        <Rows4Icon aria-hidden className="size-4" />
      )}
    </button>
  );
}

export function ExportCsvButton({
  onExport,
  label = "Export CSV",
  testId,
}: {
  onExport: () => void;
  label?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onExport}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-sm font-medium text-muted-foreground shadow-e1 transition-colors hover:text-foreground"
    >
      <DownloadIcon aria-hidden className="size-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
