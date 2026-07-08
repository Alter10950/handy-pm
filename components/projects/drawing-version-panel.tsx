"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { renderFileToPages } from "@/lib/pdf/render-drawing-file";
import { approveDrawingVersion, uploadDrawingVersion } from "@/lib/drawings/actions";
import { createClient } from "@/lib/supabase/client";

export interface DrawingVersionSummary {
  id: string;
  version: number;
  approvedForInstall: boolean;
  createdAt: string;
  supersededAt: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Self-contained, like ReceivingPanel: manages its own upload/approve
// mutations and router.refresh(), rather than threading through
// RowMarkingWorkspace's undo stack — version history is an audit trail,
// not an undo-able edit (same posture as material_receipts/
// project_estimates). See docs/DECISIONS.md ADR-034.
export function DrawingVersionPanel({
  projectId,
  drawingId,
  pageIndex,
  history,
}: {
  projectId: string;
  drawingId: string;
  pageIndex: number;
  history: DrawingVersionSummary[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const latest = history[0] ?? null;

  async function handleFile(file: File) {
    setError(null);
    startTransition(async () => {
      try {
        const pages = await renderFileToPages(file);
        const page = pages[0];
        if (!page) throw new Error("Could not read that file.");

        const supabase = createClient();
        const path = `${projectId}/${Date.now()}-page${pageIndex}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("drawings")
          .upload(path, page.blob, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;

        await uploadDrawingVersion(
          projectId,
          drawingId,
          pageIndex,
          path,
          page.width,
          page.height
        );
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not upload that version."
        );
      }
    });
  }

  function handleApprove() {
    if (!latest) return;
    setError(null);
    startTransition(async () => {
      try {
        await approveDrawingVersion(latest.id, projectId, pageIndex);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not approve.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card shadow-e1 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          data-testid="drawing-version-badge"
          className="text-xs font-medium text-foreground"
        >
          v{latest?.version ?? 1}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            latest?.approvedForInstall
              ? "bg-success/15 text-success-fg"
              : "bg-destructive/15 text-destructive"
          }`}
        >
          {latest?.approvedForInstall ? "Approved for install" : "Pending approval"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            data-testid="drawing-version-upload-input"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? "Working..." : "Upload new version"}
          </Button>
          {latest && !latest.approvedForInstall ? (
            <Button
              type="button"
              size="sm"
              disabled={isPending}
              onClick={handleApprove}
            >
              Approve for install
            </Button>
          ) : null}
        </div>
      </div>

      {latest && !latest.approvedForInstall ? (
        <p className="text-xs font-medium text-destructive">
          This drawing was updated on {formatDate(latest.createdAt)} and hasn&apos;t
          been approved for install yet — check with your PM before marking or
          installing off of it.
        </p>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {history.length > 0 ? (
        <details data-testid={`drawing-history-${drawingId}`}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            Version history ({history.length})
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {history.map((entry) => (
              <li key={entry.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">v{entry.version}</span>{" "}
                — {formatDate(entry.createdAt)}
                {entry.approvedForInstall ? " · approved" : ""}
                {entry.supersededAt ? " · superseded" : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
