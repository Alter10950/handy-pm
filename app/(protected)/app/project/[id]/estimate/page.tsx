import Link from "next/link";

import { MarginPanel } from "@/components/margin/margin-panel";
import { ProjectEstimatePanel } from "@/components/estimating/project-estimate-panel";
import { getApprovedChangeOrderTotals } from "@/lib/change-orders/queries";
import {
  computeProjectEstimate,
  listProjectEstimates,
} from "@/lib/estimating/queries";
import { listCrews } from "@/lib/crews/queries";
import { isConnected } from "@/lib/integrations/queries";
import { getProjectMargin } from "@/lib/margin/queries";
import { getProject } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [estimate, history, crews, project, approvedCoTotals] =
    await Promise.all([
      computeProjectEstimate(id),
      listProjectEstimates(id),
      listCrews(),
      getProject(id),
      getApprovedChangeOrderTotals(id),
    ]);

  const original = project?.original_estimate_saved_at
    ? {
        laborUnits: project.original_estimate_labor_units ?? 0,
        days: project.original_estimate_days ?? 0,
      }
    : null;

  // Margin is owner-only (costs never surface to PM/scheduler/crew).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: viewer } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const isOwner = viewer?.role === "owner";
  const [margin, quickbooksConnected] = isOwner
    ? await Promise.all([getProjectMargin(id), isConnected("quickbooks")])
    : [null, false];

  return (
    <div className="flex flex-col gap-4">
      {original ? (
        // "The project keeps BOTH numbers" (ADR-043): the original
        // estimate is the frozen deal-time snapshot; current approved is
        // original + every approved change order — variance between what
        // was sold and what's now agreed stays visible instead of the
        // baseline silently absorbing growth.
        <div
          data-testid="estimate-baseline-card"
          className="rounded-lg border border-border bg-card shadow-e1 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              Original vs current approved
            </h3>
            <Link
              href={`/app/project/${id}/change-orders`}
              className="text-xs font-medium text-info-fg hover:underline"
            >
              {approvedCoTotals.count} approved change order
              {approvedCoTotals.count === 1 ? "" : "s"} →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Original hours</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {Math.round(original.laborUnits * 10) / 10}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approved hours</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {Math.round(
                  (original.laborUnits + approvedCoTotals.laborUnits) * 10
                ) / 10}
                {approvedCoTotals.laborUnits > 0 ? (
                  <span className="ml-1 text-xs font-medium text-info-fg">
                    (+{Math.round(approvedCoTotals.laborUnits * 10) / 10})
                  </span>
                ) : null}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Original days</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {Math.round(original.days * 10) / 10}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approved days</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {Math.round((original.days + approvedCoTotals.addedDays) * 10) /
                  10}
                {approvedCoTotals.addedDays > 0 ? (
                  <span className="ml-1 text-xs font-medium text-info-fg">
                    (+{Math.round(approvedCoTotals.addedDays * 10) / 10})
                  </span>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <ProjectEstimatePanel
        projectId={id}
        initialEstimate={estimate}
        history={history}
        crews={crews}
        aiExplainAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
      />

      {isOwner && margin ? (
        <MarginPanel
          projectId={id}
          margin={margin}
          quickbooksConnected={quickbooksConnected}
        />
      ) : null}
    </div>
  );
}
