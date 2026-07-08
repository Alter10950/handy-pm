"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { VoiceNoteDraft } from "@/components/field/voice-note-recorder";
import { VoiceNoteRecorder } from "@/components/field/voice-note-recorder";
import {
  addDayLogPhoto,
  closeDay,
  removeDayLogPhoto,
  upsertDayLog,
  type DayLogFields,
} from "@/lib/field/actions";
import { createClient } from "@/lib/supabase/client";
import type { BlockerCode, Tables } from "@/lib/supabase/database.types";

const STEPS: { field: keyof DayLogFields; label: string }[] = [
  { field: "arrivedAt", label: "Arrived" },
  { field: "offloadStart", label: "Offload start" },
  { field: "offloadEnd", label: "Offload end" },
  { field: "installStart", label: "Install start" },
  { field: "installEnd", label: "Install end" },
];

const FIELD_TO_COLUMN: Record<keyof DayLogFields, keyof Tables<"day_logs">> = {
  arrivedAt: "arrived_at",
  offloadStart: "offload_start",
  offloadEnd: "offload_end",
  installStart: "install_start",
  installEnd: "install_end",
  departedAt: "departed_at",
  note: "note",
};

function formatTime(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function DayLogPanel({
  projectId,
  crewId,
  dayLog,
  photoUrls,
  todaySummary,
  todayBlockerCount,
  onBack,
  onReportBlocker,
}: {
  projectId: string;
  crewId: string | null;
  dayLog: Tables<"day_logs"> | null;
  photoUrls: Record<string, string>;
  todaySummary: {
    rowLabel: string;
    materialName: string;
    unit: string;
    netQty: number;
  }[];
  todayBlockerCount: number;
  onBack: () => void;
  onReportBlocker: (
    initialNote: string,
    initialCode: BlockerCode | null
  ) => void;
}) {
  const [note, setNote] = useState(dayLog?.note ?? "");
  const [pending, setPending] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceNoteDraft | null>(null);
  const [reviewingClose, setReviewingClose] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const photoPaths = dayLog?.photo_paths ?? [];

  async function mark(field: keyof DayLogFields) {
    setPending(true);
    try {
      await upsertDayLog(projectId, crewId, {
        [field]: new Date().toISOString(),
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function clear(field: keyof DayLogFields) {
    setPending(true);
    try {
      await upsertDayLog(projectId, crewId, { [field]: null });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function saveNote(value: string) {
    setPending(true);
    try {
      await upsertDayLog(projectId, crewId, { note: value });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleCloseDay() {
    setPending(true);
    try {
      await closeDay(projectId, crewId);
      router.refresh();
      setReviewingClose(false);
    } finally {
      setPending(false);
    }
  }

  async function handleAddPhoto(file: File) {
    setPending(true);
    setPhotoError(null);
    try {
      const supabase = createClient();
      const date = new Date().toISOString().slice(0, 10);
      const path = `${projectId}/${date}/${crewId ?? "no-crew"}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("daily-photos")
        .upload(path, file);
      if (uploadError) throw uploadError;
      await addDayLogPhoto(projectId, crewId, path);
      router.refresh();
    } catch (err) {
      setPhotoError(
        err instanceof Error ? err.message : "Could not upload that photo."
      );
    } finally {
      setPending(false);
    }
  }

  async function handleRemovePhoto(path: string) {
    if (!dayLog) return;
    setPending(true);
    try {
      await removeDayLogPhoto(dayLog.id, projectId, path);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  function acceptVoiceNote() {
    if (!voiceDraft) return;
    setNote(voiceDraft.cleanedNote);
    void saveNote(voiceDraft.cleanedNote);
    setVoiceDraft(null);
  }

  function reportVoiceNoteAsBlocker() {
    if (!voiceDraft) return;
    onReportBlocker(voiceDraft.cleanedNote, voiceDraft.blockerCode);
    setVoiceDraft(null);
  }

  const closed = Boolean(dayLog?.departed_at);

  if (reviewingClose) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <button
          type="button"
          onClick={() => setReviewingClose(false)}
          className="self-start text-sm text-muted-foreground"
        >
          ← Back to edit
        </button>
        <h2 className="font-semibold text-foreground">
          Review today &amp; close
        </h2>

        <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Times
          </h3>
          <div className="flex flex-col gap-1 text-sm">
            {STEPS.map(({ field, label }) => {
              const column = FIELD_TO_COLUMN[field];
              const formatted = formatTime(
                dayLog ? (dayLog[column] as string | null) : null
              );
              return (
                <div key={field} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground">{formatted ?? "—"}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Installed today
          </h3>
          {todaySummary.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing logged today.
            </p>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              {todaySummary.map((item) => (
                <div
                  key={`${item.rowLabel}:${item.materialName}`}
                  className="flex justify-between gap-2"
                >
                  <span className="text-foreground">
                    {item.rowLabel} — {item.materialName}
                  </span>
                  <span
                    className={
                      item.netQty > 0 ? "text-success-fg" : "text-destructive"
                    }
                  >
                    {item.netQty > 0 ? "+" : ""}
                    {item.netQty} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Blockers
          </h3>
          <p className="text-sm text-foreground">
            {todayBlockerCount === 0
              ? "None reported today."
              : `${todayBlockerCount} reported today.`}
          </p>
        </div>

        {note ? (
          <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Note
            </h3>
            <p className="text-sm text-foreground">{note}</p>
          </div>
        ) : null}

        {photoPaths.length > 0 ? (
          <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Photos
            </h3>
            <div className="flex flex-wrap gap-2">
              {photoPaths.map((path) =>
                photoUrls[path] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, signed Storage URLs; not worth configuring next/image's remote allowlist for.
                  <img
                    key={path}
                    src={photoUrls[path]}
                    alt="End-of-day"
                    className="size-16 rounded-md border border-border object-cover"
                  />
                ) : null
              )}
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          disabled={pending}
          onClick={() => void handleCloseDay()}
        >
          {pending ? "Closing..." : "Confirm & close day"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm text-muted-foreground"
      >
        ← Back
      </button>
      <h2 className="font-semibold text-foreground">Today</h2>

      <div className="flex flex-col gap-2">
        {STEPS.map(({ field, label }) => {
          const column = FIELD_TO_COLUMN[field];
          const value = dayLog ? (dayLog[column] as string | null) : null;
          const formatted = formatTime(value);
          return (
            <div
              key={field}
              data-testid={`day-log-row-${field}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card shadow-e1 p-3"
            >
              <span className="text-foreground">{label}</span>
              {formatted ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {formatted}
                  </span>
                  <button
                    type="button"
                    disabled={pending || closed}
                    onClick={() => void clear(field)}
                    className="text-xs text-muted-foreground underline disabled:opacity-50"
                  >
                    Reset
                  </button>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending || closed}
                  onClick={() => void mark(field)}
                >
                  Mark now
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {todaySummary.length > 0 ? (
        <div className="rounded-lg border border-border bg-card shadow-e1 p-3">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Installed today
          </h3>
          <div className="flex flex-col gap-1 text-sm">
            {todaySummary.map((item) => (
              <div
                key={`${item.rowLabel}:${item.materialName}`}
                className="flex justify-between gap-2"
              >
                <span className="text-foreground">
                  {item.rowLabel} — {item.materialName}
                </span>
                <span
                  className={
                    item.netQty > 0 ? "text-success-fg" : "text-destructive"
                  }
                >
                  {item.netQty > 0 ? "+" : ""}
                  {item.netQty} {item.unit}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Spotted a mistake? Fix it from the row&apos;s material stepper
            (Correct −N) before closing the day.
          </p>
        </div>
      ) : null}

      <Textarea
        placeholder="Note for today (optional)"
        value={note}
        disabled={closed}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => void saveNote(note)}
      />

      <div className="flex flex-col gap-2">
        {photoPaths.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {photoPaths.map((path) =>
              photoUrls[path] ? (
                <div key={path} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, signed Storage URLs; not worth configuring next/image's remote allowlist for. */}
                  <img
                    src={photoUrls[path]}
                    alt="End-of-day"
                    className="size-16 rounded-md border border-border object-cover"
                  />
                  {!closed ? (
                    <button
                      type="button"
                      aria-label="Remove photo"
                      disabled={pending}
                      onClick={() => void handleRemovePhoto(path)}
                      className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ) : null
            )}
          </div>
        ) : null}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleAddPhoto(file);
          }}
        />
        {!closed ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => photoInputRef.current?.click()}
          >
            📷 Add end-of-day photo
          </Button>
        ) : null}
        {photoError ? (
          <p className="text-xs text-destructive">{photoError}</p>
        ) : null}
      </div>

      {!closed ? <VoiceNoteRecorder onDraft={setVoiceDraft} /> : null}

      {voiceDraft ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary bg-primary/10 p-3">
          <p className="text-sm text-foreground">
            &ldquo;{voiceDraft.cleanedNote}&rdquo;
          </p>
          {voiceDraft.isBlocker ? (
            <p className="text-xs text-info-fg">
              This sounds like it might be a blocker
              {voiceDraft.blockerCode ? ` (${voiceDraft.blockerCode})` : ""}.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={acceptVoiceNote}>
              Use as today&apos;s note
            </Button>
            {voiceDraft.isBlocker ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={reportVoiceNoteAsBlocker}
              >
                Report as blocker instead
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setVoiceDraft(null)}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}

      {closed ? (
        <p className="rounded-lg border border-border bg-card shadow-e1 p-3 text-sm text-muted-foreground">
          Day closed — departed at {formatTime(dayLog?.departed_at ?? null)}.
        </p>
      ) : (
        <Button
          type="button"
          disabled={pending}
          onClick={() => setReviewingClose(true)}
        >
          Close the day
        </Button>
      )}
    </div>
  );
}
