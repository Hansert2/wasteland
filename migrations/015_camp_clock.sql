-- The hour belongs to the camp; the weather still belongs to the world.
--
-- World time was UTC for everybody, on the stated grounds that every camp is under the
-- same sky and a sky telling two players different hours would be two skies. That reason
-- conflated two things. **Weather is genuinely global** — every camp must see the same
-- storm, which is why `world_events` has no `settlement_id` and why it never will. **The
-- hour is not.** Nothing in the game compares two camps' clocks, and the argument for
-- sharing one was an analogy rather than a constraint.
--
-- Under a single UTC clock a player in Auckland always checks in at world-night and one in
-- Denver always at world-morning, which is a systematically different game through no
-- choice of their own. The phase answered that by putting the mechanical weight on the
-- trip rather than on the check-in; a per-camp offset means it does not need answering.
-- It also buys the thing that made this worth doing: dark outside and dark in the game are
-- the same dark, so sending somebody out at bedtime and reading the report over breakfast
-- is a rhythm the game can finally express.
--
-- **Minutes, and a fixed offset rather than a named zone.** A zone brings daylight saving,
-- which would jump the sky by an hour twice a year — a discontinuity in a function that is
-- otherwise smooth, and a trip spanning the transition would get an hour more or less
-- daylight than the dispatch table promised it. Minutes rather than hours because a fair
-- number of the world's offsets are not whole ones.
--
-- **Stored rather than read**, which is the load-bearing part. Taking it from the server's
-- locale or the browser's would make the game change when the server moved or when the
-- player travelled, and would make an expedition resolve differently on replay. As a
-- column it is part of the camp, so every trip still replays exactly.

alter table settlements
  add column clock_offset_minutes integer not null default 0
    check (clock_offset_minutes between -840 and 840);

comment on column settlements.clock_offset_minutes is
  'Minutes ahead of UTC for this camp''s own clock. Weather stays global; only the hour '
  'and the light are shifted. Fixed rather than a timezone, so there is no daylight saving.';
