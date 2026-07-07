// Pure types/constants — zero server-only imports, safe for a Client
// Component to import directly. See lib/gates/shared.ts for why this
// split exists in this codebase.
import type { ScopeWorkType, Tables } from "@/lib/supabase/database.types";

export const WORK_TYPE_LABEL: Record<ScopeWorkType, string> = {
  install: "Install",
  teardown: "Teardown",
  remove_levels: "Remove levels",
  add_levels: "Add levels",
  relocate: "Relocate",
  repair: "Repair",
  other: "Other",
};

export const WORK_TYPE_ORDER: ScopeWorkType[] = [
  "teardown",
  "remove_levels",
  "add_levels",
  "relocate",
  "repair",
  "install",
  "other",
];

export type ScopeItemProgressRow = Tables<"scope_item_progress">;

export function scopeItemStatusLabel(status: string | null): string {
  if (status === "done") return "Done";
  if (status === "partial") return "Partial";
  return "Not started";
}
