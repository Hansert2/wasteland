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
- **The glass** — Phase 9's weather instruments, fitted to the watchtower. Called the
  glass rather than the barometer because it is what somebody in this camp would call it,
  the same reason a moment is *contact* on the page.
- **Sampled and integrated** — how a factor is taken across a trip. *Sampled* reads it once,
  at the hour of return; *integrated* takes the duration-weighted mean of every hour
  between departure and return. The sky was sampled until Phase 9 and is integrated after
  it, along with the sun: **a trip is scaled by what it walked through, for the hours it
  walked through it.** Where the older word appears in a comment, that comment predates
  the change.

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

**Corrected 2026-08-27: `stamina` was never measured.** The sensitivity table has three
axes — health, radiation, scavenging — and no stamina row. Combat is measured scenery;
stamina was convicted by sitting beside it in a sentence. It has a design of its own now,
in **Phase 10**, which also supplies this phase with the justification it has been missing
since its premise was retired: not "more hands so more verbs", which was false, but
"survivor-hours are scarce and must be allocated". The two ship as a pair or not at all.

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

## Phase 9 — time and conditions

*Against: every trip is the same trip.*

Designed 2026-08-27, from `wasteland-overhaul.md` — an **untracked** working document at
the repo root, named here so a reader who cannot find it knows why rather than assuming a
broken link. It is a feature document
written without this file open, whose Expansion 1 §§6–11 is Phase 7 re-derived and whose
§§4–5 propose the two columns `tools/skill-sensitivity.mjs` measured as scenery. Its
§§1–3 are the part that is genuinely new, and this is that part designed properly. The
overhaul document is a source, not a plan; nothing else in it is scheduled by this
section.

### Why this before the roster

**It is the only proposal in that document that adds a decision without touching
`characters_one_living_idx`.** The roster is still the largest change in the game and
still has no re-justification since its premise was retired on 2026-08-19. This phase
does not wait on that and does not prejudge it.

**It needs no migration.** Not "a small one" — none. Enumerated, because a claim like
that is usually wrong:

- The clock and the temperature are pure functions of `now`. Nothing is stored, so
  nothing is stored *wrong*.
- Temperature is derived from the sky rather than generated beside it, so there is no
  second seed, no second calendar, and no second table.
- The two new fittings need no DDL: `structure_upgrades.upgrade` is plain text validated
  in code against `UPGRADES`, deliberately (`migrations/006`). Only `camp_structures.kind`
  is a check constraint, and no structure is added.
- No new slice boundary, so `settlements.last_tick_at` keeps its meaning.

That makes this the cheapest phase since Phase 6, and it is cheap in the same way: it
reuses the world seed, the sky, the fitting track and the dispatch table, and adds one
pure module.

### The one idea

**The camp already knows what the sky is doing. It does not know what time it is, and
time is the only thing that changes what the sky costs you.**

Everything below is that sentence. The sky stays global, stays seeded, stays a window
with a kind. What this phase adds is a second axis through it — the hour — and one
consequence attached to that axis rather than seven small ones.

### 1. The world clock

A pure function of `now`, in a new `src/game/daylight.js`. No state, no I/O, no seed, and
nothing in `State`: the tick does not learn a new field, and `applyTick` keeps its
signature.

**World time is UTC, and `WORLD_EPOCH` is already the world's first instant.** One
timezone for everybody, for the reason `world_events` has no `settlement_id`: every camp
is under the same sky, and a sky that told two players different hours would be two skies.

**Revised 2026-08-27, and the reasoning above is half wrong.** It conflates two things.
**Weather** genuinely is global — every camp must meet the same storm, which is why
`world_events` has no `settlement_id` and why it never will. **The hour** is not: nothing
in the game compares two camps' clocks, and the argument for sharing one was an analogy
rather than a constraint.

Worse, the shared clock created the unfairness the objection below was written to answer.
A player in Auckland always checked in at world-night and one in Denver always at
world-morning — a systematically different game through no choice of their own. The phase
answered that by putting the mechanical weight on the *trip*; a per-camp offset means it
does not need answering.

So: **the hour belongs to the camp and the weather to the world.**
`settlements.clock_offset_minutes` (migration `015`) shifts the instant before any of the
arithmetic starts, and every function in `daylight.js` takes it. It buys the thing that
made it worth doing — dark outside and dark in the game are the same dark, so sending
somebody out at bedtime and reading the report over breakfast is a rhythm the game can
express.

Two decisions inside it. **A fixed offset rather than a named zone**, because a zone brings
daylight saving and would jump the sky an hour twice a year — a discontinuity in a function
that is otherwise smooth, and a trip spanning the transition would get an hour more or less
daylight than the dispatch table promised. The cost is that a camp founded in summer keeps
summer's offset, which is an hour of drift and no cliff.

And **stored rather than read**, which is the load-bearing half. Taken from the browser once
at founding and kept as a column, so a camp does not change its sky when the server moves or
the player travels, and an expedition still replays exactly. Reading the host's locale would
have been the same class of mistake as reading `Date.now()` inside the tick.

#### One number was doing two jobs

**Corrected 2026-08-28, by the user, against a window.** The offset shipped and the sky was
still wrong: on 27 August the game put dawn at 05:24 where Amsterdam's was 06:47. The day
*length* was close — 13.2 hours against 13.8 — so nothing about the season was broken. The
whole day was simply centred an hour and a half early.

Because there are two quantities here and migration `015` shipped one of them.

> **What time is it here** is the timezone offset, and a browser knows it.
> **Where does the sun sit against that clock** is a different thing, and a browser cannot
> know it.

The second depends on how far the camp sits from its timezone's meridian, plus whatever
summer time is doing — Amsterdam is about twenty minutes west of the CEST meridian and an
hour into summer, so its solar noon is 13:40 rather than 12:00. `daylight.js` had `SOLAR_NOON
= 12` as a constant and built the day symmetrically around it, which is right only for a camp
standing on its own meridian. Shifting the *clock* by two hours moves the numbers on the face
and the sun with them; it cannot move the sun *relative* to the face, and that is exactly the
error that was left.

So `settlements.solar_noon_minutes` (migration `016`), and `sunAt(at, noon)` takes it like
every other hour-aware function takes the offset. Measured against the real sky on 28 August,
with the camp set to 820:

    sunrise   sunset   midpoint
    07:03     20:16    13:40     the game
    06:49     20:31    13:40     Amsterdam

**The midpoint is now exact and the amplitude is deliberately not.** `DAYLIGHT_SWING_HOURS`
is 3, so the modelled year runs 9 to 15 hours where Amsterdam's runs about 8 to 16.5. That is
a balance constant — day length is a loot multiplier — and it is chosen rather than
inherited. A camp that wanted a real latitude would change that number, and would have to
re-run `daylight-balance.mjs` afterwards.

#### And then derived, because it is not a number anyone knows

**Asked for by the user 2026-08-28: "can we make it so the sunrise and sunset is based on
the camp time?"** The column shipped and the player had to set it by hand, which is one
number too many and a number nobody knows about themselves — "how far are you from your
timezone's meridian" is not a question a person can answer about where they live.

The camp's *clock* cannot answer it, which is worth stating because it is the obvious thing
to reach for and it is the same conflation a second time. An offset is quantised to whole
zones with summer time folded in, so it has already thrown longitude away. **Madrid and
Warsaw are both CEST in August and their solar noons are 14:15 and 12:36** — ninety-nine
minutes apart on an identical clock, so no arithmetic on the offset could get both right.

*(Corrected 2026-08-28: this argument first used Amsterdam and Athens, on the assumption that
both are UTC+2 in August. Greece keeps EET and springs to **+3**, so they share no clock and
the example proved nothing. Caught by the db suite the moment the offset stopped being an
assumption and started coming from the tz database — which is the argument for deriving it.)

The camp's *zone* does answer it, and the browser has been able to say it all along:

    Intl.DateTimeFormat().resolvedOptions().timeZone   // "Europe/Amsterdam"

No permission, universal support, and a zone is a place with a longitude. One degree is
four minutes of time and the offset already carries the meridian the clock was cut from, so
the whole derivation collapses to one line:

    solar noon = 720 + offsetMinutes − 4 × longitude

`src/game/zones.js` holds a curated table of about a hundred zones — the set a real player
is plausibly in, short enough to read in a diff — and `foundSettlement` derives the column
once and stores it. **An unlisted zone returns `null` and the camp keeps 720**, which is a
correct sky rather than a wrong one; adding a row is the whole fix. Vendoring IANA's full
`zone1970.tab` was the alternative and was rejected as ~350 rows nobody reads.

**Balance-neutral, and that is a property rather than a hope.** `sunAt` computes
`sunrise = noon − hours/2`, and `hours` comes from `daylightHoursAt`, which never sees
`noon`. Solar noon sets the day's *phase*; only `DAYLIGHT_SWING_HOURS` sets its *length*.
So no loot multiplier moves and `daylight-balance.mjs` did not need re-running — and
`test/unit/zones.test.js` pins it, so if day length ever becomes a function of longitude the
suite says so rather than the fuel figures quietly going stale.

**Derived once and stored**, like the offset and for the same reason: a camp must not change
its sky because the player travelled, or an expedition would stop replaying. Summer time is
folded in and then frozen for both, so the two drift together and the sun stays where it was
against the camp's own clock — freezing one and not the other would be worse than freezing
neither.

**Left out: the equation of time**, which swings true solar noon ±16 minutes across the year
and is why a sundial and a clock disagree in November. Including it would make solar noon a
function of the date rather than a property of the camp, and the column is a property of the
camp on purpose. The error is under a minute at the equinoxes and always smaller than the
one this fixed.

**Why the default stays 720.** Noon is the idealised world and is correct for a camp on its
meridian; it is also the only value that needs no knowledge the game does not have. Camps
founded before this keep it, because there is nothing to derive their zone from after the
fact — which is what the picker below is for.

#### The picker, and the exploit it would have opened

**Asked for by the user 2026-08-28**, once deriving-at-founding turned out to leave every
existing camp on the idealised sky with no way to say otherwise. A control on the camp page,
and — their proposal — limited to once a day.

**The daily limit is not the guard, and finding out why is the useful part.** `returnExpedition`
read the camp's clock *at resolution*. Daylight multiplies finds and a trip's light is
integrated between departure and return, so a player able to set their own timezone could
send somebody out at dusk, roll the clock twelve hours, and have the whole trip resolve as
though it had gone at dawn.

> **A rate limit does not close an exploit, it rations it.** One change a day is one exploit
> a day, and trips are shorter than a day.

It was also, already, a live violation of the rule migration `015` called load-bearing —
*stored rather than read, so every trip still replays exactly*. The clock was being read.
Nothing but a hand at the database could reach it, so it never bit; the picker would have
made it reachable. **The schema was wrong before the feature was proposed, and the feature is
what made anyone look.**

So migration `017` puts the sky on the trip, beside `departed_at` and `seed`: a trip replays
under the sky it left beneath, whatever the camp does afterwards. `reportOn` reads the same
frozen pair, because `travelFactors` being one function stops the two composing the sky
differently only if they are handed the same arguments.

#### And then the limit turned out to be answering a question nobody had

**Proposed by the user 2026-08-28: "maybe the timezone can only be set once during sign up
and creation of the camp."** Which is already what happens — registration reads the browser's
zone and derives both numbers with nothing asked and no UI shown. A camp founded today is set
once, at founding, exactly as described.

That reframes what the control is. **It is not a second way to set the sky; it is the only way
for camps the derivation came too late for** — those founded before it existed, and those
whose zone the curated table does not list. Both stand on Greenwich and the idealised sky by
default rather than by choice, and neither can say otherwise.

So it is offered to exactly those camps, once, and to nobody else. `clock_changed_at` stops
being a cooldown stamp and becomes one fact: **was this camp ever actually placed.** Founding
stamps it when the derivation succeeded and leaves it null when it did not — stamping
unconditionally would be the easy mistake, marking every camp placed including the ones only
sitting on the default, and closing the one door out of it.

> **The control removes itself from the game as the last unplaced camp is placed.** A setting
> that exists to repair a specific historical gap should disappear when the gap is closed,
> rather than sitting on the strip for ever offering to re-answer a settled question.

The daily limit is gone with it, and its absence costs nothing: what closed the exploit was
freezing the sky onto the trip, never the limit. A rate limit rations an exploit rather than
closing one, so once the schema does the closing there is nothing left for it to do.

**The form takes a place and nothing else.** An offset sent alongside the zone would be a
second fact the player could set independently, and the two are not independent: a camp
claiming Amsterdam on a Denver clock is not a camp anywhere. Node ships the tz database, so
`offsetForZone` derives it — correctly for Kathmandu's +345 and for Auckland's summer being
our winter — and then stores it, which keeps `015`'s fixed-offset choice intact. Registration
prefers the same derivation and falls back to the browser's reported offset only when the
zone is one the table does not list.

**Free at every tier** when it is shown at all, unlike the hour beside it. The clock and the
glass sell precision; this is not precision, it is the camp knowing where it stands. A player
whose sky is eight hours out from their window has a broken game rather than an un-upgraded
one, and there is nothing to sell them there. The summary reads *not set* rather than naming
the control, because a camp in that state has no other way of finding out: Greenwich with noon
at 12:00 sharp is a coherent sky, almost certainly not the player's, and indistinguishable on
the strip from a correct one.

**How it hid.** `loadWorld` never selected either clock column, so the tick ran on Greenwich
and noon while the page ran on the camp's own — and both suites stayed green, because a
default is quiet. The fix that mattered was less the query than the test now at
`test/db/world.test.js`, which asserts the *tick* sees the columns rather than that the page
does. The second bug in the same hour was `(Number(x) ?? 720)`, which never fires: `Number()`
returns `NaN` for garbage and `0` for `null`, never nullish, so a missing column would have
landed noon at midnight rather than at the default. Both are the same lesson —

> **A default that is never observed to be a default is indistinguishable from a wire that
> was never connected.**

Five bands, always free to read: *before dawn*, *morning*, *the heat of the day*,
*evening*, *night*. Their boundaries move with the season, which costs one cosine term
and is the only thing the year is for.

**Rejected: a world day of 25 hours.** It was the obvious fix to the objection below —
drift the phase against the player's habits so everyone eventually sees every band at
their usual hour — and it fails on two counts. It puts a 25th hour on a clock face, which
is a lie the page then has to keep; and it decouples world hours from the real hours that
`travel_hours` and `returns_at` are denominated in, so "a nine-hour trip" would stop
meaning nine of the hours the clock shows. Recorded because it is a good idea that does
not survive contact with the units.

**The objection it was meant to fix, and the actual answer.** A player who checks in at
eight in the morning, local, checks in at the same world band every day for ever. If the
mechanical weight sat on the hour of the *check-in*, that player would be playing a
permanently smaller game through no fault of their own.

So it does not sit there. **The weight is on the trip, not on the visit.** What the player
chooses is a region and therefore a duration, and a duration from any given hour lands
whatever mix of light and dark it lands. Every player has the full range of that choice
available from every check-in hour they keep. The band at the top of the page is a
planning input and a piece of weather; it is not a gate, and nothing in this phase reads
it to decide what the player may do.

### 2. Day and night, and where the weight goes

The rule from Phase 6 applies unchanged: a thing that only makes the reward bigger is a
progress bar. Night has to change *which option wins*.

**`tools/skill-sensitivity.mjs` already says which lever can do that.** Over 34,800
occasions per axis it found radiation moves the right answer 44% of the time and health
moves it between 0% and 8%. That is not a hint, it is a measurement taken for a different
question that happens to answer this one:

- A night mechanic built on **hazard** would be scenery, for exactly the reason
  `skill_combat` is scenery — a healthy survivor cannot die, so softening or sharpening a
  hit is only a decision in the last few points before death.
- A night mechanic built on **dose** lands on the axis where all the leverage in this game
  already is.

So:

> **The day is dear and the night is cheap.** Daylight turns things up and costs you on
> the counter. Darkness finds less and costs less.

Let `d` be the fraction of a trip's hours that fell in daylight. Both factors are centred
on `d = 0.5`, so a trip that spent as many hours in the light as in the dark resolves
*exactly* as it does today — the same discipline gear and weather already follow.

**What is centred is `d`, not the clock**, and the difference is worth saying because the
first draft of this section got it wrong. A full twenty-four hours is neutral only at the
equinox: a summer day is fifteen hours of light against nine of dark, so a day-long trip
in July is a daylight trip whenever it leaves. Caught by writing the test.

    radiation = 1 + Kr * (2d - 1)        Kr in [0.20, 0.45]
    finds     = 1 + Kf * (2d - 1)        Kf in [0.35, 0.65], generous on purpose

**Daylight pays in `finds`, and bulk loot is not touched at all.** Decided 2026-08-27,
after the reach table below showed the first draft's bulk-loot multiplier handing the
Fence Line a free ~29 scrap/h — a ten-minute walk with `finds: []` and
`radiation_per_trip: 0` is trivially all-daylight and pays nothing for it, so the trade
collapsed into a bonus on the one region least in need of one. Finds fix that at the root
rather than with a minimum trip length, which would be a cliff: the Fence Line has no find
table and no dose, so it becomes correctly and completely indifferent to the sun, which is
what a walk to the wire should be.

It also makes the two halves *structurally* different rather than two scalars on one roll,
which is nearer to *different, not worse* than a haul multiplier ever was — and it stays
inside the standing rule that the sky and gear both follow: `rollFinds` takes one
`chance(random, find.chance)` draw per find, so this shifts a threshold and never a draw
count. Clamp the result to `[0, 1]`; the richest find in the game is `scavenged_parts` at
0.55, so nothing overflows today and something will.

**`Kf` is generous on purpose, and that is the lesson from skills rather than a guess.**
`skill_scavenging` at level 8 — a +70% haul — moved one answer in ten, and the plan's
conclusion was that a cautious curve here reads as nothing at all. A find shifting from
0.55 to 0.59 is invisible; 0.55 to 0.64 is a decision. Provisional, and it is
`daylight-balance.mjs` that sets it.

**Why that is a real choice and not a discount.** Radiation is the standing limiter on
survivor uptime: a Deep Zone trip doses ~25 nominal against a decay of 0.8/h, which is
thirty-one hours on the bench. Night buys that back and pays for it in what turns up. A
camp that has fitted filtration wants the day, because it can afford the dose and wants
the parts; a camp that has not wants the night. **The same region is a different purchase
to two different camps**, which is the standard this game holds a mechanic to.

**Different regions get different flavours of the same choice, which falls out rather than
being designed.** The Deep Zone carries 25 rads and a rich find table, so it is a real
two-sided trade. Coastal Wreckage carries 4 rads and good finds, so its dose lever is
worth about two hours of bench time and the decision there is almost purely about what
turns up. The Old Service Road and the Ruined City have finds and no dose at all, so they
keep a small one-way daylight preference — a tinned stew at six percentage points better,
which is named here rather than waved past. **The trade is only a trade where both levers
exist**, it grades with danger, and near the wire the hour genuinely does not matter.

