// Pure types — zero server-only imports, safe for a Client Component to
// import directly. See lib/gates/shared.ts for why this split exists in
// this codebase.
import type { Tables } from "@/lib/supabase/database.types";

export type HandoffSurveyRow = Tables<"handoff_surveys">;

// handoff_surveys.constraints is an unconstrained jsonb column (no CHECK
// at the DB level — same "app enforces the shape, not the schema"
// posture as materials.task_key) — this is the shape ADR-037 specifies
// verbatim (live_warehouse/access_notes/forklift_onsite/working_hours/
// floor_condition/permits_needed).
export interface HandoffConstraints {
  liveWarehouse: boolean;
  accessNotes: string;
  forkliftOnsite: boolean;
  workingHours: string;
  floorCondition: string;
  permitsNeeded: boolean;
}

export const EMPTY_CONSTRAINTS: HandoffConstraints = {
  liveWarehouse: false,
  accessNotes: "",
  forkliftOnsite: false,
  workingHours: "",
  floorCondition: "",
  permitsNeeded: false,
};

export function parseConstraints(raw: unknown): HandoffConstraints {
  if (!raw || typeof raw !== "object") return { ...EMPTY_CONSTRAINTS };
  const r = raw as Record<string, unknown>;
  return {
    liveWarehouse: Boolean(r.liveWarehouse),
    accessNotes: typeof r.accessNotes === "string" ? r.accessNotes : "",
    forkliftOnsite: Boolean(r.forkliftOnsite),
    workingHours: typeof r.workingHours === "string" ? r.workingHours : "",
    floorCondition:
      typeof r.floorCondition === "string" ? r.floorCondition : "",
    permitsNeeded: Boolean(r.permitsNeeded),
  };
}

export function isSurveyComplete(survey: HandoffSurveyRow | null): boolean {
  if (!survey) return false;
  return Boolean(
    survey.site_visit_date &&
    survey.existing_racking_condition &&
    survey.photo_paths.length > 0
  );
}
