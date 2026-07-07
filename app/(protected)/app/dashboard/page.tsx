import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BlockerEscalationList } from "@/components/dashboard/blocker-escalation-list";
import { CrewPerformanceSummary } from "@/components/dashboard/crew-performance-summary";
import { EmailReportButton } from "@/components/dashboard/email-report-button";
import { GateOverrideList } from "@/components/dashboard/gate-override-list";
import { LifecycleAttentionList } from "@/components/dashboard/lifecycle-attention-list";
import { ProjectRiskList } from "@/components/dashboard/project-risk-list";
import { ShortageList } from "@/components/dashboard/shortage-list";
import { TodayActivityPanel } from "@/components/dashboard/today-activity";
import {
  getCrewPerformanceSummary,
  getTodayActivitySummary,
  listActiveProjectsForDashboard,
  listShortagesAcrossProjects,
  listUnresolvedBlockersAcrossProjects,
} from "@/lib/dashboard/queries";
import { listOrgWideNextActions, listOverriddenStages } from "@/lib/gates/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Dashboard — Handy PM",
};

export const dynamic = "force-dynamic";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
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
  ] = await Promise.all([
    listActiveProjectsForDashboard(),
    listShortagesAcrossProjects(),
    listUnresolvedBlockersAcrossProjects(),
    getCrewPerformanceSummary(),
    getTodayActivitySummary(),
    listOrgWideNextActions(),
    listOverriddenStages(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <div className="flex flex-wrap gap-2">
          <EmailReportButton period="daily" />
          <EmailReportButton period="weekly" />
        </div>
      </div>

      <Section title={`Active projects (${projects.length})`}>
        <ProjectRiskList projects={projects} />
      </Section>

      <Section title={`Needs attention — stalled or overdue (${lifecycleAttention.length})`}>
        <LifecycleAttentionList summaries={lifecycleAttention} />
      </Section>

      <Section title={`Overridden gates (${gateOverrides.length})`}>
        <GateOverrideList overrides={gateOverrides} />
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title={`Blockers needing escalation (${blockers.length})`}>
          <BlockerEscalationList blockers={blockers} />
        </Section>
        <Section title={`What's short (${shortages.length})`}>
          <ShortageList shortages={shortages} />
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Crew performance">
          <CrewPerformanceSummary crews={crews} />
        </Section>
        <Section title="What changed today">
          <TodayActivityPanel activity={activity} />
        </Section>
      </div>
    </div>
  );
}
