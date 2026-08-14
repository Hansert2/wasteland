# Wasteland — the plan

A post-apocalyptic browser text RPG. You hold one camp and one survivor. The camp is
persistent and outlives its people; the survivor is not, and will eventually die of
something. The loop is checking in, reading what happened while you were gone, and
spending what you have on the next few hours.

Several source comments cite "the plan" (`src/game/constants.js`, `migrations/001_init.sql`).
This file is that plan, written down after the fact so it stops living only in a
conversation. Where the code departed from the original sketch, the departure is
recorded here rather than quietly forgotten.

## The load-bearing decisions

These are the ones that are painful to retrofit, so they are settled first.

**Structures and resources hang off `settlements`, never off `characters`.** That is
what makes the camp outlive its people. A survivor dying knocks the camp back a level
(`SUCCESSOR_STRUCTURE_LOSS`) and halves the stores; it does not erase them.

**One clock per settlement, not one per resource row.** `settlements.last_tick_at` is
the single timeline. Hunger, production and death all have to agree on what time it
is, and per-row clocks would let them drift apart.

**The simulation is a pure function of `(state, now)`.** `src/game/tick.js` has no
clock, no I/O and no global randomness. `src/db/world.js` is the only module that
speaks both Postgres and simulation vocabulary. This is what makes a month-long
absence testable in a millisecond.

**Outcomes are rolled from a seed stored on the row.** An expedition's result is
derived at resolution time from `expeditions.seed`, so a retried request replays the
trip instead of re-rolling the dice. Same for crafting.

**The interval is walked in slices, cut at pending event timestamps.** Death has to
land at a *timestamp*, not merely be detected — a 40-hour absence where the survivor
died at hour 12 resolves as 12h of survivor simulation, then death, then 28h of
settlement-only accrual.

**Time-to-death is a balance guard, not a preference.** Death is the price of
neglect, not of a weekend away. `test/unit/tick.test.js` asserts the window stays
between 36h and 72h from full health and empty stores, so a balance pass that makes
the game punish real life fails the suite.

## Phase 1 — the core loop ✅

Shipped. Auth and sessions, one settlement per account, the tick, structures and
build orders, expeditions, successors, the roster of the fallen.

Departures from the original sketch, and why:

- **`character_history` is a view, not a table.** Every column it would hold already
  lives on a dead `characters` row. A second copy of the truth would drift.
- **A `garden` structure was added.** The original structure list had no food
  producer, which would have made starvation unavoidable rather than a consequence of
  neglect — and the offline-death design rests on a camp being able to run
  food-positive.
- **`last_tick_at` moved from `resources` to `settlements`.** See above.
- **Production is derived from structures, not stored.** A cached rate has to be
  resynced on every build, upgrade and raid, and the failure mode is silent. Storage
  cap is the deliberate exception: keeping it a column lets the database enforce
  `amount <= storage_cap` as a real invariant.

## Phase 2 — recipes and crafting ✅

The workshop stops being only a scrap tap. Found materials plus stores become gear,
and gear changes what you survive.

- `recipes` and `craft_orders` (migration `005`). Recipes are content and live in
  `src/db/seed.js` alongside regions and items, because balance passes edit them and
  an applied migration cannot be edited.
- **A craft queue of one, separate from the build queue.** Sharing one queue would
  mean crafting a spear blocks upgrading the garden, which is not a decision anyone
  wants to make. Separate queues, one order each.
- **Starting a craft needs living hands; finishing does not.** Same rule as builds.
  But *delivery* needs hands too: if the survivor is dead when the order completes,
  the order is marked `lost` and the goods are forfeit, exactly as an expedition's
  haul is.
- **Gear is used automatically — there is no equip step.** The survivor carries the
  best weapon and the best armour they own and uses them. This matches the tick's
  existing "the survivor is not an idiot" auto-consume valve, and it avoids an
  equipment-slot table that would earn nothing.
- **Gear dies with its owner.** `inventory_items` hangs off `character_id`, and a
  successor is a new row with an empty pack. That is what lets crafted gear be
  permanent without trivialising the game: the vest is not an upgrade you keep, it is
  a reason this particular survivor lasted longer than the last one.
- Armour cuts hazard *damage*; a weapon cuts hazard *chance*. Both are capped, so no
  amount of gear makes the Deep Zone safe.
- **Gear shifts thresholds without changing what is drawn.** Equipment never takes an
  extra number out of the generator, so an unarmed trip rolls exactly what it rolled
  before crafting existed — same loot, same finds, same dose, roll for roll.

One departure from the load-bearing decisions above, recorded rather than forgotten:

- **Crafting rolls no dice, so `craft_orders` stores no seed.** "Outcomes are rolled
  from a seed stored on the row" was written to cover crafting too, but a craft turned
  out to have no outcome to roll: it either lands in the pack or it is forfeit, and
  which one is decided by whether anybody is alive at the completion hour. A seed
  column would have been a column that never moves.

## Phase 3 — raids

Threats that arrive on the tick rather than being sought out. `campStrength()` in
`src/game/structures.js` already exists and is already derived rather than stored,
because this is the number that decides when raiders take an interest.

Open questions: whether a raid can kill a survivor outright or only wound and steal;
whether the watchtower gives warning (a scheduled, visible raid) or only defence.
Leaning towards steal-and-wound plus visible warning — losing a survivor to something
you could not have seen while offline is the one death that would feel unfair.

## Phase 4 — world events

Global timed events (rad storms, caravans, blight) that modulate production and
expedition danger for everyone at once. Cheap to add to the tick — a table of events
with a window, and a multiplier applied in `accrueResources` and `resolveExpedition`.
Deliberately last of the mechanical phases: it is flavour on top of a loop, not new
decisions.

## Phase 5 — factions

Reputation, traders, gated regions. The largest phase: new tables, new pages, and it
touches expeditions, resources and items at once. Not started, and not designed —
doing it before the loop is proven would be building on sand.

## Not planned

- **Alts.** `settlements_player_idx` is unique on `player_id`. Drop it if this ever
  changes.
- **Down-migrations.** Rolling back a schema change means writing the next migration.
- **A build/craft queue longer than one.** Choosing what to build next *is* the game;
  a queue of five removes the choice.
