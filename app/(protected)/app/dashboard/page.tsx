import {
  ActivityIcon,
  AlertTriangleIcon,
  FlagIcon,
  GaugeIcon,
  type LucideIcon,
  PackageXIcon,
  ShieldAlertIcon,
  UsersIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { cn } from "@/lib/utils";

import { AnomalyStrip } from "@/components/dashboard/anomaly-strip";
import { BlockerEscalationList } from "@/components/dashboard/blocker-escalation-list";
import { InboundStrip } from "@/components/dashboard/inbound-strip";
import { CapacityOverrideList } from "@/components/dashboard/capacity-override-list";
import { CrewPerformanceSummary } from "@/components/dashboard/crew-performance-summary";
import { EmailReportButton } from "@/components/dashboard/email-report-button";
import { GateOverrideList } from "@/components/dashboard/gate-override-list";
import { LifecycleAttentionList } from "@/components/dashboard/lifecycle-attention-list";
import { ProjectRiskList } from "@/components/dashboard/project-risk-list";
import { ShortageList } from "@/components/dashboard/shortage-list";
import { TodayActivityPanel } from "@/components/dashboard/today-activity";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import {
  getCrewPerformanceSummary,
  getTodayActivitySummary,
  listActiveProjectsForDashboard,
  listShortagesAcrossProjects,
  listUnresolvedBlockersAcrossProjects,
} from "@/lib/dashboard/queries";
import {
  listOrgWideNextActions,
  listOverriddenStages,
} from "@/lib/gates/queries";
import { listOpenAnomalies } from "@/lib/anomalies/queries";
import { listInboundMessages } from "@/lib/inbound/queries";
import { listCapacityOverrides } from "@/lib/scheduler/capacity";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard — Handy PM",
};

export const dynamic = "force-dynamic";

// Exception cards get an icon + a tone that only lights up when the card
// actually holds exceptions (design pass v3 D3) — calm when clear.
function Section({
  title,
  icon: Icon,
  tone = "default",
  action,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  tone?: "default" | "warning" | "danger";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4 shadow-e1",
        tone === "warning" && "border-l-4 border-l-warning",
        tone === "danger" && "border-l-4 border-l-destructive"
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {Icon ? (
            <Icon
              aria-hidden
              className={cn(
                "size-4",
                tone === "danger"
                  ? "text-destructive"
                  : tone === "warning"
                    ? "text-warning-fg"
                    : "text-muted-foreground"
              )}
            />
          ) : null}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

// Exception-first: an owner/pm/scheduler's home base for "what needs my
// attention right now," not a duplicate of the plain /app project list.
export default async function DashboardPage() {
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
  if (
    !profile?.org_id ||
    !["owner", "pm", "scheduler"].includes(profile.role)
  ) {
    redirect("/app");
  }

  const [
    projects,
    shortages,
    blockers,
    crews,
    activity,
    lifecycleAttention,
    gateOverrides,
    capacityOverrides,
  ] = await Promise.all([
    listActiveProjectsForDashboard(),
    listShortagesAcrossProjects(),
    listUnresolvedBlockersAcrossProjects(),
    getCrewPerformanceSummary(),
    getTodayActivitySummary(),
    listOrgWideNextActions(),
    listOverriddenStages(),
    listCapacityOverrides(),
  ]);
  const [anomalyResult, inbound] = await Promise.all([
    listOpenAnomalies(),
    listInboundMessages(),
  ]);

  const openBlockers = blockers.length;
  const shortCount = shortages.length;
  const attentionCount = lifecycleAttention.length;
  const portfolioPct =
    projects.length > 0
      ? Math.round(
          (projects.reduce((sum, p) => sum + p.pct, 0) / projects.length) * 100
        )
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        overline="Handy Equip"
        title="Dashboard"
        description="What needs your attention right now, across every job."
        actions={
          <>
            <EmailReportButton period="daily" />
            <EmailReportButton period="weekly" />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Portfolio complete"
          value={String(portfolioPct)}
          suffix="%"
          ringPct={portfolioPct}
        />
        <StatTile
          label="Needs attention"
          value={String(attentionCount)}
          tone={attentionCount > 0 ? "warning" : "default"}
        />
        <StatTile
          label="Open blockers"
          value={String(openBlockers)}
          tone={openBlockers > 0 ? "danger" : "default"}
        />
        <StatTile
          label="Materials short"
          value={String(shortCount)}
          tone={shortCount > 0 ? "warning" : "default"}
        />
      </div>

      <AnomalyStrip
        anomalies={anomalyResult.anomalies}
        available={anomalyResult.available}
      />

      <InboundStrip
        messages={inbound.messages}
        available={inbound.available}
        configured={inbound.configured}
      />

      <Section title={`Active projects (${projects.length})`}>
        <ProjectRiskList projects={projects} />
      </Section>

      <Section
        title={`Needs attention — stalled or overdue (${lifecycleAttention.length})`}
        icon={FlagIcon}
        tone={attentionCount > 0 ? "warning" : "default"}
      >
        <LifecycleAttentionList summaries={lifecycleAttention} />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title={`Overridden gates (${gateOverrides.length})`}
          icon={ShieldAlertIcon}
          tone={gateOverrides.length > 0 ? "warning" : "default"}
        >
          <GateOverrideList overrides={gateOverrides} />
        </Section>
        <Section
          title={`Capacity overrides (${capacityOverrides.length})`}
          icon={GaugeIcon}
          tone={capacityOverrides.length > 0 ? "warning" : "default"}
        >
          <CapacityOverrideList overrides={capacityOverrides} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section
          title={`Blockers needing escalation (${blockers.length})`}
          icon={AlertTriangleIcon}
          tone={openBlockers > 0 ? "danger" : "default"}
        >
          <BlockerEscalationList blockers={blockers} />
        </Section>
        <Section
          title={`What's short (${shortages.length})`}
          icon={PackageXIcon}
          tone={shortCount > 0 ? "warning" : "default"}
        >
          <ShortageList shortages={shortages} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Crew performance" icon={UsersIcon}>
          <CrewPerformanceSummary crews={crews} />
        </Section>
        <Section title="What changed today" icon={ActivityIcon}>
          <TodayActivityPanel activity={activity} />
        </Section>
      </div>
    </div>
  );
}
