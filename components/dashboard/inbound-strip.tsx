"use client";

import { MessageSquareIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setInboundStatus } from "@/lib/inbound/actions";
import type { InboundMessageRow } from "@/lib/inbound/queries";

// Batch 5 Sub-phase C(3): office triage of inbound SMS/WhatsApp. Messages
// arrive as drafts and are NEVER applied automatically — an office user
// reads and either handles (takes the info into the field log by hand) or
// dismisses. Hidden entirely until Twilio is connected.
export function InboundStrip({
  messages,
  available,
  configured,
}: {
  messages: InboundMessageRow[];
  available: boolean;
  configured: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  // Nothing to show and Twilio isn't set up → don't clutter the dashboard.
  if (!available || (!configured && messages.length === 0)) return null;

  function act(id: string, status: "applied" | "rejected") {
    startTransition(async () => {
      try {
        await setInboundStatus(id, status);
        toast.success(status === "applied" ? "Marked handled." : "Dismissed.");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not update.");
      }
    });
  }

  return (
    <div
      data-testid="inbound-strip"
      className="rounded-lg border border-border bg-card p-4 shadow-e1"
    >
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <MessageSquareIcon aria-hidden className="size-4 text-muted-foreground" />
        Field messages ({messages.length})
      </h2>

      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unread field texts. Crews can text the project line; messages land
          here as drafts for you to confirm.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {messages.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-surface px-3 py-2"
            >
              <span className="mt-0.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                {m.channel}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                  {m.body || <em className="text-muted-foreground">(media only)</em>}
                </p>
                <p className="num text-[11px] text-muted-foreground">
                  {m.fromNumber.replace("whatsapp:", "")}
                  {m.status === "unmatched" ? " · no project matched" : ""}
                  {m.media.length > 0 ? ` · ${m.media.length} attachment${m.media.length === 1 ? "" : "s"}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(m.id, "applied")}
                  className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground shadow-e1 hover:bg-muted disabled:opacity-50"
                >
                  Handled
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => act(m.id, "rejected")}
                  className="rounded-md px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
