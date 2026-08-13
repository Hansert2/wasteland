# Wasteland RPG — Design & Build Plan (v2)

Post-apocalyptic browser text RPG. Ogame-style persistent state: resources accrue in
real time whether or not you're logged in, builds and expeditions run on timers.

## Resolved design tensions

### Permadeath vs. long-horizon progression
The core conflict: Ogame-style play rewards weeks of investment, permadeath erases it.
Resolution — **split what dies from what persists**:
- **The survivor dies.** Stats, skills, carried inventory, active expeditions — gone.
- **The camp persists** as a "settlement" tied to the account, at reduced capacity
  (e.g. structures drop a level or two, stored resources partly looted/spoiled).
- New survivor inherits the settlement and starts rebuilding from there.

This keeps death genuinely painful without making a bad roll delete three weeks of play.
It also gives permadeath a narrative frame that fits the genre: the settlement outlives
its people. The `character_history` table becomes a real feature — a roster of everyone
who died holding this camp.

**Confirmed:** settlement persistence (not hard permadeath). The game is designed for
indefinite base-building, not bounded runs — a settlement can outlive many survivors with
no target end date.

### Forced PvP vs. personal scope
Forced PvP requires other players, which you don't have and aren't planning for yet.
Resolution — **two-stage**:
- **Now (solo):** raids come from NPC factions. Once camp strength crosses a threshold,
  raider bands start showing up on a timer. Same mechanic, same tension, same
  `camp_strength` trigger, same defence value from the watchtower — just server-generated
  attackers. This is far less work than real PvP and makes camp defence matter immediately.
- **Later (if opened up):** swap the NPC attacker selection for real player targeting.
  The raid resolution logic, loot rules, and combat log are identical, so this is a
  targeting change, not a rewrite.

