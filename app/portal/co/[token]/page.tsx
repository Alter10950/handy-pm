import type { Metadata } from "next";

import { ChangeOrderDecision } from "@/components/change-orders/change-order-decision";
import { resolveChangeOrderToken } from "@/lib/change-orders/public";
import { CO_STATUS_LABEL, coLabel } from "@/lib/change-orders/shared";

export const metadata: Metadata = {
  title: "Change order approval — Handy PM",
};

export const dynamic = "force-dynamic";

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center bg-background px-4 py-16">
      <div className="w-full max-w-2xl">
        <p className="mb-8 text-xl font-bold tracking-tight text-foreground">
          Handy<span className="text-primary">PM</span>
        </p>
        {children}
      </div>
    </main>
  );
}

// The customer's approve/decline page — reached only from the emailed,
// single-purpose token link. Same no-session trust model as the read-only
// portal (ADR-035), extended to exactly two writes on exactly one row
// (ADR-043).
export default async function ChangeOrderApprovalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const co = await resolveChangeOrderToken(token);

  if (!co) {
    return (
      <PortalShell>
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            This link is no longer valid
          </h1>
          <p className="mt-2 text-muted-foreground">
            This change order may already be decided, or the link was
            replaced. Please contact your project manager.
          </p>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            {co.orgName} — {co.projectName}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {coLabel(co.number)}: {co.title}
          </h1>
          {co.description ? (
            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
              {co.description}
            </p>
          ) : null}

          {co.items.length > 0 ? (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                What this change covers
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {co.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground"
                  >
                    <span>
                      {item.kind === "scope" && item.work_type
                        ? `${item.work_type.replace("_", " ")}: `
                        : ""}
                      {item.description}
                    </span>
                    {item.qty !== null ? (
                      <span className="text-muted-foreground">
                        {item.qty} {item.unit ?? ""}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {co.addedDays !== null && co.addedDays > 0 ? (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Schedule impact
                </p>
                <p className="mt-1 text-xl font-bold text-foreground">
                  ~{co.addedDays} day{co.addedDays === 1 ? "" : "s"}
                </p>
              </div>
            ) : null}
            {co.price !== null ? (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Price
                </p>
                <p className="mt-1 text-xl font-bold text-foreground">
                  ${co.price.toLocaleString()}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {co.status === "pending_customer" ? (
          <ChangeOrderDecision token={token} />
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <p className="text-lg font-semibold text-foreground">
              This change order is {CO_STATUS_LABEL[co.status].toLowerCase()}.
            </p>
            {co.customerApproverName ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Decided by {co.customerApproverName}.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </PortalShell>
  );
}