**It also gives the danger-5 fuel inversion a move.** Queue item 2 — Coastal Wreckage
sustaining 19.4 fuel/day against the Deep Zone's 13.1, because 25 rads idles the survivor
43% of the time — is a fact about dose against uptime, and this is a lever on exactly that.
This is *not* a claim that it fixes it. It is a claim that `tools/fuel-balance.mjs` must be
re-run afterwards, and that tuning the inversion before this lands would be tuning against
a number about to move.


#### Re-run 2026-08-27, and the number did not move

**It does not give the inversion a move. The paragraph above was wrong, and measuring is
the only reason anyone knows.** Coastal Wreckage still sustains 19.4 fuel/day against the
Deep Zone's 13.7 — within noise of the 13.1 on record — and no policy available to a
player closes it.

`fuel-balance.mjs` gained a player who *waits for the dark*: attentive, but holding out for
a departure at least half in the night rather than taking the first legal hour. Both a
patient version and a realistic one were run.

    region              attentive   waits <=3h   waits <=24h   + filtration
    Coastal Wreckage         19.4         19.4          19.4           19.4
    The Deep Zone            13.7         13.6          13.3           18.0
    The Waterworks           14.4         14.4          14.2           19.8
    Harrow End               19.0         19.0          19.0           22.1

**Timing the departure is worth nothing on the fuel regions, and a long wait is worth less
than nothing.** The reason is structural and is already visible in the reach table below:
the lever needs *full reach* and *heavy dose* in the same region, and the map has no such
region. Everything with the whole range of `d` available is nine hours or under and doses
two to eight rads; everything that doses twenty-five or more is eighteen hours or longer,
where `d` is compressed to 0.33-0.66 and half of even that is unreachable without waiting
out the swing. The one place both conditions meet is Irradiated Farmland, which is the one
already recorded as over the bound - and it pays in food.

**What actually closes the inversion is filtration, which already exists.** It lifts the
Deep Zone to 18.0 and the Waterworks to 19.8, and puts Harrow End at 22.1, above Coastal
Wreckage. So danger 5 out-earns danger 4 for a camp that has bought the thing the fuel
track sells for exactly this purpose, and does not for one that has not. The inversion is
therefore narrower than the queue entry says: it is the Deep Zone and the Waterworks,
unfiltered, and Harrow End already matches Coastal Wreckage without help.

**None of this makes the sun a bad mechanic; it makes it a different one.** It is a
tiebreaker at the moment of dispatch - the hour says whether *now* is a good time to go -
and not a strategy to hold out for. What it measurably moves is finds and bench time on
the near and middle rungs, which is where the reach is.

**Also found: the instrument was broken by the phase it was meant to measure.**
`fuel-balance.mjs`, `balance.mjs` and `onboarding.mjs` each build an expedition by hand and
none set `departedAt`, so `travelFactors` threw the moment it was asked for a window. That
is `integrateFactors` refusing a missing bound rather than quietly returning clear skies -
the guard written on the grounds that a silent 1.0 would disable the weather everywhere and
look like nothing had happened. It earned its place on its first outing.

**How much of `d` a player can actually choose, measured rather than asserted.** The first
draft of this section claimed the long regions "wash out to `d ≈ 0.5`" and that was too
strong — it was reasoned about rather than worked out. `tools/daylight-reach.mjs` computes
the achievable range of `d` for every region, since a trip of `T` hours starting anywhere
in a day with `L` hours of light captures between `max(0, L − (24 − T))` and `min(L, T)` of
them. Swept against `daylightFraction` in `src/game/daylight.js` rather than against a
tool's private copy of the formula, so the table moves if the seasonal swing is ever
retuned. At the equinox, with the provisional `Kr = 0.35` and `Kf = 0.5`:

    --- equinox: 11.9h of light ---
    region                  T    d range      dose range    finds range   worst->best
    The Fence Line        0.17   no finds, no dose - indifferent to the hour
    The Old Service Road  0.75    0.00-1.00             -     0.50-1.50         200%
    The Ruined City          4    0.00-1.00             -     0.50-1.50         200%
    Irradiated Farmland      6    0.00-1.00     0.65-1.35     0.50-1.50         108%
    The Millrace             8    0.00-1.00     0.65-1.35     0.50-1.50         108%
    Underground Bunkers      9    0.00-1.00     0.65-1.35     0.50-1.50         108%
    Coastal Wreckage        12    0.00-0.99     0.65-1.35     0.50-1.49         107%
    Sixteen Wells           14    0.14-0.85     0.75-1.25     0.64-1.35          67%
    The Deep Zone           18    0.33-0.66     0.88-1.11     0.83-1.16          26%
    The Waterworks          20    0.40-0.60     0.93-1.07     0.90-1.10          15%
    Harrow End              26    0.46-0.54     0.97-1.03     0.96-1.04           6%

**The compression is gradual and only Harrow End truly washes out.** Seven of eleven
regions have effectively the whole range — Coastal Wreckage at twelve hours reaches 0.99
rather than 1.00, because the equinox day is 11.9 hours and a twelve-hour trip is six
minutes longer than the sun is up. The Deep Zone keeps a 26% spread between its best and worst
departure hour, which against a 25-rad nominal dose is about six rads, or seven hours of
bench time — small, real, and worth a glance at the clock. The Waterworks keeps 15%. Only
the twenty-six-hour trip is genuinely indifferent to when it leaves, and a trip longer than
a day *should* be.

**The season moves the range rather than only its width, which nobody designed and which is
the best thing here.** In summer (`L = 15`) the Deep Zone's range is `0.50–0.83`: it cannot
be sent into the dark at all, and its dose floor is 1.00. In winter (`L = 9`) it is
`0.17–0.50` and it can never be a daylight trip, ceiling 1.00. **The long trips are forced
into the sun in summer and into the dark in winter**, so the same region is a different
proposition in March and in August without a single extra mechanic. The cost is that the
deep-region fuel economy now drifts about ±12% across the year with nobody able to opt out,
which `fuel-balance.mjs` must be run against at both solstices rather than once.

**The Fence Line takes the whole upside and none of the downside, and that is a fault in
the draft above rather than a quirk to accept.** A ten-minute walk to the wire is trivially
all-daylight or all-dark, it has `radiation_per_trip: 0`, and it is already measured at
~24 scrap/h — about seven times any long region, deliberately kept. Under the two scalars
as drafted it becomes ~29 scrap/h in the sun and pays nothing for it, because the dose that
makes this a trade everywhere else does not exist there. The trade collapses into a bonus
on precisely the region that least needs one.

The fix was not a minimum trip length, which is a cliff, but a change of lever, and it is
**settled above**: daylight pays in `finds` and bulk loot is untouched. `finds: []` and
`radiation_per_trip: 0` on the Fence Line make it exactly and automatically indifferent to
the hour, with no exception written anywhere. The residual cost is legibility — finds are
chancy, so the effect is noisier to feel than a bulk number, which is why `Kf` is generous
and why the page has to print the multiplier for it to be a decision at all.

**The `dose range` column below is therefore the whole of what the table measures.** The
reach arithmetic is about `d` and applies to both factors identically; only the dose
column is quoted because dose is the lever with the measured 44% and the one that decides
whether a long trip's narrow band is worth a glance at the clock.

### Everything a trip meets is integrated, the sky included

**Decided 2026-08-27, and it is the largest change in the phase.** The first draft
integrated the sun and left the sky sampled at `returns_at` as it is today, on the grounds
that sampling had never falsified a promise. That is true and it is not enough. **A trip
is scaled by what it walked through, for the hours it walked through it** — one rule, both
systems, no exception to explain to anybody.

**The exploit that settles it.** The sky is sampled at the instant of return
(`tick.js:440`, `view-camp.js:85`) and `render.js:1987` prints a live countdown to the
weather clearing. Those two facts together are a live, plannable exploit in production
today: read that a rad storm lifts in four hours, dispatch a nine-hour trip, walk four
hours through the storm, come home five hours after it cleared, and take **none** of its
×1.8 dose. It runs the other way too — time a trip to *end* inside caravan season and
collect ×1.5 on a haul gathered almost entirely outside it. Rad storms run 18–48h, so the
countdown is long enough to plan against, and the correct play under sampling is to time
arrivals rather than to choose destinations.

**The mechanism, and it is one the code already has.** For each factor, take the
duration-weighted mean across `[departedAt, returnsAt]`. World events are windows, so cut
the trip at every boundary that falls inside it and average the constant pieces —
`nextBoundaryAfter` in `world-events.js` already yields those boundaries, and this is the
tick's slice walk with a different accumulator:

```js
export function integrateFactors(events, from, to) {
  let cursor = from;
  let loot = 0;
  let radiation = 0;

  while (cursor < to) {
    const next = Math.min(to, nextBoundaryAfter(events, cursor));
    const span = next - cursor;
    const held = expeditionFactors(activeAt(events, cursor));
    loot += held.loot * span;
    radiation += held.radiation * span;
    cursor = next;
  }

  const hours = to - from;
  return { loot: loot / hours, radiation: radiation / hours };
}
```

**Arithmetic mean over time, not geometric, and the reason is worth writing down because
somebody will ask.** `expeditionFactors` composes *concurrent* events multiplicatively —
two blights are worse than one — and that stays. Composition across *time* is a different
question, and both quantities here accumulate per hour: dose is taken hour by hour, and a
haul is what was gathered over the trip. An hour under a storm contributes a storm-hour's
worth. That is an arithmetic average, and a geometric one would understate a short severe
window against a long mild one for no reason anybody could defend.

**Built 2026-08-27, and the prediction below was measured rather than left as algebra.**
Over 40,000 trips per duration across five years of generated weather, the mean drift
between sampling and integrating is **0.01% at worst** on both dose and haul, at every
region length from ten minutes to twenty-six hours. The variance falls as predicted and
in proportion to how much calendar a trip averages: 2% at four hours, 5% at nine, 10% at
eighteen, 15% at twenty-six. So every number measured under sampling stands, and what
this change actually bought was the exploit and the tail.

**The expected value does not move; the variance does.** This matters for how the change
is verified. By linearity of expectation over a stationary event process, the mean factor
of a time-average equals the mean factor of a point sample — so **the ninety-day soak's
totals should land inside sampling noise**, and if they move materially something is
wrong. What integration removes is the *tail*: the best case an attentive player can
engineer by timing an arrival, which is the exploit, and the worst case of arriving under
a storm that only just began. That is the intended effect stated as a testable prediction
rather than a hope.

**It buys the glass its real job.** Because world events are derived from the world seed
rather than observed, the events covering a *future* trip are already computable. Once the
sky is integrated, the dispatch table can honestly say "the storm covers the first four
hours of this trip" instead of only "there is a storm now" — which is a far better thing
for the weather fitting to sell than the current-conditions readout the first draft gave
it. Derive those future slots for display; **do not insert them.** `eventForSlot` is
deterministic and `ensureWorldEvents` inserts `on conflict do nothing`, so a slot shown on
the page is byte-identical to the one stored later, and writing ahead would only invent a
way for the two to disagree.

**What it costs, stated plainly.** Every balance number measured to date was measured
under sampling: `region-balance.mjs`, `fuel-balance.mjs`, `moment-balance.mjs` and the
soak. All of them must be re-run, and the prediction above is what makes that a
confirmation rather than a re-tuning. `view-camp.js:55` carries a comment explaining why
the weather at scheduled return is the right weather; it becomes false the moment this
lands, and leaving it would be the exact failure this file already has a lesson about — a
comment claiming more than the code delivers.

**Sequencing.** Land the sky integration **on its own, before any of the sun**, and re-run
the four instruments against it. It touches no new content and changes one function, so a
soak that moves is unambiguously about integration; folding it in with a new mechanic
would leave nobody able to say which one moved what.

**Done, and the re-run turned out to prove less than it sounds.** `region-balance`,
`fuel-balance` and `moment-balance` all run under a **clear sky** — none of them puts a
world event into the state at all — so integration cannot move them, and a green run is
a tautology rather than evidence. The evidence is the drift measurement above and the
ninety-day soak, which does go through the real service layer with real weather. Worth
knowing before anyone cites an unchanged `fuel-balance` table as confirmation of
anything.

**Two things the build found that the design had not.**

1. **The weather window was loaded from `lastTickAt`, and a trip starts earlier than
   that.** `advance-settlement.js` fetched events for `[lastTickAt, now]`, which is the
   right window for the tick's own walk and the wrong one for a trip that departed before
   the last check-in. Events falling entirely inside the erased stretch were simply not
   found, and `activeAt` reports "not found" as clear sky — so **the more often a player
   checked in, the more of their own weather they erased.** That would have been a new
   exploit installed by the change that removed the old one. The window now reaches back
   to an in-flight departure.
2. **`reportOn` could never see weather that had not started yet**, which was a live
   disagreement between the page and the tick predating all of this: the report sampled
   `activeAt(worldEvents, returnsAt)` against a set loaded only up to `now`, so a storm
   due to begin in two hours and cover the return was invisible to it. Integration fixes
   it by construction, because the report now derives the remainder of the trip's sky
   from the world seed — stored rows for the elapsed hours, derived ones for what is
   still to come, and the two sets never describe the same slot.

**A note on the test that guards the first of those.** It compares two camps under one
sky, sharing an expedition seed, one watched halfway and one not — and it only works
because the storm it turns on is **written into `world_events` explicitly**. The first
version let the real calendar supply the weather and passed with the bug still in place,
because whether an event happens to open and close inside one particular ten-hour stretch
is a fact about the day the suite runs. That is the shape the database suite already
flaked in once. A guard that cannot be shown to go red is not a guard; this one was run
against the unfixed code and observed to fail.

**And a check that could not fail, recorded because it was believed for most of a day.**
The claim made while building this was that all seven page snapshots came out
byte-identical, which sounded like strong evidence that neither commit moved the page. It
was worth nothing. `page-states/` is in `.gitignore` — it is a design aid, rebuilt on
demand — so `git diff page-states/` returns empty whatever the code does. The tool is not
deterministic either: two runs of *identical* code differ, because the survivor who
answers the gate is drawn per camp and the countdowns tick in wall-clock seconds.

**`tools/page-states.mjs` is a design aid, not a regression check, and the difference is
not visible from the diff it produces.** What actually guards the page is
`test/db/page-contract.test.js`, which builds the same seven states and asserts twelve
structural properties of them — every block renders, every deadline is a live countdown
the client script can still find, every gauge carries its attributes, every plate is a
file that exists. That is the assertion to cite. It is also, exactly, the thing this file
already has a lesson about: a claim that sounded stronger than the check behind it.

**The sun follows the same rule, and needed it first.** `d` is computed across
`[departedAt, returnsAt]` for the reason the sky now is, plus one of its own: the dispatch
table will tell the player how many hours of their trip fall in the dark *before they
commit*, and a factor sampled at `returns_at` would make that sentence false — a trip
nine-tenths in daylight that happened to arrive at half past midnight would score as a
pure night trip, and "always arrive at 2am" would beat choosing a destination.

**A note on which levers are integrated.** The sky today scales `loot` and `radiation` and
nothing else; `rollFinds` and `rollHazard` take no sky argument. Integration is a change
to *how* a factor is measured across a trip, not to which factors exist, so it applies to
the two that are there. The accumulator above is field-agnostic: the day a world event
wants a `hazard` or `finds` coefficient, it gets integrated the same way with no further
thought.

**One function, called from two places.** `returnExpedition` and `reportOn` must compose
sky and sun identically or the report lies about the trip it is reporting on. That is the
duplication this file already has a rule about: export one `travelFactors(expedition,
worldEvents)` from `daylight.js` and have both call it, rather than two call sites
multiplying two things in the same order and hoping.

**The tick gains no boundary.** Day and night touch expedition resolution only. Camp
production, consumption, raids, caravans and crafting are untouched, so `nextEventAfter`
is unchanged and a month's absence costs exactly what it costs today.

**`departedAt` is already available.** `reportOn` has `row.departed_at`; the tick's
expedition state does not carry it but `returnsAt - travelHours * HOUR_MS` is exact.
Select it in `src/db/world.js` anyway — deriving a stored column is how the two drift.

### 3. Temperature

**Derived from the sky, not generated beside it.** A `warmth` field on each `WORLD_EVENTS`
spec, composed the way `productionFactors` composes, plus the diurnal swing and the
seasonal term. No new seed, no new generator, no new slot calendar, nothing to keep in
step with the one that exists. It also gives the seven existing kinds a temperature
character for free: a rad storm is hot, hard rain is cold, long light is warm.

**It has exactly one mechanical job: it sets `Kr` and `Kf`.** Heat widens the gap between
day and night; cold and cloud narrow it. That is the whole of it, and the restraint is the
design rather than an omission — the sky already owns production, haul and dose, and a
second global system pulling the same three levers would make `effectsOf` an incomplete
account of what the weather is doing to you. `effectsOf` is a contract the page prints.
Adding a silent second contributor to those numbers is the failure mode this phase is most
likely to have, and one lever is how it is avoided.

**Deliberately not built: cold raising food consumption.** The overhaul document asks for
it and it is the obvious camp-side effect. It is refused here because consumption is where
the load-bearing balance guard lives: `test/unit/tick.test.js` pins time-to-death between
36 and 72 hours, and that constant exists so the game punishes neglect rather than a
weekend away. A weather kind that quietly raises the burn rate moves that window for a
player who is not at the keyboard to see why. If it is ever wanted, it wants its own
measurement and a restatement of the guard, not a `warmth` coefficient.

**The seasonal hazard, named now and built.** A year-long term means a suite that passes
in August can fail in January, and it would fail on a day nobody changed anything. `Kr`
and `Kf` are therefore clamped to their bands, and `test/unit/temperature.test.js` reads
them at **every hour of a full year** — 8,784 of them, against a clear sky, against every
warm event stacked at once, and against every cold one. Any test that reads the wall clock
instead of being handed an instant is a flake waiting for a season.

**As built.** The climate is the annual mean (20°C) swung ±13 by the season, plus the
`warmth` of whatever sky is in force, read against a band of 5°C to 35°C. Four of the
seven kinds carry a `warmth`: Rad Storm +6 (a dirty sky is a hot one, which the prose
already said), Long Light +5, Hard Rain −6, Dust −2. The other three do not, and that is
deliberate rather than unfinished — Caravan Season is traffic, the Blight is in the soil,
and the Slip is something that fell. None of them is the sky doing anything to the
temperature, and a token value would be content invented to fill a column.

**Warmth is summed where everything else here is multiplied**, because these are offsets
on a temperature: a storm over a hard rain is warmer than the rain and cooler than the
storm, which is what a sum says and what a product could not.

**The thermometer and the lever are two different readings, and separating them is the
one subtle thing in this section.** `temperatureAt` includes the diurnal swing and is what
the glass prints. `climateAt` excludes it and is what sets `Kr` and `Kf`. Feeding the
current point on the day/night swing into the coefficient that *scales* that swing would
count the same fact twice, and would make a trip's factor depend on the hour the player
happened to load the page.

### 4. What the instruments buy

