import Image from "next/image";
import type { Metadata } from "next";

import { ProgressBar } from "@/components/ui/progress-meter";
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

// The customer's window into their job — always light (app/portal/layout.tsx
// wraps in .force-light), calm, and readable by someone who has never seen
// the app. One card, big progress, latest update, photos.
function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-full flex-1 flex-col items-center bg-background px-4 py-12 sm:py-16">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-black text-primary-foreground shadow-e1">
            H
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight text-foreground">
              Handy<span className="text-text-secondary">PM</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Your install, live from the floor
            </p>
          </div>
        </div>
        {children}
        <p className="mt-10 text-center text-xs text-muted-foreground">
          Provided by Handy Equip · questions? Reply to your project manager.
        </p>
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
        <div className="rounded-xl border border-border bg-surface p-8 text-center shadow-e2">
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
  const pct = Math.round(data.pct * 100);

  return (
    <PortalShell>
      <div className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {data.projectName}
            </h1>
            <span className="rounded-full bg-brand-subtle px-3 py-1 text-sm font-medium text-foreground">
              {STATUS_LABEL[data.status] ?? data.status}
            </span>
          </div>

          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="type-overline text-muted-foreground">
                Install progress
              </p>
              <p className="num text-3xl font-bold text-foreground">{pct}%</p>
            </div>
            <ProgressBar pct={pct} size="lg" />
          </div>

          {data.nextMilestone ? (
            <div className="mt-6 rounded-lg bg-surface-sunken p-4">
              <p className="type-overline text-muted-foreground">
                Target completion
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatDate(data.nextMilestone)}
              </p>
            </div>
          ) : null}

          {data.mostRecentUpdate ? (
            <div className="mt-6 border-t border-border-subtle pt-4">
              <p className="type-overline text-muted-foreground">
                Latest from the site — {formatDate(data.mostRecentUpdate.workDate)}
              </p>
              <p className="mt-1.5 text-foreground">
                {data.mostRecentUpdate.note || "Work was logged on site."}
              </p>
            </div>
          ) : null}
        </div>

        {data.photos.length > 0 ? (
          <div className="rounded-xl border border-border bg-surface p-6 shadow-e2 sm:p-8">
            <h2 className="type-overline text-muted-foreground">Photos</h2>
            {(
              [
                ["before", "Before"],
                ["during", "During install"],
                ["after", "After"],
              ] as const
            ).map(([phase, label]) => {
              const group = data.photos.filter((photo) => photo.phase === phase);
              if (group.length === 0) return null;
              return (
                <div key={phase} className="mt-4 first-of-type:mt-3">
                  <p className="mb-2 text-sm font-semibold text-foreground">
                    {label}
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {group.map((photo, index) => (
                      <div key={index} className="flex flex-col gap-1">
                        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-surface-sunken">
                          <Image
                            src={photo.url}
                            alt={photo.caption ?? "Project photo"}
                            fill
                            unoptimized
                            className="object-cover"
                          />
                        </div>
                        {photo.caption ? (
                          <p className="text-xs text-muted-foreground">
                            {photo.caption}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </PortalShell>
  );
}
