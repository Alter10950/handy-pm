-- Batch 4, sub-phase A: "a project with no activity for N days (org
-- setting, default 3) is flagged STALLED" — this one org setting wasn't
-- part of sub-phase 0's own table list (that migration's brief only
-- named num_crews), so it gets its own small follow-up here, same as
-- how day_log_photos.sql followed batch3's own sub-phase 0 migration.
alter table organizations add column if not exists stalled_after_days int not null default 3;
