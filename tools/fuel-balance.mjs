/**
 * How fast does fuel actually arrive, and how long is the road at that rate?
 *
 * Asked because of a design question — should a caravan ever sell fuel? — which
 * `docs/PLAN.md` settles with a *no* that is still right: scrap is patience, fuel is
 * danger money, and an exchange rate between them collapses the second currency into
 * the first. But that answer only holds if fuel is reachable by the route it does have.
 * If the road is a decade long, "buy it from a trader" stops being a design mistake and
 * starts being a symptom.
 *
 * So this measures the faucet rather than arguing about it, in three passes:
 *
 * 1. **Per trip.** What each region pays in fuel and charges in rads, over many seeds.
 *    This is the number the dispatch table implies and the one that is easiest to
 *    mistake for the answer.
 * 2. **Per day, sustained.** The same regions run through the real tick for sixty days
 *    under a policy — go whenever radiation allows. A trip that pays 17.5 fuel is worth
 *    nothing if the survivor spends thirty hours at home cooling off first, and that
 *    waiting is the actual limiter on the whole fuel economy.
 * 3. **In days of play.** Those rates against `linkCost()` and the three fittings, for
 *    two players: one who dispatches the moment they can, and one who checks in twice a
 *    day and can only dispatch when they are looking.
 *
 * Regions come from the database, so this measures what shipped rather than what this
 * file remembers. Everything else is `applyTick`, which is a pure function of
 * (state, now) — sixty days runs in milliseconds.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/fuel-balance.mjs
 */
import { pool } from '../src/db/pool.js';
import { applyTick } from '../src/game/tick.js';
import { POTENCY_TO_POINTS } from '../src/services/use-item.js';
import { momentsFor } from '../src/game/moments.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { CONFIG } from '../src/game/constants.js';
import { LINKS, linkCost, roadCost } from '../src/game/road.js';
import { UPGRADES } from '../src/game/structures.js';
import { ORDINARY } from '../src/game/wanderers.js';
import { daylightFraction } from '../src/game/daylight.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);
const SEEDS = 3000;
const DAYS = 60;
const RUNS = 5;

