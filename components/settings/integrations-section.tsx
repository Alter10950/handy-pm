"use client";

import { toast } from "sonner";

import type { IntegrationStatus } from "@/lib/integrations/queries";

// Batch 5 Sub-phases F/G: the Settings → Integrations panel. Built to the
// Connect button; the OAuth handshake needs the org's app credentials
// (QBO_CLIENT_ID / ZOHO_CLIENT_ID) which land on NEEDS-YOU. Until they're
// present, Connect explains exactly what's missing — nothing is a dead
// button, and every downstream feature works without the connection
// (manual quote entry for QuickBooks, manual project creation for Zoho).

const META: Record<
  IntegrationStatus["provider"],
  { name: string; blurb: string; env: string }
> = {
  quickbooks: {
    name: "QuickBooks Online",
    blurb:
      "Sync the contract quote and roll job cost into a per-project margin. Manual quote entry works without it.",
    env: "QBO_CLIENT_ID / QBO_CLIENT_SECRET",
  },
  zoho: {
    name: "Zoho CRM",
    blurb:
      "Turn a won deal into a pre-filled project and push stage/% back to the deal. Manual project creation works without it.",
    env: "ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET",
  },
};

export function IntegrationsSection({
  statuses,
}: {
  statuses: IntegrationStatus[];
}) {
  function connect(status: IntegrationStatus) {
    if (!status.credentialsPresent) {
      toast.error(
        `${META[status.provider].name} needs its app credentials set on the server (${META[status.provider].env}) before you can connect.`
      );
      return;
    }
    // Credentials present → begin the OAuth redirect. The route returns the
    // provider consent URL; the callback stores tokens server-side.
    window.location.assign(`/api/integrations/${status.provider}/connect`);
  }

  return (
    <div className="flex flex-col gap-3">
      {statuses.map((status) => {
        const meta = META[status.provider];
        return (
          <div
            key={status.provider}
            data-testid={`integration-${status.provider}`}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4 shadow-e1"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium text-foreground">
                {meta.name}
                {status.connected ? (
                  <span className="rounded-full bg-success/20 px-2 py-0.5 text-xs font-medium text-success-fg">
                    Connected
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {meta.blurb}
              </p>
              {!status.credentialsPresent ? (
                <p className="mt-1 text-xs text-warning-fg">
                  Needs {meta.env} on the server (NEEDS-YOU).
                </p>
              ) : null}
            </div>
            <button
              type="button"
              data-testid={`integration-connect-${status.provider}`}
              onClick={() => connect(status)}
              className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-muted"
            >
              {status.connected ? "Reconnect" : "Connect"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
