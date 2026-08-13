-- Expeditions become resolvable: regions carry what can be found in them, and every
-- expedition carries the seed its outcome will be rolled from.
--
-- The seed is stored rather than rolled at resolution time so that resolving is a
-- pure function of the row. Re-running the tick over the same interval — after a
-- failed request, a retry, or a replay in a test — produces the same outcome instead
-- of quietly re-rolling the dice in the player's favour or against them.

alter table regions add column loot jsonb not null default '{}'::jsonb;
alter table regions add column finds jsonb not null default '[]'::jsonb;
alter table regions add column radiation_per_trip numeric(6, 2) not null default 0;

alter table expeditions add column seed bigint;

-- Backfill is unnecessary (no rows yet), but the column is only useful if it is
-- always present.
update expeditions set seed = 0 where seed is null;
alter table expeditions alter column seed set not null;
