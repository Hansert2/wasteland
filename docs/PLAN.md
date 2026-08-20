# Wasteland — the plan

A post-apocalyptic browser text RPG. You hold one camp and one survivor. The camp is
persistent and outlives its people; the survivor is not, and will eventually die of
something. The loop is checking in, reading what happened while you were gone, and
spending what you have on the next few hours.

Several source comments cite "the plan" (`src/game/constants.js`, `migrations/001_init.sql`).
This file is that plan, written down after the fact so it stops living only in a
conversation. Where the code departed from the original sketch, the departure is
recorded here rather than quietly forgotten.

## The words this file coined, and what they mean

Written down after a reader had to ask what two of them meant. Most of this document is
prose that explains itself; these are the handful of terms it invented and then went on
using as though they were obvious. A name that does not say what the thing does is a name
that costs every later reader a paragraph.

- **The fuel track** — the upgrades that are paid for in fuel rather than scrap: the
  radio, filtration, the machine shop. Called a *track* because it runs alongside the
  scrap one and buys a different kind of thing. Where the sentence would be clearer
  saying **fittings**, it should say fittings.
- **A fitting** — one of those upgrades, and the verb for installing it. A structure is
  *built* to a level; an upgrade is *fitted*, once, with no levels.
- **A moment**, called **contact** on the page — a decision offered mid-expedition, in a
  window, which the survivor answers for themselves if nobody is looking. The code says
  moment and the page says contact, deliberately: one is what the thing is, the other is
  what a survivor on a radio would call it.
- **Attending** — loading the page while a moment's window is open and answering it.
  *Unattended* is the same trip with nobody watching, which is the pre-Phase-6 game and
  the baseline every measurement is taken against.
- **Uplift** — how much more a trip is worth because somebody answered its moments.
  Attended value over unattended value. It is a ceiling rather than a likely figure: the
  measurement takes the greediest possible answers.
- **A rung** — a group of regions worth roughly the same per trip, within ten percent.
  The map is not a ladder of ten distinct steps; it is five rungs with two places on most
  of them, so moving between two regions of equal value is a *choice*, not progress.
- **The bound** — the rule that uplift must stay under the step to the next rung.
  Attending a trip must not out-earn going somewhere better, or the map stops mattering
  and the right play is to grind the region you already have, carefully.
- **The road** — Phase 8. Seven links, paid for in fuel, each reconnecting the camp to
  somewhere that was out there all along.

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

## The next three phases — designed 2026-08-17

Phase 6 began construction 2026-08-18, from the bottom: `mix` in `src/game/random.js`
and the whole of `src/game/timeline.js` exist and are tested, both of them pure and
neither yet wired to anything. Phases 7 and 8 are design only.

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

*Against: no surprises, too little per visit.* Worked through in detail 2026-08-17,
built 2026-08-18, and played on 2026-08-19 — which found the gap recorded at the end of
"What the page has to grow" below.

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

**`mix` does not exist yet, and it is the load-bearing line of the whole phase.**
`src/game/random.js` has `makeRandom`, `intBetween`, `chance` and `newSeed`, and no way
to derive one seed from another. It needs a string salt hashed to a uint32 — `makeRandom`
takes `Number(seed) >>> 0` — combined with the seed and avalanched, FNV-1a over the salt
then a mixing round is ample. It is not cryptography and does not need to be.

**What it does need is to be frozen the moment the first expedition uses it.** An
expedition's seed is stored on the row and replayed at resolution, so the trip a player
is on right now is defined by exactly this arithmetic. Changing `mix` later — tightening
it, tidying it, "improving" the constants — silently re-rolls every trip in flight and
every trip any test has ever pinned. It is the same rule as an applied migration, and it
wants the same comment saying so at the top of the function.

Two tests, and the second matters more than it looks: that the three streams from one
seed show no usable correlation, and a **golden-value test pinning exact outputs**, so a
future refactor cannot quietly change what everyone's expedition does.

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

**Mechanically it is a line in `outcome.log`, not an event of its own.** The log is
already the trip's narrative — the tick pushes one `expedition_returned` event carrying
`log`, and `render.js` joins it into a sentence. A moment is part of that story and
belongs in sequence with the scavenging and the hazard, not as a separately timestamped
entry beside it. This also means `describe()` in `render.js` grows no new case: the
rendering change for missed moments is nothing at all.

#### The page

Six commits of this phase said nothing about the interface, which was an omission rather
than a deferral: Phase 6 is the first phase whose whole point *is* what the page shows.
Nothing below invents a new idiom — `render.js` is deliberately plain HTML, and every
piece here is a shape the file already uses.

**Read this section knowing the look is scaffolding.** `render.js` says the styling
exists only to keep the page readable while playing, and the intention is to overhaul the
graphics properly at some point. So this section is two things layered together, and they
have very different lifespans:

- **Durable** — the thing with a deadline goes first; a priced choice shows its price
  beside it; the facts a decision needs sit next to the decision; a number that moves once
  an hour is not animated; a refused verb speaks in the game's voice. These are about how
  the game communicates, and they should survive any reskin intact.
- **Transitional** — `class="error"`, the offers-table shape, the 44rem monospace column,
  and every literal mock below. These are what plain HTML made convenient, nothing more,
  and a redesign should feel free to throw all of it away.

Where the two are tangled below, the reasoning is written out rather than the markup, so
the durable half can be lifted off the transitional half later.

**An open moment goes in the top slot, under the raid warning.** That slot already has a
stated rule — *"placed above everything else because it is the only thing on this page
with a deadline"* — and a closing window is the second thing to qualify. It is **not**
given `class="error"`, though: that box is the alarm idiom, and a moment is an invitation.
The warned variant is the exception, where the alarm is the correct reading.

    Contact — 3h 30m 12s to answer

    They are six hours into the Bunkers, carrying 22 scrap, at 61 health.

    A door someone welded shut from the outside. That was a decision, once.

      Leave it          they walk on                          [ Choose ]
      Work it open      +2h · a chance at something           [ Choose ]
      Start for home    bank 22 scrap · home in 2h 30m        [ Choose ]

