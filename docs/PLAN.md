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
- **garden → greenhouse.** Survives blight and rad storms — which exist now, so this
  is no longer blocked either. Undone rather than deferred, and the open question is
  balance: blight is the main thing world events do to a camp, and an upgrade that
  ignores it needs the same scrutiny filtration got before it ships.

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
(Re-measured 2026-08-14 after the pacing rescale added the two short regions — the
original version of this table predated them and understated the top row badly.)

    region                 danger  hours  loot/h  rads/h  finds/trip  hurt
    The Fence Line              1   0.17   29.45    0.00        0.00   8.3%
    The Old Service Road        1   0.75   15.97    0.00        0.15   9.1%
    The Ruined City             1      4    3.26    0.00        0.25   9.9%
    Irradiated Farmland         2      6    3.16    1.33        0.15  17.8%
    Underground Bunkers         3      9    2.84    0.22        1.07  26.7%
    Coastal Wreckage            4     12    3.75    0.33        1.33  35.3%
    The Deep Zone               5     18    3.34    1.38        2.16  45.0%

Among the long regions, loot per hour is flat — 2.84 to 3.75 — because ranges and
travel times escalate together and cancel. Per *trip* the spread is real: 13 units
from the city against 60 from the Deep Zone, and finds go from 0.25 to 2.16. Fuel
drops only in the bottom three rows.

**The Fence Line is a ~24 scrap/h faucet for an attentive player, roughly seven times
any long region, and it never stops paying. Measured, considered, and kept.** The
reasons, so nobody rediscovers this as a bug:

- Builds self-limit against it. The cost curve is exponential, so a level-9 build
  costs about twelve hours of checking in every ten minutes — some seventy visits.
  The faucet funds the fast early levels it was added for and cannot meaningfully
  fund the late ones; patience runs out long before the curve does.
- It pays in nothing but bulk. No finds, no fuel, no parts — everything that matters
  past the on-ramp still requires danger. The short regions make the camp bigger;
  only the long ones make it *capable*.
- Trimming it costs the thing it exists for: dropping the loot enough to matter
  removes one of the four first-hour builds, and the first hour containing a game is
  the whole point of the rescale.

**The ceiling it sets is a constraint on Phase 5, recorded there:** any flat
scrap-priced good a trader offers is implicitly priced in fence-visits at 24/h, and
must be priced against that ceiling — not against idle workshop production, which is
an order of magnitude lower.

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

**A death costs one to two days of camp production, at any size.** Undoing the
successor penalty costs 35 scrap at a level 2 camp and 284 at level 6 — but 1.5 days
and 2.4 days respectively, because exponential costs and exponential production very
nearly cancel. A death is a weighty, consistent setback rather than one that scales
into ruin, which is what makes starting again bearable. (It was about a week before
the pacing rescale; the whole game moves faster now, and this moved with it.)

## Pacing: the first hour has to contain a game

The opening move used to be a four-hour wait. A new camp holds 10 scrap, the cheapest
build cost 20, and the workshop starts at level 0 producing nothing — so the only
available action was a four-hour expedition, and the first structure finished around
hour eight.

**Time was never the binding constraint early. Scrap was.** Simulating the first hour
with a fast build curve and nothing else produced exactly one build, at thirty
seconds, followed by the same wall — because scrap income is denominated per hour and
a minute-scale loop needs a minute-scale income. That is why this is one change and
not two:

- **The build curve runs from seconds to days.** Half a minute and four scrap for a
  first garden, a quarter hour by level five, hours by level nine, days past twelve.
  Same exponential shape, far lower base. Craft times moved with it — three to
  twenty-four minutes — and fuel-upgrade fittings came down to an hour or so, longer
  than a craft on purpose: a fitting is a capability the camp keeps forever.
- **Two short regions.** The Fence Line at ten minutes and the Old Service Road at
  forty-five, paying little. They are the only minute-scale source of scrap, and
  therefore the thing that makes the fast levels reachable at all. A cheap build you
  cannot afford is not an improvement.

**A level is now worth half what it was, and there are twice as many of them.** The
first rescale cut times and costs without touching output, which made the same
production roughly three times cheaper to reach. This second pass puts that back:
every `perLevel` was halved, starting levels doubled so a new camp is handed exactly
the camp it was handed before, and both growth exponents replaced by their square
roots so the curve keeps its shape across twice the steps. Reaching a given output is
deliberately about **2.3× dearer and 2.4× longer** than it was an hour ago.

The square roots are not decoration. Doubling the level count under the old exponent
would have put a garden of twelve food an hour at two hundred thousand scrap instead
of two and a half — the arithmetic was checked before any of it was written.

