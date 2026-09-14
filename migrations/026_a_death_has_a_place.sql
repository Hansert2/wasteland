-- Phase 16: a death starts recording where it happened, and whether anybody went back.
--
-- **Two columns, and no table, because the premise the phase was designed on was wrong.** The
-- design said a dead survivor's pack is gone by the time anybody could fetch it —
-- `inventory_items` cascades on delete, and migration 001 means it. True about the constraint
-- and false about what happens: nothing ever deletes a character row. A death sets `died_at`,
-- so that cascade has never once fired for one.
--
-- `view-graveyard.js` has been reading those packs since it was written, and `headstone()` says
-- so in as many words — "nothing cleans up after the dead, so their pack is still there to be
-- read." What the phase needed, then, was never a snapshot of what was left; a second copy of
-- `inventory_items` would only have been something to drift. It needed the one fact the row
-- does not carry.
--
-- ## `died_at_region_id`, and null is load-bearing
--
-- `characters` has recorded `died_at` and `cause_of_death` since 001 and nothing about where,
-- so the graveyard prints their most recent *trip* instead: a survivor who starved in their
-- own camp gets a headstone naming a place they came back from alive.
--
-- Null means **inside the wire** — starved, taken in a raid, or gored at the fence line — and
-- that is the whole rule for whether there is anything to go and fetch. A death in the camp
-- leaves its pack twenty feet from the shelf, and what happens to it is settled at once rather
-- than by sending somebody to the fence line to collect it.
--
-- ## `recovered_at`
--
-- When somebody went out and brought them back, which is also when the pack came home: the
-- user's call on 2026-09-14 is that the two are one act rather than two choices. Null is still
-- out there. The graveyard reads it, and the recovery verb refuses a second trip for somebody
-- already home.
--
-- On delete set null for the region, not cascade: a region is content and could in principle be
-- renamed out of the table, and losing a whole headstone because a place was reorganised is a
-- worse outcome than losing the place off it.

alter table characters
  add column died_at_region_id bigint references regions (id) on delete set null,
  add column recovered_at      timestamptz;

-- A recovery is a thing that happened to somebody who died. Nothing else in this schema can
-- state that, and a row claiming to have been brought home from nowhere is the kind of
-- nonsense a check constraint exists to refuse.
alter table characters
  add constraint characters_recovery_follows_a_death check (
    recovered_at is null or died_at is not null
  );

comment on column characters.died_at_region_id is
  'Where they died, or null for inside the wire. Null is the rule for whether there is '
  'anything to recover: a death in the camp leaves its pack twenty feet from the shelf.';

comment on column characters.recovered_at is
  'When somebody went out and brought them back, the pack riding home with them. Null is '
  'still out there.';