**The mechanic is never a secret.** The bands and the *direction* are free and always on
the page: you always know it is night, and you always know the night is kinder on the
counter and thinner on the haul. This phase adds no hidden multiplier, which is the
standing rule since the UI-honesty pass — a player who cannot see the number cannot plan
around it, and the whole decision here is when to spend survivor-hours.

What fuel buys is *precision*, and the radio is the precedent: it is already an upgrade
that changes nothing in the simulation and sells one fact. Two more of those:

- **The clock — fitted to the shelter.** The exact hour, and, on the dispatch table, the
  daylight-and-dark split of each proposed trip in hours. Without it the table says "most
  of it in the dark"; with it, "6h light, 3h dark". The shelter is chosen because it is the
  only structure with no branch on the fuel track and because a clock on the wall is what a
  shelter is. Cheap and early: this should be reachable in the first day.
- **The glass — fitted to the watchtower, beside the radio.** Today's actual `Kr` and `Kl`,
  the current temperature, and the conditions for the next several hours — which is the
  one that lets you plan a trip that leaves in bad weather and returns in good. The tower
  is where the camp learns things; it already sells one.

#### What the glass turned out to be — built 2026-08-27

A **chart of the current world day**, not a line of figures. Temperature against time is
the same plot as *how much the hour is worth*, because temperature is what sets `Kr` and
`Kf` — so one line answers "when should the long trip go" for a whole day. Day and night
are two grounds a step either side of the block's own fill, the weather that arrives is a
bar beneath, and the two turns of the light are named on the axis, because those are the
hours the chart is read for.

**The window is a fixed day and the marker travels across it.** Plotting "now to now plus
a day" would pin the present to the left edge for ever. Arrows in the label strip reach
six days either way — a week of forecast and a week of record. That reach is a design
decision and not a limit of the arithmetic: the seed would answer for any day the world
has ever had, and an instrument that printed a year would end planning rather than serve
it.

**The temperature wanders, and it had to.** It was a cosine on a cosine — a perfect wave,
identical every day, which reads as a diagram of weather rather than as weather. Drift is
drawn at anchors eight hours apart and smoothstepped between them, seeded from the anchor
index alone so it is a fact about the world rather than about the camp reading it. It made
the climate genuinely time-varying, and three tests were right to fail: what survives is
that the gap between the thermometer and the climate is the diurnal term, which depends on
the hour of the day and on nothing else.

**A page that draws a number twice has to keep both true.** The chart's marker walks the
line every second while the strip's temperature was server-rendered text — wrong within
eight minutes, three degrees out after three. `nextDegreeChange` arms the strip for the
instant its *displayed* figure changes, capped so a plateau at the turn of the day cannot
leave it unarmed. That failure was found by being asked whether the two would agree, not
by any test: every visual defect in this phase was invisible to a suite that reads HTML
and never lays it out.

**`upgradeFor` becomes `upgradesFor`, returning a list.** The singular is an accident of
there having been three structures and three upgrades, and the watchtower is now the first
with two. Three call sites in `view-camp.js` (686, 739, 834) name the result `branch`, and
the page renders one. This is small, and it is the only structural change in the phase, so
it should be done first and on its own.

### 5. Night content

**Nothing is gated at dispatch.** No region, offer, recipe or road link becomes unavailable
because of the hour. The timezone objection is the reason: a player whose only check-ins
are world-daylight must never be locked out of a verb, and a night-gated *destination*
would do exactly that where a night-weighted *trip* does not.

Night belongs in what the trip meets. `momentsFor(region, seed)` places moments across the
travel hours, so the world hour of each placement is already knowable — a moment can be
tagged as one that only happens in the dark, and darkness is reached by leaving at the
right time rather than by checking in at it.

**This makes moment placement depend on departure time, and that is a real change worth
stating.** Today a trip's moments are a function of `(region, seed)` alone. They would
become a function of `(region, seed, departedAt)` — still pure, still replayable, still
derived from stored columns, but no longer reproducible from the seed by itself. Every
tool that regenerates moments from a seed must be handed a departure, `moment-balance.mjs`
included. If that turns out to cost more than the content is worth, night moments are the
part of this phase to drop; §§1–3 do not depend on them.

### The bound applies, restated

Uplift from attending must stay under the step to the next rung, or the right play is to
grind the region you have. The same rule, in the same words, for the same reason:

> **The gain from choosing the right departure hour must stay under the step to the next
> rung.**

If sending someone out at dusk out-earns sending them somewhere better, the map has
stopped mattering and this phase has repeated the mistake the bound was written to
prevent. `Kr` and `Kf` are provisional above precisely because this is what sets them, and
it is measured rather than argued.

#### Measured 2026-08-27: inside the bound everywhere it is about progression

`tools/daylight-balance.mjs` sweeps every region across every departure hour at all three
turns of the year, in **yield per day including bench time** — the dose a trip takes *is*
bench hours, so measuring per trip would report the cost of daylight and miss the benefit
of darkness entirely.

Every region that pays in scrap or fuel is inside. The Deep Zone swings 14% against a 61%
step to the next rung, Coastal Wreckage 21% against 22%, Underground Bunkers 15% against
22%. The Fence Line swings **0%**, exactly as the finds decision intended. What darkness
actually buys at the Deep Zone is about **eight hours off the bench** — 39.5 down to 31.0
— paid for in what turns up.

**One region is over, and it is deliberately accepted: Irradiated Farmland, at 50%
against a 22% step.** It is the only region that combines full reach — six hours, so it
can be aimed wholly into light or wholly into dark — with dose-dominated economics, eight
rads against a six-hour trip, so its bench time is longer than its journey. Every other
region has either no dose or compressed reach.

The reason for accepting rather than tuning is what the bound is *for*. It exists so that
optimising something small cannot out-earn moving up the map: *"the map stops mattering
and the right play is to grind the region you already have, carefully."* That is an
argument about progression. Scrap builds and fuel opens the road. **Farmland pays in
food**, which is consumed, capped by storage, and produced by the garden anyway — so
grinding it at night feeds the camp rather than advancing it, and the failure the bound
describes cannot happen there.

The alternative was rejected on measurement rather than taste: bringing 50% under 22%
needs roughly `Kr ∈ [0.08, 0.17]`, and the skills work already established that a cautious
curve here reads as nothing at all. It would fix one food region by making the whole
mechanic invisible.

**`daylight-balance.mjs` encodes this rather than leaving it to memory.** It carries a
`PROGRESSION` set of scrap and fuel, marks Farmland *over, accepted (consumable)*, and
counts only progression currencies in its verdict — because a guard that fires every run
is a guard nobody reads, and the next violation needs to be the one that stands out.

### The tests

**For the sky integration, which lands first and on its own:**

1. A trip entirely inside one weather window resolves *identically* to what sampling gave
   it — the constant case must not move, roll for roll.
2. A trip under a storm for its first third takes a third of the storm's dose surcharge,
   not none of it and not all of it. This is the exploit, written as an assertion.
3. A trip that ends the instant a storm clears is no longer free of that storm.
4. Weather that changes twice mid-trip integrates all three pieces; boundaries inside the
   trip are cut, not rounded.
5. Two blights *concurrently* still compose multiplicatively. Integration is across time
   and must not quietly flatten the existing composition across events.
6. `integrateFactors` is pure and replay-stable: same events, same window, same answer.
7. Predicted, and the point of the whole exercise: **the ninety-day soak's totals move
   inside sampling noise.** A material move means the mean was not preserved and the
   change is wrong, not merely tuned.

**For the sun:**

8. A trip whose hours straddle a full day and night resolves *identically* to the same
   trip with the sun absent — roll for roll, not merely in total.
9. `d` is computed across the trip, not sampled: a trip nine-tenths in daylight returning
   after midnight is a daylight trip.
10. Daylight moves `finds` and leaves bulk loot alone. The Fence Line, with `finds: []`
    and no dose, resolves identically at every hour of the day — the Fence Line case is
    the reason the lever changed, so it is the one to pin.
11. A find's chance is clamped to `[0, 1]`, and the draw *count* is unchanged: the same
    seed takes the same number of draws from the generator with and without the sun.
12. `Kr` and `Kf` stay inside their band at every hour of a full simulated year. No test in
    this phase reads the wall clock.
13. Bands, temperature and factors are pure: same `now`, same events, same answer, on any
    machine and in any local timezone. Run at least one case under a non-UTC `TZ`.
14. No new slice boundary. A long absence with an expedition in flight cuts the same slices
    it cuts today.
15. The report and the tick agree. The same expedition through `reportOn` and through
    `returnExpedition` produces the same factors, which is what one shared function is for.
16. The dispatch table's promised split matches the split the trip actually resolves
    against — the contract, tested, since it is the reason any of this is integrated.
17. Zero migrations: the suite that builds a database from `migrations/` is untouched.
18. The bound, measured rather than asserted.

### The instrument

`tools/daylight-balance.mjs`, on the pattern of `region-balance.mjs`: sweep departure hour
against every region, report haul per trip, dose per trip and **fuel per day including
bench time**, since uptime is the currency this phase actually trades in. Re-run
`fuel-balance.mjs` afterwards — this moves the numbers behind queue item 2 — and
`moment-balance.mjs` if night moments are built.

### The hazards, recorded before they are found

1. **A player locked to one band.** Answered by putting the weight on the trip, and the
   answer is only as good as that. If any later change gates a verb on the hour, this
   objection comes back and it comes back unfixed.
2. **Two systems on the same three levers.** Temperature gets one job so that `effectsOf`
   stays a complete account of what the weather costs. The moment a second contributor is
   added silently, the page is lying with true numbers.
3. **The season breaking the suite on a day nobody deployed.** Clamped band, year-long
   test, no wall clock in tests.
4. **The dispatch table becoming a solver.** Printing the split and the multipliers is the
   honesty rule, but a table that shows the optimum too plainly makes the choice for the
   player. Show the split and the direction; do not rank the rows.
5. **Night moments changing what a seed means.** §5. Droppable without touching the rest.

## Phase 7 — the roster, and the bed that decides it

*Designed 2026-08-30, with the user, after four mechanisms were weighed.*

Phase 10 says stamina and the roster ship together or not at all, and the user's own note
adds the constraint that decides everything here: **idleness is per survivor, and what
matters is whether the *camp* is idle.** Two people alternating means somebody is always
available — so the second survivor has to arrive in the first day or two, or every new camp
plays the version that does not work.

### The four ways in, and why beds won

**A moment that yields a survivor** was the first proposal and does not survive contact.
Moments occur only on trips of four hours and over — the Fence Line and the Service Road have
no interior — so a new camp must reach the Ruined City before one exists. Forcing "the *next*
moment is an encounter" also overrides `momentsFor`, which derives the schedule from the seed
and allows one axis per trip, so trips would stop replaying.

> **The fatal objection is the shape rather than the plumbing: it makes the second survivor a
> reward for going out, and the second survivor exists so that you can go out when the first
> one cannot.** Under Phase 10 the failure state is one exhausted person and an idle camp —
> exactly when a trip is not available to fix it.

**A scheduled morning arrival** was the second and is much stronger. It needs no dispatch, and
it reuses two things already built: the gate block from the empty camp, and armed timers, so
it appears without a reload. And *8 a.m.* means something now — migrations `015` and `016`
gave the camp its own clock, so you check in over breakfast and somebody is there. Its
weakness is that the condition offered was shelter level 2, which **a new camp already starts
at**, so it is an unconditional script wearing a gate.

**The caravan** brings someone. First visit is 30–84 hours out by construction, so it lands
inside the window; it needs no new scheduling and is the best of the four thematically. But
it couples the roster to a system a player can ignore, and 84 hours is outside the window at
the top of its range.

**Beds** win, and take the morning arrival as their arrival beat.

### Beds

**A bed is a fitting in the shelter that can be built more than once, capped by shelter
level.** The roster holds `1 + installed beds`: the first survivor needs no bed, so a camp
with one bed can hold two people.

**Priced in scrap, which the fuel rule permits rather than forbids.** Fuel buys capabilities
and scrap buys structure, and a bed is a physical thing built into a shelter rather than an
instrument. It is also the only workable answer: **none of the regions a new camp can reach
return any fuel at all** — the Fence Line, the Service Road, the Ruined City and the Farmland
are scrap, food and water — so a fuel-priced bed could not be bought inside the window this
phase exists to hit.

The intended first day, which is the whole test of the design:

    found the camp                       10 scrap
    send somebody to the Service Road     6-14 scrap back, under an hour
    build a bed                           ~12 scrap
    the next morning at eight             somebody is at the gate

**The cap is `floor(shelter level / 2)`**, so a camp starts able to hold two and grows by
building. Shelter has bought nothing but storage since it was written; this gives it the
second job it has always been short of, and it puts the cost of a bigger roster exactly where
Phase 10 wants it — one more mouth against the same garden.

### Schema

`structure_upgrades` is `UNIQUE (settlement_id, upgrade)`, which is what makes every fitting
once-only. Beds need an **`ordinal`**, defaulting to 1, with the key becoming
`(settlement_id, upgrade, ordinal)`. Every existing fitting keeps ordinal 1 and stays
once-only because `upgradesFor` will not offer it a second time; nothing else about the
fitting model changes.

`characters_one_living_idx` — `UNIQUE (settlement_id) WHERE died_at IS NULL` — is what
enforces one survivor, and it goes in the same migration. It is deliberately *not* dropped
before the code can handle two people: `loadWorld` already reads a roster
(`ba86abc`) and says so, and the index is what has been keeping that list honest at length
one while the rest is built.

### Whose hands, decided 2026-08-30

Nearly every verb already demands living hands and none of them names whose, and Phase 10's
first decision — *it depletes from everything: travel, construction, crafting* — cannot be
charged until they do.

**Work belongs to a named person.** Building and crafting occupy somebody and cost them
stamina. This is the only thing that makes the roster's justification true: *survivor-hours
are scarce and must be allocated*. The original justification — more hands, more verbs — was
measured false on 2026-08-19 and is not coming back.

**The player picks, for everything.** Not only dispatch. A chooser on every build row and
every recipe was offered as the cost and accepted, on the grounds that it is the truest
reading of "what did this person spend the day on" — the camp assigning quietly would make
the roster something to watch rather than something to run, which is the *queue discipline
with a gauge attached* outcome Phase 10 names as the failure.

> **The cost to watch, recorded so it is a known trade and not a surprise:** the structures
> list and the bench are already dense, and this adds a selector to every row of both. If it
> reads badly at three survivors it is the layout that should move, not the decision.

**One block per person, stacked.** Each survivor keeps the block they have now, with its
Condition / Skills / Carrying tabs. Simplest to build and nothing new to learn; a roster
strip with a single detail block was the alternative and was declined.

> The known limit: a shelter 8 camp holds five people, which is five blocks of three gauges
> in a narrow rail. **Revisit at the roster size that actually hurts rather than in advance**
> — the roster is two for a long time, and a strip can be introduced later without changing
> anything about how work is assigned.

### Two people out at once, decided 2026-08-31

**The dispatch table stays single, with a chooser per row.** It lists eleven regions, so one
table per survivor is thirty-three rows of identical region data for a camp of three. That is
settled by arithmetic rather than taste, and it is the same shape the build and craft rows
take.

**A trip is reported inside its own survivor's block.** Vera's block says where Vera is,
which follows from stacked blocks: the alternative puts a person's condition and their trip
in two different stacks and makes "what is Vera doing" a question you answer twice.

**Contact stays one block, showing the window that shuts soonest and naming whose it is.** A
moment is the one thing on the page carrying a deadline, and that block's existing rule is
that the deadline goes first. Others queue behind it with their time named. One box per open
moment was the alternative and was declined: three alarm boxes at once is the page shouting.

### What this does not decide

**Which survivor a verb belongs to.** Dispatch, crafting and using an item all take "the
survivor" today, across 26 call sites. That is the next piece of work and it is where the
roster stops being a refactor and starts being a game.

## Phase 10 — stamina, and what a survivor's day is worth

*Against: one survivor, and nothing to decide about them.*

Designed 2026-08-27 from `wasteland-overhaul.md` §§4–5, which proposed stamina and sleep
and which this file had already refused once. The refusal was half right, and the half that
was wrong is the reason this section exists.

### The correction that opens it

**Stamina was never measured.** Phase 7 records `skill_combat` and `stamina` as "measured
and found to be scenery", and `tools/skill-sensitivity.mjs` has three axes in its table —
health, radiation, scavenging. There is no stamina row. Combat is measured scenery; stamina
was convicted by sitting next to it.

The column has been on `characters` since migration `001` and nothing has ever read it.

### What the measurement actually taught, which is not what it was asked

    radiation 0 -> 75    44% of answers change
    health 100 -> 60      0% of answers change

The difference is not size. **Radiation gates dispatch** — it decides when the survivor may
leave again — and health gates nothing until the last few points, because the game
guarantees a healthy survivor cannot die: maximum hazard at danger 5 is 45 against 100
health.

> **A gauge matters if it decides what you may do next.**

That is the whole finding. It is what makes stamina *possible*, and it is also what makes
it dangerous.

### The trap: a second radiation

A stamina bar that gates dispatch is radiation wearing a different label. Two gauges doing
one job means the player only ever meets the tighter of them — invisible whenever radiation
binds first, indistinguishable from radiation when it does not. That is the failure to
design against, and it is not hypothetical: it is what the overhaul document proposes.

The separation has to be structural.

> **Radiation limits where you can go. Stamina limits how much you can do at all.**

Radiation comes only from dangerous ground and decays on a clock that fuel can buy down.
Stamina comes from *everything* — travelling, building, crafting — so the question it asks
is "what did this person spend the day on", which the game has never asked.

### The five decisions

**1. It depletes from everything.** Travel, construction, crafting. Not from danger, which
is radiation's job, and not from the passage of time, which is nobody's.

**2. It recovers passively.** Sleep is an accelerator and never a requirement. The
alternative — recovery only through scheduled sleep — means a player away for three days
returns to a survivor who has been exhausted for sixty hours and done nothing, which is
precisely the punish-a-weekend-away failure the 36-to-72-hour guard exists to prevent. The
overhaul document lists "a well-prepared camp must remain safe during a normal real-world
absence" among its balance principles and then proposes the mechanic that breaks it.

**3. Recovery drinks food, and this is the load-bearing one.** *(Superseded 2026-09-01 —
recovery draws nothing at all now, and only hunger may reach the stores. The reasoning below
is why it was built, and* What decision 3 became *is what happened to it.)* Measured 2026-08-27:

    garden   grows   a mouth eats   surplus   surplus in mouths
      L1       0.6            0.5       0.1         x0.2
      L2       1.2            0.5       0.7         x1.4
      L4       2.4            0.5       1.9         x3.8
      L6       3.6            0.5       3.1         x6.2
      L8       4.8            0.5       4.3         x8.6

**Food is not a constraint in this game; it is a solved problem by garden level two.** Every
camp measured is sitting at its storage cap and throwing food away hourly. So "recovery
costs hunger" at any modest rate costs *nothing*, and stamina would be scenery for a third
time.

