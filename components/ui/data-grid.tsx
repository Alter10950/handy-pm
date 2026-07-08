"use client";

import { useMemo, useState } from "react";

import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

// DataGrid (Phase 11) — the premium-spreadsheet primitive that powers
// Materials, Receiving, and Estimate. Sticky header + sticky first
// column, sortable columns, hairline separators (no zebra), right-aligned
// tabular numerics, column groups, column show/hide, a comfortable/
// compact density toggle (via the --grid-pad-* tokens), and cell render
// slots so screens can drop inline-edit inputs straight into cells.
//
// Deliberately a LIGHT abstraction: typed column configs + your row
// array. No virtualization (project BOMs are hundreds of rows, not
// millions) and no internal state beyond sort/density/visibility.

export interface DataGridColumn<Row> {
  key: string;
  header: React.ReactNode;
  /** Column-group label — adjacent columns with the same group share a spanning header row. */
  group?: string;
  align?: "left" | "right" | "center";
  /** Right-aligned tabular numerics shorthand (sets align right + .num). */
  numeric?: boolean;
  /** px width hint; the first column also gets sticky positioning. */
  width?: number;
  /** Sort accessor — omit to make the column unsortable. */
  sortValue?: (row: Row) => string | number | null;
  cell: (row: Row) => React.ReactNode;
  /** Hide from the column-visibility menu (always shown). */
  alwaysVisible?: boolean;
}

export function DataGrid<Row>({
  columns,
  rows,
  rowKey,
  stickyFirstColumn = true,
  defaultSort,
  emptyState,
  toolbar,
  showDensityToggle = true,
  showColumnToggle = true,
  onRowClick,
  rowClassName,
  maxHeightClassName = "max-h-[70vh]",
  testId,
}: {
  columns: DataGridColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  stickyFirstColumn?: boolean;
  defaultSort?: { key: string; direction: "asc" | "desc" };
  emptyState?: React.ReactNode;
  /** Extra controls rendered in the grid's toolbar row (left side). */
  toolbar?: React.ReactNode;
  showDensityToggle?: boolean;
  showColumnToggle?: boolean;
  onRowClick?: (row: Row) => void;
  rowClassName?: (row: Row) => string | undefined;
  maxHeightClassName?: string;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(
    defaultSort ?? null
  );
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);

  const visibleColumns = columns.filter((c) => !hidden.has(c.key));

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;
    const accessor = column.sortValue;
    return [...rows].sort((a, b) => {
      const va = accessor(a);
      const vb = accessor(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  function toggleSort(key: string) {
    const column = columns.find((c) => c.key === key);
    if (!column?.sortValue) return;
    setSort((current) =>
      current?.key === key
        ? current.direction === "asc"
          ? { key, direction: "desc" }
          : null
        : { key, direction: "asc" }
    );
  }

  // Column-group header row (only when any column declares a group).
  const hasGroups = visibleColumns.some((c) => c.group);
  const groupSpans: { label: string | null; span: number }[] = [];
  if (hasGroups) {
    for (const column of visibleColumns) {
      const label = column.group ?? null;
      const last = groupSpans[groupSpans.length - 1];
      if (last && last.label === label) last.span += 1;
      else groupSpans.push({ label, span: 1 });
    }
  }

  const alignClass = (c: DataGridColumn<Row>) =>
    c.numeric || c.align === "right"
      ? "text-right"
      : c.align === "center"
        ? "text-center"
        : "text-left";

  if (rows.length === 0 && emptyState) {
    return <div data-testid={testId}>{emptyState}</div>;
  }

  return (
    <div data-testid={testId} data-density={density} className="flex flex-col gap-2">
      {(toolbar || showDensityToggle || showColumnToggle) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">{toolbar}</div>
          <div className="flex items-center gap-2">
            {showColumnToggle ? (
              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={columnMenuOpen}
                  onClick={() => setColumnMenuOpen((open) => !open)}
                  className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-e1 hover:text-foreground"
                >
                  Columns
                </button>
                {columnMenuOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      aria-hidden
                      onClick={() => setColumnMenuOpen(false)}
                    />
                    <div className="absolute right-0 z-20 mt-1 flex w-48 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1.5 shadow-e3">
                      {columns
                        .filter((c) => !c.alwaysVisible)
                        .map((c) => (
                          <label
                            key={c.key}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-accent"
                          >
                            <input
                              type="checkbox"
                              checked={!hidden.has(c.key)}
                              onChange={() =>
                                setHidden((current) => {
                                  const next = new Set(current);
                                  if (next.has(c.key)) next.delete(c.key);
                                  else next.add(c.key);
                                  return next;
                                })
                              }
                              className="size-3.5 rounded border-border"
                            />
                            <span className="truncate">{c.header}</span>
                          </label>
                        ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {showDensityToggle ? (
              <Segmented
                ariaLabel="Row density"
                size="sm"
                value={density}
                onChange={setDensity}
                options={[
                  { value: "comfortable", label: "Cozy" },
                  { value: "compact", label: "Compact" },
                ]}
              />
            ) : null}
          </div>
        </div>
      )}

      <div
        className={cn(
          "overflow-auto rounded-lg border border-border bg-surface shadow-e1",
          maxHeightClassName
        )}
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            {hasGroups ? (
              <tr>
                {groupSpans.map((group, i) => (
                  <th
                    key={i}
                    colSpan={group.span}
                    className={cn(
                      "sticky top-0 z-20 border-b border-border bg-surface-sunken px-[var(--grid-pad-x)] pb-1 pt-2 text-left",
                      i === 0 && stickyFirstColumn ? "left-0 z-30" : ""
                    )}
                  >
                    {group.label ? (
                      <span className="type-overline text-muted-foreground">
                        {group.label}
                      </span>
                    ) : null}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr>
              {visibleColumns.map((column, i) => {
                const sortable = Boolean(column.sortValue);
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    style={column.width ? { minWidth: column.width } : undefined}
                    className={cn(
                      "sticky z-20 border-b border-border bg-surface-sunken px-[var(--grid-pad-x)] py-2 text-xs font-semibold text-muted-foreground",
                      hasGroups ? "top-[29px]" : "top-0",
                      alignClass(column),
                      i === 0 && stickyFirstColumn ? "left-0 z-30" : ""
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-foreground",
                          active ? "text-foreground" : ""
                        )}
                      >
                        {column.header}
                        <span aria-hidden className="text-[9px]">
                          {active ? (sort!.direction === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "group/row",
                  onRowClick ? "cursor-pointer" : "",
                  rowClassName?.(row)
                )}
              >
                {visibleColumns.map((column, i) => (
                  <td
                    key={column.key}
                    className={cn(
                      "border-b border-border-subtle bg-surface px-[var(--grid-pad-x)] py-[var(--grid-pad-y)] text-foreground transition-colors group-hover/row:bg-accent/50",
                      alignClass(column),
                      column.numeric ? "num" : "",
                      i === 0 && stickyFirstColumn
                        ? "sticky left-0 z-10 font-medium"
                        : ""
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
