-- What a person can carry, and what the camp keeps.
--
-- Phase 13. Two facts the game has never had: an item has a weight, and the camp has a
-- shelf that is not on anybody's back.
--
-- ## Grams, and why the column says so
--
-- The plan wrote this column as `numeric`. It ships as an integer count of grams, decided
-- 2026-09-02 alongside Phase 18's denomination of the stores: a gram is already the small
-- unit, half a gram is not a distinction any content in this game will ever want to make,
-- and an integer cannot drift the way a scaled float can when a stack is multiplied out.
--
-- Weights themselves are content and live in `src/db/seed.js` with the rest of it, so a
-- balance pass can edit them. The default of zero is deliberate rather than lazy: a camp
-- that has migrated but not re-seeded has a pack that weighs nothing, which is exactly the
-- game it had yesterday. Nothing breaks while the two run a second apart.
--
-- ## A table of its own, and the cascade is the whole reason
--
-- `store_items` could have been a nullable `character_id` on `inventory_items`. It is not,
-- because the single most important thing about the box is what does *not* happen to it.
-- `inventory_items` cascades on the character by design since migration 001 — carried
-- inventory belongs to the survivor and dies with them — and the box exists precisely to
-- stand outside that. Two lifetimes, two tables, and no chance of one delete reaching both.
--
-- The box hangs off the settlement instead, which outlives everybody in it. It is uncapped
-- for now: the constraint this phase is about is the road, not the shed.

alter table items
  add column weight_grams integer not null default 0 check (weight_grams >= 0);

comment on column items.weight_grams is
  'What one of these weighs, in grams. Rations are derived from potency through the food '
  'stores (a point of hunger is 5.2 g); everything else is anchored content. Zero means '
  'weightless, which is what every item was before Phase 13.';

create table store_items (
  settlement_id bigint  not null references settlements(id) on delete cascade,
  item_id       bigint  not null references items(id),
  qty           integer not null check (qty >= 0),

  primary key (settlement_id, item_id)
);

comment on table store_items is
  'The camp box: items the settlement keeps rather than any one survivor. Survives a death, '
  'which is its entire reason to exist; a pack does not. Reachable from the workshop bench, '
  'and never by the tick''s safety valve — banking your last ration is how you die with a '
  'full larder.';