const { rows } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by danger, travel_hours`,
);

// The tablet, as the game has it: what the bench charges and what taking one is worth.
const { rows: scrubberItemRows } = await pool.query(
  "select potency from items where slug = 'rad_scrubber'",
);
const { rows: scrubberRecipeRows } = await pool.query(
  "select costs from recipes where slug = 'rad_scrubber'",
);
const scrubberItem = scrubberItemRows[0];
const scrubberRecipe = scrubberRecipeRows[0];

/** The shape `resolveExpedition` and the tick both want. */
const regions = rows.map((row) => ({
  slug: row.slug,
  name: row.name,
  danger: row.danger,
  travelHours: Number(row.travel_hours),
  travel_hours: Number(row.travel_hours),
  loot: row.loot,
  finds: row.finds,
  radiationPerTrip: Number(row.radiation_per_trip),
}));

const paysFuel = regions.filter((r) => Array.isArray(r.loot?.fuel));

// ---------------------------------------------------------------- pass one

/** What one trip pays and costs, averaged over seeds, deaths excluded from the haul. */
function perTrip(region) {
  let fuel = 0;
  let rads = 0;
  let deaths = 0;

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const out = resolveExpedition({
      region,
      survivor: { health: 100, skillScavenging: ORDINARY, inventory: [] },
      seed,
    });
    if (out.died) {
      deaths += 1;
      continue;
    }
    fuel += out.loot.fuel ?? 0;
    rads += out.radiation;
  }

  const trips = SEEDS - deaths;
  return {
    fuel: fuel / trips,
    rads: rads / trips,
    deathRate: deaths / SEEDS,
    perHour: fuel / trips / region.travelHours,
  };
}

// ---------------------------------------------------------------- pass two

function camp(crew = 1) {
  return {
    lastTickAt: T0,
    settlement: {
      id: 1,
      upgrades: [],
      structures: [
        { id: 1, kind: 'shelter', level: 2, buildCompletesAt: null },
        { id: 2, kind: 'garden', level: 3, buildCompletesAt: null },
        { id: 3, kind: 'water_purifier', level: 3, buildCompletesAt: null },
        { id: 4, kind: 'workshop', level: 2, buildCompletesAt: null },
      ],
      resources: {
        food: { amount: 300, ratePerHour: 3.6, cap: 600 },
        water: { amount: 300, ratePerHour: 7.5, cap: 600 },
        scrap: { amount: 100, ratePerHour: 2, cap: 600 },
        fuel: { amount: 0, ratePerHour: 0, cap: 600 },
      },
    },
    survivors: Array.from({ length: crew }, (_, nth) => ({
      id: nth + 1,
      alive: true,
      health: 100,
      hunger: 0,
      radiation: 0,
      // Phase 10. Without it `simulateSurvivor` defaults to a hundred and the arithmetic
      // still runs, but the state written back would not round-trip and a reader of this
      // file would have no way to see that the constraint is being modelled at all.
      stamina: 100,
      skillScavenging: ORDINARY,
      bornAt: T0,
      diedAt: null,
      causeOfDeath: null,
      inventory: [],
    })),
    expeditions: [],
    expedition: null,
    craft: null,
    fitting: null,
  };
}

/**
 * Sixty days of sending somebody to one region as often as the rules allow.
 *
 * `goAt` is the radiation the player is willing to leave on, and it is the whole of the
 * policy. `checkInsPerDay` is the other half of honesty: an attentive player dispatches
 * the hour a survivor gets home, and a real one dispatches when they next open the page.
 * Null means the attentive one.
 *
 * A death ends the run and is reported rather than restarted. A camp that buries its
 * survivor on day nine did not earn sixty days of fuel, and averaging over the restart
 * would quietly hide the region that keeps doing it.
 */
/**
 * What a Rad Scrubber costs at the bench, and what taking one is worth.
 *
 * The question this measures is exact: does spending ten fuel to remove 22.5 rads buy back
 * more than ten fuel of reduced idleness? Idleness is what the whole fuel economy turns on,
 * and a survivor who can scrub on demand waits less — so the tablet is either a way of
 * turning fuel into trips at a profit, or it is a way of burning fuel to feel busy.
 *
 * Deliberately generous to the scrubber, so that a negative result is decisive:
 *
 *   - The scavenged part each one needs is ignored. Parts come off trips and would
 *     sometimes be the binding constraint, so a real player crafts fewer of these.
 *   - Workshop 4 and the 0.3 hours at the bench are ignored: the camp here is one shape for
 *     every run, and giving this policy a workshop the others do not have would measure the
 *     workshop instead of the tablet.
 *
 * If it still does not pay under those terms, it does not pay.
 */
const SCRUBBER = {
  // The bench price, from `recipes`.
  fuel: Number(scrubberRecipe?.costs?.fuel ?? 10),
  scrap: Number(scrubberRecipe?.costs?.scrap ?? 15),
  // What taking one is worth, from the item's own potency and the constant `useItem`
  // applies. Retuning either is measured here without this file being told — a tool
  // carrying its own copy of the number it is measuring is a tool that agrees with itself.
  rads: Number(scrubberItem?.potency ?? 0) * POTENCY_TO_POINTS,
};

function play(region, { goAt = 20, checkInsPerDay = null, upgrades = [], seed0 = 1, nightly = false, holdHours = 24, scrubbing = false, answers = null, crew = 1 } = {}) {
  let state = camp(crew);
  state.settlement.upgrades = upgrades;

  // The expedition seed is the only randomness in a run, so it is the only thing worth
  // varying between them. Started far apart rather than at 1, 2, 3: consecutive seeds
  // through `mix` are fine, but adjacent runs sharing a prefix of outcomes is the kind
  // of thing that makes five runs look like agreement when they are one run.
  let seed = seed0;
  let now = T0;
  const end = T0 + DAYS * 24 * HOUR;

  let trips = 0;
  let waiting = 0;
  let out = 0;
  let gained = 0;
  // Fuel that went into tablets. Subtracted at the end, because `gained` only ever counts
  // the balance going up and would otherwise report the spend as free.
  let burned = 0;

  const gap = checkInsPerDay ? Math.round(24 / checkInsPerDay) : 1;
  let hour = 0;
  let held = 0;

  /*
   * A camp, not a survivor, and Phase 10 is what made the difference matter.
   *
   * This modelled one person because that is all the game had. Stamina turns that into a
   * lie in the one direction that matters most: a survivor spends four hours resting for
   * every hour walked, so a camp of one is idle about four fifths of the time and the fuel
   * economy appears to collapse by a factor of four. A camp of four alternates, and somebody
   * is always on the road.
   *
   * They are **not** independent, which is the whole reason this has to be simulated rather
   * than multiplied by `crew`. Recovery drinks six times a mouth, and every mouth drinks
   * from the same store — so a garden that comfortably feeds four idlers may not feed four
   * people recovering, and the crew throttles itself. That is the loop the design is for:
   * production limits labour, and labour builds production.
   */
  while (now < end) {
    const before = state.settlement.resources.fuel.amount;
    ({ state } = applyTick(state, (now += HOUR)));
    hour += 1;

    const living = state.survivors.filter((one) => one.alive);
    if (living.length === 0) {
      const first = state.survivors.find((one) => one.diedAt != null);
      return {
        trips,
        gained,
        waiting,
        out,
        diedOnDay: (first.diedAt - T0) / (24 * HOUR),
        perDay: (gained - burned) / ((now - T0) / (24 * HOUR)),
      };
    }

    gained += Math.max(0, state.settlement.resources.fuel.amount - before);

    // Trips that came home, counted once each.
    for (const trip of state.expeditions) {
      if (trip.status !== 'active' && !trip.counted) {
        trip.counted = true;
        trips += 1;
      }
    }
    state.expeditions = state.expeditions.filter((trip) => trip.status === 'active');
    state.expedition = state.expeditions[0] ?? null;

    // Only a player who is looking can dispatch.
    if (hour % gap !== 0) {
      for (const person of living) {
        if (state.expeditions.some((trip) => trip.characterId === person.id)) out += 1;
      }
      continue;
    }

    /*
     * A player who waits for the dark, which is the lever Phase 9 added and the reason
     * this file is being run again.
     *
     * Darkness takes a third off the dose, and dose is bench time — so on a region whose
     * rate is limited by waiting rather than by walking, leaving at the right hour buys
     * trips. Waiting to leave costs hours too, which is exactly the trade being measured:
     * a policy that held out for a perfect midnight departure would spend more than it
     * saved, so this takes any departure at least half in the dark and gives up after a
     * day of looking.
     */
    /*
     * Everybody who is home, one at a time — the same policy, applied per person.
     *
     * Each of the decisions below was written about "the survivor" and every one of them is
     * really about a person: whether *they* are clean enough to go, whether *they* have the
     * legs for it, whether a tablet is worth spending on *them*. The only thing that is
     * about the camp is the stores they all draw from, and those are shared by being shared.
     */
    for (const person of living) {
      if (state.expeditions.some((trip) => trip.characterId === person.id)) {
        out += 1;
        continue;
      }

      /*
       * Take a tablet rather than wait, when the camp can pay for one.
       *
       * Only while there is something to wait *for*: above the threshold the player would
       * otherwise be standing still, and below it the dose is not what is holding them.
       */
      if (
        scrubbing &&
        person.radiation > goAt &&
        state.settlement.resources.fuel.amount >= SCRUBBER.fuel &&
        state.settlement.resources.scrap.amount >= SCRUBBER.scrap
      ) {
        state.settlement.resources.fuel.amount -= SCRUBBER.fuel;
        state.settlement.resources.scrap.amount -= SCRUBBER.scrap;
        person.radiation = Math.max(0, person.radiation - SCRUBBER.rads);
        burned += SCRUBBER.fuel;
      }

      const legs = CONFIG.staminaPerHourWorked * region.travelHours;
      const ready = person.radiation <= goAt && person.stamina >= legs;

      if (nightly && ready) {
        const lit = daylightFraction(now, now + region.travelHours * HOUR);
        if (lit > 0.5 && held < holdHours) {
          held += 1;
          waiting += 1;
          continue;
        }
        held = 0;
      }

      if (!ready) {
        waiting += 1;
        continue;
      }

      const trip = seed++;

      /*
       * The answers, decided at dispatch because that is when the seed is fixed.
       *
       * A moment's schedule and its options are a pure function of the region and the trip
       * seed, so a policy can be written down in advance and the tick will meet exactly the
       * moments it was written against.
       */
      const choices =
        answers === null
          ? []
          : momentsFor(region, trip).flatMap((moment) => {
              const taken = moment.options.filter(
                (option) => (option.radiationFactor ?? 1) > 1 && (option.lootFactor ?? 1) > 1,
              );
              if (taken.length === 0) return [];

              // Steepest first, so `greedy` takes the whole trade and `careful` the small one.
              taken.sort((a, b) => b.radiationFactor - a.radiationFactor);
              const option = answers === 'greedy' ? taken[0] : taken[taken.length - 1];
              return [{ index: moment.index, key: moment.key, option: option.key }];
            });

      state.expeditions.push({
        id: `e${trip}`,
        characterId: person.id,
        status: 'active',
        departedAt: now,
        returnsAt: now + region.travelHours * HOUR,
        seed: trip,
        region,
        resolvedAt: null,
        log: null,
        choices,
      });
      state.expedition = state.expeditions[0];
    }
  }

  return {
    trips,
    gained,
    waiting,
    out,
    diedOnDay: null,
    perDay: (gained - burned) / DAYS,
  };
}

/** Runs are seeded differently only through the expedition counter, so vary the camp. */
function average(region, options) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    runs.push(play(region, { ...options, seed0: 1 + i * 10_000 }));
  }
  const mean = (f) => runs.reduce((t, r) => t + f(r), 0) / runs.length;
  return {
    perDay: mean((r) => r.perDay),
    trips: mean((r) => r.trips),
    idle: mean((r) => r.waiting) / Math.max(1, mean((r) => r.waiting) + mean((r) => r.out)),
    deaths: runs.filter((r) => r.diedOnDay !== null).length,
  };
}

// ---------------------------------------------------------------- reporting

const f1 = (x) => x.toFixed(1);
const pct = (x) => `${(x * 100).toFixed(0)}%`;

console.log(`\nfuel: nothing in the camp makes it. rad threshold ${CONFIG.radThreshold},`);
console.log(`decay ${CONFIG.radDecayPerHour}/h in camp and on the road,`);
console.log(`x${UPGRADES.filtration.radDecayMultiplier} in camp with filtration fitted.\n`);

console.log('=== one trip, over 3000 seeds ===\n');
console.log('  region                  danger    h   fuel/trip   rads   fuel/h   died');
console.log('  ' + '-'.repeat(70));
for (const region of paysFuel) {
  const t = perTrip(region);
  console.log(
    `  ${region.name.padEnd(22)} ${String(region.danger).padStart(4)}` +
      ` ${String(region.travelHours).padStart(4)}` +
      ` ${f1(t.fuel).padStart(10)}` +
      ` ${f1(t.rads).padStart(6)}` +
      ` ${f1(t.perHour).padStart(8)}` +
      ` ${pct(t.deathRate).padStart(6)}`,
  );
}

console.log(`\n=== ${DAYS} days of sending somebody there, ${RUNS} runs ===`);
console.log('\n  "attentive" dispatches the hour they get home. "twice a day" is a real person.\n');
console.log('  region                  player        fuel/day   trips   idle   died');
console.log('  ' + '-'.repeat(70));

const sustained = new Map();
for (const region of paysFuel) {
  for (const [label, opts] of [
    ['attentive   ', { checkInsPerDay: null }],
    ['twice a day ', { checkInsPerDay: 2 }],
    ['+ filtration', { checkInsPerDay: null, upgrades: ['filtration'] }],
    ['waits <= 3h  ', { checkInsPerDay: null, nightly: true, holdHours: 3 }],
    ['waits <= 24h ', { checkInsPerDay: null, nightly: true, holdHours: 24 }],
    ['+ scrubbing ', { checkInsPerDay: null, scrubbing: true }],
    ['buys the dose', { checkInsPerDay: null, answers: 'greedy' }],
    ['buys a little', { checkInsPerDay: null, answers: 'careful' }],
  ]) {
    const a = average(region, opts);
    if (label.trim() === 'attentive') sustained.set(region.slug, a.perDay);
    console.log(
      `  ${region.name.padEnd(22)} ${label} ${f1(a.perDay).padStart(9)}` +
        ` ${f1(a.trips).padStart(7)} ${pct(a.idle).padStart(6)}  ${a.deaths}/${RUNS}`,
    );
  }
}

/*
 * The conclusion above turns on a number this file chose, so sweep it.
 *
 * `goAt` is how much radiation a player will leave the camp carrying, and the table
 * above used 20 — `regenRadCeiling`, the dose below which wounds close. That is a
 * cautious player, and caution is exactly what penalises the Deep Zone, which doses 25
 * a trip. A reckless one goes out at 45 and still comes home under the burning
 * threshold. If the ranking flips across that range then "Coastal Wreckage is the best
 * fuel source" is a fact about this file rather than about the game.
 *
 * The tools README has this failure written on it twice already, in the entry about the
 * automaton that never waited on radiation and so could not see what filtration bought.
 */
console.log('\n=== the same question at other appetites for radiation ===\n');
console.log('  fuel/day for the attentive player, by the dose they will leave on\n');
console.log('  region                  <=10   <=20   <=35   <=45   <=55');
console.log('  ' + '-'.repeat(58));

for (const region of paysFuel) {
  const cells = [10, 20, 35, 45, 55].map(
    (goAt) => f1(average(region, { checkInsPerDay: null, goAt }).perDay).padStart(6),
  );
  console.log(`  ${region.name.padEnd(22)}${cells.join(' ')}`);
}

// The best rate any single region sustains for the attentive player, which is the
// fastest the road can honestly be built.
const best = [...sustained.entries()].sort((a, b) => b[1] - a[1])[0];
const bestRegion = paysFuel.find((r) => r.slug === best[0]);

console.log(`\n=== the road, at the best sustained rate ===\n`);
console.log(`  best region: ${bestRegion.name} at ${f1(best[1])} fuel/day\n`);
console.log('  link   cost   cumulative   days to here   (twice a day)');
console.log('  ' + '-'.repeat(60));

const halfRate = average(bestRegion, { checkInsPerDay: 2 }).perDay;

let cumulative = 0;
for (let i = 1; i <= LINKS; i += 1) {
  cumulative += linkCost(i);
  console.log(
    `  ${String(i).padStart(4)} ${String(linkCost(i)).padStart(6)}` +
      ` ${String(cumulative).padStart(12)}` +
      ` ${f1(cumulative / best[1]).padStart(14)}` +
      ` ${f1(cumulative / halfRate).padStart(15)}`,
  );
}

const fittings = Object.entries(UPGRADES)
  .filter(([, u]) => u.fuel > 0)
  .map(([slug, u]) => [slug, u.fuel]);
const fittingTotal = fittings.reduce((t, [, f]) => t + f, 0);

console.log(`\n  every fitting: ${fittings.map(([s, f]) => `${s} ${f}`).join(', ')} = ${fittingTotal}`);
console.log(`  the whole road: ${roadCost()}`);
console.log(`  both: ${roadCost() + fittingTotal} fuel = ${f1((roadCost() + fittingTotal) / best[1])} days attentive\n`);

await pool.end();

/* ------------------------------------------------------------------ pass four

 * What a roster is worth, which is the question Phase 10 rests on.
 *
 * Stamina costs a survivor about four hours of rest for every hour walked, so a camp of one
 * spends four fifths of its life waiting and the fuel economy above looks like it has
 * collapsed. The design's answer is that idleness is a fact about a *person* and the thing
 * that matters is whether the *camp* is idle: two people alternating means somebody is
 * always on the road.
 *
 * That is a claim, and this is the table that decides it. Not arithmetic — the crew shares
 * one food store and recovery drinks six times a mouth, so a garden that comfortably feeds
 * four idlers may not feed four people recovering. If the rate stops climbing with the crew,
 * the constraint has moved from stamina to the garden, which is exactly the loop the design
 * says it wants and would then have to be balanced rather than assumed.
 */
console.log('\n=== what a roster buys, at the attentive policy ===\n');
console.log('  fuel/day for the whole camp, and the share of survivor-hours spent waiting\n');
console.log('  region                  crew 1     crew 2     crew 3     crew 4     crew 5');
console.log('  ---------------------------------------------------------------------------');

for (const region of paysFuel.filter((r) => ['coastal_wreckage', 'the_deep_zone', 'harrow_end'].includes(r.slug))) {
  const cells = [];
  for (const crew of [1, 2, 3, 4, 5]) {
    const runs = [];
    for (let i = 0; i < RUNS; i += 1) {
      runs.push(play(region, { checkInsPerDay: null, seed0: 1 + i * 10_000, crew }));
    }
    const perDay = runs.reduce((sum, r) => sum + r.perDay, 0) / runs.length;
    const idle =
      runs.reduce((sum, r) => sum + r.waiting / Math.max(1, r.waiting + r.out), 0) / runs.length;
    cells.push(`${perDay.toFixed(1).padStart(5)} ${(idle * 100).toFixed(0).padStart(3)}%`);
  }
  console.log('  ' + region.name.padEnd(22) + cells.join('  '));
}