Two things had to move with it, and both are the sort of thing that would have been
found much later by someone confused:

- **`campWealth` counts half a point per level.** Levels doubled, so counting them
  whole would have doubled every camp's apparent wealth overnight and with it how
  often raiders call, for no change in what the camp actually holds.
- **Everything that names a level was restated**: fuel upgrades want level 4, recipes
  want workshop 2 and 4, and the successor knock takes two levels, which is the one
  level it always was.

Measured after: a new camp is indistinguishable from the player's side — food +0.7/h,
water +1.75/h, next garden 7 scrap and a minute — and an attentive first hour still
buys five builds. Only the numbers on the level counters changed, and the distance
between here and a big camp.

**Build time is deliberately steeper than that square root, and it is the one number
here chosen from measurement rather than derived.** Growing time and cost together
left the build crew idle 7% of the time, and that quietly retired the queue of one:

    time growth      crew busy at garden level 6 / 10 / 16 / 20 / 26
    1.414 (paired)      7%    9%   14%   19%    30%
    1.5   (chosen)      8%   13%   29%   50%   100%
    1.55                9%   17%   45%   88%   100%

A queue of one only forces a choice while the crew is the scarce thing. It had
stopped being scarce — not because the queue got longer but because it became
instant — so nothing was ever built *instead of* anything, and "choosing what to
build next is the game" had become false while nobody was looking.

At 1.5 the early game stays click-heavy, which is what onboarding needs and what the
8% figure means; the middle is a real coin-toss between waiting for scrap and waiting
for the crew; and the deep game is time-gated the way the original curve was. Steeper
values were measured and rejected: 1.55 and 1.6 put a single late level at thirty and
seventy days, which is the same failure wearing the other hat.

Onboarding is untouched by it — identical build counts through the first twelve hours
— because early play is gated on scrap, not on the crew. That is the 8% saying the
same thing twice.

Measured, first hour, attentive player: **one build without the short regions, four
with them** — and a return to read every ten minutes. Four structure levels at ten
minutes, seven at an hour, eleven at three hours, twenty at twelve.

**Deliberately left slow: the long regions.** Four to eighteen hours is what you set
running before closing the tab. Building and crafting are the active loop, expeditions
the idle one, and a game that is all active loop has given up the thing that made it
worth checking in on. The survivor's hunger and radiation rates are untouched for the
same reason — the 36-to-72-hour starvation guard depends on them.

Two properties were re-measured afterwards rather than assumed. Raid cadence tracks
structure levels, and faster levelling could have meant raids at their 48-hour floor
almost immediately; it does not — 7.4 days between raids ten minutes in, 3.5 days at
twelve hours, 2.4 after a week. And the successor penalty fell from a week to a day
or two, recorded above.

## Phase 5 — factions ✅

Designed and built 2026-08-14. The design survived contact with the code with one
departure, recorded below where it happened.

**Two rival factions, and every gain with one costs standing with the other.** A
reputation that only ever rises is a bar that fills, not a decision. One rivalry axis
— a single slider between two crews — is legible in a way three-faction politics is
not, and nothing stops a third faction arriving later once the machinery exists.

Both factions **trade and raid**. This is load-bearing: if one faction were the
traders and the other the raiders, the choice would collapse — everyone befriends the
shopkeeper. Because both do both, siding with either means better prices and calmer
raids from one crew, and worse terms and nastier visits from the other. There is no
correct answer, only a preference.

**Reputation gates prices and raids. Not regions, for now.** Standing sets trade
terms — strangers pay a premium, friends get fair rates — and decides whose raiders
take an interest: a faction's raids come less often and softer as standing rises,
more often and harder as it falls. Region-gating (faction territory behind a trust
wall) is deliberately deferred; it is the biggest build of the three and reputation
should prove itself as a mechanic before earning new content.

**Reputation hangs off the settlement and takes a knock on succession**, exactly the
structures pattern: the camp is what factions deal with, but the new face at the gate
is not the one they trusted, so standing decays toward neutral when a survivor dies.
Camp-permanent reputation would be the one investment death cannot touch — the same
oddity the fuel track was deliberately denied — and survivor-held reputation would
start every successor cold with everyone, which is punishment stacked on a penalty
that is already priced.

**Traders arrive as visiting caravans, on the raid-scheduling pattern.** A caravan
is a window of hours at *your* camp — scheduled per settlement from a seed and a
count, exactly as raids are, so a month-long absence resolves the visits it missed
deterministically and nothing needs a cron. While the window is open the camp page
shows that faction's offers; when it closes, it closes. Missable on purpose: the
check-in loop is the game, and an always-open market would be the one mechanic that
ignores time. Which faction's caravan comes, and what it carries, derive from the
seed — standing tilts how often each side bothers to visit.

