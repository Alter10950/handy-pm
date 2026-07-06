-- project_gate_items had no stable ordering column: getProjectLifecycle
-- ordered by created_at, but ensureProjectStages bulk-inserts a whole
-- stage's items in one statement (same/near-identical timestamp), so
-- Postgres had no reliable tiebreaker and the checklist/What's Next order
-- didn't match the template's authored position order. Add position,
-- carried over from the template item at copy time (see
-- lib/gates/actions.ts#ensureProjectStages), custom items appended after.
alter table project_gate_items add column if not exists position integer not null default 0;
