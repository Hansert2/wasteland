-- Phase 8: the four places the road actually reaches.
--
-- "The neighbour is the destination" — reconnecting to somewhere means you can go
-- there, so a destination link puts a region on the dispatch table. One nullable
-- column does the whole job: null is a region that has always been open, and a number
-- is the link that opens it.
--
-- Gating lives here rather than in a join table because a region is opened by exactly
-- one link and never by anything else. A table would be three joins to express a
-- foreign key that points at a number in `src/game/road.js`, which is where the road's
-- shape is and where it stays.

alter table regions add column requires_link integer;

comment on column regions.requires_link is
  'Road link that opens this region, or null for the ones that were always there.';

-- Note what is deliberately *not* here: no constraint tying this to road_links, and no
-- cascade. A region is world content and a link is one camp's progress — they meet in
-- the service, which asks "has this camp finished link N", and nowhere else. Wiring
-- them at the schema level would make world content depend on a settlement, which is
-- backwards and would break the moment a second camp existed.