The option list is the caravan offers table exactly — *what / what it costs / a button* —
because that table already teaches the player how a priced choice looks here. Turn back
appears as the last row of every moment, which is what "a standing option underneath all
of them" means in practice. A warned option carries its warning in the cost column, where
the price of everything else is: `⚠ they may not survive this · at 34 health`.

**The one-line context sentence is deliberate duplication.** The fuller report lives in
the *Away* section further down, but a decision needs its facts next to it, and making
the player scroll to find out whether 34 health is bad would be the whole design failing
at the last inch.

**The *Away* section stops being a countdown and becomes the report.** Today it is two
lines — region and due-back. It gains what the timeline knows: what they are carrying,
what has happened to them, and — with the radio — when the next contact is due. This is
what makes an expedition worth looking at on a check-in that catches no window, which is
most of them.

**The haul is rendered once and does not animate, and this is a decision rather than an
oversight.** Every other countdown on the page ticks, because the pacing rescale made
things finish while you are looking at them. The haul is the opposite case: `carried()`
steps by one whole unit roughly every fifty minutes on a Deep Zone run, so animating it
would buy nothing. It would also cost a great deal — the client script would need the
progress curve and the per-kind jitter, and `render.js` already carries one duplicated
formatter with a test pinning the two copies together and a comment asking the next
person to keep them in step. A second, far hairier duplication for a number that moves
once an hour is a bad trade. The existing note about store decimals settles it in
advance: *a number that changes slowly because the thing it counts changes slowly is
telling the truth.*

**An answered moment stays on the page until the trip comes home.** Found by playing it
on 2026-08-19, and the first thing anyone said about Phase 6 after using it: *"I talked to
them but didn't see what the result of that interaction was."* Everything was working. The
answer was recorded, the return was moved, the consequence was queued for `returns_at` —
and the page said none of it. The moment box is filtered out of the view the instant it is
answered, so a decision the player had just made vanished on submit, and the outcome was
still six hours away in a return log that did not name it either.

Two lines fix it, and they are the two ends of the same thread:

- The *Away* report gains what has been settled — `The turning wind, 3h 46m in — Sit it
  out.` — followed by *"What came of that comes home with them."* That last sentence is
  the load-bearing one: the honest answer to "what happened?" is *not yet*, and a game
  that resolves at the return has to be willing to say so.
- The outcome, when it lands, is **signed with the moment it came out of**: `Their
  wounded, 3 hours in. They shared a fire and little else.` Every moment therefore needs
  a short `title` — the prose is the situation, the title is what to call it afterwards.

The signature is a sentence of its own rather than a clause joined on, because three of
the effect narrations already carry an em dash and one carries a colon, so every joining
punctuation collided with something.

**The general lesson, which is the reason this is written down rather than just fixed:**
an action whose consequence is deferred needs the page to acknowledge the *action*, not
only the eventual consequence. Every other verb in this game changes something visible
immediately — stores drop, a countdown appears, a row moves. Answering a moment was the
first verb that legitimately does nothing you can see, and it was built as though the
outcome would speak for itself. It does not, and the player reads a button that did
nothing.

**A stale submit is an `InputError`, like every other refused verb.** The window can close
between rendering the page and clicking the button, and unlike anything else in the game
that is a routine event rather than an edge case, because windows expire on their own.
It renders in the ordinary error box and reads in the ordinary voice: **"That moment has
passed."** No redirect games, no special casing — the camp page re-renders with the
message, and the countdown already sitting at *passed* explains it.

**An option the pack cannot pay for is not an option, and the page has to say so before
the click.** Found by playing on 2026-08-19, eleven minutes from the end of a window: the
page read *"There is a dose in the pack and a long way across"*, the option beside it read
*"Take it before crossing"*, and clicking it returned **"There is nothing like that in the
pack."** The survivor was carrying six rations and a spear. Nothing was broken — the
option worked exactly as specified for anyone holding a dose — which is why 289 tests had
nothing to say about it.

Two faults, one in the content and one in the page:

- **The prose asserted what was in the pack, and it cannot know.** A moment is drawn from
  a region and a seed and nothing else, deliberately, so that attending one never changes
  what the trip was going to be. Three of the six consuming moments said "there is a
  sealed tin in the pack", "there is a dose in the pack", "the spear" anyway. All three
  now describe only what is *out there*; the price lives in the option, where it belongs.
- **The option rendered identically whether or not it could be taken.** `viewCamp` now
  resolves each option's `consumes` against the real pack — the first point at which the
  price and the pack are both known — and marks it `missing` with the item names. The
  page then follows the bench's existing rule: keep the row, drop the button, say what it
  wants. `needs Rad Scrubber or Rad-X`.

The server-side check stays exactly where it was, and the comment above it already said
why: *"the page is a render of a moment ago."* The page leading the refusal does not make
the refusal redundant — it makes it unreachable from an honest click.

**The general lesson, and it is the same shape as the one above it:** every other refusal
in the answer path needs a stale page to reach — a window that closed while it was being
read, a double submit, an index that no longer exists. This one did not. It sat on a
correctly rendered, currently open window and refused anyway, because the page was
showing a price it had never checked. **A cost the page displays but does not verify is a
button that lies.**

**What the view has to grow.** `viewCamp` gains `moment` — index, prose, the closing
instant, and the options with their costs and warned flags already resolved — and
`expedition` gains the report: `carrying`, the damage and finds so far, and
`nextMomentAt` when the radio is fitted. All of it computed from the timeline, all of it
already pure.

