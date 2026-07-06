-- Batch 3, sub-phase B: "attach end-of-day photos" — distinct from
-- blockers.photo_path (one photo tied to one reported problem); this is
-- general documentation of the day's work, so it can be more than one
-- photo. A plain array column, not a new one-to-many table — a day log
-- has at most a handful of photos, and there's no need to query them
-- independently of their day log.
alter table day_logs add column if not exists photo_paths text[] not null default '{}';
