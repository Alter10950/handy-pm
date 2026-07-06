-- Batch 3, sub-phase D: the estimation brain. Two small additions — every
-- other piece this sub-phase needs (labor_standards, project_estimates,
-- crew_rates, materials.labor_units, projects.planned_days) already exists
-- from Phase 2 and Batch 3 sub-phase 0, which both anticipated this exact
-- work ("only new application logic" per their own comments).

-- MATERIALS: task classification --------------------------------------------
-- Maps a material to a labor_standards row (task_key), so its labor_units
-- can be computed from base_labor_units × a size factor instead of sitting
-- at the bare default of 1 forever. Free text, no CHECK — labor_standards
-- itself has none either (an org can add its own task_key rows later; a
-- hardcoded enum here would need a migration every time). The application
-- layer sources the dropdown of valid values from the org's own
-- labor_standards rows, the same "app-enforced, not schema-enforced"
-- relationship crew_rates.task_key already has to labor_standards.
alter table materials add column if not exists task_key text not null default 'general';

-- PROJECTS: a fourth status for pre-sale estimating --------------------------
-- A "future job" being estimated (paste a material list, see days + a daily
-- plan, before there's a signed customer or a drawing to mark) reuses the
-- exact same projects/materials tables and paste-materials flow as a real
-- project — it just starts one stage earlier in the lifecycle and is
-- filtered out of the main Projects/Field/Scheduler lists (all three
-- already query for status = 'active' or otherwise exclude non-active rows
-- except the main Projects list, which this sub-phase updates to exclude
-- 'estimate' explicitly). "Convert to active project" is just a status
-- flip — no data migration, since it was always a real projects row.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status in ('estimate', 'active', 'on_hold', 'complete'));