For it to bite, recovery has to drink something like **five to eight times** a survivor's
ordinary consumption while it is happening. That is a large number and it is the number to
measure rather than to guess. What it buys is worth the trouble: the garden has one
interesting level and seven decorative ones, and this gives it a track. **Production would
limit labour, and labour builds production** — a loop the game does not have.

**4. Sleep is the accelerator.** It trades the survivor's availability for a faster
recovery: they cannot travel, build, craft or answer contact while asleep. That is the
decision — not whether to recover, but whether to spend the hours recovering *fast*.

**5. It needs the roster, and that is not a detour.** With one survivor, "what did this
person spend the day on" has one answer, and stamina does not create a choice — it removes
verbs. The camp goes quiet, which is strictly worse than today and the opposite of what
Phase 7 was measured to need.

### What this does to Phase 7

Phase 7's premise was retired on 2026-08-19: one survivor is not a bottleneck on the verbs,
because every verb guards on *alive* rather than on *home*. That retirement was correct, and
it left the roster without a justification, where it has sat since.

**This is a different justification.** Not "more hands, so more verbs are available" — which
was measured false — but "survivor-hours are scarce and must be allocated", which is a claim
about scarcity rather than about availability.

The two ship as a pair or not at all. The roster without stamina is the thing already
measured as changing one bucket on 12% of visits; stamina without the roster is a mechanic
that switches the page off.

### The question that kills it or confirms it — asked and answered

`skill-sensitivity.mjs` is the wrong instrument, because stamina does not act on moments —
it acts on which person is sent. The question is:

> **Does stamina ever make the right answer "send the tired one anyway"?**

Simulate a camp of two or three against a stamina budget and compare optimal play with the
trivial policy — *send whoever has the most*. If the trivial policy is always optimal then
stamina is not a decision, it is queue discipline with a gauge attached, and the honest
outcome is to drop the column at last.

The food axis is what gives it a chance of surviving that test. With recovery priced in
food, sending the tired one costs food the camp may want for something else, which is a
second thing to weigh. Without it the answer is always "send the rested one", and there is
nothing here.

#### Measured 2026-08-27, and the answer inverts the proposal

`tools/stamina-sensitivity.mjs`. A camp of two picks somebody to send; what the choice is
worth is the haul over how long that person is then unavailable, and with two gauges the
downtime is `max(rads to clear / decay, stamina to refill / regen)`. **That max is the
whole mechanic.** Read over eight dosing regions and four thousand states each:

    shape      cost/regen   binds   contested   cleanest wrong   rested wrong
    gentle         1.5/2      29%         22%              47%            53%
    moderate       3/1.5      64%         32%              91%             9%
    steep          4.5/1      79%         39%              95%             5%
    brutal        6/0.75      92%         44%              97%             3%

*Contested* is the share of states where the cleanest survivor and the most rested one are
different people — the only states where anything is being chosen. The two right-hand
columns are read inside those alone.

**Only the gentle shape is a decision.** At 47/53 neither single-gauge policy is right more
than a coin flip, so a player has to weigh dose against tiredness. Every harsher shape
collapses into a *swap*: at brutal, "send the most rested" is right 97% of the time, which
is not stamina adding a choice but stamina taking radiation's job.

> **A punishing stamina system is less interesting than a light one**, which is the
> opposite of what the overhaul document proposes. Exhaustion at zero and hard gating
> produce the bottom row of that table.

The signal is real but modest: about a fifth of dispatches are contested, and in those the
call is near enough even. For scale, the scavenging skill was judged worth building at
"moves one answer in ten".

**So the shape is settled before the mechanic is — or it was, until the section below
found the reason.** Against a threshold radiation the answer is a gentle stamina: cost
around 1.5 an hour of travel, recovery around 2 an hour at rest. A trip pays itself back in roughly
three-quarters of the hours it took, which is well inside the thirty-one hours the Deep
Zone's dose already costs — stamina is the *second* constraint by design, and binds on 29%
of occasions rather than on most of them.

**One correction, recorded because it looked like a result for ten minutes.** The first
version of this instrument counted states where the best pick was *neither* the cleanest
nor the most rested, and printed a flat zero at every shape. That was arithmetic, not
evidence: with two survivors and two gauges the winner is always better on at least one of
them, so the column could not have been anything else. The question had to be narrowed to
one that can vary.

#### The shapes have to match, and radiation's is the one that is wrong

Measured 2026-08-27, following the table above, because the obvious next question was
whether a harsher radiation would make room for a harsher stamina. It does not, and *why*
it does not is the useful part.

    decay  shape       contested   cleanest wrong   rested wrong   survivor idle
      0.8  gentle           22%              47%             53%              4%
      0.3  gentle           22%              44%             59%              6%
      0.8  brutal           44%              97%              3%             48%
      0.3  brutal           44%              96%              4%             48%

Slowing the decay by nearly three times barely moves anything. **`radWait` is zero until
the dose crosses sixty**, so a slower decay only sharpens a gauge that is dormant in most
states. Radiation is a *threshold*; stamina as modelled is *linear*.

> **A threshold gauge and a linear gauge cannot contest each other across a range.** Below
> the line stamina decides alone; above it radiation swamps everything. Only a stamina
> small enough to lose to the rare bite looks like a decision — which is exactly why
> "gentle" was the only shape that worked, and it was working for the wrong reason.

So the shapes have to match, and radiation's is the one to change.

#### Radiation on a curve, and the cliff nobody should have to learn

**Proposed by the user 2026-08-27: no hard threshold, an exponential cost to health
instead.** Damage as `radDamagePerHour * (rads/100)^4`, chosen so the top of the scale —
where the game is already balanced — stays near where it is, and the flat nothing below
sixty becomes a slope.

    coming home at      today    cube      ^4
        30 rads          0 hp    1 hp     0 hp
        45 rads          0 hp    5 hp     2 hp
        60 rads          0 hp   16 hp     8 hp
        75 rads         15 hp   40 hp    24 hp
        90 rads         58 hp   83 hp    60 hp

The cube is a death sentence at ninety on a survivor who also arrives with up to forty-five
hazard damage. The fourth power leaves that end alone and does its work lower down.

**It makes radiation more of a decision, not less**, which was the risk worth checking —
the measured 44% came from crossing the threshold, and a curve has no line to cross. What
a further 25 rads costs, in health, at each starting level:

    already at    today   quartic
             0      0.0       0.1
            20      0.0       1.9
            35      0.0       7.5
            50     14.8      21.1

    levels where today says the dose is free: 8 of 11
    levels where the curve says it is free  : 0 of 11

**Today, taking another twenty-five rads is free at eight levels out of eleven.** The
decision only exists in a narrow band near the cliff; everywhere else the answer is "yes,
obviously". A curve asks a different question at every level, which is what a gauge is for.

#### What that does to stamina, which is the reason for all of it

With no threshold there is nothing to wait *under*. What makes somebody unavailable is
health: they bleed while irradiated and only heal once the dose is nearly gone. So the two
gauges become health and stamina, and both are continuous.

    shape      contested   healthiest wrong   rested wrong   survivor idle
    gentle           47%                 9%             91%             48%
    moderate         47%                15%             85%             51%
    steep            45%                37%             63%             61%
    brutal           45%                62%             38%             72%

**The contest doubles and then inverts.** Nearly half of all dispatches are contested
rather than a fifth, because a continuous gauge always has something to say. And it is now
the *harsh* stamina shapes that hold their own: gentle loses at 91%, because a radiation
that is no longer dormant simply out-argues it.

That is the first table read the other way round, and it is one finding rather than two:
**two gauges contest when they are the same shape and the same size.**

#### Re-measured 2026-08-30, after the trip started settling across its hours

Phase 11 changed idleness, and idleness is the number every figure below was tuned against,
so `stamina-sensitivity.mjs` was run again before any of this was built on.

    shape        contested          survivor idle
                 was  ->  now       was  ->  now
    gentle       47%  ->  47%       48%  ->  39%
    moderate     47%  ->  46%       51%  ->  50%
    steep        45%  ->  45%       61%  ->  60%
    brutal       45%  ->  45%       72%  ->  63%

**The central claim is untouched.** Nearly half of all dispatches are contested at every
shape, which was the whole argument — a continuous gauge always has something to say, and
two gauges contest when they are the same shape and the same size.

**The stated cost got cheaper.** "Buying the contest costs a fifth of the playtime" was
written against 72% idle at brutal and 48% at gentle; the band is now 63% and 39%. The dose
arrives earlier, decays earlier, and people wait less.

**But the tuning conclusion below is wrong now, and this is the correction.** It says to look
between steep and brutal. Brutal has flipped:

    brutal        healthiest wrong   rested wrong
    was                 62%               38%      stamina was the better heuristic
    now                 43%               57%      health is

Steep is unchanged at 36/64. So steep and brutal have converged, and brutal no longer buys
the extra contest it used to — it costs more idleness for the same 45%. **The range to look
in is steep, and not past it.**

> **A note on the instrument itself, settled 2026-08-31.** Its first two tables modelled
> radiation as a threshold, which the game stopped having on 2026-08-27 — half its output
> described a game that did not exist. They were cut when sleep shipped, and the finding they
> produced is kept in the source above what remains, because *a threshold gauge and a linear
> gauge cannot contest each other across a range* is a fact about shapes rather than about
> constants and it is why the cliff went.
>
> The surviving table now imports the damage curve and the healing rule from `tick.js`
> instead of carrying copies. The healing copy was stale in the same way — it switched off
> past `regenRadCeiling` where the game fades it with the dose — so every figure moved a
> little on re-measurement: *healthiest wrong* reads 15/28/43/51% against the 9/15/37/62%
> recorded above, and the shipped shape ("reach", 3.8) sits at 45% contested, 45/55, 57%
> idle. The conclusion is unchanged, and the tables above are the older instrument's.

### The cost, and the tension left open

`survivor idle` runs 48% to 72%. Two qualifications before that number is used for
anything: recovery here waits for health *as well as* for the dose, which the threshold
model did not, so part of the jump is the stricter definition rather than the mechanic —
the two tables' idle columns are not comparable. And the game gates dispatch on nothing at
all: going out hot is the player's judgement, so this is what a cautious player would
choose rather than what the rules impose.

What is comparable is the trend inside the table. **Buying the contest costs a fifth of the
playtime**: 72% idle at brutal against 48% at gentle.

And that is the tension this design has not resolved. The game's largest measured balance
problem is that idleness makes danger 4 out-earn danger 5 — Coastal Wreckage at 19.4
fuel/day against the Deep Zone's 13.7, because the dose idles the survivor. **This design
increases idleness deliberately.**

**Answered 2026-08-27, and the answer changes the question rather than accepting it: the
idle figure is per *survivor*, and the thing that matters is whether the *camp* is idle.**
Two people alternating means somebody is always available, so a survivor spending seventy
percent of their time recovering is not seventy percent of a quiet page — it is the other
one working. Idleness only reads as dead time in a camp of one, which is the camp the
measurement was taken in because it is the only camp the game has.

That turns a tension into a **constraint on Phase 7**: the second survivor has to arrive
*early*. A roster whose second arrival is a reward for weeks of play would leave every new
camp playing the version of this that does not work, and the mechanic would be judged on
its worst case. Whatever finally schedules arrivals — a wanderer at the gate, a passenger
with a caravan, on the raid and caravan seed pattern — the second one belongs in the first
day or two, and the cap after that can be as slow as it likes. That is not a reason to drop it; it is the reason the
exponent and the stamina cost have to be chosen against the idle column and not only
against the contest column. Somewhere around `^4` and between `steep` and `brutal` is where
to start looking, and `fuel-balance.mjs` has to be re-run against whatever is chosen before
any of it is believed.

### Constraints it must not break

**The 36-to-72-hour starvation window** (`test/unit/tick.test.js:131`). A survivor
recovering stamina on empty stores starves faster. Recovery must either stop when there is
no food, or be measured against that window with the window restated — and restated for a
camp at its bed cap rather than for one person, which Phase 7 already flags.

**`regenHungerCeiling` is 25**, and health regenerates only below it. Recovery that pushes
hunger past 25 stops the survivor healing, so stamina recovery and health recovery would
compete for the same room. That is either a tension worth having or an accident that makes
injury unrecoverable, and it has to be chosen rather than discovered.

**Storage caps become a stamina reserve.** A camp at 350/350 throws food away every hour
today; once recovery drinks it, shelter levels quietly become labour capacity. Worth having,
and worth being a decision the page states rather than a surprise a player works out.

### Schema

`characters.stamina` needed none. It is `numeric(6,3) not null default 100 check (stamina
between 0 and 100)` and has been since migration `001`.

The one column three phases have wanted to drop turns out to be the one this needs. That is
an argument for having left it, and it is not a strong enough argument to have left it on —
the plan's own note stands: a schema describing a system nothing implements reads, to
anyone planning against it, as a system that is nearly there.

Sleep needed one: `characters.sleep_until timestamptz`, migration `020`. A column rather
than a table because one person's sleep is a queue of one by construction, and only an end
because nothing ever asks how long they have been under — see the migration, which argues
both.

## Sleep, built 2026-08-31 — the last piece of Phase 10

*Decision 5 of the five, and the only one that had not been built.*

A survivor can be put under for a fixed number of hours. While they are, they recover at
`staminaSleepPerHour` instead of `staminaRegenPerHour`, and every verb refuses them:
`who-is-free.js` gained a `sleeping` occupation, so the gate, the yard, the bench and the
pack all say "Vera is asleep and cannot ..." without any of them learning what sleep is.

**There is no waking them, and that is the mechanic.** Recovery happens anyway — passively,
at a point an hour, which decision 2 settled to keep a weekend away survivable. So the only
thing sleep can charge for the speed is the availability, and an availability the player can
take back at any moment is not a price. A twelve-hour commitment is twelve hours.

### The rate is derived, not swept

**An hour asleep undoes an hour of work**: `staminaSleepPerHour` *is*
`staminaPerHourWorked`, one constant read twice, 3.8.

The sensitivity table could not have chosen this, and it is worth being clear why. That
instrument measures *which survivor to send*; sleep does not touch that question — it
changes how long the answer stays unavailable. So the figure comes from a rule, the way 3.8
itself did (a hundred points over the longest walk on the map). Harrow End is 26 hours out
and costs a whole gauge; under this it costs a whole day under. The coupling to the map
recorded against `staminaPerHourWorked` now covers both numbers, because they are one
number.

Passive rest stays at 1/h and is therefore 3.8 times slower, which is what keeps this a
decision rather than a formality: a camp that never sleeps anybody still recovers, across
four days instead of one.

### What decision 3 became

Phase 10's third decision — *recovery drinks food, and this is the load-bearing one* — was
built as `staminaRecoveryRationMultiplier`, six times a mouth per point recovered. It was
load-bearing for a real reason: food is not otherwise a constraint, so this was the only
thing making production limit labour, and it is what turned a shelter's storage cap into a
reserve of working hours.

**It is gone, and what replaced it is one rule from the user on 2026-09-01: only hunger may
draw on the stores.** See *What recovery costs* below for how it got there. The chain is now

    stores -> hunger -> stamina -> work

with each arrow the only way to cross it. Production still limits labour — through a belly,
which is how it works everywhere else — but it limits it **much** more loosely, and that is
a balance fact worth stating rather than discovering:

> **Measured 2026-09-01: a full gauge, nought to a hundred, costs the camp 50 food. Doing
> nothing at all for the same hundred hours costs the camp 50 food.** Recovering is a mouth
> like any other mouth. Under the multiplier the same hundred points cost 300.

So recovery's price is now **time and the healing ceiling**, not food. That is a deliberate
trade and it is the user's, made with the number in front of them: the arithmetic nobody
could believe — a sleeper drawing twenty-three mouths an hour out of stores while the page
said they were asleep — bought a loop that was never legible as a loop.

**If food should bite again, the lever is not this.** It is `foodPerHour` against
`hungerFallPerHour`, which together decide what a point of hunger costs in rations: half a
unit of food currently buys twelve points, which is why the chain is cheap. Retuning those
two is a change to the whole hunger economy — the starvation window included — and should be
measured as one.

### Three durations, and no free number

`sleepHours` is `[4, 8, 12]` — a nap, a night, a long night, worth 15, 30 and 46 points
against 17, 34 and 50 hunger. The longest is deliberately shorter than the longest walk, so
the deepest hole a player can dig takes two decisions to climb out of. A free number would
have needed a bound, and a bound is a constant nothing derives.

The three are a real choice rather than three sizes of the same thing, and only because
nobody can be woken: a nap stays under the healing ceiling, a long night does not. Picking
one is picking how much of the next day to spend hungry.

### Two things the tick had to learn

**Waking is a slice boundary.** `nextEventAfter` cuts at every survivor's `sleepUntil`, or a
sleep ending mid-slice would be paid at whichever rate the boundary test happened to land
on. It is the first boundary in that function that belongs to a person rather than to the
camp, which is why it is a loop.

**`recoveryOf` is one definition asked three times** — by the tick that charges it, by the
gauge mark that names it ("asleep +3.8/h"), and by the stores line that prices the camp's
draw. A page quoting a rate the simulation is not charging is the fault this project keeps
finding in itself; three callers of one function cannot have it.

### What recovery costs, settled over four answers

Asked by the user the day sleep shipped: *does recovering stamina deplete hunger? I think it
still depletes food and water directly.* It did, and only that. Getting from there to the
rule took four answers, and the last is smaller than any of the others.

#### The hole

`appetite` scaled the ration draw; hunger moved on `fedFraction` alone. Pay the bill and
hunger fell at the ordinary rate whatever the bill was. **Measured over ten hours from hunger
40, on stores deep enough to pay: idle ended at 0.0, recovering at 0.0, asleep at 0.0.** The
intent — *resting hard is work of a kind and should show on the gauge eating does* — was
written in this plan, in the constant's own comment and on the page, and implemented nowhere.

Worse, `staminaRecoveryHungerTaper` stopped recovery as hunger approached
`regenHungerCeiling`, to keep recovery from locking an injured survivor out of healing. It
guarded a cost that could not occur, and it was not free: it slowed a hungry survivor's
recovery for a reason that was not real.

#### Two wrong turns, both dials

**First:** charge hunger per point recovered — `staminaRecoveryHungerPerPoint`, derived at
4.2 from two bounds. It worked and it measured correctly. It was a new dial invented to make
a cost exist.

**Second:** the user, shown that a sleeper drew 11.4 food and 17.1 water an hour — *"sleeping
shouldn't draw food and water, you can't eat while sleeping."* A sleeper's appetite went to
zero and their hunger climbed at the unfed rate. Right, and half a rule: it fixed sleeping and
left resting drawing six mouths for reasons nobody could state.

#### The rule

> **Only hunger may draw on the stores.**

