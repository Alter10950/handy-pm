"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approveChangeOrderViaToken,
  declineChangeOrderViaToken,
} from "@/lib/change-orders/public-actions";

// The customer's approve/decline controls on the public token page. Kept
// deliberately simple: one name field (approval needs a name on record),
// one optional note (decline), two buttons.
//
// Deliberately NO router.refresh() after a decision: deciding nulls the
// token (single-use, ADR-043), so a server re-render of this page would
// resolve to the invalid-link shell and unmount the thank-you card the
// customer is reading. The local `decided` state IS the terminal UI; a
// manual reload later correctly lands on "already decided."
export function ChangeOrderDecision({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [declineNote, setDeclineNote] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<"approved" | "declined" | null>(null);
  const [isPending, startTransition] = useTransition();

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveChangeOrderViaToken(token, name);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setDecided("approved");
    });
  }

  function decline() {
    setError(null);
    startTransition(async () => {
      const result = await declineChangeOrderViaToken(token, declineNote);
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setDecided("declined");
    });
  }

  if (decided === "approved") {
    return (
      <div
        data-testid="co-decision-done"
        className="rounded-lg border border-success/50 bg-success/10 p-6 text-center"
      >
        <p className="text-lg font-semibold text-success">Approved — thank you!</p>
        <p className="mt-1 text-sm text-foreground">
          The team has been notified and will proceed with the change.
        </p>
      </div>
    );
  }
  if (decided === "declined") {
    return (
      <div
        data-testid="co-decision-done"
        className="rounded-lg border border-border bg-card p-6 text-center"
      >
        <p className="text-lg font-semibold text-foreground">Declined.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your project manager will follow up with you.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-sm font-semibold text-foreground">Your decision</p>
      {!showDecline ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="approver-name" className="text-xs text-muted-foreground">
              Your name
            </label>
            <Input
              id="approver-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              disabled={isPending}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isPending || !name.trim()}
              onClick={approve}
            >
              {isPending ? "Working…" : "Approve this change"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setShowDecline(true)}
            >
              Decline…
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="decline-note" className="text-xs text-muted-foreground">
              Anything you&apos;d like us to know? (optional)
            </label>
            <textarea
              id="decline-note"
              value={declineNote}
              onChange={(e) => setDeclineNote(e.target.value)}
              rows={2}
              disabled={isPending}
              className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={decline}
            >
              {isPending ? "Working…" : "Decline this change"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={isPending}
              onClick={() => setShowDecline(false)}
            >
              Back
            </Button>
          </div>
        </div>
      )}
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