Buying is what earns standing (commerce is trust): +6 with the seller, −3 with the
rival, clamped at ±100 — deliberately not zero-sum, so a camp trading with both crews
drifts warmer with the world overall. Standing prices the goods (×1.4 hostile through
×0.6 trusted) and tempers that crew's raids. Trading needs living hands, like every
other verb.

**One departure from the design as first written: visit frequency ignores standing.**
The draft said standing would tilt how often each side bothers to visit. Building it
showed why it must not: trading is the only way to recover standing, so a hostile
crew that stopped visiting would make the rivalry a one-way ratchet — dig deep enough
and the road back is bricked over. So even the crew that hates you shows up, charges
you forty percent over the odds, and that *is* the road back. It also keeps the visit
schedule derivable from seed and count alone, which is what the slice-independence
guarantee wants anyway. A test pins the property by asserting `caravanVisit` takes
two arguments and nothing else.

Measured before shipping, thirty days of neglect, established camp, eight seeds:

    standing with both crews    raids   taken    died
    hated  (-90)                 11.5   12267     0/8
    strangers (0)                 7.8    8564     0/8
    trusted (+90)                 4.1    2599     0/8

A ~4.7× swing in losses across the standing range, and the never-kills rule holds at
every point of it.

One watch item, recorded rather than hidden: **offers are unlimited within a visit
window.** Nothing today is exploitable through that — bulk food competes with a free
garden, and everything worth hoarding is priced in fuel — but any future offer should
be checked against "what if they buy forty of these in one visit" before it ships.

Mechanically this reuses what exists rather than inventing: caravan scheduling is the
raid scheduler with a friendlier payload, faction attribution rides on the raid seed
already stored, offers are content in the seed script like recipes, and the
settlement lock already serialises trades against ticks. New schema is small — a
`factions` seed table, a `faction_standing` row per settlement per faction, and
caravan bookkeeping on `settlements` mirroring the raid columns.

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

**Second settled constraint: trader prices are set against the fence, not the
workshop.** An attentive player's scrap income is ~24/h from the Fence Line (see the
measured table above), an order of magnitude over idle production. Any flat
scrap-priced good is therefore implicitly priced in ten-minute fence visits, and a
price that looks steep against a workshop is trivial against the fence. Either
denominate trader stock in the things the fence cannot produce — fuel, parts, found
items — or price scrap goods against the 24/h ceiling and say so in a comment at the
price table.

The questions this section used to hold open — what reputation gates, who holds it,
how traders arrive, whether standing can fall — were all settled above on 2026-08-14.
Region-gating is the one deliberately parked rather than decided.

## The next three phases — designed 2026-08-17, none of them built

Every phase above shipped, and then the player played it. The verdict was "a bit dull",
and pressed on what that meant it came back as three things and not one: **too little
happens per visit, nothing is a surprise, and there is nothing to work toward.** The
five commits before this section were decimals and live counters — polish, which makes
a thin loop legible without making it thicker.

Two directions were settled at the same time and constrain all three phases. **Play
leans active**: the game should reward checking in, not merely tolerate it. And **other
camps become visible but never interactive** — news, neighbours, rankings, wreckage, and
nothing another camp can do to yours.

One diagnosis was raised and rejected, recorded so it is not raised again as if it were
new. The survivor is mechanically interchangeable — `stamina`, `skill_combat`,
`skill_crafting` and `skill_medicine` have been columns since migration `001` that
nothing reads, and `skill_scavenging` is read once in `src/game/expeditions.js` for a
+10% loot multiplier that nothing ever raises above its default of 1, so it is
permanently 1.0. That is all true, and it is not what the game feels short of. It
returns in Phase 7, where three concurrent people make a difference between them into a
decision; one sequential person only made it flavour.

### Phase 6 — encounters in the field

*Against: no surprises, too little per visit.* Worked through in detail 2026-08-17;
still not built.

An expedition is a dispatch and a log. You pick a region, and some hours later you read
what was decided the instant you clicked. Everything between departure and return is a
timer, and the only uncertainty in the game resolves while nobody is watching.

**A trip becomes a handful of moments rather than one roll.** Each expedition draws,
from the seed it already carries, a small number of moments at known hours of the trip —
a sealed door, a lit fire in the distance, a choice of routes. A moment is a half-open
window. Load the camp page while one is open and you choose; miss it and the survivor
chooses for themselves.