Recovery is charged in hunger; hunger is what sends somebody to eat; eating is the one thing
that takes food. `staminaRecoveryRationMultiplier` is deleted, appetite is a mouth or nothing,
and `staminaRecoveryHungerPerPoint` survives as **one price for everybody**, derived rather
than picked: an hour asleep recovers `staminaSleepPerHour` and costs `hungerRisePerHour`, so a
point costs `4.2 / 3.8 ≈ 1.1` hunger. Sleeping is that same price paid faster by somebody who
is not eating it back.

A sleeper is charged the recovery and *not* the ordinary unfed rise, because the two are the
same physical fact — a body running on reserves — and charging both puts a twelve-hour sleep
into the starvation band. What they pay is `max(unfed rise, recovery charge)`, which are equal
by construction while recovery runs and part company only when the gauge tops out mid-sleep.
**That is what keeps overshooting a real mistake**: there is no waking them, so twelve hours
to recover four points still costs twelve hours of hunger.

Measured on the shipped code, starting fed:

    4h asleep   +16.8 hunger    under the ceiling; a nap is free of the tension
    8h asleep   +33.6 hunger    healing has stopped
    12h asleep  +50.4 hunger    and starvation is still twenty away
    12h dozing    0.0 hunger    the charge loses to eating twelvefold

So a survivor cannot sleep a hard trip off and mend from it in the same twelve hours — they
wake hungry, eat it down at twelve an hour, and heal after. Awake, recovery costs the player
nothing to manage, which is the intent: **resting is the thing that always works; sleeping is
the thing you choose.** Both bounds are guarded in `test/unit/tick.test.js`, as consequences
of four constants rather than properties of one.

#### What the page had to learn

The hunger mark read "resting, eating for it" with the draw in its note, which described the
cost to the camp and left the survivor's unsaid. Both kinds of recovery now carry the charge —
`asleep +4.2/h`, `resting +1.1/h` — and the eating mark is suppressed for a sleeper, because
the page was otherwise printing "eating −12/h" under a gauge climbing at 4.2, which is the
page contradicting the simulation in the space of two marks. The hunger popup gained
`recovering +1.1 a point`; the stamina popup lost its rations row and gained
`costs 1.1 hunger a point`.

#### And what it did to the soak, which was not a regression

`test/db/soak.test.js` failed on the change: one moment answered in ninety days. Nothing was
broken — the survivors were healthy, clean and dispatching constantly. Richer camps produced
busier ones, their trips settled at about twelve hours, and the automaton checks in every
twelve. Every trip was dispatched at one check-in and home by the next, so across ninety days
it *saw* nine active trips. Widening the jitter from two hours to four took that to
forty-two. **The lesson is about the instrument: moment coverage there is incidental, so a
balance change that moves trip lengths can silently stop exercising the path the run exists
to exercise.**

### A bug the fixtures found### A bug the fixtures found

`workingAt` compared `built_by` / `fitted_by` / `crafted_by` against `survivor.id` directly,
so `undefined === undefined` made an *absent* fitting into a job somebody was doing.
Invisible in play, because every loaded survivor has an id — and it made every hand-built
fixture read as "fitting", which is how it surfaced: a sleep test that recovered nothing. An
unowned job occupies nobody, and the comparison now says so.

`test/db/page-contract.test.js` had the same shape of assumption one layer up: it counted
gauges per *page* and capped them at four, which was true while every fixture held one
survivor. The `asleep` page state is the first with two people on it. Four is a fact about a
person, and it is counted per card now.

### What is deliberately not built

**Answered by Phase 12 on 2026-09-02, and the paragraph below is kept for its reasoning.**
A sleeper can be pulled to the fence: `answerRaid` refuses only somebody who is *away*, on
the rule that standing is a job you can be too busy for — you put the beam down, and
somebody twenty hours down the road cannot. `resolveRaid` no longer exists, and neither
does the founder-takes-the-damage line noted below: each defender now takes their own.

*Written when sleep shipped, 2026-08-31:* **a sleeper still defends.** `resolveRaid` asks
only whether anybody is alive, so the overhaul document’s “cannot defend while asleep” is
not modelled. Modelling it means deciding what a camp of sleepers does when raiders arrive,
which is a raid design question and not a sleep one. Noted here so the next reader knows it
was seen rather than missed. Related and worth grepping before touching raids: `raid()`
passes `state.survivor` — the founder — as the person who takes the damage. That is the
sixth instance of the phrase that meant “the survivor” when a camp held one.

**No shelter bonus.** The overhaul proposes a shelter that improves sleep. Beds already cap
the roster, so "you need a bed to sleep" would be scenery — everybody standing in the camp
has one by construction — and a level-scaled rate is a second dial nothing derives.

**No night bonus.** The camp clock exists and sleeping through the small hours could be
worth more. It is a nice idea and it is a *third* thing acting on one rate.

## Phase 11 — the trip as it happens

*Against: a trip you can watch and cannot touch.*

Designed and built 2026-08-28, from the user's question: should a trip's health, dose and
hunger land as they happen rather than at the gate, so that consumables mean something?

### Four fifths of it was already true

The premise needed checking before the design, and most of it did not need building.

    hunger, and food and water drawn        real time     tick.js
    radiation decay                         real time     camp-only filtration
    health regen and starvation damage      real time
    death out there, at the hour it happens  yes          tick.js, and long-standing
    the trip's own hazard and dose          at the gate   the only part that waited

**Field death was never new.** A survivor who starved mid-trip has always died at that hour,
the expedition has always gone to `lost`, the haul has always been forfeit, and the graveyard
has always recorded it. A trip that killed its survivor already forfeited the haul too. So
this was never "add death out there" — it was **let the trip's own two effects be the cause,
at the hour they happen.**

### What made it safe

`timeline.js` was written to attribute an outcome across the hours for *reporting*, and its
header declined to be authoritative. The contract it already guaranteed is what made the
promotion safe:

> `stateAt` is monotone in `hours` and exact at the end.

So the per-slice deltas over a whole trip sum to precisely the outcome that was rolled. The
change decides **when**, never **how much**, and no roll moved.

### The cost the module was guarding, measured

Its stated reason was that a survivor who dies out there stops eating hours earlier, changing
what an unattended trip costs a camp. True, small, and it runs the cheap way: the hazard
falls on average at 52% of the trip, so on an eighteen-hour run death moves from hour 18 to
hour 9.4 and the camp stops feeding a mouth 8.6 hours early — **4.3 food and 6.5 water**,
against a camp at its cap throwing food away hourly.

### What it actually did, which was not what it was for

`fuel-balance.mjs` run on both sides of the change, same seeds, same database:

    player          region              fuel/day        idle        change
    attentive       Coastal Wreckage    19.4 -> 19.4    0% -> 0%     +0.0
                    The Deep Zone       13.7 -> 13.6   41% -> 40%    -0.1
                    The Waterworks      14.4 -> 14.3   45% -> 44%    -0.1
                    Harrow End          19.0 -> 20.2   28% -> 22%    +1.2
    twice a day     Coastal Wreckage    19.4 -> 19.4    0% -> 0%     +0.0
                    The Deep Zone       12.7 -> 13.6    4% ->  3%    +0.9
                    The Waterworks      13.5 -> 14.5    5% ->  5%    +1.0
                    Harrow End          15.7 -> 18.4    2% ->  0%    +2.7

**Coastal Wreckage does not move at all**, which is the control: danger 4 doses nobody, so
there is nothing to accrue. Every hot region gains, and the casual player gains most.

The mechanism is the one the design predicted. The dose arrives earlier, so it *decays*
earlier, so a survivor is cool enough to send again sooner. Idleness is the whole of it.

> **This partly fixes the game's largest measured balance problem, and changes no constant to
> do it.** Harrow End at 20.2 now out-earns Coastal Wreckage at 19.4 for an attentive player,
> where before it lost 19.0 to 19.4. The danger-5 inversion is closed at the top of the
> ladder. For a twice-a-day player it narrows from a gap of 3.7 to a gap of 1.0 and is not
> closed; the Deep Zone remains far behind at 13.6, as the weakest danger 5 always was.

That is worth being explicit about, because it was not the goal. The phase was asked for so
that consumables would matter. The inversion was caused by idleness, accrual reduces
idleness, and the fix fell out — which is a good outcome and an accident.

Deaths were `0/5` on every row before and after: the tool sends healthy survivors, and a
healthy survivor still cannot be killed by hazard alone. **Accrual is more lethal only to a
survivor who leaves hurt**, because the damage now lands against the health they have at that
hour rather than the health they would have finished the trip with. That is the decision the
player made when they dispatched, and it was previously invisible.

### The tablet, measured

`useItem` shipped at half of potency — a Rad Scrubber worth 22.5 rads — with a note saying
the number had no anchor and wanted measuring. It did. `fuel-balance.mjs` gained a
`+ scrubbing` policy on 2026-08-30: a player who spends ten fuel and fifteen scrap on a
tablet rather than standing still, net of what the tablet cost.

    region                attentive   + scrubbing   change
    Underground Bunkers     13.0         13.0        +0.0
    Coastal Wreckage        19.4         19.4        +0.0
    Sixteen Wells            8.2          8.2        +0.0
    The Deep Zone           13.6         17.2        +3.6
    The Waterworks          14.3         19.0        +4.7
    Harrow End              20.2         23.0        +2.8

**Idleness went to zero on every hot region.** The three cold ones do not move, which is the
control: nothing to scrub. That is precisely the failure `tick.js` already names about
filtration — *radiation stopped being a constraint at all, and going out recklessly became
safer than waiting* — and it was reachable for ten fuel.

Swept to find where it stops paying:

    a tablet worth   The Deep Zone      Harrow End
      22.5 rads      17.2  (+3.6)       23.0  (+2.8)
      12   rads      12.7  (−0.9)       21.3  (+1.1)
       8   rads       7.7  (−5.9)       19.5  (−0.7)
       5   rads       2.1  (−11.5)      15.9  (−4.3)

Break-even is about twelve. `POTENCY_TO_POINTS` is **0.25**, which puts a Rad Scrubber at
11.3 and a Rad-X at 15, straddling it — and the measured result is a decision rather than an
answer:

    The Deep Zone    13.6 -> 11.9   (−1.7, loses)
    The Waterworks   14.3 -> 12.7   (−1.6, loses)
    Harrow End       20.2 -> 21.1   (+0.9, pays)

> **What the tool cannot see, and the reason the number is not pushed lower.** It measures
> fuel a day and nothing else. A tablet's other job is pulling somebody back from a dose that
> would have killed them, and deaths were `0/5` on every row of every run — so the survival
> value of a scrubber is entirely absent from these figures. A number that is marginal on
> throughput and valuable as insurance is the right place to stop.

Two copies of that constant were found while wiring it. The tool held its own, and so did
`view-camp`, which is how a page comes to advertise a dose the service will not deliver; both
read `POTENCY_TO_POINTS` now. And the pack's gear line was written as `points * 2`, which
equalled potency only because the constant happened to be 0.5 — retuning the tablets halved
the Scrap Spear. Gear reads its potency straight, the way `equipment.js` does.

### What is left

Nothing from this phase. The half it was asked for — **a moment option that spends a
consumable** — The pack is the
survivor's — `inventory_items.character_id`, carried with them, lost with them — so there is
no schema and no fiction to accept. `AXES` already contains `health` and `radiation`, moments
already land at an hour, and healing already knows which hour it happened at. What remains is
an option kind that requires an item and spends it.

### One thing to know at deploy

A trip already in flight when this ships accrues only from the first tick after the deploy.
The hours before that are never settled, so those trips are slightly less damaging than they
should be. One-off, bounded by the length of a trip, and not worth a migration to fix.

## Phase 12 — the raid as a decision

*Against: the one thing that happens to a camp and cannot be answered.*

Designed 2026-09-01 with the user, out of a bug. `raid()` passed `state.survivor` — the
founder — as who takes the damage, the sixth instance of the phrase that meant "the survivor"
while a camp held one. The fix needs to know who is actually holding the camp, and asking that
question honestly turns out to be the whole of a mechanic the game has never had.

### What a raid is today

Raiders arrive on their hour, the watchtower may turn them away, and whatever is left carries
off a share of every store and hurts somebody. **The player is never present for any of it.**
It resolves inside the tick, on a page load, hours after the fact — the one event in the game
that acts on the camp rather than on a trip, and the only one with no answer to it.

### What it becomes

> **A raid opens a window. You choose who stands.**

The survivor who stands takes the injury, and the raiders leave with less. Anyone away is
ineligible — they are twenty hours down the road. **Building and crafting do not stop you
defending**, decided by the user: a raid is not a job you can be too busy for. No answer by the
time the window closes means everybody hid, and the raiders take more.

That is the moment system pointed at the camp instead of at the road. `momentsFor` /
`isOpen` / an answer recorded on the row is exactly this shape, and the tick already stops at
`nextRaidAt`; what changes is that a raid whose hour falls inside the window is left *pending*
rather than resolved.

### The order of the evening

Two gates, and they answer different questions, which is what keeps both worth having:

1. **The watchtower decides whether they come.** `repelChance` fires first and is unchanged.
   A repelled raid opens no window — there is nothing to answer.
2. **The defender decides what they leave with.** Standing adds softening on top of the
   watchtower's, and at enough combat it reaches the whole way: **a strong survivor can hold
   the fence and cost the raiders the trip.**

Which finally gives `skill_combat` a job. It has been on `characters` since migration `001`,
was measured as scenery in Phase 7, and was very nearly dropped twice. It is scenery because
nothing has ever asked it a question; this asks it the only question a combat skill can be
asked.

### Hiding, and the principle it is spending

**The user's call, made against a stated objection: hiding costs a little more than a raid
costs today.**

The objection, recorded because it is the game's spine: a week away must not be punished. It
is why stamina recovers passively, why the starvation window is 36 to 72 hours, and why
raiders are generated by whoever next looks rather than by a scheduler. A window that costs
you for missing it is that failure by definition.

What makes it affordable is that today's absent player already loses on both counts — stores
*and* an injury. Hiding trades the injury away, so even at a somewhat larger share the absent
player is not simply worse off than they are now; they are worse off in stores and better off
in health. The user's judgement is that a raid should sting a little more when nobody answers
it, and that is the version to build.

**The bound this must be held to, and it is not optional:**

- The larger share is measured against **a week offline**, not against one raid. Raids resolve
  in sequence and a month away resolves the whole run of them; a factor that is gentle once is
  not necessarily gentle eight times.
- The floor stays. A raid wounds and never kills — `test/unit/tick.test.js` asserts it across
  200 seeds and that test does not move.
- If a week offline under the new share reads as a camp stripped rather than a camp raided,
  the factor comes down. **The number serves the principle; the principle does not bend to the
  number.**

### A raid wakes the camp

**Decided by the user: a sleeping survivor is woken by a raid, and is then pickable.**

This is the one exception to *there is no waking them*, and it is the right one — a rule with a
single dramatic exception reads as a rule, where a rule with none reads as an oversight. It
also gives the raid a second cost that is not health or stores: **the rest of that sleep is
gone**, along with the hours of recovery it was going to buy, and the survivor is left with the
hunger they have already paid for it.

It follows that the sleep ends whether or not anybody answers. It is the raid that wakes them,
not the choice.

### Nobody home, and everybody hiding

These converge deliberately: a camp with three people who all hid and a camp with nobody in it
lose the same. Only the log differs. **Presence is worth nothing unless it is spent**, which is
the sentence the whole phase is built on and is worth being explicit about rather than tuning
around.

### The numbers, and none of them are guesses

Four, and every one is measured before it ships:

    hidden share      "a little harsher" than today, bounded by the week-offline read above
    window length     2-4h, the user's range; measure the catch rate a real cadence gives
    combat softening  where "stood and held it" reaches minimal loss, and how steep it is
    the week away     total stores lost across seven days, new against today

`tools/check-in-density.mjs` already plays a camp at a real cadence and is the instrument for
the window: aim at roughly one raid in three being catchable by a twice-a-day player. A window
nobody meets is a mechanic nobody has, and one everybody meets makes the absent player's
harsher share the ordinary case rather than the exception.

### Schema

A raid becomes a row rather than a timestamp. `settlements.next_raid_at` says when the next
one falls due and cannot say that one is *currently happening and unanswered* — that is a
state with a seed, a deadline and an answer, which is what `expeditions` already looks like.
Migration 021: a `raids` table carrying the hour, the seed, the faction, the window's close,
and the choice when one is made.

`nextEventAfter` gains the window's close, for the same reason it gained a sleep's end: the
outcome changes there, so the walk has to cut there.

### Measured 2026-09-01, and it moved the design

Two instruments, `tools/raid-window.mjs` and `tools/raid-absence.mjs`. Both are pure —
`nextRaidAt` schedules and `resolveRaid` settles — so they measure the game rather than a
model of it.

#### The window: 4 hours, and wealth has nothing to do with it

    cadence                     2h    3h    4h    6h
    once a day, evening         8%   12%   17%   24%
    morning and evening        18%   25%   33%   50%
    three times                25%   36%   50%   71%
    five times                 40%   53%   66%   82%

A hoard raided every 48 hours and a young camp raided every 160 give the same column. The
catch rate is *window over the gap between check-ins* and has nothing to do with the gap
between raids — so the window is chosen against a cadence or against nothing.

**Four hours**, which puts a twice-a-day player at one raid in three, the stated aim.

**And a third of raids arrive between 23:00 and 07:00, which no sane window reaches.** The
camp clock is set from the founding browser, so a game hour is the player's hour. Put to the
user and settled: **raiders keep the small hours.** Being raided in the night is the setting
working, not a mechanic failing.

#### The absence: the bound was worth writing and does not bite

    away for      raids   today   +15%   +30%   +50%   (food)
    a week          1.4     133    153    173    200
    a month         7.3     702    807    910   1049

**The compounding this section demanded be measured does not happen.** `1.15x` stays `1.15x`
at every span, because a produced store refills between visits and the share is taken of a
full pile either way. Fuel goes the other way — 80 against 87 across a month, +9% for a +50%
factor — because nothing in the camp makes fuel, so the pile is already gone and a harsher
share only takes it sooner.

#### Which turns the contentious number into the uninteresting one

A week at +30% costs forty more food than today, against a storage cap of 350. The hider also
dodges an injury of 8 to 30. **At any factor in this range an absent player is arguably better
off than they are under today's raid** — so the harsher share cannot be what makes the choice
worth making, and the objection this section opened with is answered by arithmetic rather than
by care.

Settled with the user on that reading:

- **Hiding is `shareBoost` 1.15.** Small on purpose. With a four-hour window it is what
  happens to two thirds of raids, so it is not a penalty for missing a decision — **it is the
  new ordinary cost of a raid**, and it should be priced as one.
- **The weight goes on what standing saves**, which is the number a player actually feels.

#### What standing saves

A raid takes roughly 95 food, 95 water, 95 scrap and 22 fuel from a camp at its cap. So the
defender's reduction is worth an injury at ordinary skill and worth a great deal above it:

    share is multiplied by (1 - stand)

    combat   stand   what a raid still takes
       1      0.05   nearly all of it
       4      0.50   half
       5      0.65
       6      0.80
       7      0.95   nearly nothing

