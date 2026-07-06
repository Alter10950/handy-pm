"use client";

import { Button } from "@/components/ui/button";

export function RowCommandPanel({
  selectedCount,
  isSingleSelection,
  isPending,
  onCopy,
  onDelete,
  onRenameToggle,
  onMaterialsToggle,
  onPhaseToggle,
  onReadinessToggle,
  onClearSelection,
}: {
  selectedCount: number;
  isSingleSelection: boolean;
  isPending: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onRenameToggle: () => void;
  onMaterialsToggle: () => void;
  onPhaseToggle: () => void;
  onReadinessToggle: () => void;
  onClearSelection: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
      <span className="px-1 text-sm font-medium text-foreground">
        {selectedCount} row{selectedCount === 1 ? "" : "s"} selected
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onCopy}
        >
          Copy
        </Button>
        {isSingleSelection ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={onRenameToggle}
          >
            Rename
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onMaterialsToggle}
        >
          Set materials
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onPhaseToggle}
        >
          Set phase
        </Button>
        {isSingleSelection ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={onReadinessToggle}
          >
            Readiness
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={onDelete}
          className="text-destructive"
        >
          Delete
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>
          Clear
        </Button>
      </div>
    </div>
  );
}
