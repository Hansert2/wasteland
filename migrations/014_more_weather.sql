-- Four more kinds of sky, and the constraint that would have refused them.
--
-- `world_events.kind` was pinned to the three that existed when it was written. That is
-- the right shape for a column whose values are content — a typo becomes an error rather
-- than a row nothing can render — and it is also the thing that makes adding weather a
-- migration rather than an edit to a data file. Worth the trade, but worth knowing: the
-- generator would have produced `long_light` happily and the insert would have failed on
-- a page load, for everybody at once, because the sky is global.
--
-- The three that were already here keep their names and their meanings. What changed
-- alongside this is how often each is drawn — see `WORLD_EVENTS[kind].share` — and that
-- needs no schema at all, because a slot already written keeps whatever it was. The
-- calendar's past is what the table says it is; only unwritten slots follow the new
-- shares. Nothing here rewrites a storm somebody already lived through.

alter table world_events drop constraint world_events_kind_check;

alter table world_events
  add constraint world_events_kind_check
  check (kind in ('rad_storm', 'caravan', 'blight', 'long_light', 'hard_rain', 'the_slip', 'dust'));
