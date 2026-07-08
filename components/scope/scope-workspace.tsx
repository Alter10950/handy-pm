"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addScopeItem,
  logScopeItemProgress,
  removeScopeItem,
  updateScopeItem,
  type ScopeItemInput,
} from "@/lib/scope/actions";
import {
  scopeItemStatusLabel,
  WORK_TYPE_LABEL,
  WORK_TYPE_ORDER,
  type ScopeItemProgressRow,
} from "@/lib/scope/shared";
import { createClient } from "@/lib/supabase/client";
import type { ScopeWorkType } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

interface Phase {
  id: string;
  name: string;
  color: string;
}
interface RowOption {
  id: string;
  label: string;
}
interface LaborStandardEntry {
  baseLaborUnits: number;
  unitBasis: string;
}
type LaborStandardsMap = Record<string, LaborStandardEntry>;

// Mirrors lib/estimating/labor.ts#laborUnitsFor's own fallback (a
// work_type with no dedicated labor_standards row — "install"/"other"
// today — resolves through "general" instead of suggesting nothing).
function suggestedLaborUnits(
  laborStandards: LaborStandardsMap,
  workType: string,
  qty: number | null | undefined
): number | null {
  const standard = laborStandards[workType] ?? laborStandards.general;
  if (!standard) return null;
  return Math.round(standard.baseLaborUnits * (qty ?? 1) * 100) / 100;
}

// No success-foreground/destructive-foreground token exists in this
// theme (see app/globals.css) — translucent-bg + colored-text + colored
// border, same established pattern as every other status badge.
const STATUS_CLASS: Record<string, string> = {
  done: "bg-success/15 text-success-fg border-success/40",
  partial: "bg-brand-subtle text-foreground border-brand/40",
  not_started: "bg-muted text-muted-foreground border-border",
};

function emptyInput(): ScopeItemInput {
  return {
    workType: "teardown",
    description: "",
    qty: null,
    unit: null,
    laborUnits: null,
    rowId: null,
    phaseId: null,
  };
}

