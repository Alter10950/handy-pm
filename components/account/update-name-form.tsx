"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOwnName } from "@/lib/account/actions";

type Status = "idle" | "loading" | "error" | "success";

export function UpdateNameForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
    try {
      await updateOwnName(name);
      setStatus("success");
      setMessage("Name updated.");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Could not save.");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="full_name">Display name</Label>
        <Input
          id="full_name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Jane Smith"
        />
      </div>

      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Saving..." : "Save name"}
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