`stand = clamp(0.5 + (combat - ORDINARY) * 0.15, 0.05, 0.95)`, which puts the halving on the
ordinary survivor and reaches the user's *fend it off entirely* at the top of the pool. A poor
fighter who stands saves almost nothing **and still takes the injury** — a bad choice, freely
available, which is what makes it a decision rather than a button.

**Combat does not reduce the damage the defender takes.** Deliberate: if it reduced both, the
best fighter would simply always stand and there is no question left. Keeping them apart makes
the call two-sided — *who saves the most* against *who can afford the injury* — which is the
same shape as the dispatch question the roster already asks.

### The blocker nobody had noticed: combat does not exist

`skill_combat` is `smallint not null default 1` in migration `001`, and the string "combat"
appears nowhere else in `src/` or `migrations/` at all. It is not merely unread — **it is
never written**. Every survivor in every existing camp is a 1, and the wanderer pool does not
set it.

So Phase 12 cannot rest on combat until combat varies, and how it comes to vary touches the
one piece of content this file argues hardest about. The pool is seven wanderers, three
mirrored pairs plus a 4/4, averaging exactly `ORDINARY` on both axes — an arithmetic chosen so
that a spread costs the economy nothing, and so that a wanderer is *strong in one axis and
poor in the other* rather than simply good.

**Proposed, and wanting the user's nod before it is built:**

- **Combat is a third axis rolled independently of the mirrored two.** The pool's argument is
  about scavenging and medicine being anti-correlated; a combat number alongside them does not
  disturb that, where folding combat into the mirror would break the average and turn "strong
  in one" into "good at things".
- **Every survivor alive today becomes `ORDINARY`.** Not a random backfill: the column has
  never varied, so *everyone has always been ordinary at this* is the one true statement about
  them. Rolling dice retroactively would invent facts about people the player already knows.

The alternative worth naming: combat could be **earned** rather than issued — raids survived,
or defences stood. That is a progression system the game does not otherwise have, and it would
mean a new camp cannot defend at all until it has been raided, which reads badly. Recorded as
considered, not chosen.

### A crew, decided 2026-09-01 after playing it

This section used to end by *not* deciding whether a crew defends better than one person —
bodies did not count, one survivor stood and the rest were simply not the ones standing. The
user overturned it within an hour of the block being on screen, and the reason is the block
itself: four names, one of them able to press anything, and the page was plainly asking the
wrong question.

**Everybody who stands, stands.** Two rules settle it, and they have to hold together or there
is nothing to weigh:

**What they hold back is `1 - the product of what each fails to hold`.** Not a chosen curve —
it is what "each of them independently stops some of it" *means*, it can never exceed the
whole, and the second body is worth less than the first without any rule saying so.

    Vera .45   Hansert .45   Wren .20

    Vera alone          45%      Wren + Hansert      56%
    Vera + Hansert      70%      all three           76%

Adding them to a cap was the alternative and was refused: it makes the third body worth
nothing and the second worth everything, a cliff at a number nobody can see.

**Each of them takes their own injury.** Splitting one raid's worth between them was the
gentler option and it removes the decision entirely — more defenders, less hurt each, so
committing the whole camp is strictly better than committing one. Paid separately, a crew buys
stores with health across the roster and *how many do I send* stays a question. The floor is
per survivor, so four defenders come home wrecked and alive.

Migration `022` follows from the second rule rather than the first: what a raid has to record
is a set of people **and what each of them took**, which `raids.stood_by` could not hold.

### What this still does not decide

**Whether standing should soften what a defender takes.** A crew of four fighting together
plausibly takes less each than one alone. It is left out because it points the wrong way:
softening with numbers, on top of holding back more with numbers, makes sending everybody the
answer to every raid.

## Phase 13 — what a person can carry, and what the camp keeps ✅

*Against: a pack with no bottom, and no way to move anything out of it.*

Designed 2026-09-01 with the user. **Built 2026-09-02** — see the end of this section for
what the build decided and what the browser found.

### Three reasons, and the first is a fault rather than a feature

**1. Parts scatter and nothing can move them.** `consumeInputs` takes a recipe's materials
from *the crafter's* pack, and finds land on whoever walked. So the scavenged parts for a
plate vest end up spread across three survivors and the bench refuses, with no verb in the
game that can put them together. There is no transfer of any kind. That is a present,
felt fault and it is the strongest argument here.

**2. A pack has no bottom.** Nothing limits what a survivor carries, so "what do I take"
is not a question anybody has ever been asked.

**3. A pack dies with its owner.** `inventory_items` cascades on delete and migration `001`
says so on purpose: *carried inventory belongs to the survivor and dies with them.* Nothing
in the game can bank an item against that. The camp outlives its people everywhere else.

### The four decisions, all the user's

**Weight is carried items only.** A trip's `loot` — scrap, fuel, food, water — goes to the
camp's `resources` and always has; only `finds` become items. So capacity constrains what a
person carries and touches the haul not at all, which is what lets this ship without
re-measuring the economy. **The alternative was refused deliberately**: weighing the haul
would put a ceiling on fuel per day, and fuel per day is the axis the road's 396 days, the
fittings' 252 and the whole danger-4 against danger-5 argument are measured on.

**The box banks against death.** Items in it are not lost when a survivor is. That is the
box's reason to exist beyond tidiness, and it is the game's own rule about settlements
applied to things for the first time.

**Transfers are free at camp and frozen during a raid.** The second half is not a detail. The
raid built on 2026-09-01 rests on `standFor` reading the weapon somebody is *carrying*, and
its whole character comes from there being no way to hand it over — *who has the spear is a
lasting fact about a person, one you built rather than rolled*. Free transfers would make gear
fungible and collapse "who stands" into "who can afford the injury", with the spear posted to
them. Frozen while a raid is open, the tension survives exactly where it matters and nowhere
else, which is the same shape as *somebody away cannot defend*.

**A flat cap for everybody.** No pack item, no per-survivor difference. A rucksack that
raises capacity while occupying capacity is a knot, and it would be one more thing that has to
be in the right hands. The decision stays *what do I take* rather than *who has the good bag*.

### The cap is derived, and here is the rule

The same method `staminaPerHourWorked` used — a rule about the map rather than a number off a
sweep:

> **A survivor can carry their kit, what they will need on the longest walk, and what that
> walk is likely to find.**

So the measurement, before any number is written down: **the distribution of `finds` per trip
across the regions**, at the 90th percentile rather than the mean, plus the weight of a
working kit — a weapon, armour, and consumables enough for a Harrow End run. The cap is the
sum. A cap that makes the ordinary trip drop something is a cap that punishes playing
properly; a cap that never binds is a column nobody reads.

Weights themselves are content, per item, and want the same anchoring pass: a tablet against a
spear against a plate vest. A stack weighs `qty × weight`, which needs saying once.

### Measured 2026-09-02, and it moved the design

`tools/carry-balance.mjs`, 4,000 trips per region against the real region rows.

**A ration's weight is derived, not invented, and reality checked the arithmetic.** A point
of hunger has a mass: eating covers `hungerFallPerHour` an hour while costing `foodPerHour`,
so one point is 5.2 g at Phase 18's conversion. Tinned Stew is 80 points, therefore **417 g**
— which is a tin of stew. Preserved Meal comes out at 365 g. Neither number was chosen. The
rest are the anchoring pass the rule asked for: tablets at 20 g, parts at 750 g, the spear at
2 kg, the vest at 9 kg.

**What a trip brings home is small, and the far regions are where it is anything at all.**
Median haul by mass: nothing at all up to the Millrace, 750 g at Coastal Wreckage and
Sixteen Wells, 1.5 kg at the Deep Zone, the Waterworks and Harrow End. The heaviest single
trip measured anywhere was 3.1 kg.

**So the cap the rule produces is 14.9 kg, and 11 kg of it is the kit.** Spear and vest are
three quarters of the pack; the walk's supplies are 854 g and the p90 haul is 3 kg. The term
this phase is *about* — what a trip finds — is a fifth of the number.

#### The question the measurement asks, and it is the user's

**Does gear that is worn count against the cap?** The phase says weight is carried items
only, and never distinguishes *worn* from *carried* because until now nothing needed the
distinction.

    trips before the pack is full, at a 14.9 kg cap
      Harrow End / Waterworks / Deep Zone      2.0 with kit      9.3 without
      Coastal Wreckage / Sixteen Wells         4.0 with kit     18.7 without

**Counting it makes armour a real cost, which is the more interesting game.** A survivor in a
plate vest has 4 kg of pack left, so one long trip roughly fills it, and the next find is
refused on the road — that is the vest being *heavy* in a way the player feels rather than
reads. It also agrees with `standFor`, which already reads a *carried* weapon: gear is on
your back, not in a slot beside it.

**Not counting it makes the cap a pure question about hauling**, at nine long trips between
visits to the box — which, since every trip ends at camp anyway, is a cap that never binds
and a column nobody reads. That is the failure the rule was written to avoid.

**Recommended: worn gear counts.** With one consequence to accept deliberately — a fully
kitted survivor loses finds on a long trip unless they bank first, and the page has to say so
before dispatch rather than in the returning log.

### What happens when a full pack meets a find

They are on the road; the box is at home. **They leave it, and the log says what.** That is
the moment the cap exists for, and it should be rare rather than routine — which the
derivation above is what guarantees.

### Four interactions, and three of them are the good kind

**`equipmentOf` reads what is carried**, so storing your spear disarms you on the next trip.
Coherent, and it makes the box a real choice rather than a shelf.

**`standFor` reads the same thing**, so a spear in the box defends nobody. Also coherent, and
it is what keeps the raid honest once transfers exist.

**The tick's safety valve reaches into the pack**, not the box: before lethal damage a
survivor eats whatever they are carrying. So **banking your emergency rations is how you die
with a full larder.** That is a genuine tension and worth keeping rather than smoothing — the
box is safe from death and useless in an emergency, and both halves of that are true at once.

**The bench draws from the crafter's pack**, which is the fault this phase opens with. If the
box is not reachable from the bench, the fix for scattered parts is to shuttle them to
whoever is crafting, every time — busywork replacing an impossibility. **Answered by the user on 2026-09-02: yes, the bench may draw from the box.** The recipe's argument survives it
— *the interesting half of a recipe is the thing you had to go and find* is about where a
material came from, not about which pocket it is in.

### Schema

    items          + weight, numeric, not null
    store_items    settlement_id, item_id, qty, unique (settlement_id, item_id)

A table of its own rather than a nullable `character_id` on `inventory_items`: the two are
different things with different lifetimes, and the cascade that destroys a pack is exactly
what must not reach the box.

Nothing changes about death. A pack still dies with its owner; the box is opt-in, and the
decision to bank is the player's.

### One verb

`moveItem(from, to, slug, qty)` where each end is a survivor or the box. Refuses when either
survivor is away, when a raid is open, and when the receiving side has no room. One verb
rather than three, because store, take and hand-over are the same act with different ends.

### Built 2026-09-02, and what the build decided

Migration `024`, `src/game/carrying.js`, `src/services/move-item.js`, and the box block on
the camp view. 331 unit tests and 218 database tests green.

**The cap is 15 kg**, rounded up from the measured 14,854 g, and the rounding is the only
part of it that was chosen. **Worn gear counts against it** — the user's call once the
measurement showed the kit is three quarters of the cap — so a survivor in a plate vest
carries 11 kg of their 15 and one long trip roughly fills the rest. There is no `equipped`
flag in the schema and this is why one was not added: `equipmentOf` and `standFor` already
read what is *carried*, so gear is on your back rather than in a slot beside it.

#### Four departures from the design above, all small and all deliberate

**`weight_grams` is an integer, not the `numeric` the schema sketch said.** A gram is
already the small unit, half a gram is a distinction no content here will want, and an
integer cannot drift when a stack is multiplied out.

**A finished craft that does not fit goes in the box; a find that does not fit is left
behind.** The design wrote one rule for a full pack, but the two cases are not the same act:
a find is out there and the box is at home, while an order is lifted off a bench that is
standing next to the box. Refusing the order would destroy something already paid for in
fuel and scrap. Two events say which happened — `find_left_behind` and `craft_boxed`.
**A caravan's goods take the same road as the bench's**, and for the same reason: the camp
is standing right there.

**The bench spends the pack before the box.** A survivor's own materials are the ones that
die with them, so spending those first is the ordering that loses least, and it keeps the
box a reserve rather than the first thing raided.

**The tick still cannot see the box, structurally.** `loadWorld` does not read `store_items`
— the box is read by `viewCamp` and by the bench, not by the simulation — so the safety
valve eating the pack and never the shelf is a fact about what `applyTick` is handed rather
than a rule somebody has to remember. `test/db/carrying.test.js` asserts the behaviour; the
seam is what guarantees it.

#### The page, and two things only the browser said

The block goes through `block()` with the picker in its label strip, like the bench. Both
were found by reading the rendered page rather than the markup, which is the third time that
rule has paid for itself:

**The box's rows sat 16 pixels left of every other block's.** `.carrying` is styled for the
two-hundred-pixel rail inside a survivor card — `padding: 7px 0`, no side padding, because
the rail provides it. In a full-width block the cells carry their own padding, so the box
uses a plain table like Structures and the bench do.

**The pack line and the box's footnote both wore `.short`, which is oxide** — the class the
stylesheet reserves for *a price the camp cannot pay*, a warning, a clock that is running
out. Every pack on the page read as an alarm. They are captions, so there is now a `.caption`
rule that is faint, with the reasoning beside it.

**And the box's picker is deliberately not `whoSelector`.** That helper offers whoever is
*free*, which is right for a job — dispatching, building, the bench. Reaching into a box is
not a job: `moveItem` refuses only somebody who is **away**, so a camp where everybody is
building can still bank a spear. Built on `whoSelector` the page would have refused what the
service allows.

#### One fixture bug worth recording, because it looked like a code bug

The new page state put a survivor named Wren beside a successor the wanderer pool had also
named Wren. Every `name <> 'Wren'` in the fixture then matched nobody: both packs rendered
empty, both options in the Take control read the same, and the page looked broken in a way
that had nothing to do with what it was drawn to check. Fixtures now capture the id they
insert rather than matching on a name out of a pool of seven.

### Storage became a view of its own — 2026-09-02, the same day

The box shipped as a block on Camp, under the bench, and was played for about an hour before
the user asked for this: **a tab holding the box and every survivor's pack side by side, with
drag and drop between them.**

**The argument for the move is that the block could not answer the question it was for.**
What a player does here is *compare* — this pack against that shelf against the other pack —
and a block sitting ninth in a column of blocks has nothing beside it to compare with. A view
whose whole subject is one question can stand every holding in a row, which is also the only
layout in which dragging one thing onto another means anything.

So `PANES.camp` lost `box` and gained nothing; `PANES.storage` is `['storage']` and holds one
board. The rail gained **Storage**, between Survivors and Road.

#### The trip is a switch, and the pack is always the default

A card carrying the trip block *and* the pack table ran most of a screen tall. The trip is a
panel of its own now, revealed by a control that is in the strip only while somebody is out.

It was a third tab first, and the default while anybody was away. **Both were wrong and the
user cut them.** The tabs are three views of one person; this is a view of one *card*, and a
tab that takes over the strip has to say something about the other three people — the build
fell through to their packs, which worked but meant the tab meant two things at once. And a
default that moves when somebody leaves the camp means the page opens somewhere different
depending on what the camp is doing. **Carrying is the default, always.**

So: a switch that takes over the traveller’s card and leaves everybody else exactly as they
were. It names who is out rather than saying *away* — on a roster of four that is the fact
being offered — and it falls back to “on the road” when more than one person is.

**On by default, so the attribute names the closed state.** A body that has never been
clicked carries no attribute at all, so a rule that *shows* a trip cannot be written against
one; what the switch sets is `data-away-shut`, and turning it on again is deleting that.
The generated tab rules are re-run for the traveller under that attribute rather than being
negated, so the card rejoins the strip without those rules knowing this control exists.

**And it does not look like a tab**, which is the point of it not being one. The tabs are a
strip of words with the open one underlined; this is a state, so it is a box with a lamp in
it — hollow ring off, filled with oxide on — borrowing the sending radio’s idiom, which is
what this page already uses to mean *this one, right now*.

**On the body, like the tab**, and for the same reason: a per-card attribute lives inside the
section the page replaces on every action, so it would be lost on the next swap. `syncTabs`
presses the button back in after a swap for exactly that reason — the fresh button knows
nothing, and the body is the one copy of the state.

One thing the contract test could not ask, and now asks differently: the sheet is a single
constant carrying every rule on every page, so *does the trip have a rule* is always yes.
What it pins instead is that **the switch and the trip panel appear together** — a control
over nothing, or a trip the page renders and cannot reveal, are the two failures worth
catching. It also learned to look for the button rather than the string, because the client
script is printed into every page and was matching its own source.

#### Away dims the pack, not the person

The card was greyed whole while somebody was out — borrowed from the board, where a holding
that cannot be reached really is unreachable. On a survivor it was wrong, and wrong against
a decision recorded two hundred lines above it: **health and radiation keep moving while
somebody is away** — the dose accrues across the walk since Phase 11 — so a card dimmed for
exactly the hours those numbers move fastest hides what it exists to show.

What is out of reach is the pack, so the pack is what says so: dimmed, with the board’s own
words under the total, and its rows no longer draggable. A row that can be picked up and
dropped nowhere is a gesture the page offers and the service takes away — `moveItem` refuses
either end of a transfer twenty hours down the road. **Use still works**, which is the point
of the pack travelling with them.

#### What has somebody, as a chip on their name

The occupation line was a sentence sitting on top of the column the four gauges had just
moved into — prose over a list of figures. It is a chip after the name now, small and faint
in the label face so the name stays the loudest thing on the card, and it answers the
question a roster is scanned for: *who is doing what*, beside the person it is about.

**And every timed job carries its clock, not sleep alone.** Sleep had one because the hour
sat on the survivor’s own row and the card could reach it; building, fitting, crafting and
standing at the fence were named and left open-ended — a state a player cannot plan around,
which is the opposite of what committing the hours was for. Every query in `occupations`
already had the instant in hand and dropped it, because its only caller was a refusal and a
refusal asks *whether*, never *for how long*. They all carry `until` now.

Away stays out of the chip. It heads its own field in the middle column with the place, the
picture of it and the countdown — a chip repeating that would be one card saying one thing
three times.

#### The survivor card lost a tab, 2026-09-02

**Condition is not a tab any more; it stands under the name on every card.** A tab is for
what you go and look at, and a gauge is for what you glance at — health, hunger, the dose and
stamina answer *can this person do the thing*, which is the question every other control on
the card is asking, so hiding them behind a tab meant clicking to find out whether you were
allowed to click.

**Carrying is the default and Skills follows it.** With the Store button gone this is the
view where things are handed from one person to another, and a pack you have to open a tab
to reach is a pack you cannot drag out of. Skills is the one thing on the card that is
genuinely a reference: it changes about once a lifetime and is read when choosing who to
send, not while sending them.