The route is `POST /moment` with the index and the chosen option, redirecting to `/camp`
like every other verb.

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

**Measured 2026-08-18 (`tools/moment-balance.mjs`), and the bound holds:**

    region                 moments   unattended   attended   uplift   step to next
    The Ruined City            1        17.5        17.6      0.3%        —
    Irradiated Farmland        1        17.4        18.1      4.5%      140%
    Underground Bunkers        2        41.6        52.0     25.1%       49%
    Coastal Wreckage           2        62.0        75.5     21.8%       33%
    The Deep Zone              3        82.3       107.6     30.7%        —

Against the greediest possible player — one who evaluates every branch and takes the
best — attending is worth 22–31% on the regions that have moments worth answering,
against region steps of 33–49%. Under the bound everywhere, and close enough to the ~35%
the design aimed at.

**The lethality guarantee survives contact with a perfect player.** Greedy play at full
health kills nobody, in any region, over four thousand trips each. And the more
interesting half: at 35 health in the Deep Zone, attending takes the death rate from
**17.0% down to 0.4%**. Attending is worth most when you are in trouble, which is
exactly what "you turn back *because* the news was bad" was supposed to mean and is now
a measured fact rather than an intention.

Three options were retuned on the evidence: overloading a container was taken 9% of the
time and is now 42%; going to ground was 4% and is now 8%; sitting out a rad storm was
either always or never right depending on the hour cost, and at one hour it is 30%.

**One target is knowingly missed. `the_tin` — the ration — is declined about 70% of the
time**, against a 60% ceiling. Raising the healing from 32 to 42 was tried and measured
identical, because healing past the damage actually taken buys nothing. The honest
reading is that this is a moment which is *correctly* declined most of the time: eating
your reserve is situational, and a supplies moment whose answer is usually "not yet" is
not the same failure as an option nobody would ever take. Recorded rather than tuned
away, because tuning it further would have been fitting the instrument rather than the
game.

**A twice-daily player meets a moment about once a fortnight.** The soak was extended
to answer whatever the field is asking, and over ninety days its automaton answered
*nine*. That is not a fault in the test and not a fault in the windows: it checks in
every twelve hours and spends five rotation slots in eight on regions too short to have
an interior, so the only trips still in flight when it next looks are the eighteen-hour
ones. The coverage figure of ~58% is a statement about *a long trip*, and a player who
mostly sends short ones rarely has a long trip running.

This is worth sitting with before writing eighteen more moments. The content is not the
binding constraint on how often this phase is felt — the itinerary is. If moments should
be met more often, the lever is giving the mid-length regions something worth catching,
or accepting that encounters are a Deep-Zone-and-Coastal mechanic and writing them that
way.

**2026-08-18, second pass: eighteen moments, narrower windows.** The content went from
six to three per axis, every region except the Fence Line now offers moments, and counts
rose to four on the Deep Zone. Windows tightened from ~58% of a trip to ~33%, and the
floor dropped from forty-five minutes to twelve so the forty-five-minute Service Road can
hold one at all.

Those two moves belong together. Wide windows on few moments meant each encounter was
easy to catch and rare to meet, which is the worst of both — answerable whenever, and
seldom anything to answer. The bound survived the change: 21–32% uplift against steps of
33–49%, and greedy play at full health still kills nobody anywhere.

**The trade lands differently for different players, and the soak measured it.** The
twice-daily automaton went from nine caught moments in ninety days to **four** — tripling
the content did not make up for cutting the windows, because it only ever has long trips
in flight. An attentive player gains: moments now exist on the Service Road, in the City
and in the Farmland, which are the trips a click-heavy player actually sends.

**Settled 2026-08-19 by measuring it (`tools/window-coverage.mjs`): the divisor stays at
3, and the question it was asked to answer turned out to be the wrong question.** Caught
moments per ninety days, averaged over ten worlds:

    itinerary / cadence        ÷1.75    ÷2.5      ÷3      ÷4      ÷6   offered
    soak rotation, 10 min        703     703     701     695     695      704
    soak rotation, hourly        516     479     449     380     283      622
    soak rotation, twice daily    17      12      10       8       6      210
    deep zone only, twice daily   63      42      36      26      18      343

Three things fall out, and the first two settle it:

- **The dial buys the attentive player nothing.** 703 against 701 — they catch what is
  offered at any setting, so widening the window is not a trade between an attentive
  player and an absent one. It is a gift to the semi-absent one, priced in the timing
  skill that everyone else is playing.
- **The itinerary is a stronger lever than the dial, by roughly double.** For a
  twice-daily player, changing what they *send* is worth 10 → 36 moments; opening the
  windows all the way to 1.75 is worth 10 → 17. The dial cannot reach the player it was
  being considered for.
- **So the "four in ninety days" figure is an artefact of the soak's itinerary, not a
  property of the windows.** That automaton spends five slots in eight on regions under
  an hour, so it is almost never mid-trip when it next looks. A twice-daily player
  sending the trips a twice-daily player would actually send — long ones, timed to still
  be out at the next check-in — meets **nine times as many**, about one every two and a
  half days, without anything changing.

The soak is not wrong to keep its rotation: it is testing systems, not modelling a
person. But its moment count is a fact about that rotation and must not be read as a
fact about the phase, which is exactly how it was nearly read here.

**If the absent player is to be served, the dial is the wrong instrument** — it doubles
almost nothing. The lever that would work is making a long trip's windows *findable*
rather than wider, which is already the radio's job and already gated behind watchtower
4. Whether that gate is too high is a real question, and a different one.

