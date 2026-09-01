-- A raid stops being a moment and becomes an afternoon.
--
-- Reworked 2026-09-01 with the user, after playing the version that settled in one press.
-- Raiders are in the yard for four hours and they are *carrying things off the whole time*:
-- the camp bleeds stores by the hour, and at any point in it the player can send people to the
-- fence or pull them back out. What a raid costs is now a function of when you got there and
-- how long you left them standing.
--
-- ## What the raid row carries now
--
-- `per_hour` is the drain, fixed at the hour raiders arrive and never recomputed. Four
-- undefended hours take exactly what a raid took before this, so no balance figure moves — and
-- a rate that does not move is the only kind a live counter can honestly extrapolate. A share
-- of whatever is left was the alternative: gentler, curved, and it would have needed the week
-- offline measured again.
--
-- `taken` and `damage` stop being a settlement and start being a running total.
--
-- ## And why a stand is one row per person, not one per stint
--
-- Somebody can go out, come back, and go out again. That could be a row per stint, and then
-- "what has Vera prevented" is a sum over rows and the page has to do arithmetic to answer a
-- question about a person. One row per person instead: `since` is when they last went out and
-- null when they are back, and the three totals accumulate across every stint.
--
-- The old rows survive it. A raid answered under the single-press build has one person who
-- stood and the damage they took, which is exactly a completed stint: `since` null, and their
-- hours unknown but their damage recorded.

alter table raids
  add column per_hour jsonb not null default '{}'::jsonb;

alter table raid_stands
  add column since timestamptz,
  add column hours numeric(10, 4) not null default 0 check (hours >= 0),
  add column prevented jsonb not null default '{}'::jsonb;

comment on column raids.per_hour is
  'What the raiders carry off each hour with nobody in their way, per resource. Fixed when '
  'they arrive: four undefended hours come to what a raid took before it had a duration.';

comment on column raid_stands.since is
  'When this survivor last went out to the fence, or null when they are not there now. The '
  'totals beside it accumulate across however many times they went.';

comment on column raid_stands.prevented is
  'What this survivor has kept out of the raiders'' hands, per resource, attributed in '
  'proportion to their share of what the crew was holding back at the time.';
