-- Phase 2: the workshop stops being only a scrap tap.
--
-- Recipes are content, so the rows themselves live in `src/db/seed.js` alongside
-- regions and items — balance passes edit them, and an applied migration cannot be
-- edited. Only the shape lives here.
--
-- The craft queue is deliberately separate from the build queue. Sharing one would
-- mean crafting a spear blocks upgrading the garden, and that is not a decision worth
-- making interesting; they are different workbenches.

create table recipes (
  id             bigserial primary key,
  slug           text     not null unique,
  name           text     not null,
  output_item_id bigint   not null references items (id),
  output_qty     integer  not null default 1 check (output_qty > 0),

  -- Settlement stores consumed, as {"scrap": 20, "fuel": 5}. Same vocabulary as
  -- `resources.kind`, checked in the service rather than by a constraint so an
  -- unknown key is a content bug with a readable message, not a 23514.
  costs jsonb not null default '{}'::jsonb,

  -- Items consumed off the survivor, as [{"slug": "scavenged_parts", "qty": 2}].
  -- This is what makes a recipe a recipe rather than a shop: the interesting cost is
  -- the thing you had to go and find.
  inputs jsonb not null default '[]'::jsonb,

  -- A workshop of at least this level. Level 0 means no workshop is needed; nothing
  -- currently ships at 0, but a starting recipe would want it.
  requires_workshop smallint      not null default 1 check (requires_workshop >= 0),
  craft_hours       numeric(6, 2) not null check (craft_hours > 0),

  description text
);

create table craft_orders (
  id            bigserial primary key,
  settlement_id bigint not null references settlements (id) on delete cascade,
  recipe_id     bigint not null references recipes (id),

  -- 'lost' is not a failure to craft. It means the order finished with nobody alive
  -- to take it off the bench, exactly as an expedition's haul is forfeit when its
  -- survivor dies. The camp keeps working; it just has no hands to hold the result.
  status       text not null default 'active' check (status in ('active', 'delivered', 'lost')),
  started_at   timestamptz not null default now(),
  completes_at timestamptz not null,
  resolved_at  timestamptz,

  constraint craft_orders_resolution_is_complete check (
    (status = 'active' and resolved_at is null)
    or (status <> 'active' and resolved_at is not null)
  )
);

-- One order at a time per camp, enforced by the database rather than by remembering
-- to check. Mirrors expeditions_one_active_idx.
create unique index craft_orders_one_active_idx
  on craft_orders (settlement_id)
  where status = 'active';

create index craft_orders_settlement_idx on craft_orders (settlement_id);