**One of the new moments was built wrong rather than mistuned.** `the_ford` had wading as
a free default with two alternatives that were pure cost, so it was the right answer 93%
of the time — an option set where the default dominates by construction, not by numbers.
Rebuilt so the crossing is the shortcut and the safe road is what it costs you.

**What the instrument cannot see.** The value function converts finds, rads, damage and
hours into scrap so that options which trade in different currencies can be compared,
and those conversions are arguable — they are constants at the top of the file for
exactly that reason. Three earlier versions of it were wrong in ways that changed the
conclusions completely: pricing every rad as forced waiting made the Deep Zone read as
net *negative*; not charging for the hours an option costs made sitting out a storm right
94% of the time; and pricing a tin of stew like a dose of chelation made eating look
wasteful. Each of those was a fault in the measuring instrument that looked exactly like
a fault in the game.

**And one it still has: the pack is never sampled.** States vary health and radiation but
the survivor always carries nothing, while `resolveExpedition` does not check the pack at
all — the service does. So every `supplies` moment is scored as though spending an item
you may not have, and `the_tin`, `the_medkit` and `trade_the_spear` will read as
correctly-declined however they are tuned. Their numbers should be argued about from play,
not from the table.

#### Reachability: the phase the player never met

*Measured 2026-08-19, after the verdict on a check-in was still "very thin".*

`tools/check-in-density.mjs` probes every verb at every check-in — attempting each one
inside a savepoint and rolling it back, so availability is decided by the real service
guards rather than by a second copy of their reasoning. Ninety days, twice daily:

    dispatch  158/180   88%        craft   177/180   98%
    build      88/180   49%        trade    33/180   18%
    fit        29/180   16%        moment    1/180    1%

Two things fall out, and the second is why this section exists.

**A check-in is never empty, so the premise Phase 7 rests on is false.** That phase says
one survivor is the bottleneck on every verb and a camp whose person is in the field
"can do nothing at all". Every camp verb guards on `died_at is null` — *alive*, not
*home* — so builds, fittings, the bench and the caravan are all reachable while somebody
is nine hours into the Bunkers. The floor is one verb, the median is three, and freeing
the trip slot entirely moves the histogram by one bucket on 12% of check-ins. Phase 7
needs a new justification before it is built; "more hands" does not answer this.

**A moment reached the player once in ninety days.** Not because the windows are narrow —
that was swept the same morning and cleared — but because the survivor is *home* at 88%
of check-ins, and a moment only exists while somebody is out. The first real camp says it
more sharply still: of fifteen dispatches, nine went to the Fence Line, which by design
has no interior and never will. Of the six trips that could hold a moment, four were
answered — and the last of them, the first Deep Zone run after the dispatch table began
saying what a trip holds, was answered four times out of four. **The catch rate was never the problem. The itinerary was.**

**And the itinerary was chosen from a table that never mentioned contact.** The dispatch
list showed name, danger, hours and flavour. Nothing on it said that a ten-minute run has
nothing inside it, or that a Deep Zone trip holds four things to answer — so the region
that is the top row, the cheapest click and the best scrap per hour is also the one that
switches the whole phase off, and the page never said so.

The fix is this plan's own rule about decisions, applied to the one decision it had been
left out of: *the facts a decision needs sit next to the decision.* `viewCamp` gives every
region its `momentCount`, and the dispatch table renders it in the word the radio line and
the moment box already use — `4 contacts`, `1 contact`, or `too short for contact` for the
fence. Derived from the generator's own function, so the page cannot promise a trip the
generator will not produce.

**This is information, not economics, and that is deliberate.** The Fence Line's ~24
scrap/h is measured, considered and kept, and a player who reads "too short for contact"
and sends the fence run anyway has made a real choice rather than an uninformed one. If
the itinerary does not move now that the table says what it holds, the next lever is what
the long trips *pay* — a balance change, to be argued with numbers, after this one has
had its chance.

#### The tests that hold it up

1. **The big one:** for many seeds, `choices: []` reproduces the pre-Phase-6 outcome
   exactly — loot, finds, rads, hazard, death, log.
2. The moments and timeline generators never advance the base generator.
3. Timeline segments sum to the outcome's totals, at every hour.
4. No option whose worst case would kill is ever offered unwarned.
5. A choice submitted outside its window is rejected; a repeated identical choice is a
   no-op and a conflicting one is refused.
6. Measured, not asserted: the attentive-play bound above.
7. The region list carries the generator's own contact count, and the fence line's is
   zero — so a redesign that drops the column fails the suite rather than quietly
   switching the phase off again.
8. An option priced in something the pack does not hold is reported as `missing`, with
   the names of what would pay for it, and one that costs nothing out of the pack is not.

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

**Decided 2026-08-19: they stay, for now, and this is the third time.** The phase that
was going to settle them lost its premise the same day, so dropping them was the obvious
tidy — and was deliberately not taken, because a re-justified Phase 7 is the likeliest
home for them and a migration that deletes four columns is easier to write than to
un-write. The cost is named rather than waved past: **these columns are what misled the
Phase 7 design in the first place.** A schema describing a survivor system that nothing
implements reads, to anyone planning against it, as a system that is nearly there. If
Phase 7 has not been re-justified by the time Phase 8 ships, drop them then and stop
reasoning about a game that is not in the code.

**Half-resolved on 2026-08-20, by measurement rather than by argument.** Two of the four
have a design waiting for them below — `skill_medicine`, and whatever finally writes to
the already-wired `skill_scavenging`. The other two do not: `skill_combat` and `stamina`
were measured and found to be scenery, so when the drop comes it is those two that go.

#### Skills: measured 2026-08-20, designed, and deliberately not built

The one part of this phase worth rescuing, and the measurement that says which part.
Written down now because the design is settled and the *timing* is what was declined —
this is a queued piece of work, not an abandoned one.