**The unattended outcome is exactly the game as it stands today, and this is the
load-bearing rule.** The default for every moment is what the expedition would have done
before Phase 6 existed. Attending can add upside and a risk you knowingly took; it can
never restore a baseline that absence took away. Death is the price of neglect, not of a
weekend away — and by the same logic a thinner haul must not be the price of a working
day. This is what lets an active-leaning phase ship without quietly converting the idle
loop into a punishment.

#### Three generators, and why the base one is never touched

**Moments must not change what is drawn.** Same rule as gear and as weather, for the
third time and the same reason. The mechanism is the part worth writing down: moments
and their consequences draw from **separate generators salted off the same seed** —
`makeRandom(mix(seed, 'moments'))` and `makeRandom(mix(seed, 'timeline'))` — and never
from the one `resolveExpedition` already opens. The base draw sequence is therefore
untouched by construction rather than by discipline, and a trip where every moment
defaults is identical to one taken before encounters existed, roll for roll, without
anyone having to remember not to break it.

#### The timeline: how a mid-trip report can be true

A moment reports the trip honestly — *"six hours in, carrying 22 scrap, took 14 damage
from a collapsing floor"* — and that is the whole reason attending is worth doing. It is
also the one thing here that cannot be faked, because the numbers have to agree with
what eventually lands in the stores.

So the base outcome gains a **timeline**: the same rolls as today, *attributed to hours*.
The timeline generator places the hazard at an hour, places each find at an hour, and
splits the loot across segments. Because it is a separate generator, the totals are
identical to today's; only their distribution in time is new, and on an unattended trip
that distribution is never observed by anyone. `stateAt(timeline, hours)` is then a pure
function giving the truthful report at any instant.

This is the largest single piece of Phase 6 and it exists solely to make the report real
rather than estimated. The cheaper version — reporting only the survivor's condition —
was considered and rejected: without a haul-so-far there is nothing to weigh, and a
moment degrades from a situation into a prompt.

**The timeline is a reporting projection. The simulation still resolves exactly once, at
`returns_at`.** This is the correction that keeps the whole phase honest, and it was
nearly missed. If the timeline were the simulation — if a hazard placed at hour 11 killed
the survivor at hour 11 — then they would stop eating seven hours earlier than they do
today, and the unattended trip would no longer be identical. The guarantee would break
quietly, in the way that is hardest to notice.

So damage is *reported* as taken at hour 11 and *applied* on return, which is already how
the game works and was simply never visible. Health at a moment, which the lethality rule
needs, is therefore `current health − damage reported so far`: a computed value, not a
simulated one. Nothing about when anybody dies changes.

#### Settled: how the haul is attributed, and why there is nothing to reconcile

The question was first written down as "splitting integer loot across segments so the
parts sum exactly", which is a genuinely awkward problem — largest remainder, drift,
reconciliation at the end. It was the wrong framing, and the right one dissolves it.

**Do not split. Define the cumulative directly:**

    carried(kind, h) = floor(total[kind] × progress(h) + jitter[kind])

`progress` is monotone with `progress(0) = 0` and `progress(1) = 1`. Exactness at the
end is then automatic — there are no parts to reconcile and no error to accumulate — and
the report can never go backwards because `progress` never does. An entire class of bug
stops existing rather than getting solved.

`jitter[kind]` is a value in `[0, 1)` drawn per resource per trip from the timeline
generator. Without it, `floor` puts a haul of one scrap at the very last instant of the
trip and nowhere else; with it, small hauls surface somewhere sensible instead.
Exactness survives untouched, because `floor(total + jitter) = total` for an integer
total and a jitter under one.

**`floor` rather than `round`, deliberately:** never report something they have not
picked up yet. It also gives turning back the right shape — bailing at nine tenths of the
way brings home nine tenths, and nothing is rounded up as a parting gift.

**`progress` is shaped, not linear:** little on the way out, most of it in the middle,
little on the walk home. Any monotone curve anchored at 0 and 1 is safe, so this is free
to tune. Per-trip jitter on the *curve* is deliberately left out for now — the per-kind
offset already breaks up the mechanical feel, and a jittered curve is one more thing that
has to be proven to still end at exactly 1.

Radiation takes the same treatment at one decimal place. Finds and the hazard are not
quantities but discrete events: the timeline generator gives each an hour, and they are
reported once that hour has passed. Exact by construction, nothing to sum.

Choices extend the curve piecewise rather than replacing it. Pressing on at hour 11 adds
its bonus over the hours that remain; turning back at hour 11 banks `carried(kind, 11)`
and forfeits the rest, which is exact by definition rather than by arithmetic.

