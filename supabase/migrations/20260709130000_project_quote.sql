-- Batch 5 Sub-phase F: per-project quote (contract value) for margin.
--
-- The margin view compares quote vs actual-cost-to-date vs
-- forecast-at-completion. The quote base lives here; approved change
-- orders (change_orders.price) adjust it live, and QuickBooks — when
-- connected — can populate it, but manual entry always works. crews
-- already carry cost_per_hour (owner-only) for the actual-cost side.
--
-- Additive + idempotent. Read-time code uses select("*") so it degrades
-- to "no quote yet" before this is applied (ADR-051 pattern).

alter table projects
  add column if not exists quoted_amount numeric;