Design decision carried forward: **raids loot and damage, they don't permakill.** A raid
never kills the survivor directly, so forced raids never feel like a coin-flip run-ender.
(It can still kill indirectly — a raid that loots your food stores can starve you later.
That's fine: the death is downstream of a state you can see and respond to.)

### Hosting requirements
Because resource ticks are **lazy-evaluated on read** (elapsed time computed when you load
a page), the server doesn't need to be running for your resources to accrue — the math is
the same whether the process was up or down. NPC raids can also resolve lazily on login.

That means: **no always-on host needed.** Docker Desktop + WSL2 on your PC is fully
sufficient for the entire single-player game. A VPS only becomes necessary if you later
open it to other players, where raids must resolve against people who aren't logged in.

### Offline death (hunger & radiation)
Making hunger and radiation lethal collides with lazy evaluation: a survivor can die while
you're logged out. Resolution — **let it kill, with a safety valve.**

The two systems aren't symmetric, and that's what makes it fair:
- **Hunger is a flow.** The settlement produces food, the survivor consumes it. Log off
  net-positive and you can be gone for a month safely. Starvation only happens if you left
  the camp unsustainable — knowable and preventable at logout. This is also what gives food
  structures real economic weight.
- **Radiation is a stock.** It doesn't grow in camp; you carry it back from hot regions and
  it decays or gets treated. Offline radiation death means you came back glowing and didn't
  take the meds — a single visible decision, not an economy.

**Safety valve — the survivor isn't an idiot.** Before the tick applies lethal damage, the
survivor auto-consumes what's on hand: rations from settlement storage, anti-rad meds from
inventory. Death only lands when there was genuinely nothing left. This removes the deaths
that feel like the game cheating (starving with a full pantry) and keeps every real one.

**Rejected: floor offline decay at 1 HP.** It breaks the fiction, and worse, it makes
logging off invulnerable — the optimal play becomes "close the tab when nearly dead." Any
mechanic that rewards not playing is a bug. It's also more code, not less: the tick would
need to distinguish suppressed decay-death from allowed action-death.

**Tuning guard.** Size the buffer for real life. Roughly a day or two of health drain from
"food hits zero" to death, on top of several days of stored food — so a well-run camp
survives a week of absence. Death should be the price of neglect, not of a weekend away.
This matters more given the indefinite-base-building decision above; a harsh clock compounds
forever.

## Stack
- **Backend:** Node.js + Express
- **Database:** PostgreSQL (relational — lots of interrelated entities)
- **Frontend:** vanilla HTML/CSS/JS to start; text-heavy UI doesn't justify a framework
- **Local host:** Docker Compose under WSL2 (nginx, app, postgres, optional cron)
- **Persistence:** named Docker volume for Postgres so `compose down` doesn't wipe state
- **Later, if opened up:** same compose stack on a small VPS, plus cron for raid resolution

## Core systems

1. **Survivor** — health, hunger, radiation, stamina; skills in scavenging, combat,
   crafting, medicine; inventory and equipment. Hunger and radiation are lethal on their
   own — left unmanaged (no food/water, prolonged exposure) they drain health to zero,
   same as combat. Death isn't confined to expeditions, and can occur while logged out;
   see *Offline death* above for the auto-consume rule that guards it.
2. **Settlement** — persists across survivor deaths; structures (shelter, water purifier,
   workshop, watchtower) with build timers and resource costs
3. **Resources** — water, food, scrap, fuel; accrue per second, capped by storage,
   computed lazily on read
4. **Expeditions** — send survivor to a region for a timed duration; returns loot, story
   events, injuries, or death
5. **Combat** — turn-based text resolution with a readable log; from expeditions or raids
6. **Crafting** — recipes gated by skill level and workshop tier
7. **Raids (NPC)** — triggered above a camp strength threshold; watchtower level and
   defences determine losses; produces a combat log the player reads on next login
8. **Quests & factions** — branching text questlines, 3-4 factions with opposed goals,
   reputation shifting available content
9. **Settlement history** — roster of fallen survivors, days survived, cause of death

## Data model (high level)
- `players`, `characters`, `character_history`
- `settlements` (account-scoped, survives character death), `camp_structures`
- `resources` (amount, production_rate, storage_cap, last_tick_at)
- `items`, `inventory_items`, `recipes`
- `regions`, `expeditions`
- `factions`, `faction_reputation`
- `raids` (attacker source, outcome, loot taken — NPC now, player-targeted later)
- `world_events`

Note: attach structures and resources to `settlements`, not `characters` — this is what
makes the persistence-across-death model work, and retrofitting it later is painful.

## Architecture notes
- Keep game logic (tick math, combat resolution, raid resolution) as **pure functions**
  separate from Express routes — testable, and portable if the hosting model changes
- Lazy-evaluate everything possible; reserve cron strictly for things that genuinely
  can't wait for a login
- Treat `camp_strength` as a derived value (computed from structures + defences) rather
  than a stored column that can drift out of sync
- **The tick must compute *when* death happened, not just whether.** Because death can
  occur offline, a 40-hour absence where the survivor died at hour 12 has to resolve as:
  12 hours of survivor simulation → death → 28 hours of settlement-only accrual. Resources
  keep accruing after death (correct — the settlement outlives its people), but an
  expedition in flight resolves as lost, and `character_history.days_survived` needs the
  true death timestamp. This pushes `applyTick` from a closed-form multiply toward a small
  ordered event simulation — cheap to build now, ugly to retrofit later
- Pass `now` into the tick as a parameter rather than reading the clock inside it, so tests
  can fast-forward days without waiting

## Content plan
- 4-5 regions with escalating danger/reward: Ruined City, Irradiated Farmland,
  Underground Bunkers, Coastal Wreckage, The Deep Zone
- 3-4 factions: survivalist militia, tech scavengers, a cult, itinerant traders
- ~20-30 items and recipes for MVP
- Main questline of 10-15 story beats, plus repeatable expeditions and random events

## Roadmap

**Phase 1 — core loop**
Auth, survivor creation, settlement with 2-3 structures, resource ticks, one region with
expeditions, basic combat, ~10 items. No factions, no raids. Goal: is checking in fun?

**Phase 2 — death & depth**
Permadeath with settlement persistence, `character_history`, full crafting tree,
remaining regions, quests, factions, random events.

**Phase 3 — pressure**
NPC raids above camp strength threshold, watchtower/defence mechanics, world events.
This is where the game gets teeth.

**Phase 4 — polish (and optionally, other people)**
Balance pass, UI pass, mobile layout, more story. If you want others playing: move to a
VPS, add cron-based raid resolution, swap NPC raid targeting for player targeting,
add a leaderboard.

## Still open
None — all three open questions resolved.
