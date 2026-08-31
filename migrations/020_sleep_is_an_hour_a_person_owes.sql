-- Sleep, the accelerator, and it is one column.
--
-- Phase 10's last piece. Stamina already recovers passively — a survivor doing nothing pays
-- back a point an hour — and this is the decision that sits on top of it: **not whether to
-- recover, but whether to spend the hours recovering fast.** Somebody asleep cannot travel,
-- build, craft or reach for anything in their pack, and that unavailability is the whole of
-- what sleep costs.
--
-- ## Why a column and not a table
--
-- Every other queue in this schema is a row with a start, an end and a status, because every
-- other queue is a thing the *camp* is doing and more than one of them can stand at once. A
-- person sleeps or does not, and one person's sleep is a queue of one by construction — there
-- is nowhere for a second row to go. The partial unique index that would be needed to say so
-- against a table is exactly the shape `characters_one_living_idx` had, and migration `018`
-- has just finished explaining what that costs.
--
-- ## Why only the end
--
-- No `slept_at`. The arithmetic never asks how long they have been under: recovery is charged
-- per slice like every other rate, and the tick cuts a slice at this timestamp so a sleep that
-- ends mid-hour is paid its accelerated rate up to the minute and the ordinary one after. A
-- start would be a fact the page could print and nothing could use.
--
-- ## Null, and a timestamp in the past, mean the same thing
--
-- Nothing clears this. Waking is the clock passing it, so `sleep_until > now()` is the only
-- question anybody asks — the same reading `camp_structures.build_completes_at` gets, and for
-- the same reason: a state that has to be cleared by a writer is a state that is wrong for as
-- long as nobody writes.

alter table characters add column sleep_until timestamptz;

comment on column characters.sleep_until is
  'When this survivor wakes, and therefore until when they can be asked to do nothing. Null '
  'or past means awake; there is no separate flag and nothing clears it.';
