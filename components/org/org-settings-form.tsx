"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOrgSettings } from "@/lib/org/actions";
import { cn } from "@/lib/utils";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export function OrgSettingsForm({
  initialName,
  initialAddress,
  initialWorkingDays,
}: {
  initialName: string;
  initialAddress: string;
  initialWorkingDays: number[];
}) {
  const [name, setName] = useState(initialName);
  const [address, setAddress] = useState(initialAddress);
  const [workingDays, setWorkingDays] = useState(new Set(initialWorkingDays));
  const [status, setStatus] = useState<"idle" | "saving" | "error" | "success">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  function toggleDay(day: number) {
    setWorkingDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage(null);
    try {
      await updateOrgSettings(name, address, [...workingDays]);
      setStatus("success");
      setMessage("Settings saved.");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-md flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="org_name">Organization name</Label>
        <Input
          id="org_name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="org_address">Address</Label>
        <Input
          id="org_address"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="123 Industrial Pkwy, Springfield"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Default working days</Label>
        <p className="text-xs text-muted-foreground">
          Used as the starting point when building a new project schedule.
        </p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day) => {
            const active = workingDays.has(day.value);
            return (
              <button
                key={day.value}
                type="button"
                onClick={() => toggleDay(day.value)}
                className={cn(
                  "h-9 min-w-11 rounded-md border px-2 text-sm font-medium transition-colors",
                  active
                    ? "border-brand bg-brand-subtle text-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                {day.label}
              </button>
            );
          })}
        </div>
      </div>

      <Button type="submit" disabled={status === "saving"}>
        {status === "saving" ? "Saving..." : "Save settings"}
      </Button>

      {message ? (
        <p
          role="status"
          className={
            status === "error"
              ? "text-sm text-destructive"
              : "text-sm text-success-fg"
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
