-- A raid stops being something that happened to you.
--
-- Phase 12. Raiders arrive, and instead of resolving inside the tick and telling you about it
-- afterwards, they wait: the camp is *being raided* for a few hours, and whoever is standing
-- there may choose who holds the fence. That survivor takes the injury and the raiders leave
-- with less. Nobody answers, and everybody hid.
--
-- ## Why this needs a row
--
-- `settlements.next_raid_at` says when the next one falls due, and that is all it can say. A
-- raid in progress is a different kind of fact — it has a seed, a deadline and an answer —
-- which is exactly the shape `expeditions` already has, and for the same reason: it is a
-- thing with an outcome that has not been decided yet.
--
-- The seed is copied onto the row rather than derived from `raid_seed + raid_count` at
-- resolution time. Those two move on the moment the raid settles and the next one is booked,
-- so a raid that is still open cannot be described by them: the pair would answer for the
-- raid *after* this one. What a player is being asked about has to be pinned when it starts.
--
-- ## `stood_by` and `resolved_at` are the whole state machine
--
-- Both null: open, and the window may still be answered. `stood_by` set: somebody was named.
-- `resolved_at` set: settled, one way or the other. There is no status column, because every
-- state it could hold is already legible from those two and a status is then a second place
-- for the truth to live.
--
-- `on delete set null` on the defender, as with every other job a person can be given: the
-- raid outlives the survivor, and a camp that lost somebody should not lose the record of
-- what they stood in front of.

create table raids (
  id             bigserial primary key,
  settlement_id  bigint not null references settlements(id) on delete cascade,
  at             timestamptz not null,
  closes_at      timestamptz not null,
  seed           bigint not null,
  faction        text,
  stood_by       bigint references characters(id) on delete set null,
  resolved_at    timestamptz,
  taken          jsonb not null default '{}'::jsonb,
  damage         integer not null default 0 check (damage >= 0),
  log            jsonb not null default '[]'::jsonb
);

-- One open raid at a time, which is a rule about the world rather than about the schema:
-- raiders do not queue. A partial unique index says so where a check in code would drift.
create unique index raids_one_open_idx
  on raids (settlement_id)
  where resolved_at is null;

create index raids_settlement_at_idx on raids (settlement_id, at desc);

comment on column raids.closes_at is
  'When the window shuts and an unanswered raid settles as everybody having hidden. Four '
  'hours after `at`: measured in tools/raid-window.mjs as about one raid in three for a '
  'twice-a-day player.';

comment on column raids.seed is
  'Pinned at the raid rather than derived from raid_seed + raid_count, which have already '
  'moved on to describe the next one by the time this is answered.';

comment on column raids.stood_by is
  'Who held the fence. Null on a resolved raid means nobody did, and the raiders took the '
  'larger share for it.';