**The haul is shown on the camp page whenever a survivor is out, not only at a moment.**
An expedition in flight stops being a bare countdown and becomes something worth looking
at — which is the "too little per visit" complaint answered on every check-in rather than
only on the two or three that happen to catch a window. It costs the moments nothing:
what makes a moment special is the *choice*, and the choice is still only there while the
window is open.

#### What the tick has to do: nothing

Recorded as a **departure from this phase as first sketched.** The sketch said a moment
would be "one more timestamp" for the slice walk. It is not. A trip already resolves in
one shot at `returns_at`, so a choice is simply an extra input to `resolveExpedition`,
and the pure signature grows one argument:

    resolveExpedition({ region, survivor, seed, weather, choices })

`choices` defaults to empty, which is today's game. The slice walk, the event types and
the tick's structure are all untouched. The one exception is turning back, which moves
`returns_at` — and that is a write at the moment of choosing, not a slice boundary.

#### Schema: one column

Moments derive from the seed, so they are never stored. Only the player's answers are:
`choices jsonb not null default '[]'` on `expeditions`, holding `{index, option}` pairs.
The settlement lock already serialises this against ticks, exactly as it does trades.

#### Where the moments fall, and how missable they are

Count scales with travel time — none below two hours, one at four to six, two at nine to
twelve, three at eighteen. The short regions deliberately have none: a ten-minute fence
run has no interior to have a moment in, and the fence is already the attentive player's
faucet.

Windows are proportional to the trip rather than fixed, which is the answer to the
question of whether this becomes a page you have to sit on. Roughly `travel_hours ÷
(count × 1.75)`, floored at about forty-five minutes: three and a half hours on a Deep
Zone run, two and a half in the Bunkers. Moments are also placed in the trip's interior,
never in the first or last tenth, so there is always a report worth reading and always
enough trip left for the choice to matter.

**The first draft of this said `× 3`, and claimed two or three check-ins would catch most
moments. The arithmetic did not agree**, which is recorded because it is the sort of
error that reads as fine and ships as disappointment: three two-hour windows in an
eighteen-hour trip leave only a third of it open, so three check-ins catch about *one*
moment of the three. The design promised an experience its own numbers did not deliver.

At `× 1.75` coverage is a little under sixty percent, and the honest claim is: **one
check-in during a long trip usually finds something open, two nearly always do, and
catching all of them still takes either attention or the radio.** Full coverage was
deliberately not chosen — an always-answerable moment would make timing worthless, which
would strip the radio of the job the next paragraph gives it, and would repeat the
mistake Phase 5 avoided when it made caravans missable. This also leans on something
already settled: the haul shows continuously, so a visit that catches no window is not an
empty one.

**The radio gets a second job, and it is the same job it already has.** Without it, you
find a moment by happening to load the page inside its window. With it, the camp page
says when the next one is due. Its scrap levels protect you while you are gone; the radio
helps only while you are here — which is exactly what was written about it in Phase 3,
now paying off twice.

**The consequence is accepted rather than overlooked: Phase 6 is faint until watchtower
4.** Timing a check-in is the radio's to sell, so a camp without one meets moments by
luck. Moving the hour off the radio was considered and rejected — it is the one upgrade
with no multiplier, and taking away the only thing it sells to make a new phase land
sooner would leave it with nothing. The widened windows above are what keep the phase
playable in the meantime, and the continuously shown haul is what keeps an ungated visit
worth making.

#### The verbs — a closed vocabulary, widened to fit the content

All priced in things that already exist:

- **Press on** — more loot from the remaining stretch, at more danger and more hours.
- **Investigate** — spend hours for a shot at a find.
- **Spend** — burn food, water or meds from the pack for a margin.
- **Wait** — give up hours to avoid something: a dose, a hazard, a thing on your trail.
- **Confront** — settle a threat now rather than carry it, at whatever health they have.
- **Parley** — deal with whoever is out there; the outcome comes from standing.
- **Turn back** — bank what the timeline says they are carrying, forfeit the rest, and
  start for home. The defensive verb, and the one that makes the report load-bearing: you
  turn back *because* the news was bad. Without it, attending is only ever greed, and a
  decision with upside on every branch is not a decision.

**The first four of these were the whole list, and the content outgrew it while the
exemplars were being written.** *Sit it out*, *go to ground*, *turn and face it* and
*hail them* were none of press on, investigate, spend or turn back — so the taxonomy was
describing a smaller game than the one being designed. Recorded rather than quietly
patched, because the alternative on the table was free-form effect specs per moment, and
that trade is worth naming: a closed vocabulary means shared effect code and uniform
tests, and it costs a plan edit every time content needs a verb that does not exist yet.
That is the right price here — the verb list is short, and a moment that needs an eighth
verb is a moment worth thinking about twice.

