-- Phase 1 schema: enough for the core loop (auth, a survivor, a settlement,
-- resources, one region, expeditions). Factions, recipes, raids and world_events
-- arrive in later phases and deliberately aren't stubbed here.
--
-- The load-bearing decision, per the plan: structures and resources hang off
-- `settlements`, never off `characters`. That is what makes the camp outlive its
-- people, and it is painful to retrofit.

create table players (
  id            bigserial primary key,
  email         text        not null,
  password_hash text        not null,
  created_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness without pulling in the citext extension.
create unique index players_email_lower_idx on players (lower(email));

create table settlements (
  id         bigserial primary key,
  player_id  bigint      not null references players (id) on delete cascade,
  name       text        not null,
  founded_at timestamptz not null default now(),

  -- One clock for the whole settlement, not one per resource row.
  --
  -- The plan's sketch put last_tick_at on `resources`, but applyTick advances the
  -- settlement and its survivor along a single timeline — hunger, production and
  -- death all have to agree on what time it is. Per-row clocks would let those
  -- drift apart, and the survivor simulation has no sensible answer for that.
  last_tick_at timestamptz not null default now(),

  created_at timestamptz not null default now()
);

-- One settlement per account for now. Drop this index if alts are ever allowed.
create unique index settlements_player_idx on settlements (player_id);

create table characters (
  id            bigserial primary key,
  settlement_id bigint      not null references settlements (id) on delete cascade,
  name          text        not null,

  born_at        timestamptz not null default now(),
  died_at        timestamptz,
  cause_of_death text,

  health    numeric(6, 3) not null default 100 check (health between 0 and 100),
  hunger    numeric(6, 3) not null default 0   check (hunger between 0 and 100),
  radiation numeric(6, 3) not null default 0   check (radiation between 0 and 100),
  stamina   numeric(6, 3) not null default 100 check (stamina between 0 and 100),

  skill_scavenging smallint not null default 1 check (skill_scavenging >= 0),
  skill_combat     smallint not null default 1 check (skill_combat >= 0),
  skill_crafting   smallint not null default 1 check (skill_crafting >= 0),
  skill_medicine   smallint not null default 1 check (skill_medicine >= 0),

  -- A corpse must record how it got that way; a living survivor must not.
  constraint characters_death_is_complete check (
    (died_at is null and cause_of_death is null)
    or (died_at is not null and cause_of_death is not null)
  )
);

-- At most one living survivor per settlement, enforced by the database rather than
-- by remembering to check. Dead rows accumulate freely — they are the roster.
create unique index characters_one_living_idx
  on characters (settlement_id)
  where died_at is null;

create index characters_settlement_idx on characters (settlement_id);

create table camp_structures (
  id            bigserial primary key,
  settlement_id bigint   not null references settlements (id) on delete cascade,
  kind          text     not null check (kind in ('shelter', 'water_purifier', 'workshop', 'watchtower')),
  level         smallint not null default 0 check (level >= 0),

  -- Non-null only while a build is in flight; cleared when it completes.
  build_completes_at timestamptz,

  unique (settlement_id, kind)
);

create table resources (
  settlement_id bigint         not null references settlements (id) on delete cascade,
  kind          text           not null check (kind in ('water', 'food', 'scrap', 'fuel')),
  amount        numeric(14, 4) not null default 0 check (amount >= 0),
  -- Per hour, matching the tick's units. Derived from structures on build/upgrade.
  production_rate numeric(10, 4) not null default 0 check (production_rate >= 0),
  storage_cap     numeric(14, 4) not null check (storage_cap > 0),

  primary key (settlement_id, kind),
  constraint resources_within_cap check (amount <= storage_cap)
);

create table items (
  id          bigserial primary key,
  slug        text not null unique,
  name        text not null,
  kind        text not null check (kind in ('ration', 'antirad', 'weapon', 'armour', 'material')),
  -- What the item does when consumed: hunger removed, rads scrubbed, damage dealt.
  potency     numeric(10, 4) not null default 0,
  description text
);

-- Carried inventory belongs to the survivor and dies with them. Settlement stores
-- live in `resources`. The tick relies on that split: bulk food comes from storage,
-- emergency rations come from here.
create table inventory_items (
  id           bigserial primary key,
  character_id bigint not null references characters (id) on delete cascade,
  item_id      bigint not null references items (id),
  qty          integer not null check (qty >= 0),

  unique (character_id, item_id)
);

create table regions (
  id           bigserial primary key,
  slug         text not null unique,
  name         text not null,
  danger       smallint      not null check (danger between 1 and 5),
  travel_hours numeric(6, 2) not null check (travel_hours > 0),
  description  text
);

create table expeditions (
  id           bigserial primary key,
  character_id bigint not null references characters (id) on delete cascade,
  region_id    bigint not null references regions (id),

  status      text not null default 'active' check (status in ('active', 'returned', 'lost')),
  departed_at timestamptz not null default now(),
  returns_at  timestamptz not null,
  resolved_at timestamptz,

  -- The readable log the player sees on login: loot, story beats, injuries.
  log jsonb,

  constraint expeditions_resolution_is_complete check (
    (status = 'active' and resolved_at is null)
    or (status <> 'active' and resolved_at is not null)
  )
);

-- One expedition in flight at a time; you only have the one survivor.
create unique index expeditions_one_active_idx
  on expeditions (character_id)
  where status = 'active';

-- The plan lists `character_history` as a table, but every column it would hold is
-- already on a dead `characters` row. A view keeps the roster as a first-class query
-- surface without a second copy of the truth to drift.
create view character_history as
select
  c.id,
  c.settlement_id,
  c.name,
  c.born_at,
  c.died_at,
  c.cause_of_death,
  extract(epoch from (c.died_at - c.born_at)) / 86400.0 as days_survived
from characters c
where c.died_at is not null;
