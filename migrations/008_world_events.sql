-- Phase 4: weather for everybody at once.
--
-- Not tied to a settlement. Every camp is under the same sky, which is what makes an
-- event something that happened to the world rather than something that happened to
-- you — and it is why there is no settlement_id here to be tempted by later.
--
-- `slot` is the nth event the world has ever had, counted from a fixed epoch. The
-- whole row is derived from one world seed plus that number, so any settlement's tick
-- can generate a missing slot and every settlement generates the same one. The unique
-- constraint is what makes that safe to do concurrently: two camps ticking at once
-- both compute slot 41, one inserts it, the other's insert does nothing.

create table world_events (
  slot integer not null primary key check (slot >= 0),

  kind      text        not null check (kind in ('rad_storm', 'caravan', 'blight')),
  starts_at timestamptz not null,
  ends_at   timestamptz not null,

  constraint world_events_window_is_forwards check (ends_at > starts_at)
);

-- The tick asks "what was in force between these two instants", which is an overlap
-- query and wants both ends indexed.
create index world_events_window_idx on world_events (starts_at, ends_at);
