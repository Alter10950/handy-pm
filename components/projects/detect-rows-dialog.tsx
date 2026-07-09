"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusPill, type PillTone } from "@/components/ui/status-pill";
import { markExtractionRunResolved } from "@/lib/extraction/actions";
import { maxRowNumber } from "@/lib/rows/naming";
import { createRowsBatch } from "@/lib/rows/actions";
import { cn } from "@/lib/utils";

// Batch 5 Sub-phase B(1): "Detect rows" review. The vision model proposes
// row rectangles (normalized coords); this shows them as ghost boxes over
// the drawing for confirm/adjust-label/delete, then applies survivors as
// real rows. Never auto-applies — the applied rows are then fully editable
// with the normal marking tools.

interface Ghost {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number | null;
  include: boolean;
}

type Status = "idle" | "detecting" | "review" | "error";

function tone(c: number | null): PillTone {
  if (c === null) return "neutral";
  if (c >= 0.85) return "success";
  if (c >= 0.6) return "warning";
  return "danger";
}

export function DetectRowsDialog({
  projectId,
  drawingId,
  storagePath,
  drawingUrl,
  existingLabels,
}: {
  projectId: string;
  drawingId: string;
  storagePath: string;
  drawingUrl: string;
  existingLabels: string[];
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function detect() {
    setOpen(true);
    setStatus("detecting");
    setError(null);
    try {
      const response = await fetch("/api/drawings/detect-rows", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storagePath, projectId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Detection failed.");
      const detected = Array.isArray(data.rows) ? data.rows : [];
      // Auto-name un-labeled ghosts continuing the project's Row-N sequence.
      let next = maxRowNumber(existingLabels);
      setGhosts(
        detected.map((r: Record<string, unknown>, i: number) => {
          const rawLabel = typeof r.label === "string" ? r.label.trim() : "";
          const label = rawLabel || `Row ${++next}`;
          return {
            key: `ghost-${i}`,
            label,
            x: Number(r.x) || 0,
            y: Number(r.y) || 0,
            w: Number(r.w) || 0,
            h: Number(r.h) || 0,
            confidence:
              typeof r.confidence === "number" ? r.confidence : null,
            include: true,
          };
        })
      );
      setRunId(typeof data.runId === "string" ? data.runId : null);
      setStatus("review");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not read the drawing.");
    }
  }

  const included = useMemo(() => ghosts.filter((g) => g.include), [ghosts]);

  function apply() {
    setError(null);
    startTransition(async () => {
      try {
        await createRowsBatch(
          projectId,
          drawingId,
          included.map((g) => ({
            label: g.label,
            geometry: { x: g.x, y: g.y, w: g.w, h: g.h },
          }))
        );
        if (runId) await markExtractionRunResolved(runId, true);
        setOpen(false);
        setStatus("idle");
        setGhosts([]);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not create the rows."
        );
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="detect-rows-button"
        disabled={status === "detecting"}
        onClick={() => void detect()}
      >
        {status === "detecting" ? "Detecting…" : "✨ Detect rows"}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next: boolean) => {
          setOpen(next);
          if (!next) {
            if (status === "review" && runId)
              void markExtractionRunResolved(runId, false);
            setStatus("idle");
          }
        }}
      >
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Detect rows</DialogTitle>
            <DialogDescription>
              Review the rows the AI found on this drawing. Uncheck any that
              are wrong, rename as needed, then apply — applied rows are fully
              editable with the normal tools.
            </DialogDescription>
          </DialogHeader>

          {status === "detecting" ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Looking for racking rows…
            </p>
          ) : null}
          {status === "error" ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          {status === "review" ? (
            <div className="flex flex-col gap-3 lg:flex-row">
              {/* preview with ghost overlay */}
              <div className="relative w-full overflow-hidden rounded-md border border-border bg-surface-sunken lg:w-3/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={drawingUrl}
                  alt="Layout drawing"
                  className="block h-auto w-full"
                />
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  {ghosts.map((g) =>
                    g.include ? (
                      <g key={g.key}>
                        <rect
                          x={g.x * 100}
                          y={g.y * 100}
                          width={g.w * 100}
                          height={g.h * 100}
                          className="fill-brand/20 stroke-brand"
                          strokeWidth={0.4}
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    ) : null
                  )}
                </svg>
              </div>

              {/* ghost list */}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {ghosts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No rows detected. Draw them by hand, or try a clearer
                    drawing.
                  </p>
                ) : (
                  <div
                    data-testid="detect-rows-list"
                    className="flex max-h-[50vh] flex-col gap-1.5 overflow-auto"
                  >
                    {ghosts.map((g, index) => (
                      <div
                        key={g.key}
                        className={cn(
                          "flex items-center gap-2 rounded-md border border-border p-1.5",
                          !g.include && "opacity-50"
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Include ${g.label}`}
                          data-testid={`detect-include-${index}`}
                          checked={g.include}
                          onChange={(e) =>
                            setGhosts((cur) =>
                              cur.map((x, i) =>
                                i === index
                                  ? { ...x, include: e.target.checked }
                                  : x
                              )
                            )
                          }
                          className="size-4 shrink-0 rounded border-border"
                        />
                        <Input
                          value={g.label}
                          onChange={(e) =>
                            setGhosts((cur) =>
                              cur.map((x, i) =>
                                i === index
                                  ? { ...x, label: e.target.value }
                                  : x
                              )
                            )
                          }
                          className="h-8 min-w-0 flex-1 text-xs"
                        />
                        <StatusPill tone={tone(g.confidence)}>
                          {g.confidence === null
                            ? "—"
                            : `${Math.round(g.confidence * 100)}%`}
                        </StatusPill>
                      </div>
                    ))}
                  </div>
                )}
                {error ? (
                  <p className="text-sm text-destructive">{error}</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              size="lg"
              onClick={apply}
              disabled={isPending || status !== "review" || included.length === 0}
            >
              {isPending
                ? "Applying…"
                : `Apply ${included.length} row${included.length === 1 ? "" : "s"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
