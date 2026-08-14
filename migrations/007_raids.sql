-- Phase 3: threats that arrive on the tick rather than being sought out.
--
-- No raids table. A raid has no lifecycle to track — it is not dispatched, does not
-- run for hours and cannot be cancelled; it happens at an instant and is over. What
-- persists is only the schedule, so three columns on `settlements` say everything the
-- simulation needs: which sequence of raids this camp gets, how far through it is,
-- and when the next one falls due.
--
-- The seed is per settlement and the outcome is derived from it plus the count, which
-- is what lets a month-long absence resolve the whole sequence in order and identically
-- however the interval is sliced. Same reasoning as `expeditions.seed`.

alter table settlements
  -- Fits comfortably in a double, which is what the simulation reads it as.
  add column raid_seed bigint not null default floor(random() * 2147483647),
  add column raid_count integer not null default 0 check (raid_count >= 0),

  -- Null means "not yet decided". The tick fills it in on its next run, from the
  -- wealth the camp has at that moment, rather than a migration guessing now.
  add column next_raid_at timestamptz;
