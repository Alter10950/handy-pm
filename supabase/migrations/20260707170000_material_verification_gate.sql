-- Batch 4, Sub-phase E: material verification gate.
--
-- Two small schema changes powering "no verified material, no crew
-- dispatch" (see docs/DECISIONS.md ADR-042):
--
-- 1. material_receipts gains resolved_at/resolved_by — a short/damaged/
--    wrong flag is "open" until an owner/pm explicitly resolves it
--    (replacement received, or accepted as-is). Open flags block the
--    Materials gate; resolution is the auditable answer to the seeded
--    "Shortages/damage resolved or accepted" checklist item.
--
-- 2. material_reconciliation gains `verified` and `open_flag_qty`,
--    APPENDED AT THE END of the select list (ADR-019: create or replace
--    view compares columns positionally — inserting mid-list silently
--    renames every column after it).
--
-- Deliberately NOT changed: to_order's formula. `received` means usable
-- units on hand (the verification worksheet confirms good qty and flags
-- bad qty as separate events, never received-bumping a flagged unit), so
-- needed - received already covers shortfall AND unusable units — one
-- reorder truth, no double-count.

alter table material_receipts
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users (id) on delete set null;

create or replace view material_reconciliation
with (security_invoker = true) as
with req as (
  select row_id, material_id, required_qty
  from row_materials
  where required_qty > 0
),
installed_raw as (
  select row_id, material_id, sum(qty) as installed_qty
  from installs
  group by row_id, material_id
),
capped as (
  select
    req.material_id,
    req.required_qty,
    least(coalesce(installed_raw.installed_qty, 0), req.required_qty) as installed_capped
  from req
  left join installed_raw
    on installed_raw.row_id = req.row_id
    and installed_raw.material_id = req.material_id
),
per_material as (
  select
    material_id,
    sum(required_qty) as assigned,
    sum(installed_capped) as installed
  from capped
  group by material_id
),
receipt_rollup as (
  select
    material_id,
    sum(qty) filter (where status = 'verified') as verified_qty,
    sum(qty) filter (
      where status in ('short', 'damaged', 'wrong') and resolved_at is null
    ) as open_flag_qty
  from material_receipts
  group by material_id
)
select
  m.id as material_id,
  m.project_id,
  m.name,
  m.unit,
  m.total_needed as needed,
  m.received,
  coalesce(pm.assigned, 0) as assigned,
  coalesce(pm.installed, 0) as installed,
  -- "left" is a reserved word in SQL (LEFT JOIN); named left_qty instead.
  m.total_needed - coalesce(pm.assigned, 0) as left_qty,
  greatest(0, m.total_needed - m.received) as to_order,
  coalesce(rr.verified_qty, 0) as verified,
  coalesce(rr.open_flag_qty, 0) as open_flag_qty
from materials m
left join per_material pm on pm.material_id = m.id
left join receipt_rollup rr on rr.material_id = m.id;
