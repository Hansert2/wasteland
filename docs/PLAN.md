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

**An account owns a camp and never a person.** `player_id` appears on `settlements`
and `sessions`, and nowhere near `characters` — the chain is player → settlement →
characters. Registration founds the camp and stops there, so a new camp stands empty
until you say who is moving in, and the first survivor arrives through
`raiseSuccessor` like every one after them. There is no separate founder path to keep
in step with the successor path. The penalty knows the difference: it is skipped when
nobody has ever held the camp, because you cannot inherit a ruin from nobody.

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
- **The graveyard is a page, because nothing cleans up after the dead.** An expired
  survivor keeps their `inventory_items` rows and every expedition they ever made, so
  `/graveyard` can say what someone was carrying when they starved and where they went
  last — all of it already in the database and none of it previously read. The camp
  page keeps a one-line pointer rather than the roster table it used to hold. This is
  the only page that skips the tick: the dead do not change.
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

## The fuel track — a second currency ✅

**Scrap makes a structure bigger. Fuel makes it do something new.**

The split is not arbitrary, and it was latent in the game long before anything used
it: fuel is the one resource nothing in the camp produces, so it comes back only from
expeditions. Scrap is patience — the workshop makes it while you sleep. Fuel is
danger money. Pricing something in fuel therefore prices it in risk rather than in
waiting, and that is what makes the second currency buy a different *kind* of thing
instead of being a second helping of the first.

- **An upgrade has no levels.** The camp either has the capability or it does not. A
  second exponential track running beside the first would be a grind; one fitting
  that changes what a structure *does* is a fork.
- **Fitting shares the build queue.** It is one crew. Crafting deliberately does not
  share it — the bench is a different bench, which is the same reasoning that gave
  the craft queue its own slot in Phase 2.
- **An upgrade outlives its survivor only as far as its structure does.** Gear dies
  with its owner because it hangs off `character_id`; an upgrade hangs off the
  settlement, so it survives a death — unless the level it was bolted to does not.
  A successor knocks every structure back one, and a purifier dropped from 2 to 1
  cannot carry filtration, so the fuel has to be found again.

  This keeps "an upgrade needs its structure at level N" true at every moment rather
  than only at the moment of purchase, and stops the fuel track being the one thing
  in the game that a death cannot touch — gear is a total loss and stores are halved,
  so a permanently death-proof upgrade would be the odd one out, bought with the
  riskiest currency of all. The consequence is the interesting part: a structure
  built one level *past* its upgrade's requirement carries it through. Overbuilding
  is insurance, which is a decision worth having.
- **Definitions live in `src/game/structures.js` beside `STRUCTURES`, not in a
  table.** Structures have never been content — `camp_structures.kind` is a check
  constraint — so migration `006` records only which upgrades a camp has.

Built, because they pay off against mechanics that exist today:

- **water purifier → filtration.** Radiation leaves a survivor 2.5× faster *while
  they are in the camp*. This is the one that earns its keep immediately: radiation,
  not scrap, is what keeps a survivor at home between trips to the Deep Zone — a trip
  is worth about 30 rads and they decay at 0.8/h, so the camp is buying back nearly
  two days of waiting.

  The "in the camp" half is load-bearing rather than flavour, and simulating sixty
  days of play is what caught it. The filter left running while its owner was away
  scrubbed 36 rads over an 18-hour trip that doses 25, so a survivor came home cleaner
  than they left: radiation stopped being a constraint, and reckless play became
  *safer* than cautious play. Confined to the camp, the upgrade is worth about 46%
  more trips and cuts recovery from 32 hours to 13, while an aggressive player still
  dies exactly as often as they do without it. Ease the constraint, do not delete it.
- **workshop → machine shop.** Every craft takes a third less time, fixed at the hour
  the order starts, so a machine shop fitted midway does not hurry work already on
  the bench.

- **watchtower → radio.** Built with Phase 3. It puts the hour of the next raid on the
  camp page and does nothing else — the only upgrade with no multiplier. See Phase 3
  for why that is the right shape rather than a thin one.

Not built:

- **shelter → reinforced.** Cuts what a raid takes. No longer blocked — raids exist
  now — so this is simply undone rather than deferred. Worth weighing against the
  watchtower first: two upgrades that both reduce raid losses may be one too many, and
  the watchtower already has the job.
- **garden → greenhouse.** Survives blight and rad storms, neither of which exists.
  Still genuinely deferred, to Phase 4. Stubbing it now would be building on sand.

## Phase 3 — raids ✅

Threats that arrive on the tick rather than being sought out.

**Two numbers decide it, never one.** `campWealth()` is what draws raiders — structure
levels plus what is sitting in the stores. `campDefence()` is what blunts them, and
comes from the watchtower alone. Both are in `src/game/structures.js`, both derived
rather than stored.

