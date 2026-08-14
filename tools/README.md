# tools

Not part of the game. These are the measuring instruments, kept because twice now
they have found something that reasoning and a green test suite both missed:

- **Filtration deleted the constraint it was designed to ease.** It scrubbed 36 rads
  over an 18-hour trip that doses 25, so survivors came home cleaner than they left
  and reckless play became *safer* than caution. Every test passed the whole time.
- **A faster build curve alone would have fixed nothing.** Simulating the first hour
  showed one build at thirty seconds and then the same four-hour wall, because scrap
  income was per-hour. That is why the short regions exist.

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

`region-balance.mjs` reads the regions from the database, so it needs the wrapper
that brings Postgres up:

```
node scripts/with-db.mjs node --env-file=.env tools/region-balance.mjs
```

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
