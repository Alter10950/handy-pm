import Image from "next/image";
import type { Metadata } from "next";

import { getPortalData, resolveShareToken } from "@/lib/portal/public";

export const metadata: Metadata = {
  title: "Project portal — Handy PM",
};

const STATUS_LABEL: Record<string, string> = {
  active: "In progress",
  on_hold: "On hold",
  complete: "Complete",
};

function formatDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

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

export default async function CustomerPortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const resolved = await resolveShareToken(token);

  if (!resolved) {
    return (
      <PortalShell>
        <div className="rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            This link is no longer valid
          </h1>
          <p className="mt-2 text-muted-foreground">
            It may have expired or been replaced. Please contact your project
            manager for an updated link.
          </p>
        </div>
      </PortalShell>
    );
  }

  const data = await getPortalData(resolved.projectId);

  return (
    <PortalShell>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {data.projectName}
            </h1>
            <span className="rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-primary">
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-muted p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Complete
              </p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
                {Math.round(data.pct * 100)}%
              </p>
            </div>
            {data.nextMilestone ? (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Target completion
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {formatDate(data.nextMilestone)}
                </p>
              </div>
            ) : null}
          </div>

          {data.mostRecentUpdate ? (
            <div className="mt-6 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Most recent update — {formatDate(data.mostRecentUpdate.workDate)}
              </p>
              <p className="mt-1 text-foreground">
                {data.mostRecentUpdate.note || "Work was logged on site."}
              </p>
            </div>
          ) : null}
        </div>

        {data.photos.length > 0 ? (
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Photos
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {data.photos.map((photo, index) => (
                <div key={index} className="flex flex-col gap-1">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                    <Image
                      src={photo.url}
                      alt={photo.caption ?? "Project photo"}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  {photo.caption ? (
                    <p className="text-xs text-muted-foreground">{photo.caption}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </PortalShell>
  );
}
