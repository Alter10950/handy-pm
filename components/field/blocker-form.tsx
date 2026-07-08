"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createBlocker } from "@/lib/field/actions";
import { createClient } from "@/lib/supabase/client";
import type { BlockerCode } from "@/lib/supabase/database.types";

const CODE_LABELS: Record<BlockerCode, string> = {
  MISSING_MATERIAL: "Missing material",
  WRONG_MATERIAL: "Wrong material",
  CUSTOMER_DELAY: "Customer delay",
  AREA_BLOCKED: "Area blocked",
  FLOOR_ISSUE: "Floor issue",
  DRAWING_ISSUE: "Drawing issue",
  CREW_SHORT: "Crew short",
  EQUIPMENT_ISSUE: "Equipment issue",
  WEATHER_TRUCK: "Weather / truck",
  OTHER: "Other",
};

export function BlockerForm({
  projectId,
  rowId,
  rowLabel,
  crewId,
  initialCode = null,
  initialNote = "",
  onClose,
}: {
  projectId: string;
  rowId: string | null;
  rowLabel: string | null;
  crewId: string | null;
  initialCode?: BlockerCode | null;
  initialNote?: string;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState<BlockerCode | null>(initialCode);
  const [note, setNote] = useState(initialNote);
  const [photo, setPhoto] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit() {
    if (!code) return;
    setStatus("saving");
    setError(null);
    try {
      let photoPath: string | null = null;
      if (photo) {
        const supabase = createClient();
        const date = new Date().toISOString().slice(0, 10);
        const path = `${projectId}/${date}/${crewId ?? "no-crew"}/${Date.now()}-${photo.name}`;
        const { error: uploadError } = await supabase.storage
          .from("daily-photos")
          .upload(path, photo);
        if (uploadError) throw uploadError;
        photoPath = path;
      }
      await createBlocker(projectId, rowId, crewId, code, note, photoPath);
      router.refresh();
      onClose();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not save.");
    }
  }

  // z-50: overlays sit above ALL nav chrome (AppShell bars are z-30),
  // matching the Dialog/Sheet convention.
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60">
      <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto rounded-t-xl border-t border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">
            Report a blocker{rowLabel ? ` — ${rowLabel}` : ""}
          </h2>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {(Object.entries(CODE_LABELS) as [BlockerCode, string][]).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setCode(value)}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  code === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground"
                }`}
              >
                {label}
              </button>
            )
          )}
        </div>

        <Textarea
          placeholder="Note (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          {photo ? `Photo: ${photo.name}` : "Add a photo"}
        </Button>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button
          type="button"
          disabled={!code || status === "saving"}
          onClick={() => void handleSubmit()}
        >
          {status === "saving" ? "Saving…" : "Submit blocker"}
        </Button>
      </div>
    </div>
  );
}
