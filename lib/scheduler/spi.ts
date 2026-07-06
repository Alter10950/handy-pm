import { todayIso } from "@/lib/dates";
import type { Tables } from "@/lib/supabase/database.types";

// The exact formula scheduler-workspace.tsx already computed inline
// (its own useMemo) — extracted here, unchanged, so the new company
// dashboard can compute the identical SPI for every active project
// without a third copy of this logic. null when there's no target data
// to compare against yet (a project with no generated targets has no
// SPI, not a 0 or a divide-by-zero).
export function computeProjectSpi(
  targets: Tables<"targets">[],
  dailyActuals: Map<string, number> | Record<string, number>
): number | null {
  const today = todayIso();
  const actualsByDate =
    dailyActuals instanceof Map ? dailyActuals : new Map(Object.entries(dailyActuals));

  const targetsByDate = new Map<string, number>();
  for (const target of targets) {
    targetsByDate.set(
      target.work_date,
      (targetsByDate.get(target.work_date) ?? 0) + target.target_qty
    );
  }

  let planned = 0;
  for (const [date, qty] of targetsByDate) {
    if (date <= today) planned += qty;
  }
  let actual = 0;
  for (const [date, qty] of actualsByDate) {
    if (date <= today) actual += qty;
  }
  if (planned === 0) return null;
  return actual / planned;
}

export type RiskTier = "good" | "watch" | "risk";

// Same three-tier success/primary/destructive convention already
// established for SPI badges (scheduler-workspace.tsx,
// crew-performance-panel.tsx) and week-view.tsx's per-day status —
// reasonable, documented cutoffs, not numbers from any spec (ADR-022).
export function classifySpi(spi: number | null): RiskTier {
  if (spi === null) return "watch";
  if (spi >= 1) return "good";
  if (spi >= 0.8) return "watch";
  return "risk";
}

export const RISK_TIER_CLASS: Record<RiskTier, string> = {
  good: "bg-success/20 text-success",
  watch: "bg-primary/20 text-primary",
  risk: "bg-destructive/20 text-destructive",
};

export const RISK_TIER_LABEL: Record<RiskTier, string> = {
  good: "On track",
  watch: "Watch",
  risk: "At risk",
};
