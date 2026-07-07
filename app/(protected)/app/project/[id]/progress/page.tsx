import { AutopsyPanel } from "@/components/autopsy/autopsy-panel";
import { PhaseProgress } from "@/components/projects/phase-progress";
import { getAutopsy } from "@/lib/autopsy/queries";
import { listPhases } from "@/lib/phases/queries";
import { getProjectProgress, listRowProgress } from "@/lib/projects/queries";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [progress, phases, rowProgress] = await Promise.all([
    getProjectProgress(id),
    listPhases(id),
    listRowProgress(id),
  ]);
  const pct = Math.round((progress?.pct ?? 0) * 100);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  const canManage = profile?.role === "owner" || profile?.role === "pm";
  // project_autopsies RLS is owner/pm-only — don't even query for other
  // roles (it would silently return null anyway).
  const autopsy = canManage ? await getAutopsy(id) : null;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-foreground">Progress</h2>

      <div
        data-testid="overall-complete-stat"
        className="rounded-lg border border-border bg-card p-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Overall complete
          </span>
          <span className="text-2xl font-bold tabular-nums text-foreground">
            {pct}%
          </span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rows
          </p>
          <p className="text-2xl font-bold tabular-nums text-foreground">
            {progress?.row_count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Rows complete
          </p>
          <p className="text-2xl font-bold tabular-nums text-success">
            {progress?.rows_complete ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Missing materials
          </p>
          <p className="text-2xl font-bold tabular-nums text-warning">
            {progress?.rows_missing_materials ?? 0}
          </p>
        </div>
      </div>

      <PhaseProgress phases={phases} rowProgress={rowProgress} />

      {canManage ? (
        <AutopsyPanel
          projectId={id}
          autopsy={autopsy}
          canManage={canManage}
          aiAvailable={Boolean(process.env.ANTHROPIC_API_KEY)}
          resendConfigured={Boolean(process.env.RESEND_API_KEY)}
        />
      ) : null}

      <p className="text-sm text-muted-foreground">
        Per-material reconciliation (installed / assigned / needed / received /
        to-order) lives on the Materials tab.
      </p>
    </div>
  );
}
