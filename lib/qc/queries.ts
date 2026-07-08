import { createClient } from "@/lib/supabase/server";

// Guarded reads (ADR-051 pattern): the row_qc_checks relation only exists
// after the Phase 14 migration is approved. `available: false` renders an
// "awaiting migration" panel instead of a crash — the feature lights up
// on push with no code change.

export interface RowQcState {
  rowId: string;
  passed: Record<string, boolean>;
  passedCount: number;
}

export interface ProjectQcSummary {
  available: boolean;
  byRow: Map<string, RowQcState>;
}

export async function getProjectQc(projectId: string): Promise<ProjectQcSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("row_qc_checks")
    .select("row_id, check_key, passed, rows!inner(project_id)")
    .eq("rows.project_id", projectId);
  if (error) return { available: false, byRow: new Map() };

  const byRow = new Map<string, RowQcState>();
  for (const check of data) {
    const state =
      byRow.get(check.row_id) ??
      ({ rowId: check.row_id, passed: {}, passedCount: 0 } satisfies RowQcState);
    state.passed[check.check_key] = check.passed;
    if (check.passed) state.passedCount += 1;
    byRow.set(check.row_id, state);
  }
  return { available: true, byRow };
}