**The question was never "can we store a skill".** It is whether the survivor in front of
you changes *which option wins*. A skill that only makes the reward bigger is a progress
bar, and the measured complaint about this game is sameness, which a multiplier does not
touch. `tools/skill-sensitivity.mjs` asks every moment on every trip twice — once for one
survivor, once for another — and counts how often the answer moves:

    axis                       occasions   answer changed
    health 100 -> 60              34800       0%
    health 100 -> 30              34800       8%
    radiation 0 -> 55             34800      37%
    radiation 0 -> 75             34800      44%
    scavenging 1 -> 4             34800       5%
    scavenging 1 -> 8             34800      10%
    scavenging 1 -> 20            34800      18%

None of that is hypothetical. `skill_scavenging` has a live reader worth +10% loot a
point and has never been written to, so turning it up is the experiment rather than a
simulation of one.

**Build two skills, and only two.**

- **`skill_medicine`**, acting on doses, thresholds and what a spend is worth. Radiation
  moves the right answer on 44% of moments, which is where all the leverage in this game
  is. `wind_turns` at 96% and `counter_clicks` at 95% are pure condition questions.
- **`skill_scavenging`**, already wired, and **generous**. Level 8 — +70% loot — moves
  one answer in ten. A cautious curve here reads as nothing at all.

**Drop `skill_combat` and `stamina`.** This is the finding worth having, because damage
mitigation is the obvious first thing anyone would build. Health at 60 changes the answer
on *zero* of 34,800 occasions: the game already guarantees a healthy survivor cannot die —
maximum hazard at danger 5 is 45 against 100 health — so softening hits is only a decision
in the last few points before death, and a skill that softens them is scenery. The plan
reached the same conclusion about these two columns for a different reason and did not act
on it; there is now a number behind it.

**What a skill would have to survive.** Two guards, both already measurable:

- The bound in `moment-balance.mjs`: uplift from attending must stay under the step to the
  next rung. Skills make attending richer, so they push on exactly that number.
- Death currently costs one to two days of camp production *at any camp size*, and that
  consistency is what makes starting again bearable. Skills break it — the better you have
  played, the worse a death becomes. The road's rule is the answer: **the camp keeps some
  of it.** Skills decay toward a floor rather than to zero, because knowledge is what a
  camp inherits from its dead. That is the emotional core stated as a mechanic, and it is
  the same shape as committed road progress surviving a succession.

**Deliberately not built on 2026-08-20, and the reason is sequencing rather than value.**
Phase 8 had shipped that day and had not been walked a single link. Building the next
system before measuring the last one is exactly what retired this phase's premise — a
design resting on an unchecked claim, four days of it, undone in an afternoon. The order
agreed instead: teach `check-in-density` the road verb, play Phase 8 for a few days, and
then take this up.

One objection was raised against skills and does *not* stand, recorded so it is not
raised again as though it were new: that they concentrate their whole effect on moments,
which the soak measured at one per 180 check-ins. That figure is about a fence-line
itinerary. A player sending long trips meets three or four moments a trip, which makes
them among the richest things on the page rather than the rarest — and the dispatch table
now says which regions those are.

**The balance guard has to be restated before any of this is tuned.** The 36-to-72-hour
starvation window in `test/unit/tick.test.js` is written against one survivor's
consumption. Three survivors empty the stores three times as fast, so the guard must
become a statement about a camp at its bed cap rather than about a person, or Phase 7
silently reintroduces exactly the punish-a-weekend-away failure the constant was written
to prevent.

### Phase 8 — the road

*Against: nothing to work toward.* Designed and built 2026-08-19, after the measurement
that retired Phase 7's premise moved this phase up the order.

A soft goal and deliberately not an ending: the camp keeps going, and there is always a
next milestone and a picture of how far you have come. A win condition would need a
prestige-and-reset loop, and a game about a place that outlives its people should not
take the place away.

**The road is the region reconnecting, one link at a time.** A link costs fuel rather
than hours of scrap — the first thing in the game the fence cannot buy. It is the natural
sink for the currency the fuel track made scarce on purpose.

**Each link brings a neighbour into view.** Their name, their size, whether they are
still there at all. Some links open a standing trade post, some open a region, some are
worth only the sight of somebody else out there. Other camps as news is what makes the
world inhabited without introducing a single new failure mode: nothing another camp does
can touch yours, so "resolve an eight-week absence on the next page load, with no process
having been running" survives intact. That guarantee is worth more than interactivity.

#### Settled 2026-08-19: the neighbours are generated

The question this section left open is answered, and the answer is **generated from the
world seed, the way weather and raids already are.** Cheaper, always available, and it
keeps the guarantee the phase is built on: nothing runs server-side, so an eight-week
absence still resolves on one page load. Real camps are more interesting exactly once
there is more than one player, and today there is one player and no hosting — a road of
real neighbours would be an empty road.

The seam is worth keeping clean anyway. A neighbour is read through one function of
`(worldSeed, linkIndex, now)`, and nothing above that function knows where the answer
came from. Swapping it for a query over real settlements later changes that function and
nothing else.

**A neighbour's fate is derived, not stored, and that is what makes the road feel
alive.** Whether they are still there is a function of the same seed and the current
instant, so a neighbour who was holding on when you linked to them can be gone when you
look again — news that changes with no cron, no row, and nothing having been running.
Weather already proved the trick works.

**The fate is news and never a repossession.** What a link bought is bought: a
destination stays on the dispatch table and a trade post stays open even after the people
who were there are not. A trade post therefore belongs to a *faction* working the
reconnected road rather than to the neighbour, which is what keeps the phase's founding
guarantee true — nothing another camp does can take anything from yours. Without that
distinction, "your trade post closed because somebody else died" is exactly the failure
mode this design exists to avoid.

#### Seven links, and an end that is not an ending