The gauges went into the left column with the name rather than as a band across the card —
a band would have sat under the open tab rather than under the name it describes. Four of
them do not fit across 190px, so that column is 240 now and they lay out two by two, which
needed the wide arrangement’s `grid-column` assignments explicitly let go of.

#### Making a row look liftable

Nothing about a table row says it can be picked up, and on this board a row *is* a thing
rather than a line of text. Three signals, in the order the eye meets them:

- **Weight.** Everything empty is cut into the panel (`--void`); everything holding
  something sits on it (`--panel`). The box runs taller than its six rows, so its block
  takes the dark too — otherwise the recess appears to stop halfway down.
- **A grip.** Two columns of dots in the gutter of every liftable row, drawn with a
  `radial-gradient` rather than typed, so it cannot be selected with the row’s text or
  announced as a character.
- **A lift on hover.** The row comes up to `--rule-in`, the grip goes to `--dim`, the name
  to `--bone`, and a 2px oxide edge lights on the leading side — the ink every live control
  on this page already uses.

**And then the whole gesture followed, 2026-09-02.** The Carrying tab lost its Store button
the way the board lost its Move buttons — two ways to move a thing is one too many, and the
one that survives is the one that says where it is going. Every row there is draggable now,
and **a survivor card is a holding**: `data-hold` on `.person` makes each person a place a
row can be dropped, so Vera hands Wren a spear on the view that lists them both. The box is
not on that view and is not meant to be — this is hand to hand, and the shelf has a view of
its own.

That decorated an opening tag two contract tests pinned literally (`<div class="person">`).
They now pin the element and its class and not what the card says about itself, which is the
same distinction the section rule draws — recorded rather than worked around, because a card
that can be dropped on has to say so in the markup.

**The shading and the hover belong to the pack table wherever it is drawn**, so the Carrying
tab on Survivors took them too: it is the same table describing the same objects, and
styling one and not the other made the tab read as a list and the board as an inventory.
**The grip stayed on the board alone** — it is the one mark here that means *pick this up*,
and a row on the Carrying tab cannot be picked up, so the same dots there would promise a
gesture that does nothing. A slot does not light up either: a hole is not a control.

**Two things this pass found.** `--ground` for an empty row is seven points of grey from the
panel: a difference you can measure and cannot see. And the drop highlight had been reaching
for `--plate`, which is not a colour on this page at all — it is the region-image URL the
road plates use — so a drop target had only its border to show for itself.

#### Moving is a drag and nothing else, and a drag moves one

The board shipped with a destination picker in every foot and a Move button on every row —
dragging as an enhancement over a control that works with a keyboard. **The user cut both**,
and the reason holds: on a board whose whole point is that everything is visible beside
everything else, a select naming the columns you can already see is furniture.

**The form stays and only its controls went.** Each row still carries a real `/move` form
with hidden fields; the drop sets the destination and submits it. So there is still one path
to the verb, and a refusal still comes back through the page’s own submit handler with no
error handling written for the drag.

**A drag moves one, whatever the stack holds.** The gesture has nowhere to put a number, and
the two readings of dropping a stack of four are equally reasonable — which is the sign that
it should mean the smaller one. Four drags to move four is legible; a stack that vanished in
one because a drag meant *all of it* is not, and there is nothing to undo it with.

**The cost, recorded rather than discovered later: taking something out of the box now needs
a pointer.** The Carrying tab on Survivors keeps its Store button, so putting things in still
works without one; there is no keyboard route the other way. If that ever matters the answer
is a control on the row, not the select that used to be in the foot.

#### The box runs the height of the roster beside it

`align-items: stretch` on the board, and the two columns end level however many people the
camp holds. **Nothing counts anybody** — the grid does it, which is why it stays right
through a death or an arrival without a line of code knowing one happened. Measured against
a live page: four survivors put both columns at 722px, two at 401, and one at 360, where the
box is the taller of the pair and sets the height itself.

The destination picker is pinned to the bottom edge with `margin-top: auto`, so the panel
reads as a container with a foot rather than a table with a gap under it.

#### The box keeps six rows whatever is in it

`BOX_ROWS` is **a floor and never a ceiling.** The box is uncapped — the constraint this
phase is about is the road, not the shed — so the blank rows are not slots and a seventh
thing does not go homeless; the table grows past them. What they buy is a shelf that keeps
its shape: storing the last item used to collapse the panel to a single sentence, and on a
board of columns that reads as the box having gone away rather than as the box being empty.

The empty-box sentence rides in the first blank row rather than above the table, so a full
box and an empty one are the same height and the words sit where the first item would.

#### A holding is a block, and there is no block around them

The board shipped as bordered panels inside a block called Storage, and the user cut the
wrapper: **one frame too many.** A block is already the page’s word for a bordered thing
with its name in a strip, and the board is the only thing on its pane, so the outer block
was naming the view a second time. The box and each survivor are blocks now; the board is
only the grid they sit on.

Two things followed from going through `block()` rather than around it. It grew an `attrs`
option, so a holding can be a block *and* the drop target without a second element wrapped
around it — the drag handlers look for `[data-hold]` rather than a class. And a heading
that carries a figure now lays out as a row: `.block > h2:has(.val)` joins the `.f-nav` and
`.tabs` cases that were already there, which is the same rule with a third occupant rather
than a new one.

**The destination picker moved to the block foot.** The strip is the name and the figure —
the two things being compared across the board — and a select wedged between them pushed the
figure past the border on a column this narrow.

One alignment fix worth knowing: `.carrying` was cut for a two-hundred-pixel rail, where the
rail supplies the side padding and the cells carry none. In a block the cells have to, or
every name sits inboard of the label above it.

#### The box takes the width, the roster stacks down the side

Five equal columns was the first build and the user drew over it: **the box wide on the
left, the people in a narrow column beside it.** It is the right shape for what the two
things are. The box is what gets filled and emptied — it holds the most, it is the only
uncapped holding, and it is one end of nearly every move — so it takes the width. The
people are a list of destinations, and a list is read down.

One column under 900px, with the override written *after* the rule it overrides: a media
query carries no specificity of its own and loses to an equal selector above it.

#### Every column is the same shape, and the differences are data

A hold is one function. The box and a person both hold items, so what separates them is what
they are called, what they weigh against — the box is uncapped and prints no denominator —
and whether they can be reached at all. Somebody *away* gets a column that says so and takes
no drops, which is the rule `moveItem` already enforces: away is the only occupation that
puts a person out of reach.

#### The gesture submits the row's own form

**This is the load-bearing decision of the whole feature.** A drop could have built its own
`fetch` from the drag data. It does not: every row carries a real form with a real
destination — chosen by the picker in the column head — and the drop handler sets one field
and calls `requestSubmit()`. `requestSubmit` rather than `submit`, because only the former
fires the event the page's existing submit handler listens for.

What that buys, in order of importance:

- **One path to the verb.** A second one would drift from the first, and the drift would be
  in the half nobody clicks.
- **The board works with no script at all** — pickers and buttons — and with a keyboard.
- **Refusals already work.** The submit handler applies the response in place, so "not while
  they are at the fence" lands on the page it was refused from, with no error handling
  written for the drag at all.

A whole stack moves, which is what the button does. Half a stack wants a number and the
gesture has nowhere to put one.

#### Two faults the browser found, and one the tooling did

**The head did not fit.** Name, total and destination on one line pushed the total out past
the column border at 230 px. The name and the figure it is compared on keep the first line;
the picker takes the second.

**Synthetic mouse input cannot start an HTML5 drag.** `left_click_drag` through the browser
tool moved nothing and proved nothing — the handlers had to be driven with real `DragEvent`
objects to see the path work. Worth knowing before trusting a green drag test again: the
end-to-end proof was a `dragstart`/`dragover`/`drop` triple, after which the Plate Vest was
in the box, Vera was down from 11.75 kg to 2.75 kg, and the page had never left
`/camp/storage`.

**And the dev environment lied twice.** A stale server from that morning served pre-Phase-13
code for half an hour while `/health` answered 200 — the tell was the CSS, not the markup.
Then the WSL distro began shutting down between commands, taking Postgres with it and killing
the app server on an unhandled pool error each time. Holding the distro open with a long
`sleep` fixed it. **`curl /health` is not proof the running server is the code on disk**;
grep the served CSS for something only the new build has.

#### What is deliberately not built

**No quantity in the gesture, and no multi-select.** Both want a control the drag does not
have, and the button beside every row already moves the same stack.

**The pack tab on Survivors keeps its own Store button.** It is the shortest path when you
are already looking at a person, and it posts to the same verb. Two entrances to one room.

### What this does not decide

**Whether the box has a cap of its own.** Uncapped to begin with: the constraint this phase
is about is the road, not the shed. If hoarding turns out to be the game, the lever is the
shelter, which already sets a storage ceiling for resources and could set one here.

**Whether weight should cost stamina.** A heavy pack slowing a walk is the richest version of
this and it reopens a derivation: `staminaPerHourWorked` is a hundred points over the longest
walk on the map, and a weight multiplier on top makes that ceiling a function of what somebody
packed. Separable, and it wants its own measurement.

## The road ahead — the order, decided 2026-09-02

*Seven phases, and the order below is an argument rather than a ranking.*

Settled with the user on 2026-09-02 by reading `wasteland-overhaul.md` back against this
file and asking what of it is genuinely still unbuilt. Four things were: its **§2** (night
as a different thing), **§§12–15** (faction relations), **§7** (recruitment through the
world) and the **second half of §10** (body recovery). Phase 13 was already designed and
belongs among them rather than before them. Phase 18 came later the same day and is not from
that document at all — it is the user asking for food and water to be counted in units a
person could hold.

Everything else in that document has landed. §1 is Phase 9, §§4–5 are Phase 10 and sleep,
§6 and §8 and §11 are Phase 7 and `who-is-free.js`, and §10's first half is Phase 13. The
overhaul document remains **a source and not a plan**: what was read and declined is at the
end of this section, so it is not proposed again as if it were new.

### The rule that comes before all seven: play what has shipped

**Three mechanics have gone out unplayed, and every number in them is a prediction.** The
roster and stamina, the road's shortcuts, and the live raid. Two of the numbers that would
move a design decision can only be got by playing:

- **Is about one raid in three catchable?** `tools/check-in-density.mjs` is the instrument
  for the 2–4h window. The four-hour drain was *derived* so that four undefended hours cost
  exactly what one press used to — derived, not observed.
- **Did the shortcuts leave the road's finale as its worst-earning region?** Measured at
  Coastal 4.3 → 5.2, Deep Zone 5.1 → 6.3, Harrow End flat at 5.5, for a 797-fuel link.
  Decide after play, not before.

This is the same hold that preceded Phase 6, and it was right that time.

### Phase 13 first, because it is the only fault on the list — built 2026-09-02

The other four are features. Phase 13 opens on something that is wrong in the game right
now: `consumeInputs` takes a recipe's materials from the crafter's pack while finds land on
whoever walked, so parts scatter across a roster that has no transfer verb of any kind. A
player can reach a state where the bench refuses and nothing in the game can fix it.

It is also **the floor under Phase 16**. Body recovery is a question about what a pack was
carrying when its owner died a long way from home, and until carried inventory is a thing
with a weight, a cap and a box to bank against, there is nothing to recover *from*.

**Both of its open decisions were answered on 2026-09-02.** The bench may draw from the box
— without it the fix for scattered parts is shuttling them to the crafter every time. And
**the cap is derived in grams**, at Phase 18's conversion of 125 g to the food unit, rather
than in abstract points that would only be re-derived later.

### Phase 14 — night as a different thing, not a dimmer day

*Against: the clock changed what an hour costs, and not what is out there.*

Phase 9 gave the world an hour and made a trip's light and dark visible before dispatch.
What it attached to that axis was **one lever**: `coefficientsAt` pays finds for daylight
and charges dose for it, integrated across the trip. That is a clean, symmetrical trade and
**this phase must not touch it.** Night is currently *quieter and thinner*, which is a trade;
the overhaul's complaint is that it is not yet *different*.

The material already exists. Phase 6's moment machinery draws from a generator salted off
the trip's own seed, and `daylight.js` can already say which hours of a trip are dark
(`splitOf`, `darkSpansBetween`). A night table is content on top of two built systems.

**Three constraints, and the first is the one that keeps the clock a decision.**

**Night content must be different in kind, not better.** The coefficients have already
priced the difference between the hours. If darkness additionally holds the good finds, the
trade collapses into "go at night", the dispatch table's split becomes decoration, and the
player stops choosing. What darkness should hold is what only darkness can: a light moving
on a ridge, someone who will not travel by day, a door left open because nobody expected to
be seen — and a hazard the day does not have, which is the doc's ambush and its navigation
injury.

**The count of moments per trip must not move.** Phase 6's window divisor was swept and
settled at 3 on measured evidence — 703 catches against 701 — and that arithmetic is about
how many windows a trip opens, not which table they draw from. So a dark hour should change
**which** moment is drawn, never **how many**: night content mirrored against day content
rather than added to it. This keeps `tools/window-coverage.mjs` meaningful, and keeps an
unattended night trip from quietly becoming a different length of game.

**Measure before designing: what share of trips crosses a dark hour at all?** Per region,
against the real dispatch table and a real spread of check-in times. If almost every long
trip already spans both, night is weather the player walks through rather than a thing they
choose, and the phase is really about the short trips — which changes what content to write.
Cheap sweep, and it should be the first thing done, the way the window divisor was.

Probably no migration; the moment tables are code and the hour is a pure function. That
claim wants enumerating rather than asserting when the phase is designed — Phase 9 made the
same claim, and it only held because it was checked line by line.

### Phase 15 — recruitment through the world

*Against: a bed is a purchase, and a person should be a story.*

Today a camp with a spare bed can take in a wanderer at the gate, and `wandererFor` derives
who that is from the camp's seed and how many have come before — deterministic on purpose,
so there is no reroll and no draft. That mechanism is correct and stays.

What the doc asks for is the **other** sources: someone met in an expedition moment, someone
rescued off the road, someone a faction introduces. Small phase, and it turns a fitting into
an arrival.

**The line that makes it safe: the world chooses when, the seed chooses who.** A moment may
be the *occasion* for an arrival, but the person must still come from `wandererFor` and the
same shared counter the gate uses. Otherwise a player who dislikes the traits takes another
trip and rolls again, and the backstory becomes a stat block — the exact failure
`src/game/wanderers.js` is written to avoid, and the reason nobody is chosen there.

**The bed still caps it, and that is the decision the doc wanted.** Meeting someone you have
no room for is a real choice: improve the shelter, or walk away from a person. A rescue must
not conjure capacity.

### Phase 16 — body recovery

*Against: what someone carried beyond the wire simply evaporates.*

The other half of §10, and the clearest statement the game makes of its own thesis. It rests
on Phase 13 being **built and played**, because the cap and the box have to have settled
before "what they were carrying" means anything.

**Two facts about the schema make this a design and not a patch, and both are worth knowing
before starting.**

**A death has no place.** `characters` records `died_at` and `cause_of_death`, and nothing
about where it happened. A recovery trip needs somewhere to go, so a death has to start
writing one.

**The pack is already gone by then.** `inventory_items` cascades on delete, and migration
`001` says that is deliberate: *carried inventory belongs to the survivor and dies with
them.* Changing the cascade would reach back through every phase that has relied on it. The
clean shape is the opposite one — a death writes **what was left out there** into its own
record, keyed to a place and a time, and the recovery trip reads that. The cascade stays
true, and "most of it is lost" becomes a number in that record rather than an accident of
deletion.

### Phase 17 — faction relations

*Against: two factions is a rivalry with a slider, not a world.*

The largest block left: §§12–15 in full — a third faction, pairwise relations between all
three, diplomatic events that appear in the log with a cause attached, and their effects on
prices, raids, roads and encounters. Most content, most schema, designed properly only when
it is next.

**Three things are already settled and carry into it.**

**Trade may never produce fuel.** Fuel is the only resource nothing in the camp produces,
which is what the whole fuel track is priced against. This is a real test now, not prose.

**Visit frequency ignores standing, deliberately.** Phase 5 recorded that departure because
the hostile crew still turning up is the only road back from a grudge. Pairwise relations
are exactly the kind of change that would overturn it by accident — a faction that hates you
*and* is at war with your only other trading partner must not be able to strand a camp.

**The third faction comes out of the map.** The doc's own rule, and it is right: developed
from existing locations and lore, controlling a genuinely different necessity, rather than
introduced as a distant government or an organised nation.

### Phase 18 — food in grams, water in litres

*Against: a camp with "340 food" in it, which is not a quantity of anything.*

Asked for by the user on 2026-09-02, for later: give the two stores real units — **grams for
food, litres for water** — with a survivor consuming a realistic amount per day, drawn down
by the hour, still gated by hunger.

**The finding that makes this cheap: the rates are already realistic, and only the label is
missing.** `foodPerHour` is 0.5 and `waterPerHour` is 0.75, which is 12 and 18 a day. Name a
unit — **1 food = 125 g, 1 water = 0.2 L** — and that is:

    1,500 g and 3.6 L per survivor per day
       62.5 g/h and 0.15 L/h, drawn every 15-minute step

A working adult in heat, and the right ratio between the two. Nothing about the simulation
is unrealistic; it has simply never said what it is counting.

**So this is a re-denomination, not a rebalance, and that distinction is the whole phase.**

**The free version.** Every food number ×125 and every water number ×0.2 — the constants,
the stored amounts, the storage caps, the structure production rates, the region loot tables,
the recipe costs, the trade offers, the raid's hourly drain. A linear scaling of one axis
moves no balance: the 36-to-72-hour starvation window holds *by construction*, because both
the demand and the store scale together, and `test/unit/tick.test.js` will say so without
being touched.

**The expensive version, which is not what realism asks for.** Deciding independently that a
person needs 3 L and re-deriving from there changes the ratio of demand to every region's
yield, moves the starvation window, and lands on the fuel/day axis everything in this file is
measured against. There is no reason to pay that: the ratio is already right.

#### Grams are a denomination of the stores, and they never become carry weight

**Confirmed by the user on 2026-09-02, and it is the trap this phase sets for the next
reader: only items have weight. Food, water, scrap and fuel do not.**

Phase 13 weighs carried items and leaves the haul alone, because weighing the haul would cap
fuel per day — the axis every balance figure in this file is measured against. Writing food
in grams makes that look like an oversight rather than a decision: a resource with a mass
that a person can carry any amount of. It is not an oversight, and the shape of the game
depends on it staying that way.

The two do meet in exactly one place, and it is legitimate: a **ration item** weighs what the
same relief would weigh eaten out of the larder, which is how the 417 g above was derived.
That borrows the conversion; it does not give the resource a mass. Worth a test that says so,
in the phase that ships the weights: a pack’s weight counts `inventory_items` and nothing
else.

#### It is wide and shallow, and "just a display change" is the wrong description

