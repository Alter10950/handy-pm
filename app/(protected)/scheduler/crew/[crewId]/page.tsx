import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { Sparkline } from "@/components/ui/sparkline";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusPill } from "@/components/ui/status-pill";
import { blockerLabel, getCrewScorecard } from "@/lib/crews/scorecard";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Crew scorecard — Handy PM",
};

export const dynamic = "force-dynamic";

export default async function CrewScorecardPage({
  params,
}: {
  params: Promise<{ crewId: string }>;
}) {
  const { crewId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  // Coaching data is office-only (crew never sees comparative productivity).
  if (!profile?.org_id || !["owner", "pm", "scheduler"].includes(profile.role)) {
    redirect("/app");
  }

  const card = await getCrewScorecard(crewId);
  if (!card) notFound();

  const trendValues = card.trend.map((d) => d.output);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Crew scorecard"
        title={card.crewName}
        description="Productivity and quality over the last 60 days — context first: blocked days don't count against targets."
        actions={
          <Link
            href="/scheduler"
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-muted"
          >
            ← Scheduler
          </Link>
        }
      />

      {card.smallSample ? (
        <p className="rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2 text-sm text-foreground">
          Small sample ({card.activeDays} active day
          {card.activeDays === 1 ? "" : "s"}) — read these as early signals,
          not a verdict.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Units installed" value={String(card.totalUnits)} />
        <StatTile
          label="Avg per active day"
          value={card.avgPerDay.toFixed(1)}
        />
        <StatTile
          label="Targets hit"
          value={
            card.targetsHitPct === null
              ? "—"
              : `${Math.round(card.targetsHitPct)}`
          }
          suffix={card.targetsHitPct === null ? undefined : "%"}
          tone={
            card.targetsHitPct !== null && card.targetsHitPct < 60
              ? "warning"
              : "default"
          }
        />
        <StatTile
          label="QC pass rate"
          value={
            !card.qcAvailable || card.qcPassPct === null
              ? "—"
              : `${Math.round(card.qcPassPct)}`
          }
          suffix={card.qcPassPct === null ? undefined : "%"}
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-e1">
        <h2 className="type-overline mb-3 text-muted-foreground">
          Daily output trend
        </h2>
        {trendValues.length > 0 ? (
          <Sparkline values={trendValues} className="h-16 w-full" />
        ) : (
          <p className="text-sm text-muted-foreground">
            No installs logged in this window yet.
          </p>
        )}
        <p className="mt-2 num text-xs text-muted-foreground">
          {card.nonBlockedTargetDays} day
          {card.nonBlockedTargetDays === 1 ? "" : "s"} judged against a
          target (blocked days excluded).
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-e1">
        <h2 className="type-overline mb-3 text-muted-foreground">
          Blockers by cause
        </h2>
        {card.blockerCountsByCode.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No blockers logged — clean run.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {card.blockerCountsByCode.map((b) => (
              <li key={b.code}>
                <StatusPill tone="warning">
                  {blockerLabel(b.code)} · {b.count}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
