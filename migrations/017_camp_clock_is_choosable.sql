-- The camp's clock becomes something a player can set, which makes it something a player
-- can abuse, so first it stops being read at resolution.
--
-- Migrations `015` and `016` gave the camp an hour and a sun, both settable only by hand at
-- the database. `returnExpedition` read them off the settlement row at the moment the trip
-- resolved, and that was safe exactly as long as nothing could change them mid-trip.
--
-- A timezone picker changes that. Daylight multiplies finds, so a player who could rotate
-- their sky while a survivor was out could send them at dusk, shift the clock twelve hours,
-- and have the trip integrated as though it had gone out at dawn. That is the same shape as
-- the sky exploit found on 2026-08-27 — a factor sampled from a value the player controls,
-- rather than integrated over what actually happened — and a once-a-day limit does not close
-- it, because one change a day is one exploit a day and trips are shorter than a day.
--
-- It is also, already, a violation of the rule migration `015` called load-bearing: *stored
-- rather than read, so every trip still replays exactly*. The clock was being read. Nothing
-- could reach it but a hand at the database, so it never bit; the picker would have made it
-- reachable.
--
-- So the sky joins `departed_at` and `seed` as something the trip carries with it. A trip
-- replays under the sky it left beneath, whatever the camp does afterwards, and the daily
-- limit below goes back to being what it was meant to be: a guard against thrash, not a
-- security control doing a job the schema should do.
--
-- Null on both columns means a trip dispatched before this migration. Those fall back to the
-- settlement's current values, which is exactly the behaviour they were dispatched under.

alter table expeditions
  add column clock_offset_minutes integer
    check (clock_offset_minutes between -840 and 840),
  add column solar_noon_minutes integer
    check (solar_noon_minutes between 0 and 1439);

comment on column expeditions.clock_offset_minutes is
  'The camp''s clock at the moment of departure, frozen so the trip replays exactly. '
  'Null for trips dispatched before migration 017; those read the settlement.';

comment on column expeditions.solar_noon_minutes is
  'Where the sun sat against that clock at departure. Frozen for the same reason.';

-- When the camp was placed, which is a thing that happens once.
--
-- This began as a cooldown stamp for a once-a-day limit, and the limit turned out to be
-- answering a question nobody had. A camp is a *place*, and founding is when a place gets
-- one: registration reads the browser's zone and derives both numbers with nobody asked
-- anything, so a camp founded today is already placed and has no use for a control.
--
-- What is left is the hole underneath. Every camp founded before this was derived stands on
-- Greenwich and the idealised sky with no way to say otherwise, and so does a camp whose zone
-- was not in the curated table. Those need placing once, and then never again.
--
-- So: **null means this camp was never actually placed**, and that is the only thing the
-- column is asked. The page offers the control to exactly those camps and to nobody else,
-- which makes it self-liquidating — it leaves the game as the last unplaced camp is placed,
-- rather than sitting on the strip for ever offering to re-answer a settled question.
--
-- Not a rate limit, then, and deliberately not: a rate limit rations an exploit rather than
-- closing one, and the closing is done above by freezing the sky onto the trip.

alter table settlements
  add column clock_changed_at timestamptz;

comment on column settlements.clock_changed_at is
  'When this camp was placed: stamped at founding when the zone was known, or when the camp '
  'later set it by hand. Null means never placed, and is the only condition under which the '
  'page offers to place it. Nothing in the simulation reads it.';