Enumerated, because that claim is usually wrong: `CONFIG.foodPerHour` and `waterPerHour`;
`resources.amount` and `storage_cap` — `numeric(14, 4)` has the headroom, and grams want no
decimals while litres want one; the production rates seeded by migration `002`; every region
`loot` table in `src/db/seed.js`; recipe costs (`food: 20` is 2.5 kg); trade offers; the
raid's stores drain; `view-camp.js` and `render.js`; and every test and tool that names a
food or water figure. About thirty files.

**And it needs a migration that scales the rows that already exist.** A camp holding 340 food
is holding 42.5 kg, and if the stored number does not move with the unit, every live save
either starves or floods on deploy. This is the one part of the phase that can go wrong
badly, and the dev database has a real camp in it.

#### Formatting, which is where the realism is actually felt

**One unit, always kilograms** — `0.02 kg`, `0.417 kg`, `1.4 kg`, `15 kg` — trailing zeroes
trimmed, and litres to one decimal. Decided while Phase 13 was being played on 2026-09-02,
against the mixed convention this section first proposed: a column of weights is read *down*,
and a column that switches unit halfway cannot be compared at a glance. The pack table is the
place that settled it, and `saysWeight` is the one function that says either. The per-hour figure reads as a rate beside the gauge, in the style the stores rate
already uses: name the effect before the number. `stats()` in `render.js` is the house style
for anything a popup explains.

#### The one decision that cannot wait for this phase

**Phase 13's carry cap should be derived in these units.** That phase sets a flat cap from
kit plus what the longest walk needs plus the 90th-percentile finds. If food is grams, the
honest unit for a pack is grams too — and deriving the cap in abstract points now means
re-deriving it later. **So settle the food unit before Phase 13 measures its cap**, even
though the re-denomination itself lands long afterwards. The reward is that "how many days of
food can one person carry" becomes a question with an answer, which is the best thing this
change buys.

#### Two things the units will make conspicuous, both of them already true

**A sleeper consumes nothing at all.** `appetite` is 1 awake and 0 asleep — deliberately a
branch rather than a rate, so that a sleeper's hunger comes only from what they recovered.
Written as litres, "asleep: 0.0 L" is a claim about a person rather than a modelling
convenience. Fixing it is the overhaul's §9 (activity-scaled consumption: more while
building, less while asleep), and that is a balance change wearing a realism hat — it wants
its own measurement, and it is not part of this.

**There is no thirst.** `fedFraction` is `min(food drawn, water drawn)`, so a camp out of
water reports the shortage as *hunger*. That is a defensible simplification of one gauge, and
it will read as a bug the moment the page says litres. **That question was asked the same day
and is now Phase 19 below**, which recommends splitting the two — and records why the split
has to stay out of this phase.

### Phase 19 — thirst, proposed 2026-09-02 and deliberately deferred

*Against: a camp with no water reports the shortage as hunger.*

Asked by the user while Phase 18 was being written: should water be separated from hunger,
and should a survivor carry both gauges? **Recommended yes, with the two gauges doing
different jobs.** **The user deferred the decision the same day: it is to be made when the
game gets there, not now — so do not re-open it as a question until Phase 18 has shipped and
been played.** The reasoning is written down here so that it is read rather than re-derived.
It is deliberately not part of Phase 18 — that phase's entire
value is that it moves no balance number, and this one moves the central guard.

#### The gauge that exists is already a thirst gauge under another name

On empty stores a survivor dies in **53.5 hours**: `hungerRisePerHour` of 4.2 climbs to the
starvation threshold of 70 in about seventeen, then `starvationDamagePerHour` of 3 drains a
hundred health across the rest. That is a little over two days.

A person without water dies in about three days. A person without food dies in about three
weeks. **The tuned clock is water's, and it is off by an order of magnitude from food's.**
So the split is not adding a system; it is admitting which system is already there.

`fedFraction` is `min(food drawn, water drawn)`, which is the same admission in code: either
store running dry drives the same gauge at the same rate.

#### Two gauges that kill on one clock would be bookkeeping, not design

The version worth building is asymmetric, and the code is already half of the way there —
the user's rule of 2026-08-31 made the chain `stores -> hunger -> stamina -> work`.

**Thirst is the deadline.** It inherits today's numbers: the rise rate, the threshold, the
damage. The 36-to-72-hour guard in `test/unit/tick.test.js` then survives the split rather
than needing re-derivation, because the thing it measures — a camp with nothing in it — is
still governed by the same arithmetic under a new name.

**Hunger is capability.** Weeks rather than hours, and its bite is the stamina chain that
already exists: a hungry survivor works badly, recovers badly, and is a poor thing to send
down a long road. Starvation still kills a camp that has been truly abandoned; it stops
being what kills a camp over a long weekend.

**The derivation that must not be skipped: the guard is about a camp with nothing, so both
gauges are running.** If thirst keeps a damage rate of 3/h and starvation adds its own on
top, the combined clock falls under 36 hours and the game starts punishing real life —
exactly the failure the guard exists to catch. The two rates have to sum to about what the
one rate does today. Measure it, do not choose it.

#### What it costs

A migration (a `thirst` column on `characters`, `numeric(6, 3)` beside `hunger`, same
check); two branches in the tick where there is one; a damage-stacking rule with radiation
already in the mix; and the page.

**The page is the real cost, and it is worth saying plainly.** A roster of four already
shows health, hunger, radiation and stamina. A fifth gauge per person is twenty numbers on a
view whose last verdict was *"too many sentences and commas"*. The house rule is the answer
if anything is: a mark reports something acting on a number **in both directions**, and says
nothing when nothing is happening. A survivor who is drinking normally should not be showing
a thirst gauge at all.

#### The cheaper alternative, recorded so it is a choice rather than a fallback

**Keep one gauge and rename it.** `fedFraction` already covers both stores; calling the
result *privation* or *condition* rather than *hunger* costs a migration-free rename and
makes the page honest without adding a system. It loses the thing this phase is actually
for — food and water having different clocks and different consequences — and it is the
right answer if the roster page turns out to be the constraint.

**What decides between them: play Phase 18 first.** Once the page says litres, either the
single gauge reads as a lie or it does not.

### What was read and declined, so it is not raised again as new

**§3's list of weather effects** — heat into stamina, cold into food, rain into water
production, dust into loot and navigation. Temperature shipped in Phase 9 with **one**
mechanical job on purpose: it widens the day/night coefficients. The recorded reason still
holds — the sky already owns production, haul and dose, and a second global system pulling
the same three would make `effectsOf` an incomplete account of what the weather costs. The
doc's own balance principle asks that weather consequences be stated before the player
commits, and one lever can be stated.

**§8's extras** — a second worker speeding a build, and handing a job over mid-way. The
assignment half of §8 shipped; these two are not scheduled. Neither is a bad idea, and both
are dials on a system nobody has played yet.

**§5's shelter and night bonuses on sleep**, already declined under Phase 10 for the same
reason: a level-scaled rate is a second dial nothing derives, and a night bonus is a third
thing acting on one number.

## The dispatch table was quoting a dose it did not charge — 2026-08-30

Asked by the user: should a higher dose be acquired when away? The answer was no, and
finding out why turned up something worse than the question.

**Four regions advertised a dose and delivered a mean of nothing.** Radiation decayed at
0.8/h while a survivor walked, so a twelve-hour trip scrubbed 9.6 rads against Coastal
Wreckage's listed 4. Measured over 24 departures each:

    region                listed   arrived
    The Millrace               1       0.0
    Underground Bunkers        2       0.0
    Coastal Wreckage           4       0.1
    Sixteen Wells              6       0.8
    Irradiated Farmland        8       5.3
    The Deep Zone             25      19.9

The listed number was not a number. A player reading "danger 4, costs radiation" came home
clean, every time.

**Raising the doses was measured first and rejected.** Simply stopping the decay costs a
third of the whole fuel economy — every region falls, and Harrow End falls hardest at −8.4,
so Coastal at 14.3 out-earns it at 11.8 and the danger-5 inversion re-opens wider than it
was before Phase 11 closed it. **The erosion was, accidentally, what was holding the
inversion shut.**

So: the road stops scrubbing, and the region figures come down to keep the game exactly
where it was.

    region                was   now      fuel/day        idle
    Irradiated Farmland     8     2
    The Millrace            1     0
    Underground Bunkers     2     0    13.0 -> 13.0    0% ->  0%
    Coastal Wreckage        4     0    19.4 -> 19.4    0% ->  0%
    Sixteen Wells           6     1     8.2 ->  7.9    0% ->  5%
    The Deep Zone          25    10    13.6 -> 14.1   40% -> 39%
    The Waterworks         30    13    14.3 -> 14.7   44% -> 43%
    Harrow End             28     7    20.2 -> 20.1   22% -> 23%

Harrow End still beats Coastal, so the inversion stays closed. Every region now delivers
between 104% and 123% of what it lists, and the excess is the sky — rad storms and the sun —
which is the design and is visible in the forecast.

> **The tuning was done by measurement because the arithmetic was wrong.** Dividing each
> dose by its observed sky factor was tried first and missed by two to three fuel a day: those
> factors were measured across spreads of 0 to 47 rads and were mostly noise. Two runs of
> `fuel-balance.mjs` found the numbers that the algebra could not.

### And what the dose is worth when it is spent on purpose

`fuel-balance.mjs` could not answer a moment — every moment resolved unattended there — so
the options that trade dose for haul were unmeasured content. It answers them now, by policy
rather than by option key: *greedy* takes the steepest dose-for-loot option a trip offers,
*careful* takes the shallowest.

    region            never answers   greedy   careful
    The Deep Zone         14.1         13.4     14.2
    The Waterworks        14.7         14.3     14.8
    Harrow End            20.1         20.1     20.4

**Greedy loses or breaks even; careful is worth about a fifth of a fuel a day.** That is a
priced decision rather than a right answer, and it is the shape wanted: the big trade buys
haul *now* at the cost of trips later, which the tool cannot value because it measures a
steady state and never an urgency. A player two hundred fuel short of a road link is not
playing for the steady state.

**It also caught a free lunch this file had just created.** `the_hot_room` listed the bunkers
and the coast, and the dose rewrite above set both regions to zero — so `radiationFactor: 2.1`
multiplied nothing and the room paid a 1.28× haul for no cost at all: +0.6 fuel a day at the
bunkers, +0.9 at the coast. **A cost written as a multiplier can only be paid by a region with
something to multiply.** The room is Deep Zone only now, which is also the coherent reading:
a counter holding a flat tone on a coast the world calls clean was never right.

**Coastal, the Millrace and the Bunkers now carry a zero**, which is what `docs/LORE.md` §2
has always said — the farmland and the Deep Zone are hot, and they are the only places that
are. The table had been claiming something the world already disagreed with.

## Dead time, and telling the player which loop they are in — 2026-08-21

Played: founded a camp, spent the opening scrap, sent someone to Coastal Wreckage for
twelve hours. Nothing on the page could change for twelve hours. The report read fine
and no number on it was wrong.

**The mechanics were not the fault.** The pacing section above already measured the good
version of the first hour — *"one build without the short regions, four with them"* —
and re-simulating it reproduces exactly that: workshop, then the Fence Line on repeat,
four builds inside the hour. That opening is reachable from turn one and always was.
What no part of the page said is that it exists.

    the opening position, measured
      starting stores                 10 scrap, 0 fuel, 40 food, 40 water
      starting structures             shelter 2, garden 2, purifier 2, workshop 0
      scrap income                    none — nothing in a new camp makes scrap
      what 10 scrap buys              the workshop: 5 scrap, 36 seconds
      the next cheapest door          garden level 3, 7 scrap — four hours at 0.5/h

So the twelve-hour trip lands on a camp with one door, already used. And the region
table sorts by danger, which puts the interesting names at the bottom.

**There are two loops and the page never said so.** Building and crafting are the active
one, minute-scale, the whole reason the two short regions exist. Anything past four hours
is the idle one — *"what you set running before closing the tab"*, as this file already
puts it. A new player walks into the idle loop on turn one and experiences it as a broken
game, which is a fair reading: three moment windows cover about a third of a twelve-hour
trip, nothing announces one without a radio, and a missed one left no trace anywhere.
Missing everything and there being nothing to miss produced the same log, byte for byte.

### What was rejected, and why it is worth writing down

**An at-camp work action — the survivor spending hours in the camp for scrap.** The
obvious fix, and it does not work, because it competes for the survivor. It cannot run
*during* the trip; it is an alternative to creating the dead window, not something that
fills one. It is also already dominated. Loot tables are flat totals rather than
per-hour, so scrap per *survivor-hour* runs:

    The Fence Line     0.17h    23.5      Underground Bunkers    9h     2.2
    Old Service Road   0.75h    13.3      Coastal Wreckage      12h     2.1
    The Ruined City       4h     2.3      The Deep Zone         18h     1.8

Priced under the Fence Line an idle-work action is strictly worse than clicking it;
priced over, it replaces the game. **The Fence Line already is the at-camp work action**
— ten minutes and attention, which is exactly the trade.

**Raising camp income instead.** The other lever, and the only one that acts without the
survivor. Tripling the workshop from 0.5 to 1.5 per level moves a twelve-hour window from
three actions to five, two of which are still inside the first minute. Income cannot fix
it: costs climb at `COST_GROWTH ** level` while the builds themselves resolve in seconds,
so what is being bought is clicks per hour, and 3x buys one every two and a half hours.
**The dead window is not an income problem and cannot be paid off.**

**Quest rewards.** The chain below is affordable on what the short walks pay — the
simulation says so — and rewards are the only part of a quest system that needs
*storage*. Completion is derivable; payment is not. Rewards would also be a balance
change, and they can be added later far more easily than a table can be removed.

### What was built

Three pieces, and only the third is a bug fix.

**`src/game/planning.js` — hours until affordable.** Every door is priced and the stores
carry a rate, so the answer was always two numbers apart and the subtraction was the
player's. Priced in the *net* rate, the same figure the stores line prints, because a
forecast that disagrees with the number above it is worse than no forecast. Null means
never, which is a different instruction from "wait" — nothing in a camp makes fuel, so a
road link is an errand rather than a delay.

**The plan spends the purse as it walks it**, and the version that did not is the
cautionary tale. Pricing every door against the same stores told a camp holding ten scrap
that it could do five things costing five to ten each; every region read *"5 things to do
meanwhile"*, including the ten-minute one. It can do one of them, and then wait. What it
still does not model is the crew — builds and fittings share one queue, so past the point
where a level takes hours this reads optimistically. Right place to fix that when the
deep game needs it.

Surfaced twice: a column on the dispatch table counting what opens *during* each trip
(doors already open are excluded, or every row carries the same number and the column
compares nothing), and a block in the Away report naming the next four and when. A camp
that can reach nothing gets a sentence rather than an empty table.

**Both are gone, 2026-08-23, and the planner is not.** The Away block's door list went
first, in August, for three separate reasons already on record. The dispatch column
followed it during the redesign, for a simpler one: on a table where every other cell is
a fact about the *place* — how far, how dangerous, how much there is to answer out
there — a count of what the camp could afford back home was the only cell about
somewhere else, and it was carrying a whole extra column to say something the Next block
says in words the moment the trip is actually out.

`planFor` stays and is still read every render: `opensBeforeReturn` is what lets the
Next block tell a camp its evening is empty *before* it finds out over twelve hours.
The plan was always worth computing. It was the second place it got printed that was
not worth the room.

**`src/game/direction.js` — five steps, derived, paying nothing.** Workshop, the short
walk by name, the bench, a craft, then the far places and what their hours cost. No
table, no migration, in the register the design brief describes: one heading, one
sentence, no progress bar. A test asserts every line is a sentence and prices nothing, so
it cannot decay into a checklist.

**It switches off on history, not on state.** Two steps can only be asked of the camp as
it stands — nothing records the highest level a workshop ever reached — and a successor
takes two levels off everything, so state alone would sit a veteran down and teach it
about the bench again. The off switch is three facts that cannot be undone: has run a
short walk, has crafted, has taken a long trip. Falling into the trap on turn one does not
trip it, because a first-ever dispatch to the Deep Zone sets one of the three and none of
the understanding.

**The moment box now arrives without a reload.** This was the only real bug, and it had
an accidental exemption: the radio's line is rendered with `countdown()`, which emits the
`data-until` the client script arms — so **a camp with a radio fitted has always had its
box appear on its own**, and every other camp sat on a page that quietly declined to
update. That is not the radio earning its fuel; it is the one upgrade-gated refresh on the
page, gated by nobody's decision. Armed for everyone now, silently, via a hidden
`countdown()` — so the contract below is satisfied rather than worked around.

**The radio therefore sells knowing *when* rather than catching it at all**, and that is a
deliberate narrowing. A player sitting on the page watching has attended either way;
making them reload to prove it was never a design, it was static HTML. The radio still
buys the only thing that lets you plan an evening around a window.

**And a missed moment now says so in the trip log.** One line, naming them — *"Three came
up out there that they settled on their own: the shaft, the warm fire and the ford."* One
rather than one per moment, because four lines of "nobody was there" on every trip of an
idle player is a scold. A moment answered with its default is not in it: that player was
present and chose to do nothing, which is a different fact.

### The guarantee this narrowed

The promise that *a trip nobody attended is the trip that would have happened anyway* used
to be tested with `deepStrictEqual` over every field including the log. That quietly made
a second promise nobody wanted: **that a trip you missed entirely and a trip you sat
through answering "walk on" would read identically afterwards.** They did, and that is
precisely how a player concludes the encounters are not running.

The simulation half is untouched and is now pinned field by field — `loot`, `finds`,
`radiation`, `damage`, `healed`, `died`, `cause`. The log differs by exactly one sentence,
checked rather than waved past. Nothing in the new path draws from a generator, so it
cannot move a trip by a unit.

One duplication went with it. The rule that **an answer names the moment it answered** had
been written out by hand in two places and was about to be written a third time, for
counting the unanswered. It is now `answerTo` in `expeditions.js`, used by the resolution
and by the camp view. An answer that names nothing was not applied out there, so it counts
as unattended here — which is what makes a garbage choice stop reading as attendance.

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

**Exercised 2026-08-23, when the redesign landed.** Direction 2a — "cold instrument" —
replaced every tag, class and layout in `render.js` and the contract held with one
addition worth writing down. The long page is now five views, and they are a *CSS filter
over the one stream of sections* rather than five pages: `campPage` still emits all
eighteen in the same order, `<body data-pane="…">` says which view is up, and rules
generated from `PANES` reveal that view's blocks.

That shape was chosen over real per-view pages for a reason that is invisible until it
bites. Splitting the sections would put the hidden alarm in `s-expedition` on the
Survivor view and the Contact box it summons on Camp — so a player sitting on Camp would
never see contact arrive, which is the exact failure `momentAlarm` exists to prevent.
Keeping every section in every response costs a few kilobytes and buys back both of
`docs/DESIGN-BRIEF.md` §7.3's hazards: the fetch of `location.pathname` returns the view
the player is on, and every timer stays armed whichever view is showing.

The new silent failure the split introduces is a block listed in no view — perfect
markup, all attributes present, on no page. Two tests in
`test/db/page-contract.test.js` close it, alongside the ones that were already there.

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
