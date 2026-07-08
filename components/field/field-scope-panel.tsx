"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { logScopeItemProgress } from "@/lib/scope/actions";
import {
  scopeItemStatusLabel,
  WORK_TYPE_LABEL,
  type ScopeItemProgressRow,
} from "@/lib/scope/shared";
import { createClient } from "@/lib/supabase/client";

function FieldScopeItemCard({
  item,
  projectId,
}: {
  item: ScopeItemProgressRow;
  projectId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // No local "just logged" override — matches
  // components/scope/scope-workspace.tsx's office-side ScopeItemRow
  // exactly, which relies purely on item.status (a fresh prop once
  // router.refresh() lands) rather than shadowing it with client state.
  function submit(status: "partial" | "done", photoPath: string | null) {
    setError(null);
    startTransition(async () => {
      try {
        await logScopeItemProgress(item.scope_item_id!, projectId, {
          status,
          note: note.trim() || null,
          photoPath,
        });
        setNote("");
        setExpanded(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not log progress."
        );
      }
    });
  }

  async function handlePhoto(file: File) {
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${projectId}/scope-items/${item.scope_item_id}-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("daily-photos")
        .upload(path, file, { contentType: file.type || "image/jpeg" });
      if (uploadError) throw uploadError;
      submit("done", path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }

  const currentStatus = item.status;

  return (
    <div
      data-testid={`scope-item-${item.scope_item_id}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {WORK_TYPE_LABEL[item.work_type!]}
          </span>
          <p className="mt-1 text-sm font-medium text-foreground">
            {item.description}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {scopeItemStatusLabel(currentStatus)}
        </span>
      </div>

      {currentStatus !== "done" ? (
        expanded ? (
          <div className="flex flex-col gap-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)…"
              disabled={isPending || uploading}
              className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground"
            />
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handlePhoto(file);
              }}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isPending || uploading}
                onClick={() => submit("done", null)}
              >
                Mark done
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending || uploading}
                onClick={() => submit("partial", null)}
              >
                Mark partial
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Photo + mark done"}
            </Button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-xs text-muted-foreground"
            >
              Cancel
            </button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => setExpanded(true)}
          >
            Log progress
          </Button>
        )
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function FieldScopePanel({
  projectId,
  items,
}: {
  projectId: string;
  items: ScopeItemProgressRow[];
}) {
  if (items.length === 0) {
    return (
      <p className="p-3 text-center text-sm text-muted-foreground">
        No scope-of-work items on this project.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {items.map((item) => (
        <FieldScopeItemCard
          key={item.scope_item_id}
          item={item}
          projectId={projectId}
        />
      ))}
    </div>
  );
}
