-- Batch 4, Sub-phase C: labor_standards was seeded install-only (upright/
-- beam/wire_deck/anchor/row_spacer/end_barrier/post_protector/general —
-- see 20260706093725_batch3_estimating_readiness_versions.sql). scope_items
-- covers non-install work_types (teardown/remove_levels/add_levels/
-- relocate/repair) that had no labor_standards coverage at all, so
-- "labor_units suggested from labor_standards" (this sub-phase's brief)
-- had nothing to suggest from. Same reasonable-default-not-measured
-- posture and idempotent on-conflict-do-nothing as the original seed.
-- task_key values match scope_items.work_type literally, so
-- lib/estimating/labor.ts#laborUnitsFor's existing task_key lookup (with
-- its own "general" fallback) works unchanged for scope items too.
insert into labor_standards (org_id, task_key, base_labor_units, unit_basis)
select o.id, s.task_key, s.base_labor_units, s.unit_basis
from organizations o
cross join (values
  ('teardown', 0.15::numeric, 'per_bay'),
  ('remove_levels', 0.10::numeric, 'per_level'),
  ('add_levels', 0.12::numeric, 'per_level'),
  ('relocate', 0.20::numeric, 'per_bay'),
  ('repair', 0.15::numeric, 'per_each')
) as s(task_key, base_labor_units, unit_basis)
on conflict (org_id, task_key) do nothing;
