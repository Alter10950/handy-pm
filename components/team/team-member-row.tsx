"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  resetTeamMemberPassword,
  updateTeamMemberRole,
} from "@/lib/team/actions";
import { generateTempPassword } from "@/lib/team/generate-password";
import type { TeamMember } from "@/lib/team/queries";
import type { ProfileRole } from "@/lib/supabase/database.types";

export function TeamMemberRow({
  member,
  isSelf,
}: {
  member: TeamMember;
  isSelf: boolean;
}) {
  const [role, setRole] = useState<ProfileRole>(member.role);
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleRoleChange(nextRole: string) {
    const previous = role;
    setRole(nextRole as ProfileRole);
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("member_id", member.id);
        formData.set("role", nextRole);
        await updateTeamMemberRole(formData);
        router.refresh();
      } catch (err) {
        setRole(previous);
        setError(err instanceof Error ? err.message : "Could not save.");
      }
    });
  }

  function handleResetOpen() {
    setPassword(generateTempPassword());
    setResetOpen(true);
    setError(null);
  }

  function handleResetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("member_id", member.id);
        formData.set("password", password);
        await resetTeamMemberPassword(formData);
        setResetOpen(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not reset password."
        );
      }
    });
  }

  return (
    <div
      data-testid={`team-member-row-${member.email}`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">
            {member.fullName || member.email}
          </p>
          {member.fullName ? (
            <p className="text-sm text-muted-foreground">{member.email}</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label={`Role for ${member.email}`}
            value={role}
            disabled={isSelf || isPending}
            onChange={(event) => handleRoleChange(event.target.value)}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="owner">Owner</option>
            <option value="pm">PM</option>
            <option value="scheduler">Scheduler</option>
            <option value="crew">Crew</option>
          </select>

          {!resetOpen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetOpen}
            >
              Reset password
            </Button>
          ) : null}
        </div>
      </div>

      {isSelf ? (
        <p className="text-xs text-muted-foreground">
          That&apos;s you — change your own role from another owner/PM account.
        </p>
      ) : null}

      {resetOpen ? (
        <form
          onSubmit={handleResetSubmit}
          className="flex flex-wrap items-end gap-3 border-t border-border pt-3"
        >
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <label
              htmlFor={`reset-password-${member.id}`}
              className="text-xs font-medium text-foreground"
            >
              New temporary password
            </label>
            <Input
              id={`reset-password-${member.id}`}
              type="text"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button type="submit" size="default" disabled={isPending}>
            {isPending ? "Saving..." : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => setResetOpen(false)}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