They were one function until Phase 3 started. `campStrength()` added levels and
defence together with defence weighted eight per level, so a single watchtower took a
starting camp from 3 to 12 while a camp with sixteen levels of infrastructure and no
defence scored 16. Anything reading that number to decide raider interest would have
made the one building meant to protect you the one that most invited attack. It is
split, and a test now asserts that fortifying a camp does not change what it is worth
to a raider.

**Settled: a raid steals and wounds, and never kills outright.** Losing a survivor to
something you could not have seen while offline is the one death that would feel
unfair. The tick holds a raided survivor at 1 health rather than killing them, and a
test asserts that across 200 seeds against someone already at 1.

That rule turns out to hold structurally, not just at the moment of the raid: a raid
takes a share of *current stores* and never touches production, so a food-positive
camp always recovers. Raiders cannot starve a working camp even indirectly, which is
what makes "no unfair offline death" true rather than merely intended.

**The schedule may only depend on structures, never on stores.** This is a real
constraint rather than a preference. Stores accrue continuously, so their value at a
given instant differs in the last decimal places depending on how the interval was
sliced; scheduling from that made the next raid's hour drift between a one-minute walk
and a seven-hour one, and the drift compounded across a month. Structure levels are
integers that change only at build completions, which are themselves slice boundaries.
It reads better anyway — what raiders notice from outside is the buildings, and what
they carry off depends on the stores, which `resolveRaid` still sees in full.

Measured over thirty days of total neglect, eight seeds each:

    camp                    raids  repelled  taken   died
    starting camp             4.1       0.0   1145    0/8
    established, no tower     7.8       0.0   8564    0/8
    established, tower 3      2.5       5.3   1006    0/8
    established, tower 6      1.8       6.0    707    0/8

Nobody dies in any configuration, and the watchtower stops being decoration: it repels
most raids and cuts losses roughly eightfold, while wealth stays flat at 16 whatever
its level. Leave a rich camp undefended for a month and it is picked clean, which is
the intended price of hoarding without walls.

One honest weakness: the wound half of "steal and wound" is nearly invisible to an
offline player, because regeneration outpaces it between visits days apart. It matters
when you log in straight after a raid and want to send someone somewhere dangerous,
and it is deliberately not allowed to compound into death — but it is much the weaker
half of the mechanic.

**The watchtower → radio branch is the warning half, and it changes nothing in the
simulation.** It is the only upgrade with no multiplier: it puts the hour of the next
raid on the camp page, and that is all. A test asserts it neither reschedules the raid
it reports nor conjures one.

That is what makes the watchtower's two jobs genuinely different purchases rather than
two readings of one number. Its scrap levels protect you while you are *gone*; the
radio helps only while you are *here*. An offline player gains nothing from it, which
is the right shape — and the useful response to a warning is to spend the stores,
since stores are all a raid can take. Warned, a hoard becomes a decision: put it into
a build or onto the bench, where nobody can carry it off.

The watchtower question is settled by the fuel track, and settled as *both*: scrap
levels buy defence, the radio branch buys warning. That turns two competing readings
of one number into two distinct purchases in two different currencies.

## Phase 4 — world events ✅

Global timed events — rad storms, caravans, blight — that modulate production and
expedition danger for everyone at once.

**This was filed as "flavour on top of a loop, not new decisions", and that turned out
to be true of any single event and false of the set.** A rad storm makes going out
expensive; a caravan season makes it lucrative. They overlap freely, so the one
question the game already asks — send them now or wait — gets an answer that changes
week to week, and sometimes an answer that costs something either way.

**No settlement_id, and no scheduler.** Every camp is under the same sky, which is
what makes an event something that happened to the world rather than to you. Nothing
generates these on a timer, because there is no cron anywhere in this project and a
game that resolves an eight-week absence on the next page load should not need a
process to have been running for the weather to have happened. Instead `slot` is the
nth event the world has ever had, the whole row derives from one fixed world seed plus
that number, and any tick that needs slot 41 generates slot 41. The primary key makes
that safe under concurrency: two camps ticking together both compute the missing
slots, one wins the insert, and the other's `do nothing` is the right answer.

- **Windows are half-open** — an event covers its start and not its end — so weather
  that ends exactly as the next begins never double-counts.
- **Multipliers scale what a roll produced, never how many rolls were taken.** The
  same rule gear follows, for the same reason: a trip under clear skies must be
  identical to one taken before there was such a thing as weather, and a test asserts
  the whole simulation is unchanged when nothing is in force.
- **Slices are cut at weather boundaries**, so a blight beginning at hour 10 of a
  20-hour absence halves the garden from hour 10 rather than from login. The tick's
  slice walk gained a `from` parameter to sample the sky at the start of each slice,
  since an event beginning exactly at the slice's end belongs to the next one.
