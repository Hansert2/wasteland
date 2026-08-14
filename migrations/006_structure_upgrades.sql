-- The fuel track: scrap makes a structure bigger, fuel makes it do something new.
--
-- Fuel is the one resource nothing in the camp produces — it comes back only from
-- expeditions. That makes it danger money, where scrap is patience, and it is the
-- reason the second currency buys a different *kind* of improvement rather than
-- simply more of the same one.
--
-- Only which upgrades a camp has lives here. What an upgrade costs and does is in
-- `src/game/structures.js` beside STRUCTURES, because structures have never been
-- content: `camp_structures.kind` is a check constraint, not a table, and a balance
-- pass edits one file rather than writing a migration.

create table structure_upgrades (
  id            bigserial   not null primary key,
  settlement_id bigint      not null references settlements (id) on delete cascade,

  -- The structure it is fitted to, and the upgrade's slug. Both are validated in the
  -- service against the definitions in code, for the same reason recipe costs are:
  -- an unknown key is a content bug with a readable message, not a 23514.
  kind    text not null,
  upgrade text not null,

  started_at   timestamptz not null default now(),
  completes_at timestamptz not null,

  -- Null while the crew is still fitting it. Fitting is building work and follows
  -- the same rule: starting needs living hands, finishing does not.
  installed_at timestamptz,

  -- Fitted once. There is no level to this track — an upgrade is a capability the
  -- camp either has or does not, which is what keeps it a different decision from
  -- the scrap levels rather than a second, parallel grind.
  unique (settlement_id, upgrade)
);

-- One job at a time in the camp. Builds and fittings deliberately share the queue:
-- it is one crew, and choosing what they work on next is the game.
create unique index structure_upgrades_one_fitting_idx
  on structure_upgrades (settlement_id)
  where installed_at is null;

create index structure_upgrades_settlement_idx on structure_upgrades (settlement_id);
