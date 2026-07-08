"use client";

import { CheckCircle2Icon, CircleIcon, PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-meter";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";
import { createPunchItem, setPunchItemStatus } from "@/lib/punch/actions";
import { setRowQcCheck } from "@/lib/qc/actions";
import { QC_CHECKS, qcRowStatus } from "@/lib/qc/shared";
import type { RowQcState } from "@/lib/qc/queries";
import type { Tables } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// QC + punch (Phase 14, ADR-052): the office view of "is each row
// actually DONE-done." Feature-guarded: until the Phase 14 migration is
// approved the panel renders a pending note instead of controls.

interface RowRef {
  id: string;
  label: string;
}

export function QcPunchPanel({
  projectId,
  rows,
  qcAvailable,
  qcByRow,
  punchAvailable,
  punchItems,
  canWrite,
}: {
  projectId: string;
  rows: RowRef[];
  qcAvailable: boolean;
  qcByRow: Record<string, RowQcState>;
  punchAvailable: boolean;
  punchItems: Tables<"punch_items">[];
  canWrite: boolean;
}) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [punchOpen, setPunchOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [rowId, setRowId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const totalChecks = QC_CHECKS.length;
  const passedRows = rows.filter(
    (row) => qcRowStatus(qcByRow[row.id]?.passedCount ?? 0) === "passed"
  ).length;
  const openPunch = punchItems.filter((item) => item.status === "open");

  if (!qcAvailable && !punchAvailable) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-5 text-sm text-muted-foreground shadow-e1">
        <p className="font-medium text-foreground">QC checklists & punch list</p>
        <p className="mt-1">
          Built and ready — they turn on when the Phase 14 database migration
          is applied (see docs/BUILD-LOG.md “NEEDS ME”).
        </p>
      </div>
    );
  }

  function toggleCheck(row: RowRef, checkKey: string, next: boolean) {
    startTransition(async () => {
      try {
        await setRowQcCheck(projectId, row.id, checkKey, next);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't save QC check.");
      }
    });
  }

  function submitPunch() {
    startTransition(async () => {
      try {
        await createPunchItem(projectId, {
          title,
          detail,
          rowId: rowId || null,
        });
        toast.success("Punch item added");
        setPunchOpen(false);
        setTitle("");
        setDetail("");
        setRowId("");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't add punch item.");
      }
    });
  }

  function togglePunch(item: Tables<"punch_items">) {
    startTransition(async () => {
      try {
        await setPunchItemStatus(
          projectId,
          item.id,
          item.status === "open" ? "done" : "open"
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't update punch item.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="qc-punch-panel">
      {qcAvailable ? (
        <div className="rounded-lg border border-border bg-card p-5 shadow-e1">
          <SectionHeader
            title="Row QC"
            description={`${passedRows} of ${rows.length} rows fully passed (${totalChecks} checks each).`}
          />
          <ProgressBar
            pct={rows.length > 0 ? (passedRows / rows.length) * 100 : 0}
            className="mt-3"
          />
          <div className="mt-4 flex flex-col gap-1.5">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Mark rows on the Layout tab first.
              </p>
            ) : (
              rows.map((row) => {
                const state = qcByRow[row.id];
                const passedCount = state?.passedCount ?? 0;
                const status = qcRowStatus(passedCount);
                const expanded = expandedRow === row.id;
                return (
                  <div
                    key={row.id}
                    className="rounded-lg border border-border-subtle bg-surface"
                  >
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setExpandedRow(expanded ? null : row.id)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm font-medium text-foreground">
                        {row.label}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="num text-xs text-muted-foreground">
                          {passedCount}/{totalChecks}
                        </span>
                        <StatusPill
                          tone={
                            status === "passed"
                              ? "success"
                              : status === "in_progress"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {status === "passed"
                            ? "Passed"
                            : status === "in_progress"
                              ? "In progress"
                              : "Not started"}
                        </StatusPill>
                      </span>
                    </button>
                    {expanded ? (
                      <div className="flex flex-col gap-1 border-t border-border-subtle p-2">
                        {QC_CHECKS.map((check) => {
                          const passed = state?.passed[check.key] ?? false;
                          return (
                            <button
                              key={check.key}
                              type="button"
                              disabled={!canWrite || isPending}
                              onClick={() => toggleCheck(row, check.key, !passed)}
                              className={cn(
                                "flex items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
                                canWrite ? "hover:bg-accent" : "cursor-default"
                              )}
                            >
                              {passed ? (
                                <CheckCircle2Icon
                                  aria-hidden
                                  className="mt-0.5 size-4.5 shrink-0 text-success-fg"
                                />
                              ) : (
                                <CircleIcon
                                  aria-hidden
                                  className="mt-0.5 size-4.5 shrink-0 text-border-strong"
                                />
                              )}
                              <span>
                                <span
                                  className={cn(
                                    "block text-sm",
                                    passed
                                      ? "text-muted-foreground line-through"
                                      : "text-foreground"
                                  )}
                                >
                                  {check.label}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {check.hint}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}

      {punchAvailable ? (
        <div className="rounded-lg border border-border bg-card p-5 shadow-e1">
          <SectionHeader
            title="Punch list"
            description={
              openPunch.length === 0
                ? "Nothing open — clear to close out."
                : `${openPunch.length} open item${openPunch.length === 1 ? "" : "s"} blocking closeout.`
            }
            actions={
              canWrite ? (
                <Dialog open={punchOpen} onOpenChange={setPunchOpen}>
                  <DialogTrigger render={<Button variant="outline" size="sm" />}>
                    <PlusIcon aria-hidden data-icon="inline-start" /> Add item
                  </DialogTrigger>
                  <DialogContent className="max-w-md">
                    <DialogHeader>
                      <DialogTitle>New punch item</DialogTitle>
                    </DialogHeader>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="punch-title">What's wrong?</Label>
                        <Input
                          id="punch-title"
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          placeholder="e.g. Row 12 — end barrier scratched"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="punch-detail">Detail (optional)</Label>
                        <Textarea
                          id="punch-detail"
                          value={detail}
                          onChange={(e) => setDetail(e.target.value)}
                          rows={3}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="punch-row">Row (optional)</Label>
                        <select
                          id="punch-row"
                          value={rowId}
                          onChange={(e) => setRowId(e.target.value)}
                          className="h-9 rounded-lg border border-border bg-surface px-2 text-sm text-foreground"
                        >
                          <option value="">Site-wide / not row-specific</option>
                          {rows.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        onClick={submitPunch}
                        loading={isPending}
                        disabled={!title.trim()}
                      >
                        Add punch item
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : undefined
            }
          />
          <div className="mt-3 flex flex-col gap-1.5">
            {punchItems.length === 0 ? (
              <EmptyState
                title="No punch items"
                description="Deficiencies found during QC or the customer walkthrough land here."
              />
            ) : (
              punchItems.map((item) => {
                const rowLabel = item.row_id
                  ? rows.find((row) => row.id === item.row_id)?.label
                  : null;
                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p
                        className={cn(
                          "text-sm font-medium",
                          item.status === "done"
                            ? "text-muted-foreground line-through"
                            : "text-foreground"
                        )}
                      >
                        {item.title}
                        {rowLabel ? (
                          <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                            {rowLabel}
                          </span>
                        ) : null}
                      </p>
                      {item.detail ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                    {canWrite ? (
                      <Button
                        variant={item.status === "open" ? "outline" : "ghost"}
                        size="sm"
                        disabled={isPending}
                        onClick={() => togglePunch(item)}
                      >
                        {item.status === "open" ? "Mark done" : "Reopen"}
                      </Button>
                    ) : (
                      <StatusPill tone={item.status === "open" ? "warning" : "success"}>
                        {item.status === "open" ? "Open" : "Done"}
                      </StatusPill>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
