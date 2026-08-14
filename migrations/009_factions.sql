-- Phase 5: two rival crews who both trade and raid.
--
-- No factions table. Factions are two rows of pure data — names, rivalry, offers —
-- and they live in `src/game/factions.js` beside the functions that read them, the
-- way STRUCTURES and UPGRADES always have. `faction` here is text checked in code,
-- following `camp_structures.kind`: an unknown slug is a content bug with a readable
-- message, not a 23503.
--
-- No trades table either. A trade has no lifecycle — it is not dispatched, does not
-- run for hours, cannot be cancelled. It happens at an instant while the buyer is
-- standing at the gate, and the standing shift *is* the record.

create table faction_standing (
  settlement_id bigint  not null references settlements (id) on delete cascade,
  faction       text    not null,

  -- -100 (they curse your name) through 0 (strangers) to 100 (they trust the camp).
  -- The camp, note — standing hangs off the settlement and survives succession with
  -- a knock, exactly as structures do.
  standing numeric(6, 2) not null default 0 check (standing between -100 and 100),

  primary key (settlement_id, faction)
);

-- Caravan bookkeeping, mirroring the raid columns for the same reasons: which
-- sequence of visits this camp gets, how far through it is, and when the next one
-- arrives. Everything else about a visit — whose caravan, how long they stay, the
-- gap to the one after — derives from the seed plus the count, so a month of missed
-- visits resolves deterministically and nothing needs a cron.
alter table settlements
  add column caravan_seed bigint not null default floor(random() * 2147483647),
  add column caravan_count integer not null default 0 check (caravan_count >= 0),

  -- Arrival of the current-or-next visit. Null means "not yet decided"; the tick
  -- books one on its next run, as it does for raids.
  add column next_caravan_at timestamptz;
