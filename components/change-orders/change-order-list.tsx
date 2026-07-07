"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createChangeOrder } from "@/lib/change-orders/actions";
import {
  CO_REASON_LABEL,
  CO_STATUS_BADGE_CLASS,
  CO_STATUS_LABEL,
  coLabel,
  type ChangeOrderRow,
} from "@/lib/change-orders/shared";
import type { ChangeOrderReason } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

const REASONS = Object.keys(CO_REASON_LABEL) as ChangeOrderReason[];

function NewChangeOrderForm({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState<ChangeOrderReason>("scope_missed");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        // Redirects to the new CO's detail page on success.
        await createChangeOrder(projectId, { title, reason, description });
      } catch (err) {
        // Next.js implements redirect() by throwing — let those through.
        const digest = (err as { digest?: string })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "Could not create change order.");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)}>
        + New change order
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="co-title" className="text-xs text-muted-foreground">
            Title
          </label>
          <Input
            id="co-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Add 2 rows along the east wall"
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="co-reason" className="text-xs text-muted-foreground">
            Reason
          </label>
          <select
            id="co-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as ChangeOrderReason)}
            disabled={isPending}
            className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {CO_REASON_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="co-description" className="text-xs text-muted-foreground">
          Description (the customer will see this)
        </label>
        <textarea
          id="co-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={isPending}
          className="rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" disabled={isPending || !title.trim()} onClick={submit}>
          {isPending ? "Creating…" : "Create change order"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function ChangeOrderList({
  projectId,
  changeOrders,
}: {
  projectId: string;
  changeOrders: ChangeOrderRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <NewChangeOrderForm projectId={projectId} />

      {changeOrders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          No change orders yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="change-order-list">
          {changeOrders.map((co) => (
            <li key={co.id}>
              <Link
                href={`/app/project/${projectId}/change-orders/${co.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3 hover:border-primary/50"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {coLabel(co.number)}
                  </span>
                  <span className="text-sm text-foreground">{co.title}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">
                    {CO_REASON_LABEL[co.reason]}
                  </span>
                  {co.price !== null ? (
                    <span className="tabular-nums text-foreground">
                      ${co.price.toLocaleString()}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 font-medium",
                      CO_STATUS_BADGE_CLASS[co.status]
                    )}
                  >
                    {CO_STATUS_LABEL[co.status]}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