**Turning back is offered at every moment rather than being a moment of its own.** It is
the standing option underneath all of them, which means the report always has a use and
no encounter ever has to be written to ask "should they come home."

#### Turning back has to cost a walk home, or it dominates everything

Caught in an audit of this section against itself, and it is the one real bug the design
had rather than a gap in it. `progress` tapers at the end — little loot on the walk home —
and turning back was written as *come home early* with no cost attached. Those two
together make bailing at four fifths of the way strictly optimal on **every** trip: you
forfeit almost no loot and save a fifth of the hours. The defensive verb becomes a
mandatory click, and attending stops being a reward and starts being a chore.

The game has no distance model to fix it with — `travel_hours` is a single number and
`returns_at` is `now + travel_hours`. So one is invented, and kept as small as it can be:
**a survivor is as far from home as the trip's midpoint implies, and turning back at hour
`h` of `H` costs `min(h, H − h) × 0.5` hours before they are through the gate.**

    turn back at   walk home   home at   saved
    hour 2 of 18       1.0h      3.0h    15.0h
    hour 9 of 18       4.5h     13.5h     4.5h
    hour 16 of 18      1.0h     17.0h      1.0h

Cheap when they have barely set out, expensive in the middle where they are furthest from
anywhere, and worth almost nothing near the end — which is exactly when it should be
worth almost nothing. Bailing late now saves an hour and forfeits about an hour's loot,
so it is neutral rather than free, and the verb goes back to meaning what it was written
to mean: you abandon a trip when the news is bad enough to justify abandoning it.

#### The content, and the rule that keeps it from rotting

Encounter content fails in a predictable way, and the failure is structural rather than
a writing problem: twenty moments get written, they all reduce to *press on for more* or
*hold back for less*, and within three trips the player stops reading the prose and picks
the known-best option. The writing becomes decoration on a multiplier. No amount of good
prose survives that, so the shape has to prevent it.

**Each moment keys off a different piece of state, and no two moments on one trip may
key off the same one.** A Deep Zone run then asks three genuinely different questions
instead of the same question three times. It is enforceable at generation and it is a
test, not an intention.

The axes:

    axis          the question it actually asks
    health        how hurt are they right now
    radiation     the dose so far, and whether meds are in the pack
    time          when they get home — a raid due, or you wanting them out again
    haul          what they are already carrying, and whether the camp can even store it
    supplies      what is actually in the pack
    standing      whose people these are, and what they think of the camp

**Two of those axes wire Phase 6 into phases that already shipped, which is the point.**
*Time* makes "+2 hours for a shot at a find" a completely different decision when the
radio says raiders are due in four — Phase 3 and Phase 6 talking to each other with no
new mechanics between them. *Standing* was found while writing the exemplars below and
is the reason there are six axes and not the five first sketched: it puts the rivalry out
in the field instead of only at the gate, and it costs nothing but content because
`standingOf` and `rivalOf` already exist.

*Haul* has a second-order property worth keeping: loot over the storage cap is already
simply lost, so overloading is worthless to a camp with a full shelter. The decision
reaches back into the camp rather than staying on the road.

#### Six exemplars, one per axis

Written to the established voice — flat declarative, then a turn — and fully specified,
so the shape can be judged before twenty more are written. Defaults are marked; the
default is always what a sensible person does alone, because the tick's survivor has
never been an idiot.

**Time — the welded door.** *Underground Bunkers, Coastal Wreckage.*
> A door someone welded shut from the outside. That was a decision, once.
- *Leave it* — default.
- Work it open — two hours, and one extra find roll at even odds.

**Radiation — the wind turns.** *Irradiated Farmland, The Deep Zone.*
> The wind turns and the counter starts clicking. There is a culvert half a mile back.
- *Push through* — default; the dose as rolled.
- Sit it out — ninety minutes, and most of the dose.
- Take the tablets — one rad-med from the pack, nearly all of the dose, no time lost.

**Health — something has kept pace.** *The Deep Zone.*
> Something has kept pace with them for an hour. It has not closed.
- *Keep moving* — default.
- Go to ground — an hour lost, and the trail with it; nothing scavenged in that hour.
- Turn and face it — settle it now, at whatever health they have. Removes the trip's
  remaining hazard and yields whatever it was guarding. **Warned** when the worst case
  exceeds their health.

**Haul — the container.** *Coastal Wreckage.*
> A container split along its seam, and more inside than one person moves.
- *Take what fits* — default.
- Overload — a third again on the rest of the trip, an hour slower, and clumsy where
  clumsy costs. Worth nothing if the shelter is already full.

