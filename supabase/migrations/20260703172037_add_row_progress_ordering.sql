-- listRowProgress() had no ORDER BY, so Postgres row order (and therefore
-- the marking canvas's paint/z-order for any two overlapping rows, e.g. a
-- freshly duplicated row placed near its source) was undefined and could
-- vary between queries. Expose rows.created_at (appended at the end of the
-- SELECT list — CREATE OR REPLACE VIEW only allows adding new columns
-- there; Postgres compares old/new columns positionally) so the app can
-- order by it deterministically.
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
    and coalesce(agg.material_count, 0) > 0 as is_complete,
  r.phase_id,
  r.created_at
from rows r
left join agg on agg.row_id = r.id;

grant select on row_progress to authenticated;
