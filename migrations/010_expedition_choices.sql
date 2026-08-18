-- Phase 6: what the player answered, while the survivor was still out there.
--
-- An expedition offers a handful of moments during the trip. Which moments, at what
-- hours, and for how long they can be answered are all derived from `expeditions.seed`
-- — so none of that is stored, any more than the loot roll is. The only thing the
-- server cannot recompute is what the player said, which is this column and nothing
-- else.
--
-- An array of {"index": n, "option": "key"}. Order in the array is arrival order and is
-- deliberately not meaningful: resolution sorts by index, because the trip happened in
-- the order the hours did and a replay must not depend on how quickly somebody clicked.
--
-- Defaulting to '[]' rather than allowing null is what keeps the resolution path free
-- of a special case: every expedition ever dispatched, including the ones already in
-- flight when this migration runs, is a trip whose moments were all left to the
-- survivor — which is exactly the game as it was before this column existed.

alter table expeditions
  add column choices jsonb not null default '[]'::jsonb;

-- A guard rather than a nicety. This is the one column in the game written directly
-- from a form post, and the resolution walks whatever is in it. Bounding the shape here
-- means a malformed or oversized body cannot reach the simulation at all.
alter table expeditions
  add constraint expeditions_choices_is_a_small_array check (
    jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) <= 8
  );