**Supplies — the tin.** *Any long region.*
> They have walked on nothing since dawn. There is a sealed tin in the pack and a long
> way still to go.
- *Save it* — default.
- Eat it — one preserved ration, health back for the rest of the trip.

This is the preventive form of the health axis, and it gives the ration recipe a second
job: "turn a surplus you cannot store into a reserve you can carry" was written about
storage, and this is what carrying it is *for*.

**Standing — the fire.** *Any long region.*
> A fire an hour old, still warm, and three sets of boot prints leaving it. The prints
> are not running.
- *Keep off the skyline* — default.
- Hail them — which crew it is comes from the moment generator, and what happens comes
  from standing with them. Trusted, they trade a little and part friendly. Hostile, they
  take something, or worse. **Warned** when hostile and hurt.

#### Two terms pinned, so nobody has to guess later

**"Any long region" means the five at four hours and over** — the Ruined City, Irradiated
Farmland, Underground Bunkers, Coastal Wreckage and the Deep Zone. The Fence Line and the
Old Service Road are the short ones and have no moments at all.

**Weather applies to a moment's effects, through the same multipliers it already
applies.** A moment never changes what is drawn, so a rad storm scales the dose a *wind
turns* choice leaves behind exactly as it scales the trip's own dose, and a caravan
season scales what pressing on brings back. This needs no new code and is written down
only so that the first person to wonder finds an answer instead of a silence.

#### Where the content lives

`src/game/moments.js` — pure data beside pure functions, the `STRUCTURES` and `FACTIONS`
pattern. Deliberately **not** `src/db/seed.js`, which is where recipes and regions live:
those are rows other tables join to, and a moment derives from the seed and is never
stored, so it needs no row and no migration.

#### How we would know the content worked

Two targets, both measurable in the soak harness, because "does it feel repetitive" is
exactly the kind of question this project has learned not to answer by intuition:

- **Repeat rate** — trips before the same moment comes round again. Repetition is what
  kills this content, so it is a number rather than a feeling, and the number is: **no
  moment seen twice within five trips to the same region.** Note the six exemplars cannot
  meet it and are not meant to — the Deep Zone needs three distinct axes and only four
  exist for it in the starter set, so the first six can be judged on shape and voice but
  never on repetition.
- **Option distribution** — no option should be right in more than about 60% of realistic
  states. If *press on* wins 85% of the time, the moment is a tax on attention rather
  than a decision, and the prose failure above has simply reappeared as a number.

**Volume: six first, then judge.** One exemplar per axis, fully built, is enough to find
out whether a Deep Zone run feels like three different questions — and cheap to throw
away if it does not. Filling out to roughly four per axis comes after that, and not
before.

#### Lethality: disclosure, not a special case

A choice can kill only a survivor who was already in trouble, and the page says so before
you commit. The rule needs no threshold constant and no special-casing, because it falls
out of arithmetic already in the game: **an option whose worst case exceeds the
survivor's health at that moment is shown with an explicit warning, and is never offered
without one.** A survivor at full health never sees a warning, because the worst case
cannot reach them — the same way maximum hazard at danger 5 is 45 against 100 health
today. "A healthy survivor cannot die on an expedition" survives Phase 6 intact, and the
real risk stays what it has always been here: going out hurt.

#### What the log says about a moment you missed

A neutral mention: *"They passed a sealed door and kept going."* Present in the return
log, with nothing implying a loss. The alternative — naming what was forfeited — is the
stronger pull toward checking in often and was rejected for it: an idle player would be
told they had played it wrong on every single trip, which is the same failure as an
unfair offline death wearing a politer hat. A missed moment is a thing that happened, not
a bill.

#### The bound on attentive play

This makes an attentive player strictly richer than an absent one, which is new to this
game and is the thing most likely to go wrong quietly. The target: **attending every
moment on a trip is worth at most one region step of loot** — roughly 35% on the mid
regions, so about 12% for each of the Deep Zone's three. Fully attending the Deep Zone
should land near a region that does not exist, and never past it.

That is a tuning target verified by measurement, not a runtime clamp. Measure it over
sixty days the way filtration was measured, and do not believe it before then — the
filtration lesson was precisely that a mechanic designed to ease a constraint had deleted
it, and only simulation found out.

#### The tests that hold it up

1. **The big one:** for many seeds, `choices: []` reproduces the pre-Phase-6 outcome
   exactly — loot, finds, rads, hazard, death, log.
