-- Survivors become people: the skill scale re-centres on four.
--
-- Both readable skills have sat at the column default of 1 since the schema was
-- written, because nothing ever wrote to them. `skill_scavenging` has had a live reader
-- worth ten percent a point that whole time; `skill_medicine` had none at all.
--
-- `src/game/wanderers.js` now hands an arriving survivor a real pair of numbers, and
-- scores them against ORDINARY = 4 rather than against 1 — seven wanderers running 1
-- through 7, averaging exactly four, so the mean arrival is precisely the survivor the
-- game has always had. Scoring against 1 instead would have made the average newcomer
-- a quarter better at scavenging than anyone before them, which is an economy change
-- and not what a file about backstories is for.
--
-- **The living have to move with the scale or they are silently nerfed.** A survivor
-- holding a camp right now reads 1, which under the new scoring is 0.7x loot — a thirty
-- percent pay cut applied by a deploy, to somebody who was doing nothing wrong. Setting
-- them to four leaves them exactly where they were, which is the only honest answer for
-- a change whose whole claim is that the average does not move.
--
-- The dead are left alone on purpose. Nothing reads a dead survivor's skills, and the
-- graveyard is a ledger — a record of what each one was carrying and where they last
-- went. Rewriting the numbers on a closed row would be editing history to tidy it.

alter table characters alter column skill_scavenging set default 4;
alter table characters alter column skill_medicine   set default 4;

update characters
   set skill_scavenging = 4,
       skill_medicine   = 4
 where died_at is null
   and skill_scavenging = 1
   and skill_medicine   = 1;