**The road is finite: seven links.** The alternative — escalating forever — was rejected
because an endless road has no denominator, and the phase's whole promise is *a picture
of how far you have come*. "Three of seven" is a goal. "Three" is a running total.

Reaching the seventh ends nothing. Nothing resets, no prestige loop, the camp keeps
going exactly as before — the seventh link is a standing fact about this camp rather than
a win, which is the same reason this section opens by refusing a win condition. If the
road ever needs to be longer, a later phase extends it; that is a much better problem
than a treadmill with no edge to measure against.

#### What a link costs, measured rather than sketched

The sketch above said "weeks of fuel". Measured on 2026-08-19, that was too much:

    region                fuel/trip   fuel/day back-to-back
    Underground Bunkers        5.0                    13.4
    Coastal Wreckage          10.0                    20.0
    The Deep Zone             17.5                    23.3

And the real camp, after six days and fifteen trips, held 51 fuel and **had never fitted
a single upgrade** — the cheapest is the radio at 55. The second currency had not been
affordable once. Pricing the road above that would have made the phase invisible for a
month, and a goal you cannot see yourself approaching is not a goal.

So the first link costs about what one fitting costs, and each one after it half again as
much:

    link      1     2     3     4     5     6     7    total
    fuel     70   105   158   236   354   532   797     2252

The first link is two or three Deep Zone trips — days, not weeks. The whole road is
roughly a hundred days of sending someone dangerous places back to back, and three or
four times that at the rate the real camp has actually been playing. Months, with the
first step inside a week.

**Fuel only, and not parts.** The sketch said "fuel and parts", and parts turn out to be
the wrong currency for this in three separate ways. They hang off `character_id`, so
unlike stores they are a *total* loss on a death rather than a halving. They are already
crafting's currency — a spear costs two, a vest one — so a road priced in them competes
with gear rather than with fittings. And the Green River Provisioners sell two for
fifteen fuel, which makes a parts price a fuel price with extra steps whenever a caravan
happens to be at the gate. Fuel alone keeps one clean story: **the road is what fuel is
for.**

#### Progress is committed, not merely afforded

Fuel is **poured into a link** and does not come back out. The alternative — the link
unlocks when the stores happen to hold enough — was rejected for three reasons, and the
third is decisive:

- A threshold gives no picture of how far you have come, and the picture is the point.
- A threshold makes no decision. Committing does: fuel has two sinks now, and choosing
  the road over filtration is a real choice about what kind of camp this is.
- **It is not possible past the fourth link.** Storage caps in the hundreds, so a
  797-fuel link can never sit in the stores at once. Incremental commitment is not a
  flavour choice; it is the only shape that reaches the end of the road.

**Committed progress survives a succession untouched.** Everything else in the game is
punished by a death — gear is a total loss, stores are halved, structures drop a level —
and the road is deliberately exempt, because it is the one thing that measures the camp's
whole life rather than its current occupant. That is the emotional core of the game
stated as a rule: the camp outlives its people, and the road is what the camp remembers.

The balance falls out of that rather than needing to be added: **uncommitted fuel is
still halved on a death, so hoarding is punished and committing is not.** A player who
pours fuel in as it arrives is protected; one who stockpiles for a bigger link later
loses half of it the first time somebody does not come home. That is a real decision with
an edge on both sides, and it costs no new mechanism at all.

#### What a link gives: the neighbour is the destination

Every link brings a neighbour into view, and **reconnecting to a place means you can go
there.** The reward and the news are the same content rather than two sets written to sit
beside each other, which is both cheaper and truer: a road is for travelling.

Of the seven, fixed by link index so the page can always say what the next one brings:

- **Four become destinations** — a new region on the dispatch table with its own travel
  time, loot and moments. This is the strongest reward available, because it feeds
  straight back into Phase 6: more places means more contact, and contact is what a
  check-in turned out to be short of.
- **Two of those four also carry a standing trade post** — a permanent offer set, the
  deliberate opposite of a caravan, which is missable by design. The road buys
  reliability, which is a different good from the one Phase 5 sells. Run by whichever
  faction the camp has standing with, which gives standing a second job rather than
  inventing a third party.
- **Three are worth only the sight of somebody else out there**, exactly as this section
  originally promised. A road where every step pays is a shop, not a road.

#### Schema: one table

    road_links(settlement_id, link_index, fuel, completed_at)

One row per link a camp has started. `fuel` is what has gone in so far; `completed_at` is
set the instant it meets the cost. Nothing about the neighbour is stored — that is
derived — so the table holds only what the player actually did.

#### The page

A **road** section showing the links already made with their neighbours and current news,
then the next link with what it costs, what has gone in, and what it will bring. Beyond
that, the remaining links as unnamed distance — a count, not a spoiler, so there is a
picture of the whole without reading the end first.

The commitment form is the ordinary shape: an amount, a button, and a refusal in the
game's voice when the stores cannot cover it.

The progress figure is a quantity, not a deadline, so it never routes through
`countdown()` — the page contract's rule, and the road is the first thing to test that
rule on something which is neither a timer nor a resource bar.

#### What could go wrong, and how we would know

- **Nobody ever fits an upgrade again.** The road costs 2252 fuel and all three
  fittings together cost 190, so the road is twelve times the size of everything else
  fuel can buy — and it is the only one of the two with a counter that visibly moves.
  If that framing wins, filtration and the machine shop are simply never fitted: no
  error, no warning, just a whole system sitting on the page unused while fuel becomes
  a token for buying links.

  It may well be fine. Filtration pays for itself in fuel — it cuts radiation waiting
  from two days to under one, which is more trips, which is more fuel — so spending 60
  to earn faster is how a thinking player reaches 2252 sooner. Which of those two
  actually happens over months is not something to reason out: run ninety days of a
  camp that sends every scrap of fuel up the road against one that fits everything
  first, and see which is further along the road at the end. If the fittings-first camp
  wins, the two sinks feed each other and the design holds. If it loses, the early
  links are priced too cheaply against the upgrades.
