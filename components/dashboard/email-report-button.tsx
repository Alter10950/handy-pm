"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { sendReportNow } from "@/lib/reports/actions";
import type { ReportPeriod } from "@/lib/reports/data";

export function EmailReportButton({ period }: { period: ReportPeriod }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleClick() {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await sendReportNow(period);
        if (!result.configured) {
          setMessage("RESEND_API_KEY is not configured on the server.");
        } else if (result.recipientCount === 0) {
          setMessage("No owner/pm recipients found.");
        } else if (result.projectsAttempted === 0) {
          setMessage("No active projects to report on.");
        } else if (result.projectsSent === 0) {
          // Every attempt failed — most likely Resend's sandbox mode
          // (unverified domain) rejecting a "to" address that isn't the
          // account owner's own — surface the real reason, not a
          // misleading "nothing to report."
          setMessage(
            `Could not send: ${result.errors[0] ?? "all sends failed."}`
          );
        } else {
          setMessage(
            `Sent ${period} report for ${result.projectsSent} project(s) to ${result.recipientCount} recipient(s).${
              result.errors.length > 0 ? ` ${result.errors.length} failed.` : ""
            }`
          );
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Could not send.");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={handleClick}
      >
        {isPending ? "Sending…" : `Email ${period} report now`}
      </Button>
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
    </div>
  );
}