- Overlapping weather composes multiplicatively. Two blights are worse than one.
- **Generation is proportional to the window being simulated, never to the age of the
  world.** Slots are deliberately not required to be contiguous: `ensureWorldEvents`
  fills only the slots that could overlap `[from, until]`, in one batched insert. The
  first version generated every slot from the epoch up to the horizon, which is
  invisible while the horizon is today and ruinous the moment it is not — a db test
  that simulates the year 2287 was generating some twenty-four thousand rows per tick,
  one insert at a time, none of which could overlap the window it asked about. It took
  the database suite from nine seconds to a hundred and sixty. This property is what
  has to hold for a game still running years from now, so it is a rule and not a
  tuning detail.

## What the numbers actually do

Measured against what shipped, not against intent. Filtration taught the lesson that
made this section exist: it was designed to ease a constraint and turned out to delete
it, and only simulating sixty days of play found that out.

**Danger does not pay per hour. It pays per trip, and it pays in materials.**

    region                 danger  hours  loot/h  rads/h  finds/trip  hurt
    The Ruined City             1      4    3.26    0.00        0.25   9.9%
    Irradiated Farmland         2      6    3.16    1.33        0.15  17.8%
    Underground Bunkers         3      9    2.84    0.22        1.07  26.7%
    Coastal Wreckage            4     12    3.75    0.33        1.33  35.3%
    The Deep Zone               5     18    3.34    1.38        2.16  45.0%

Loot per hour is flat — 2.84 to 3.75 across the whole map — because loot ranges and
travel times escalate together and cancel. Per *trip* the spread is real: 13 units
from the city against 60 from the Deep Zone, and finds go from 0.25 to 2.16. Fuel
drops only in the bottom three rows.

This is defensible and worth keeping, because a check-in game is limited by check-ins
rather than by hours: one expedition runs at a time, so what a player actually
collects is per trip. And the danger tiers still gate the things that matter —
scavenged parts and fuel, which is to say all of crafting and the whole fuel track.
The honest caveat is that a player who checks in constantly and re-sends immediately
is rationally steered to the safest region for bulk resources. Left as it is
deliberately: retuning the loot ranges would invalidate everything below.

**A healthy survivor cannot die on an expedition.** Maximum hazard damage at danger 5
is 45 against 100 health, so death threatens only the already-wounded. That makes the
real risk *going out hurt* — impatience — rather than bad luck, which is the same
shape as everything else here.

**Gear's value is survival, not damage.** In the Deep Zone it saves about 6 damage a
trip, which regenerates in three hours and is nearly irrelevant. What it does is this:

    survivor at 35 health, Deep Zone     no gear  16.2% dead  ->  spear + vest  0.0%
    survivor at 20 health, Deep Zone     no gear  37.5% dead  ->  spear + vest 20.2%

"The difference between limping home and not coming home" is the plate vest's flavour
text, written before any of this was measured, and it turns out to be literally what
the numbers say.

**A death costs about a week of camp production, at any size.** Undoing the successor
penalty costs 160 scrap at a level 2 camp and 1049 at level 6 — but 6.7 days and 8.8
days respectively, because exponential costs and exponential production very nearly
cancel. A death is a weighty, consistent setback rather than one that scales into
ruin, which is what makes starting again bearable.

## Phase 5 — factions

Reputation, traders, gated regions. The largest phase: new tables, new pages, and it
touches expeditions, resources and items at once. Not started, and mostly not designed.

**Settled in advance, because it is the one decision that could quietly undo an
earlier phase: trade may never produce fuel.** Traders deal in scrap, food, water and
items, and never in fuel.

Fuel is the only resource nothing in the camp produces — it comes back solely from the
loot of the three most dangerous regions. That is what the whole fuel track is priced
against: scrap is patience, fuel is danger money, and filtration, the machine shop and
the radio are all things you earned by going somewhere unpleasant. A trader selling
fuel for scrap would make the second currency reachable without risk, and the fuel
track would collapse into the first one.

Note that `test/unit/structures.test.js` guards this from one direction only — it
asserts no *structure* produces fuel. A trader would walk straight past that test.
This paragraph is the guard until there is code to point one at.

Still open, and worth settling before building rather than during: whether reputation
gates **regions**, **prices**, or **who raids you** — that last would wire this phase
back into Phase 3 — and whether traders need a page of their own or fold into the camp.

## Not planned

- **Alts.** `settlements_player_idx` is unique on `player_id`. Drop it if this ever
  changes.
- **Down-migrations.** Rolling back a schema change means writing the next migration.
- **A build/craft queue longer than one.** Choosing what to build next *is* the game;
  a queue of five removes the choice.
