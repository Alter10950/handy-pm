"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addGateItem,
  completeStage,
  overrideStage,
  signOffGateItem,
  toggleGateItem,
} from "@/lib/gates/actions";
import { STAGE_LABEL } from "@/lib/gates/shared";
import type { ProjectStageWithItems } from "@/lib/gates/shared";
import { createClient } from "@/lib/supabase/client";
import type { GateStageKey } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

// No `success-foreground`/`destructive-foreground` token exists in this
// theme (only `primary-foreground`/`muted-foreground`/etc. — see
// app/globals.css) — "complete"/"overridden" use the same translucent-bg
// + colored-text + colored-border pattern already established for badges
// elsewhere (row readiness dots, share-link status), not a solid fill.
const STAGE_STATUS_CLASS: Record<string, string> = {
  complete: "bg-success/15 text-success-fg border-success/40",
  overridden: "bg-brand-subtle text-foreground border-brand/40",
  active: "bg-brand-subtle text-foreground border-brand",
  locked: "bg-muted text-muted-foreground border-border",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function GateItemRow({
  item,
  projectId,
  canWrite,
  isPending,
  onError,
}: {
  item: ProjectStageWithItems["items"][number];
  projectId: string;
  canWrite: boolean;
  isPending: boolean;
  onError: (message: string) => void;
}) {
  const [isDone, setIsDone] = useState(item.done);
  const [dueDate, setDueDate] = useState(item.due_date ?? "");
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const isOverdue = Boolean(item.due_date && item.due_date < todayIso() && !item.done);

  function handleToggle() {
    const next = !isDone;
    setIsDone(next);
    toggleGateItem(item.id, projectId, { done: next })
      .then(() => router.refresh())
      .catch((err) => {
        setIsDone(!next);
        onError(err instanceof Error ? err.message : "Could not update item.");
      });
  }

  function handleDueDateChange(value: string) {
    setDueDate(value);
    toggleGateItem(item.id, projectId, { dueDate: value || null })
      .then(() => router.refresh())
      .catch((err) => onError(err instanceof Error ? err.message : "Could not set due date."));
  }

  function handleSignOff() {
    signOffGateItem(item.id, projectId)
      .then(() => {
        setIsDone(true);
        router.refresh();
      })
      .catch((err) => onError(err instanceof Error ? err.message : "Could not sign off."));
  }

  async function handlePhotoSelected(file: File) {
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${projectId}/gate-items/${item.id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("daily-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (uploadError) throw uploadError;
      await toggleGateItem(item.id, projectId, { photoPath: path });
      router.refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not attach photo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-border py-2 first:border-t-0">
      <input
        type="checkbox"
        checked={isDone}
        disabled={!canWrite || isPending}
        onChange={handleToggle}
        aria-label={item.label}
        className="size-4 rounded border-border"
      />
      <span className={cn("flex-1 text-sm text-foreground", isDone && "text-muted-foreground line-through")}>
        {item.label}
      </span>
      {isOverdue ? (
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
          Overdue
        </span>
      ) : null}
      {canWrite ? (
        <Input
          type="date"
          value={dueDate}
          onChange={(event) => handleDueDateChange(event.target.value)}
          disabled={isPending}
          className="h-7 w-36 text-xs"
        />
      ) : null}
      {item.requiresPhoto ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handlePhotoSelected(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canWrite || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {item.photo_path ? "Photo ✓" : uploading ? "Uploading…" : "Attach photo"}
          </Button>
        </>
      ) : null}
      {item.requiresSignoffRole && !isDone ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canWrite || isPending}
          onClick={handleSignOff}
        >
          Sign off ({item.requiresSignoffRole})
        </Button>
      ) : null}
    </li>
  );
}

function GateChecklist({
  stage,
  projectId,
  canWrite,
  canManage,
}: {
  stage: ProjectStageWithItems;
  projectId: string;
  canWrite: boolean;
  canManage: boolean;
}) {
  const [newItemLabel, setNewItemLabel] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [showOverride, setShowOverride] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const openCount = stage.items.filter((i) => !i.done).length;
  const isActive = stage.status === "active";

  function handleAddItem() {
    const label = newItemLabel.trim();
    if (!label) return;
    setError(null);
    startTransition(async () => {
      try {
        await addGateItem(stage.id, projectId, label);
        setNewItemLabel("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not add item.");
      }
    });
  }

  function handleComplete() {
    setError(null);
    startTransition(async () => {
      try {
        await completeStage(stage.id, projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not complete stage.");
      }
    });
  }

  function handleOverride() {
    if (!overrideReason.trim()) {
      setError("A reason is required to override this gate.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await overrideStage(stage.id, projectId, overrideReason);
        setShowOverride(false);
        setOverrideReason("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not override stage.");
      }
    });
  }

  return (
    <div
      data-testid="gate-checklist"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card shadow-e1 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">
          {STAGE_LABEL[stage.stage_key as GateStageKey]}
        </h3>
        {stage.status === "overridden" ? (
          <span className="text-xs text-muted-foreground">
            Overridden — {stage.override_reason}
          </span>
        ) : null}
      </div>

      {stage.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checklist items yet.</p>
      ) : (
        <ul className="flex flex-col">
          {stage.items.map((item) => (
            <GateItemRow
              key={item.id}
              item={item}
              projectId={projectId}
              canWrite={canWrite}
              isPending={isPending}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Input
            placeholder="Add a checklist item…"
            value={newItemLabel}
            onChange={(event) => setNewItemLabel(event.target.value)}
            disabled={isPending}
            className="h-8 flex-1 text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleAddItem}>
            + Add
          </Button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {canManage && isActive ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" disabled={isPending || openCount > 0} onClick={handleComplete}>
            Complete stage
          </Button>
          {openCount > 0 ? (
            showOverride ? (
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <Input
                  placeholder="Reason for override (required)"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  disabled={isPending}
                  className="h-8 flex-1 text-xs"
                />
                <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleOverride}>
                  Confirm override
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowOverride(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowOverride(true)}>
                Override ({openCount} open)
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LifecyclePanel({
  projectId,
  stages,
  canWrite,
  canManage,
}: {
  projectId: string;
  stages: ProjectStageWithItems[];
  canWrite: boolean;
  canManage: boolean;
}) {
  const activeStage = stages.find((s) => s.status === "active");
  const activeKey = (activeStage?.stage_key as GateStageKey | undefined) ?? null;
  const [expandedKey, setExpandedKey] = useState<GateStageKey | null>(activeKey);

  // Follow the active stage when it advances (someone just completed or
  // overrode the previously-active one) — the React-docs "previous prop
  // in state" pattern (setState called conditionally during render, not
  // in an effect — see row-stage.tsx/duplicate-range-dialog.tsx for the
  // same pattern elsewhere in this codebase). A PM manually browsing to a
  // different (non-active) stage is untouched by this — it only fires
  // when the active stage itself changes underneath them.
  const [priorActiveKey, setPriorActiveKey] = useState(activeKey);
  if (activeKey !== priorActiveKey) {
    setPriorActiveKey(activeKey);
    setExpandedKey(activeKey);
  }

  const expandedStage = stages.find((s) => s.stage_key === expandedKey);

  if (stages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
        Lifecycle tracking is being set up for this project — check back shortly.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5 overflow-x-auto rounded-lg border border-border bg-card shadow-e1 p-2">
        {stages.map((stage) => (
          <button
            key={stage.id}
            type="button"
            onClick={() => setExpandedKey(stage.stage_key as GateStageKey)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium capitalize",
              STAGE_STATUS_CLASS[stage.status],
              expandedKey === stage.stage_key && "ring-2 ring-ring ring-offset-1 ring-offset-background"
            )}
          >
            {STAGE_LABEL[stage.stage_key as GateStageKey]}
          </button>
        ))}
      </div>

      {expandedStage ? (
        <GateChecklist
          stage={expandedStage}
          projectId={projectId}
          canWrite={canWrite}
          canManage={canManage}
        />
      ) : null}
    </div>
  );
}
