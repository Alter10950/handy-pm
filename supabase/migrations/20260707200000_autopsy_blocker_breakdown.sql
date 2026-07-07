-- Batch 4, Sub-phase I: closeout autopsy (see docs/DECISIONS.md ADR-046).
-- Sub-phase 0's project_autopsies stored blocker impact as one total
-- (blocker_days); the brief asks for "days lost by code" — the per-code
-- breakdown lands in a jsonb map (code -> distinct days with that
-- blocker), same shape-convention as material_variance.

alter table project_autopsies
  add column if not exists blocker_breakdown jsonb not null default '{}';
