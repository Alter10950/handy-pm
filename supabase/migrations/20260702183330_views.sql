-- Phase 2: progress/reconciliation views.
--
-- security_invoker = true (Postgres 15+) makes these views enforce RLS as
-- the QUERYING user rather than the view owner. Without it, a view created
-- by an elevated migration role can silently bypass the RLS policies on its
-- underlying tables for every caller — the views would leak cross-org data.
--
-- "Installed capped at required" (matching the reference marking-tool
-- prototype's zonePct/zoneComplete logic): a row/material can't show over
-- 100% just because more was logged than was actually required.

-- ROW_PROGRESS: one row per `rows` record --------------------------------
create or replace view row_progress
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
    req.row_id,
    req.material_id,
    req.required_qty,
    least(coalesce(installed_raw.installed_qty, 0), req.required_qty) as installed_capped
  from req
  left join installed_raw
    on installed_raw.row_id = req.row_id
    and installed_raw.material_id = req.material_id
),
agg as (
  select
    row_id,
    sum(required_qty) as required_total,
    sum(installed_capped) as installed_total,
    bool_and(installed_capped >= required_qty) as all_materials_met,
    count(*) as material_count
  from capped
  group by row_id
)
select
  r.id as row_id,
  r.project_id,
  r.drawing_id,
  r.label,
  r.x,
  r.y,
  r.w,
  r.h,
  coalesce(agg.required_total, 0) as required_total,
  coalesce(agg.installed_total, 0) as installed_total,
  case
    when coalesce(agg.required_total, 0) > 0
      then round(agg.installed_total::numeric / agg.required_total, 4)
    else 0
  end as pct,
  coalesce(agg.material_count, 0) > 0 as has_materials,
  coalesce(agg.all_materials_met, false)
    and coalesce(agg.material_count, 0) > 0 as is_complete
from rows r
left join agg on agg.row_id = r.id;

-- PROJECT_PROGRESS: one row per project -----------------------------------
create or replace view project_progress
with (security_invoker = true) as
select
  p.id as project_id,
  p.org_id,
  p.name,
  p.site_address,
  p.status,
  p.deadline,
  p.created_at,
  count(distinct rw.id) as row_count,
  count(distinct rw.id) filter (where rp.is_complete) as rows_complete,
  count(distinct rw.id) filter (where not rp.has_materials) as rows_missing_materials,
  coalesce(sum(rp.required_total), 0) as required_total,
  coalesce(sum(rp.installed_total), 0) as installed_total,
  case
    when coalesce(sum(rp.required_total), 0) > 0
      then round(sum(rp.installed_total)::numeric / sum(rp.required_total), 4)
    else 0
  end as pct
from projects p
left join rows rw on rw.project_id = p.id
left join row_progress rp on rp.row_id = rw.id
group by p.id, p.org_id, p.name, p.site_address, p.status, p.deadline, p.created_at;

-- MATERIAL_RECONCILIATION: one row per material ---------------------------
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
  greatest(0, m.total_needed - m.received) as to_order
from materials m
left join per_material pm on pm.material_id = m.id;

grant select on row_progress, project_progress, material_reconciliation to authenticated;