function ScopeItemForm({
  projectId,
  phases,
  rows,
  laborStandards,
  initial,
  onDone,
}: {
  projectId: string;
  phases: Phase[];
  rows: RowOption[];
  laborStandards: LaborStandardsMap;
  initial?: { id: string; input: ScopeItemInput };
  onDone: () => void;
}) {
  const [input, setInput] = useState<ScopeItemInput>(initial?.input ?? emptyInput());
  const [attachTo, setAttachTo] = useState<"none" | "row" | "phase">(
    initial?.input.rowId ? "row" : initial?.input.phaseId ? "phase" : "none"
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const suggested = suggestedLaborUnits(laborStandards, input.workType, input.qty);

  function handleSubmit() {
    if (!input.description.trim()) {
      setError("Description is required.");
      return;
    }
    setError(null);
    const payload: ScopeItemInput = {
      ...input,
      rowId: attachTo === "row" ? input.rowId : null,
      phaseId: attachTo === "phase" ? input.phaseId : null,
    };
    startTransition(async () => {
      try {
        if (initial) {
          await updateScopeItem(initial.id, projectId, payload);
        } else {
          await addScopeItem(projectId, payload);
        }
        router.refresh();
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Work type</label>
          <select
            value={input.workType}
            onChange={(e) =>
              setInput((v) => ({ ...v, workType: e.target.value as ScopeWorkType }))
            }
            disabled={isPending}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {WORK_TYPE_ORDER.map((wt) => (
              <option key={wt} value={wt}>
                {WORK_TYPE_LABEL[wt]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Attach to</label>
          <select
            value={attachTo}
            onChange={(e) => setAttachTo(e.target.value as typeof attachTo)}
            disabled={isPending}
            className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="none">Project-level</option>
            <option value="row">A row</option>
            <option value="phase">A phase</option>
          </select>
        </div>
      </div>

      {attachTo === "row" ? (
        <select
          value={input.rowId ?? ""}
          onChange={(e) => setInput((v) => ({ ...v, rowId: e.target.value || null }))}
          disabled={isPending}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Select a row…</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      ) : null}

      {attachTo === "phase" ? (
        <select
          value={input.phaseId ?? ""}
          onChange={(e) => setInput((v) => ({ ...v, phaseId: e.target.value || null }))}
          disabled={isPending}
          className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="">Select a phase…</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Description</label>
        <Input
          value={input.description}
          onChange={(e) => setInput((v) => ({ ...v, description: e.target.value }))}
          disabled={isPending}
          placeholder="e.g. Tear down existing 3-level run along north wall"
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Qty</label>
          <Input
            type="number"
            value={input.qty ?? ""}
            onChange={(e) =>
              setInput((v) => ({
                ...v,
                qty: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Unit</label>
          <Input
            value={input.unit ?? ""}
            onChange={(e) => setInput((v) => ({ ...v, unit: e.target.value || null }))}
            disabled={isPending}
            placeholder="bays, hrs…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Labor (hrs)</label>
          <Input
            type="number"
            step="0.1"
            value={input.laborUnits ?? ""}
            onChange={(e) =>
              setInput((v) => ({
                ...v,
                laborUnits: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
            disabled={isPending}
          />
          {suggested !== null && suggested !== input.laborUnits ? (
            <button
              type="button"
              onClick={() => setInput((v) => ({ ...v, laborUnits: suggested }))}
              className="text-left text-xs text-info-fg hover:underline"
            >
              Suggested: {suggested} hrs
            </button>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={isPending} onClick={handleSubmit}>
          {initial ? "Save" : "+ Add scope item"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ScopeItemRow({
  item,
  projectId,
  phases,
  rows,
  laborStandards,
  canManage,
}: {
  item: ScopeItemProgressRow;
  projectId: string;
  phases: Phase[];
  rows: RowOption[];
  laborStandards: LaborStandardsMap;
  canManage: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [loggingProgress, setLoggingProgress] = useState(false);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const rowLabel = item.row_id ? rows.find((r) => r.id === item.row_id)?.label : null;
  const phaseName = item.phase_id
    ? phases.find((p) => p.id === item.phase_id)?.name
    : null;

  function handleRemove() {
    if (!window.confirm(`Remove "${item.description}"?`)) return;
    startTransition(async () => {
      try {
        await removeScopeItem(item.scope_item_id!, projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove.");
      }
    });
  }

  async function submitProgress(status: "partial" | "done", photoPath: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await logScopeItemProgress(item.scope_item_id!, projectId, {
          status,
          note: note.trim() || null,
          photoPath,
        });
        setNote("");
        setLoggingProgress(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not log progress.");
      }
    });
  }

  async function handlePhotoSelected(file: File, status: "partial" | "done") {
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${projectId}/scope-items/${item.scope_item_id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("daily-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (uploadError) throw uploadError;
      await submitProgress(status, path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }

  if (editing) {
    return (
      <li className="border-t border-border pt-3 first:border-t-0 first:pt-0">
        <ScopeItemForm
          projectId={projectId}
          phases={phases}
          rows={rows}
          laborStandards={laborStandards}
          initial={{
            id: item.scope_item_id!,
            input: {
              workType: item.work_type!,
              description: item.description!,
              qty: item.qty,
              unit: item.unit,
              laborUnits: item.labor_units,
              rowId: item.row_id,
              phaseId: item.phase_id,
            },
          }}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li
      data-testid={`scope-item-${item.scope_item_id}`}
      className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {WORK_TYPE_LABEL[item.work_type!]}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-medium",
                STATUS_CLASS[item.status ?? "not_started"]
              )}
            >
              {scopeItemStatusLabel(item.status)}
            </span>
            {rowLabel ? (
              <span className="text-xs text-muted-foreground">{rowLabel}</span>
            ) : phaseName ? (
              <span className="text-xs text-muted-foreground">Phase: {phaseName}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-foreground">{item.description}</p>
          <p className="text-xs text-muted-foreground">
            {item.qty ? `${item.qty} ${item.unit ?? ""} — ` : ""}
            {item.labor_units ? `${item.labor_units} hrs` : "no labor estimate"}
          </p>
          {item.note ? (
            <p className="mt-1 text-xs text-muted-foreground">Note: {item.note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canManage ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={handleRemove}
                className="text-destructive"
                aria-label={`Remove ${item.description}`}
              >
                Remove
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {item.status !== "done" ? (
        loggingProgress ? (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
            <Input
              placeholder="Note (optional)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={isPending || uploading}
              className="h-8 text-xs"
            />
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handlePhotoSelected(file, "done");
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isPending || uploading}
                onClick={() => submitProgress("done", null)}
              >
                Mark done
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending || uploading}
                onClick={() => submitProgress("partial", null)}
              >
                Mark partial
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending || uploading}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? "Uploading…" : "Attach photo + done"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setLoggingProgress(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => setLoggingProgress(true)}
          >
            Log progress
          </Button>
        )
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </li>
  );
}

export function ScopeWorkspace({
  projectId,
  items,
  phases,
  rows,
  laborStandards,
  canManage,
}: {
  projectId: string;
  items: ScopeItemProgressRow[];
  phases: Phase[];
  rows: RowOption[];
  laborStandards: LaborStandardsMap;
  canManage: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-border bg-card shadow-e1 p-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No scope items yet — add teardown, level changes, relocation, or
            repair work here so it&apos;s estimated and tracked, not
            discovered on site.
          </p>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <ScopeItemRow
                key={item.scope_item_id}
                item={item}
                projectId={projectId}
                phases={phases}
                rows={rows}
                laborStandards={laborStandards}
                canManage={canManage}
              />
            ))}
          </ul>
        )}
      </div>

      {canManage ? (
        adding ? (
          <ScopeItemForm
            projectId={projectId}
            phases={phases}
            rows={rows}
            laborStandards={laborStandards}
            onDone={() => setAdding(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => setAdding(true)}
          >
            + Add scope item
          </Button>
        )
      ) : null}
    </div>
  );
}
