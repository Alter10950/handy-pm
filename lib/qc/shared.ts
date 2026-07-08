// The per-row QC checklist vocabulary (Phase 14, ADR-052). App-defined,
// not schema-enforced — same stance as labor_standards.task_key. Keys are
// stored in row_qc_checks.check_key; labels/order live here so renaming a
// label never touches data.

export interface QcCheckDef {
  key: string;
  label: string;
  /** one-line "what good looks like" shown under the label in the field */
  hint: string;
}

export const QC_CHECKS: QcCheckDef[] = [
  {
    key: "plumb_level",
    label: "Uprights plumb & level",
    hint: 'Within 1/8" per 10 ft, both directions.',
  },
  {
    key: "anchors_torqued",
    label: "Anchors set & torqued",
    hint: "Every footplate anchored; wedge anchors at spec torque.",
  },
  {
    key: "shims_seated",
    label: "Shims seated",
    hint: "Full contact under footplates — no rocking, stacks banded.",
  },
  {
    key: "beams_locked",
    label: "Beam locks engaged",
    hint: "Both connectors seated, safety clips/locks in on every beam.",
  },
  {
    key: "decks_seated",
    label: "Wire decks seated",
    hint: "All decks in their channels, no bowing, correct orientation.",
  },
  {
    key: "labels_capacity",
    label: "Load labels on",
    hint: "Capacity placards mounted and readable at aisle ends.",
  },
];

export const QC_CHECK_KEYS = QC_CHECKS.map((check) => check.key);

export type QcRowStatus = "not_started" | "in_progress" | "passed";

export function qcRowStatus(
  passedCount: number,
  total = QC_CHECKS.length
): QcRowStatus {
  if (passedCount <= 0) return "not_started";
  return passedCount >= total ? "passed" : "in_progress";
}
