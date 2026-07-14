-- Step 2b performance: indexes on the hot filter columns the crew
-- scorecard, margin, anomaly, and schedule surfaces scan. These tables
-- (installs, assignments, material_receipts, blockers) were only indexed
-- on project_id, so every "this crew, this date range" query fell back to
-- a sequential scan. Additive + idempotent (create index if not exists).

-- installs: scorecards/margin/anomalies filter by crew + date range, and
-- QC joins by row.
create index if not exists installs_crew_date_idx
  on installs (crew_id, installed_on);
create index if not exists installs_row_idx
  on installs (row_id);

-- assignments: the board, calendar, and idle-crew rule scan by crew and by
-- date range across the org.
create index if not exists assignments_crew_date_idx
  on assignments (crew_id, work_date);
create index if not exists assignments_work_date_idx
  on assignments (work_date);

-- material_receipts: receiving reads every event for a material.
create index if not exists material_receipts_material_idx
  on material_receipts (material_id);

-- blockers: scorecard (by crew), dashboard escalation (unresolved),
-- anomaly excuse-check (by crew + date).
create index if not exists blockers_crew_date_idx
  on blockers (crew_id, work_date);
create index if not exists blockers_unresolved_idx
  on blockers (project_id) where resolved_at is null;