2. The moments and timeline generators never advance the base generator.
3. Timeline segments sum to the outcome's totals, at every hour.
4. No option whose worst case would kill is ever offered unwarned.
5. A choice submitted outside its window is rejected; a repeated identical choice is a
   no-op and a conflicting one is refused.
6. Measured, not asserted: the attentive-play bound above.

### Phase 7 — a camp with people in it

*Against: too little per visit.*

**One survivor is the bottleneck on every verb in the game.** Builds and crafts need
living hands to start, expeditions need a body, and there is exactly one. A camp whose
survivor is nine hours into the Underground Bunkers can do nothing at all, and "nothing
at all" is most visits. That is the structural cause of a thin check-in, and no amount of
new content fixes it while the camp has one pair of hands.

**Beds are what a shelter level buys.** Population is capped by the shelter, which gives
the one structure with no interesting effect something to do and makes the cap something
you build toward.

The schema is most of the way there already: `characters` hangs off `settlements` and
never off `players`, and `characters_one_living_idx` in migration `001` is the only thing
enforcing the singular. Dropping it is the change; the chain player → settlement →
characters is unaffected, and an account still owns a camp and never a person.

**The successor penalty moves from a death to an emptying.** A camp is knocked back when
the last of its people is gone, not each time one of them dies. An individual death costs
their gear, their labour and whatever they had learned — real, and survivable. Losing
everybody costs the camp, exactly as it does now. Without this, three survivors would
mean three times the penalty and the phase would make the game harsher while trying to
make it fuller.

**New people arrive; they are not born.** A wanderer at the gate, a passenger with a
caravan — scheduled from a seed on the raid and caravan pattern, so a month's absence
resolves the arrivals it missed and nothing needs a cron. **Every mouth eats**, which is
what stops population being a free multiplier: growing the camp raises its running cost,
and a camp that grows faster than its garden starves faster than it builds.

**This is where the dormant survivor columns get used or get dropped.** Telling three
people apart is a decision — who do I send into the Deep Zone, who stays on the bench —
and that is what `skill_scavenging`, `skill_combat`, `skill_crafting`, `skill_medicine`
and `stamina` were always for. Traits rolled at arrival, skills that rise with use. Any
of the five that still has no reader when this phase is done should be dropped from the
schema rather than left as furniture for a third time.

**The balance guard has to be restated before any of this is tuned.** The 36-to-72-hour
starvation window in `test/unit/tick.test.js` is written against one survivor's
consumption. Three survivors empty the stores three times as fast, so the guard must
become a statement about a camp at its bed cap rather than about a person, or Phase 7
silently reintroduces exactly the punish-a-weekend-away failure the constant was written
to prevent.

### Phase 8 — the road

*Against: nothing to work toward.*

A soft goal and deliberately not an ending: the camp keeps going, and there is always a
next milestone and a picture of how far you have come. A win condition would need a
prestige-and-reset loop, and a game about a place that outlives its people should not
take the place away.

**The road is the region reconnecting, one link at a time.** A link costs weeks of fuel
and parts rather than hours of scrap — the first thing in the game priced above the
patience curve, and therefore the first thing the fence cannot buy. It is the natural
sink for the currency the fuel track made scarce on purpose.

**Each link brings a neighbour into view.** Their name, their size, whether they are
still there at all. Some links open a standing trade post, some open a region, some are
worth only the sight of somebody else out there. Other camps as news is what makes the
world inhabited without introducing a single new failure mode: nothing another camp does
can touch yours, so "resolve an eight-week absence on the next page load, with no process
having been running" survives intact. That guarantee is worth more than interactivity.

**One question deliberately left open, to be settled before building:** whether the
neighbours on the road are real player camps read at page load, or generated from the
world seed the way weather is. Generated is cheaper, always available, and consistent
with everything above; real camps are more interesting exactly once there is more than
one player. It does not need answering until the map is built.

### Why this order

Phase 6 is first because it is the cheapest of the three and it is the only one that
answers two complaints at once — it reuses the seed, the slice walk, the half-open
window and the radio, and adds no schema. Phase 7 is the largest and the most likely to
disturb balance, so it wants a soak test that already covers encounters. Phase 8 is a
destination, and a destination is worth least while the journey is still thin.

If a visit still feels thin after Phase 6, that is the signal to bring Phase 7 forward
rather than to keep adding moments to a trip.

## Not planned

- **Alts.** `settlements_player_idx` is unique on `player_id`. Drop it if this ever
  changes.
- **Down-migrations.** Rolling back a schema change means writing the next migration.
- **A build/craft queue longer than one.** Choosing what to build next *is* the game;
  a queue of five removes the choice.
