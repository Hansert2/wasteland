# tools

Not part of the game. These are the measuring instruments, kept because six times now
they have found something that reasoning and a green test suite both missed:

- **Filtration deleted the constraint it was designed to ease.** It scrubbed 36 rads
  over an 18-hour trip that doses 25, so survivors came home cleaner than they left
  and reckless play became *safer* than caution. Every test passed the whole time.
- **A faster build curve alone would have fixed nothing.** Simulating the first hour
  showed one build at thirty seconds and then the same four-hour wall, because scrap
  income was per-hour. That is why the short regions exist.
- **Two of Phase 6's options were decoration.** Overloading a container was the right
  answer 9% of the time and going to ground 4% — written as decisions, shipped as
  scenery, and invisible to a suite that only ever asked whether they *worked*. The same
  run found the happier fact that attending a moment takes a wounded survivor's death
  rate in the Deep Zone from 17% to 0.4%.
- **A dial was about to be tuned to fix something it cannot reach.** A soak figure — four
  moments met in ninety days — read as the encounter windows failing the absent player.
  Sweeping the width showed it buys the attentive player nothing at all (703 caught
  against 701) and buys the absent player half of what simply sending longer trips buys
  them. The number was a fact about the soak's itinerary, not about the windows.

- **A phase was built and the player never met it.** Encounters reached a twice-daily
  player once in ninety days — and the cause was not the windows, which had just been
  swept and cleared. The survivor is *home* at 88% of check-ins, and the first real camp
  spent nine of its fifteen dispatches on the one region that by design has no interior.
  The same run retired the premise Phase 7 was designed against: every camp verb guards
  on *alive*, not *home*, so a check-in is never empty and freeing the trip slot would
  change one bucket on 12% of visits.

- **The obvious skills system would have been the flavour one.** Before designing skills
  a sixth time, the question was measured: does the survivor in front of you change which
  option wins? Radiation changes it on 44% of moments and a loot skill on 18% — but
  health at 60 changes it on *none*, because the game already guarantees a healthy
  survivor cannot die, so damage mitigation is a decision only in the last few points
  before death. A `skill_combat` that softened hits would have been the intuitive first
  build and would have been scenery.

The pattern worth keeping: the simulation is a pure function of `(state, now)`, so
sixty days of play runs in milliseconds and a balance question can be answered rather
than argued about. Before trusting a number, measure it.

## Running them

The pure ones need nothing:

```
node tools/onboarding.mjs        # the first hour, with and without the short regions
node tools/balance.mjs           # Deep Zone cadence, with and without filtration
node tools/raid-balance.mjs      # thirty days of neglect, by camp and watchtower level
node tools/craft-balance.mjs     # what gear is worth, and what a death costs
```

```
node tools/window-coverage.mjs   # who the encounter windows actually reach
```

`check-in-density.mjs` needs the database, and answers a blunter question than any of the
above: **when you load the page, what is there to do?** It probes rather than reasons —
every verb is attempted inside a savepoint and rolled back, so the answer comes from the
real service guards and the refusals are the ones the player would have read. That is why
it can be trusted against the plan's prose, and it has already contradicted it once.

`region-balance.mjs` and `moment-balance.mjs` read the regions from the database, so
they need the wrapper that brings Postgres up:

```
node scripts/with-db.mjs node --env-file=.env tools/region-balance.mjs
node scripts/with-db.mjs node --env-file=.env tools/moment-balance.mjs
node scripts/with-db.mjs node --env-file=.env tools/check-in-density.mjs
node scripts/with-db.mjs node --env-file=.env tools/skill-sensitivity.mjs
```

**`moment-balance.mjs` carries a value function, and it is the arguable part.** Options
trade in different currencies — hours for a dose, a risk for a find — so comparing them
at all means converting finds, rads, damage and hours into scrap. Those conversions are
constants at the top of the file with their derivations written out, because three
earlier versions of them were wrong in ways that changed every conclusion: pricing a rad
as forced waiting made the Deep Zone read as net *negative*; not charging for an
option's hours made sitting out a storm right 94% of the time; and pricing a tin of stew
like a dose of chelation made eating look wasteful. Each looked exactly like a fault in
the game. **Argue with the constants before believing the table.**

## wl.mjs — the time machine

A game measured in hours cannot be play-tested in real time. This rewinds a camp's
clock so the next page load ticks forward for real:

```
node scripts/with-db.mjs node --env-file=.env tools/wl.mjs you@example.com skip 9
node scripts/with-db.mjs node --env-file=.env tools/wl.mjs you@example.com show
```

**If you add a table that schedules something, add it to the `skip` query.** This has
silently done nothing three times — for `structure_upgrades.completes_at` and then
`settlements.next_raid_at` — and the failure mode each time was an empty event log
that looked like a broken feature rather than a broken tool.