- **The check-in gets thinner, not thicker.** The road is a place fuel goes, not a new
  verb per visit — if it becomes the only thing worth looking at, the phase has made the
  page emptier while claiming to give it a destination. `tools/check-in-density.mjs`
  measures exactly this, and the before figure is on record.
- **The far end is too far.** 2252 fuel is priced off one camp measured over six days. If
  link five reads as a wall in play, the multiplier is a constant, not a design.

#### Built 2026-08-19, and the four things building it settled

**A destination's name is authored; everywhere else the road goes is not.** "The
neighbour is the destination" ran straight into the fact that a region is *content* —
loot ranges, prose, and moments that name its slug — and content cannot be written for a
name that changes per world. So the four destinations are named places (The Millrace,
Sixteen Wells, The Waterworks, Harrow End) and the three news-only links keep generated
names. What still varies by world for all seven is everything else about them: how many
people, whether they are still there, and what the road reports.

**The four new places are not stronger than the Deep Zone, they are *other*.** Loot per
hour stays flat across the long regions on purpose — ranges and travel times escalate
together and cancel — so a new place earns its keep by paying in a different mix rather
than by paying more. The Millrace is the only long region that pays water; Sixteen Wells
has the best odds on parts in the game; the Waterworks is fuel at a price in rads; and
Harrow End is a 26-hour trip, which is the one thing no existing region can offer a
player who checks in twice a day.

**They would have arrived silent, and that was nearly shipped.** Moments name region
slugs, and no moment names a region that did not exist when it was written — so four
places whose whole purpose is *somewhere to go* would have been the only places on the
map with no contact in them, which would have been a grim joke given the week before
them. The fix is one table rather than four slugs added to sixteen hand-written region
lists: `PLAYS_LIKE` in `moments.js` says the Millrace plays like the Bunkers, Sixteen
Wells like the Wreckage, and the two hot ones like the Deep Zone. It is one statement
about what these places are *like*, in one place, and new content can still name them
directly — and eventually should.

**The post is kept by whichever crew the camp stands better with, derived rather than
stored.** That is standing's second job, and the reason it is derived is the interesting
part: burning a crew does not close the post, it hands it to the rival. A road that could
be talked out of trading with you would be selling off the one thing it has, which is
that somebody is always there. The prices are the crew's usual prices moved by standing
exactly as they are at the gate — the road buys *reliability*, not a discount, because
cheapness is a good a missable caravan could also sell.

**Gating is one nullable column and two checks.** `regions.requires_link` is null for the
places that were always there and a link number for the four that are not; `viewCamp`
filters the dispatch table, and `dispatchExpedition` refuses a locked region outright.
The second check is not redundant with the first, for the reason written above the pack
check in `answerMoment`: the page is a render of a moment ago and a form is whatever was
posted to it. The page leading a refusal is what makes it unreachable from an honest
click, never what makes it unnecessary.

#### Measured 2026-08-20: both fears, answered

`tools/check-in-density.mjs` now plays the same ninety days twice, changing one thing —
whether the camp fits its upgrades or pours every scrap of fuel into the road — and
probing all seven verbs at every check-in.

                                road first   fittings first
      upgrades fitted                    0                3
      fuel put into the road          1181             1222
      links reached                      5                5
      days to the first link           4.0              8.0
      expeditions sent                 122              107
      trips spent too hot to go deep    63               33
      deaths                             3                0

**Nobody-ever-fits-an-upgrade does not happen, and the reason is the one the plan hoped
for.** The camp that spent 190 fuel on fittings put *more* fuel into the road than the
camp that spent none — 1222 against 1181 — reached the same five links, wasted half as
many trips being too irradiated to go anywhere worth going, and did not bury anybody.
The road-first camp killed three survivors pushing into the Deep Zone without
filtration. The two sinks feed each other exactly as designed: spending 60 to earn faster
is how you reach 2252 sooner.

**The check-in got thicker rather than thinner.** The floor is one verb on 1% of
check-ins and the median is four to five, against a median of three before Phase 8. Two
things did that, and neither is the road counter itself: a reached trade post makes
trading possible on 63–78% of check-ins where a caravan alone managed 18%, and the road
is something worth putting fuel into on 61–71% of them.

**The honest caveat: this is one player, and the instrument had to be repaired three
times before it measured them.** The first version dispatched off a fixed rotation and
ignored radiation entirely — which silently rigged the whole comparison, because what
filtration buys is radiation cleared faster in camp, and an automaton that never waits on
radiation can never collect it. The second waited on radiation but kept the soak's gentle
rotation, which doses so little that the threshold was crossed three times in ninety days.
Only the third — a fuel-chaser, always sending the richest fuel region the survivor can
currently stand — is the player this question is actually about. The before-figure for
check-in thickness was measured on the gentle itinerary, so the "three to four or five"
comparison carries that caveat with it.

#### The tests that hold it up

1. Fuel committed to a link leaves the stores and does not come back.
2. A link completes when its cost is met and never before, and a link cannot be started
   before the one ahead of it is done.
3. A succession leaves committed progress untouched while halving uncommitted stores.
4. A neighbour is a pure function of the world seed and the link index — same inputs,
   same neighbour, on any machine and at any time.
5. A link whose cost exceeds the storage cap is still completable.
6. The road ends: there is no eighth link, and the seventh completing takes nothing away.
7. What a link bought is never repossessed — a destination and a trade post outlive the
   neighbour whose fate turned.
8. Measured, not asserted: days to the first link, and to the seventh, at a plausible
   play rate.

