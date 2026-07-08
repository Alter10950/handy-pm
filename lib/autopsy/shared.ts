// Pure types/verdict math — zero server-only imports, safe for Client
// Components. See lib/gates/shared.ts for why this split exists.
import type { Tables } from "@/lib/supabase/database.types";

export type AutopsyRow = Tables<"project_autopsies">;

export interface MaterialVarianceEntry {
  name: string;
  needed: number;
  received: number;
  assigned: number;
  installed: number;
}

export type VerdictKind = "under" | "on" | "over";

export interface Verdict {
  kind: VerdictKind;
  pct: number; // signed: +12 = 12% over estimate
  label: string;
}

// Under/on/over with a signed percentage — "on" is within ±10%, the
// tolerance a two-crew installer's estimates realistically live in.
export function verdict(
  estimated: number | null,
  actual: number | null
): Verdict | null {
  if (estimated === null || actual === null || estimated <= 0) return null;
  const pct = Math.round(((actual - estimated) / estimated) * 100);
  const kind: VerdictKind = pct > 10 ? "over" : pct < -10 ? "under" : "on";
  const label =
    kind === "on"
      ? `on estimate (${pct >= 0 ? "+" : ""}${pct}%)`
      : kind === "over"
        ? `${pct}% over estimate`
        : `${Math.abs(pct)}% under estimate`;
  return { kind, pct, label };
}

export function parseMaterialVariance(raw: unknown): MaterialVarianceEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is MaterialVarianceEntry =>
      typeof entry === "object" && entry !== null && "name" in entry
  );
}

export function parseBlockerBreakdown(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, number> = {};
  for (const [code, days] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof days === "number") result[code] = days;
  }
  return result;
}
