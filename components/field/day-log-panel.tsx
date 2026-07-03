"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { closeDay, upsertDayLog, type DayLogFields } from "@/lib/field/actions";
import type { Tables } from "@/lib/supabase/database.types";

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
  onBack,
}: {
  projectId: string;
  crewId: string | null;
  dayLog: Tables<"day_logs"> | null;
  onBack: () => void;
}) {
  const [note, setNote] = useState(dayLog?.note ?? "");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function mark(field: keyof DayLogFields) {
    setPending(true);
    try {
      await upsertDayLog(projectId, crewId, { [field]: new Date().toISOString() });
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

  async function saveNote() {
    setPending(true);
    try {
      await upsertDayLog(projectId, crewId, { note });
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
    } finally {
      setPending(false);
    }
  }

  const closed = Boolean(dayLog?.departed_at);

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
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-3"
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

      <Textarea
        placeholder="Note for today (optional)"
        value={note}
        disabled={closed}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => void saveNote()}
      />

      {closed ? (
        <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          Day closed — departed at {formatTime(dayLog?.departed_at ?? null)}.
        </p>
      ) : (
        <Button
          type="button"
          disabled={pending}
          onClick={() => void handleCloseDay()}
        >
          Close the day
        </Button>
      )}
    </div>
  );
}