### Why this order

Phase 6 is first because it is the cheapest of the three and it is the only one that
answers two complaints at once — it reuses the seed, the slice walk, the half-open
window and the radio, and adds no schema. Phase 7 is the largest and the most likely to
disturb balance, so it wants a soak test that already covers encounters. Phase 8 is a
destination, and a destination is worth least while the journey is still thin.

If a visit still feels thin after Phase 6, that is the signal to bring Phase 7 forward
rather than to keep adding moments to a trip.

**That trigger fired on 2026-08-19, and the order changed — but not the way this
paragraph expected.** The visit did still feel thin, so Phase 7 was measured before it
was built, and its premise did not survive: every camp verb guards on *alive*, not
*home*, so a check-in is never empty and a second pair of hands would change one bucket
on 12% of visits. The reasoning above — "Phase 7 is the largest, so it wants a soak that
already covers encounters" — was about sequencing a phase that has now lost its
justification. It needs a new one before it is built, and "more hands" is not it.

So Phase 8 moves up, and the argument against it moves with Phase 7. "A destination is
worth least while the journey is still thin" assumed Phase 7 would thicken the journey
first. Nothing is going to, in that shape — and the measurement said the specific shape
of the thinness is *the same two or three verbs every visit*, which is what a destination
answers directly: the verbs stop being the point when they are paying for something.

## The page contract, and what a redesign must not drop

The look is scaffolding and will be overhauled. Most of `render.js` can be thrown away
when that happens — but not all of it is decoration, and the parts that are not are
invisible. Written down before the redesign rather than during it.

**The real interface between server and browser is a handful of data attributes**, not
the markup around them. `TIMERS` is the whole of the client-side JavaScript and it finds
its work by querying for them:

    data-until, data-done          a live countdown, and what to say when it expires
    data-amount, data-rate, data-cap   a store extrapolated along a straight line
    STORE_DECIMALS                 interpolated into the script, so it cannot drift

**The round trip is mechanical, not cosmetic, and this is the thing most likely to be
lost.** When a countdown reaches zero the script goes back to the server, because the
server is the only thing that knows what a finished build actually produced. A redesign
that renders a deadline as its own hand-rolled timer — perfectly reasonable-looking
markup — silently loses that. The page then sits on *now* forever and the game appears
to have stopped, with nothing failing and nothing in a log. Two further subtleties ride
along with it: only timers with a future instant may trigger it, or an already-expired
one loops forever; and store extrapolation clamps to `data-cap`, or the page shows
amounts the database would refuse.

**Updated 2026-08-18: the round trip is a fetch and a swap rather than a reload.** The
requirement was never "must reload" — it is *when a countdown expires, the page must get
fresh server state and apply it* — and the reload was only the bluntest way to satisfy
it. The script now fetches the current path, matches `<section id="s-…">` against the
same ids in the response, and replaces the ones whose contents differ. Actions go the
same way: a form inside a section posts by `fetch` and applies the result, which needs
no server change at all, because a refused action already re-renders the whole camp page
carrying its error and a successful one already redirects to it. Success and failure are
therefore the same code path.

Three invariants came with it, all of which fail silently rather than loudly:
a section must be rendered even when empty or a caravan arriving mid-visit has nowhere
to appear; a response with no sections in it is a real navigation — an expired session
renders the landing page — and falls back to a reload rather than swapping nothing; and
the future-only rule on timers is now re-applied after every swap rather than once at
load.

`SSE` and websockets were considered and rejected. There is no cron and no background
process anywhere in this game — raids, caravans and weather all derive from seeds
precisely so that nothing has to be running — and a push channel would need something
server-side watching each camp, which is the scheduler the whole design exists to avoid.

**So the rule is: nothing renders a deadline except `countdown()`, and nothing renders a
store except the helper that emits those three attributes.** A redesign may change every
tag, class and layout in the file and must keep routing through those two functions.

### Delete the duplication rather than documenting it

`clock()` exists twice — once in `render.js` and once as `fmt` inside the `TIMERS`
string — with a comment asking the next person to keep them in step and a test that runs
both. That is a reasonable guard, and it is a strictly worse pattern than the one the
same file already uses ten lines earlier, where `STORE_DECIMALS` is *interpolated* into
the script so that "the browser and the server cannot disagree about it the way the two
clock formatters could". The file names its own inferior pattern and then keeps it.

It can simply be interpolated too. `clock` is self-contained — it closes over nothing,
and touches only `Math`, `Number` and `String` — so its source can be injected the same
way the constant is:

    const fmt = (ms) => (${clock.toString()})(ms / 1000);

The duplication then stops existing rather than being tested, and one whole class of
reskin bug goes with it. **This is safe precisely because there is no build step** — the
file already says so, when explaining why the two copies exist at all. If a bundler or
minifier is ever introduced, `Function.prototype.toString` stops being trustworthy and
this has to go back to two copies and a test. That condition is the price, and it is
worth writing down next to the code rather than discovering later.

### Test the contract, so a redesign fails loudly

The remaining risk cannot be deleted, only caught: a redesign that hand-rolls markup and
drops an attribute. One test closes it — render a camp page from a fixture with known
pending deadlines, and assert every one of them appears as an element carrying
`data-until` and `data-done`. A hand-rolled timer then fails the suite instead of quietly
disabling the reload.

This is the same shape as the existing guard that no structure produces fuel: cheap,
specific, and aimed at the exact mistake a future change is likely to make.

## Not planned

- **Alts.** `settlements_player_idx` is unique on `player_id`. Drop it if this ever
  changes.
- **Down-migrations.** Rolling back a schema change means writing the next migration.
- **A build/craft queue longer than one.** Choosing what to build next *is* the game;
  a queue of five removes the choice.
