"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createShareToken, revokeShareToken } from "@/lib/portal/actions";
import type { Tables } from "@/lib/supabase/database.types";

type TokenStatus = "active" | "revoked" | "expired";

function tokenStatus(token: Tables<"share_tokens">): TokenStatus {
  if (token.revoked_at) return "revoked";
  if (token.expires_at && new Date(token.expires_at) < new Date()) return "expired";
  return "active";
}

const STATUS_CLASS: Record<TokenStatus, string> = {
  active: "bg-success/15 text-success-fg",
  revoked: "bg-destructive/15 text-destructive",
  expired: "bg-muted text-muted-foreground",
};

const EXPIRY_OPTIONS = [
  { label: "Never expires", days: null },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ShareLinkPanel({
  projectId,
  tokens,
}: {
  projectId: string;
  tokens: Tables<"share_tokens">[];
}) {
  const [expiryDays, setExpiryDays] = useState<string>("null");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleGenerate() {
    setError(null);
    const days = expiryDays === "null" ? null : Number(expiryDays);
    startTransition(async () => {
      try {
        await createShareToken(projectId, days);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create link.");
      }
    });
  }

  function handleRevoke(tokenId: string) {
    if (!window.confirm("Revoke this link? Anyone using it will immediately lose access.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await revokeShareToken(tokenId, projectId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not revoke link.");
      }
    });
  }

  function handleCopy(token: Tables<"share_tokens">) {
    const url = `${window.location.origin}/portal/${token.token}`;
    void navigator.clipboard.writeText(url);
    setCopiedId(token.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card shadow-e1 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Customer share links</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Link expiry"
            value={expiryDays}
            onChange={(event) => setExpiryDays(event.target.value)}
            disabled={isPending}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          >
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.label} value={option.days === null ? "null" : option.days}>
                {option.label}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={isPending} onClick={handleGenerate}>
            {isPending ? "Working..." : "+ Generate link"}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No share links yet — generate one to give this customer a read-only status
          page.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map((token) => {
            const status = tokenStatus(token);
            return (
              <li
                key={token.id}
                className="flex flex-wrap items-center gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0"
              >
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_CLASS[status]}`}
                >
                  {status}
                </span>
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                  /portal/{token.token}
                </code>
                <span className="text-xs text-muted-foreground">
                  {token.expires_at
                    ? `Expires ${formatDateTime(token.expires_at)}`
                    : "Never expires"}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => handleCopy(token)}
                >
                  {copiedId === token.id ? "Copied!" : "Copy link"}
                </Button>
                {status === "active" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => handleRevoke(token.id)}
                    className="text-destructive"
                  >
                    Revoke
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
