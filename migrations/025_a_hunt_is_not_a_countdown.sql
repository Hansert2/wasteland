-- Phase 20: the hunt — the first thing in this game that does not happen over time.
--
-- Every other verb here writes a deadline and waits: a trip has `returns_at`, a build has
-- `build_completes_at`, a raid has `closes_at`, even sleep has an hour it ends at. Asked for
-- from play on 2026-09-13 — "more to do actively, without timer... instant" — and that is the
-- whole of what makes this table a different shape from every other one beside it. **There is
-- no timestamp in it that anything counts down to.** A hunt advances when the player presses
-- something and at no other moment.
--
-- ## Why the state is one jsonb column
--
-- Because it is read by exactly one thing. `src/game/hunting.js` is a pure function of
-- `(seed, the answers so far)` the way `moments.js` is, and the columns a state machine of
-- that shape would want — closeness, alarm, whether the animal has turned — are content
-- decisions that will move the first time the hunt is retuned. Spreading them across the
-- schema would mean a migration per balance pass. Nothing else joins on them, no index wants
-- them, and the one rule the database can usefully enforce about a hunt is that a camp has at
-- most one open at a time.
--
-- `seed` is the thing that must never move, so it is a column. Everything the hunt *is*
-- derives from it: which animal is out there, and every roll it makes. A reload redraws the
-- same numbers, which is what stops a player shaking a bad strike out of the page.
--
-- ## What the resolution says, and why 'left' is not 'lost'
--
--   taken   — the animal is down, and the stores and the pack are the better for it
--   bolted  — it broke and went; the stamina is spent and nothing came of it
--   lost    — six turns and the light went
--   left    — the player backed off, which is a decision and deserves its own word
--   mauled  — it came the other way
--
-- Five rather than a boolean because the away log has to be able to say which, and because
-- "I walked away" and "it got away" are not the same evening.

create table hunts (
  id            bigserial primary key,
  settlement_id bigint not null references settlements (id) on delete cascade,

  -- Whose hunt. Cascades with them: a hunt is something a person was doing, and there is no
  -- reading of an unowned one — unlike a build, where the beam is still half-raised.
  character_id  bigint not null references characters (id) on delete cascade,

  seed          bigint not null,
  state         jsonb  not null default '{}'::jsonb,

  status        text not null default 'active'
                check (status in ('active', 'taken', 'bolted', 'lost', 'left', 'mauled')),

  started_at    timestamptz not null,
  resolved_at   timestamptz,

  constraint hunts_resolution_is_complete check (
    (status = 'active' and resolved_at is null)
    or (status <> 'active' and resolved_at is not null)
  )
);

-- One at a time per camp, the same shape `expeditions_one_active_idx` and the craft bench use.
-- Per camp rather than per survivor on purpose: the point of a hunt is that it is the thing
-- you do *instead* of the other things, and two of them running at once would make it the
-- thing you do as well as them.
create unique index hunts_one_active_idx
  on hunts (settlement_id)
  where status = 'active';

comment on table hunts is
  'A hunt in progress. The only row in this schema with no deadline on it: it advances when '
  'the player presses something. `state` is whatever src/game/hunting.js put there, and `seed` '
  'is what makes a reload redraw the same numbers.';
