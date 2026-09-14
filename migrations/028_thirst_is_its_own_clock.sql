-- Phase 19: water stops being reported as hunger.
--
-- The camp has had one gauge since 001 and it was never a hunger gauge. `fedFraction` was
-- `min(food drawn, water drawn)`, so either store running dry drove the same number at the
-- same rate — and that rate was tuned to kill in 54 hours, which is what a body without
-- water does. A body without food takes about three weeks.
--
-- So this column is not a new system. It is the existing clock moving onto the gauge it was
-- always describing, and `hunger` staying behind on a clock ten times slower, where its bite
-- is the stamina chain rather than the deadline.
--
-- ## Why the existing rows start at zero
--
-- A default of 0 means every living survivor wakes up on deploy fully watered, which is a
-- small gift and the only honest option: the column being added is the one that was doing the
-- killing, so carrying the old `hunger` value across would start a camp mid-drought on a
-- reading it had no chance to act on. The gift is bounded — a camp with an empty tank is back
-- at 100 within a day — and the alternative is a deploy that kills somebody.
--
-- `hunger` is deliberately *not* rescaled. A survivor sitting at 80 hunger was, under the old
-- reading, hours from death; under the new one they are a fortnight from it and working badly,
-- which is a truer description of the same camp than any number this migration could compute.

alter table characters
  add column thirst numeric(6, 3) not null default 0
    check (thirst between 0 and 100);

comment on column characters.thirst is
  'Thirst, 0 (watered) to 100 (dying of it). The deadline gauge: it inherits every constant '
  'the single hunger gauge was tuned with, because that clock was always water''s.';
