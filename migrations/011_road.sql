-- Phase 8: the road — the region reconnecting, one link at a time.
--
-- One table, and it holds only what the player actually did. Who is at the end of a
-- link is *derived* from the world seed the way weather is, so nothing about a
-- neighbour is stored here: not their name, not their size, not whether they are still
-- there. That last one is the point. A fate derived from (seed, now) changes with no
-- row to update and nothing running, which is the same guarantee the whole game is
-- built on — an eight-week absence resolves on the next page load.
--
-- What a link costs and what it brings live in `src/game/road.js` beside the generator
-- that draws from them, following STRUCTURES and MOMENTS: a balance pass edits one file
-- rather than writing a migration.

create table road_links (
  settlement_id bigint  not null references settlements (id) on delete cascade,

  -- One-based, because the player counts links from one and the page says "3 of 7".
  -- The upper bound is checked in code against LINKS rather than pinned here, so the
  -- road can be lengthened by a later phase without a migration to widen a constraint.
  link_index integer not null check (link_index >= 1),

  -- What has been poured in so far. Fuel goes *into* a link rather than being spent at
  -- the moment it is affordable: storage caps in the hundreds and the seventh link
  -- costs 797, so a threshold could never be met at all past the fourth. Committing
  -- incrementally is not a flavour choice, it is the only shape that reaches the end.
  fuel numeric(10, 2) not null default 0 check (fuel >= 0),

  -- Set the instant the fuel meets the cost. Null while the link is still being paid
  -- for; there is at most one such row per camp, which the service enforces by
  -- refusing to start a link before the one ahead of it is done.
  completed_at timestamptz,

  primary key (settlement_id, link_index)
);

-- The road is deliberately exempt from the successor penalty, and there is nothing
-- here to make that true: `raiseSuccessor` halves resources, knocks structures back a
-- level and halves standing, and simply does not touch this table. Written down
-- because the absence is the decision — everything else in the game is punished by a
-- death, and the road is not, because it is the one thing that measures the camp's
-- whole life rather than its current occupant.
--
-- The balance falls out of that rather than being added: uncommitted fuel is still
-- halved in the stores, so hoarding for a bigger link is punished and pouring it in as
-- it arrives is not.
