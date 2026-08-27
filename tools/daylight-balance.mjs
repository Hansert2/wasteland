/**
 * Is the hour of departure worth thinking about, and does it stay inside the bound?
 *
 * `daylight-reach.mjs` answers how much of `d` a region admits. That is geometry. This
 * asks the question the geometry cannot: whether moving `d` moves anything a player would
 * cross the day for, and whether it moves it *too much*.
 *
 * **The currency is yield per day including bench time, not yield per trip.** A trip that
 * pays seventeen fuel is worth nothing if the survivor then spends thirty hours at home
 * waiting for the counter to come down, and radiation decays at a fixed rate — so the dose
 * a trip takes *is* bench hours, and bench hours are the real price of a haul. That is
 * exactly the axis the sun trades on: darkness buys uptime and pays for it in what turns
 * up. Measuring per-trip would report the cost and miss the benefit entirely.
 *
 * **A region is judged on the resource it pays most in.** The first cut of this measured
 * everything on scrap, which reported Irradiated Farmland — a food and water region whose
 * scrap range is `[0, 4]` — as swinging seventy percent with the hour. True about an
 * incidental resource, false about the region.
 *
 * **The bound is measured against the next rung, not the next region.** A *rung* is a
 * group of regions worth roughly the same, within ten percent, and moving between two on
 * one rung is meant to be a choice rather than progress. Measured against the next region
 * instead, this reported two violations that were not violations at all.
 *
 * Regions come from the database, so this measures what shipped. Everything else is
 * `resolveExpedition` and `travelFactors`, both pure.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/daylight-balance.mjs
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { travelFactors } from '../src/game/daylight.js';
import { CONFIG } from '../src/game/constants.js';
import { ORDINARY } from '../src/game/wanderers.js';

const HOUR = 3600_000;
const SEEDS = 1500;

/** Departure hours swept per day. Every two hours is finer than a player can aim. */
const STEP_HOURS = 2;

/** One day at each turn of the year: the sun's reach and its strength both move. */
const SEASONS = [
  ['midwinter', Date.UTC(2025, 11, 21)],
  ['equinox', Date.UTC(2026, 2, 21)],
  ['midsummer', Date.UTC(2026, 5, 21)],
];

/** Neighbours within ten percent are one rung, which is what the plan defines a rung as. */
const RUNG_WIDTH = 0.1;

/**
 * The currencies the bound is actually about.
 *
 * The bound exists so that optimising something small cannot out-earn moving up the map —
 * "the map stops mattering and the right play is to grind the region you already have,
 * carefully." That is an argument about *progression*. Scrap builds and fuel opens the
 * road; both are how a camp gets further.
 *
 * Food and water are not that. They are consumed, capped by storage, and produced by the
 * garden and the purifier anyway, so grinding a food region feeds the camp rather than
 * advancing it. A swing in food per day is worth reporting and is not a reason to make
 * the mechanic invisible everywhere — see the note on Irradiated Farmland in
 * `docs/PLAN.md` under Phase 9, which is the one region this distinction decides.
 *
 * Kept as an explicit list rather than inferred, so that adding a currency is a decision
 * somebody makes rather than a default somebody inherits.
 */
const PROGRESSION = new Set(['scrap', 'fuel']);

const { rows } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by danger, travel_hours`,
);

const regions = rows.map((row) => ({
  slug: row.slug,
  name: row.name,
  danger: row.danger,
  travelHours: Number(row.travel_hours),
  loot: row.loot,
  finds: row.finds,
  radiationPerTrip: Number(row.radiation_per_trip),
}));

/** What a region is actually worth having for: the resource it pays most in. */
function currencyOf(region) {
  let best = 'scrap';
  let most = -Infinity;

  for (const [kind, band] of Object.entries(region.loot ?? {})) {
    const mean = (Number(band[0]) + Number(band[1])) / 2;
    if (mean > most) {
      most = mean;
      best = kind;
    }
  }

  return best;
}

/**
 * What a trip leaving at `departedAt` is worth, per day of the survivor it consumes.
 *
 * Bench time is the dose over the decay rate: the hours before the camp could send the
 * same person out again. A region that doses nothing has no bench time, and its rate is
 * simply the trip.
 */
function perDay(region, departedAt) {
  const returnsAt = departedAt + region.travelHours * HOUR;
  const weather = travelFactors([], departedAt, returnsAt);

  const haul = {};
  let rads = 0;
  let finds = 0;
  let deaths = 0;

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const out = resolveExpedition({
      region,
      survivor: { health: 100, skillScavenging: ORDINARY, inventory: [] },
      seed,
      weather,
    });

    if (out.died) {
      deaths += 1;
      continue;
    }

    for (const [kind, amount] of Object.entries(out.loot)) {
      haul[kind] = (haul[kind] ?? 0) + amount;
    }
    rads += out.radiation;
    finds += out.finds.length;
  }

  const trips = SEEDS - deaths;
  const dose = rads / trips;
  const bench = dose / CONFIG.radDecayPerHour;
  const days = (region.travelHours + bench) / 24;

  const perDayOf = {};
  for (const [kind, total] of Object.entries(haul)) perDayOf[kind] = total / trips / days;

  return { perDayOf, findsPerTrip: finds / trips, dose, bench };
}

/** Sweep a region across a day and report what its best and worst hour are worth. */
function sweep(region, day) {
  const runs = [];
  for (let hour = 0; hour < 24; hour += STEP_HOURS) runs.push(perDay(region, day + hour * HOUR));

  const currency = currencyOf(region);
  const rates = runs.map((r) => r.perDayOf[currency] ?? 0);
  const finds = runs.map((r) => r.findsPerTrip);
  const bench = runs.map((r) => r.bench);

  return {
    name: region.name,
    currency,
    best: Math.max(...rates),
    worst: Math.min(...rates),
    mid: rates.reduce((a, b) => a + b, 0) / rates.length,
    swing: Math.max(...rates) / Math.min(...rates) - 1,
    finds: [Math.max(...finds), Math.min(...finds)],
    bench: [Math.max(...bench), Math.min(...bench)],
  };
}

for (const [season, day] of SEASONS) {
  console.log(`\n=== ${season} ===`);
  console.log('region                curr    best   worst   swing   finds hi/lo    bench hi/lo');

  for (const region of regions) {
    const s = sweep(region, day);
    console.log(
      [
        s.name.padEnd(20),
        s.currency.padStart(5),
        s.best.toFixed(1).padStart(8),
        s.worst.toFixed(1).padStart(7),
        `${(s.swing * 100).toFixed(0)}%`.padStart(7),
        `${s.finds[0].toFixed(2)}/${s.finds[1].toFixed(2)}`.padStart(14),
        `${s.bench[0].toFixed(1)}/${s.bench[1].toFixed(1)}`.padStart(15),
      ].join(' '),
    );
  }
}

// ---------------------------------------------------------------------- the bound

console.log('\n=== the bound: the hour against the rung ===\n');
console.log(
  'The swing a player can get from the hour must stay under the step to the next rung,\n' +
    'or picking a departure time out-earns going somewhere better and the map stops\n' +
    'mattering. Rungs are groups within ten percent of each other.\n',
);

const ladder = regions.map((region) => sweep(region, SEASONS[1][1])).sort((a, b) => a.mid - b.mid);

// Chained against the previous region rather than the first of the rung. Anchoring on the
// first is arbitrary and it showed: The Deep Zone, Harrow End and Sixteen Wells sit at
// 21.1, 23.0 and 23.5 — each within a few percent of its neighbour — and anchoring split
// them into two rungs seven percent apart, which reported a violation that was an artifact
// of the grouping rather than anything about the game.
const rungs = [];
for (const region of ladder) {
  const last = rungs[rungs.length - 1];
  const previous = last?.members[last.members.length - 1];
  if (previous && region.mid / previous.mid - 1 <= RUNG_WIDTH) last.members.push(region);
  else rungs.push({ members: [region] });
}
for (const rung of rungs) {
  rung.mid = rung.members.reduce((a, m) => a + m.mid, 0) / rung.members.length;
}

console.log('rung  region                curr    /day   swing   step to next   verdict');

let over = 0;
for (let i = 0; i < rungs.length; i += 1) {
  const rung = rungs[i];
  const next = rungs[i + 1];
  const step = next ? next.mid / rung.mid - 1 : null;

  for (const member of rung.members) {
    let verdict = 'top rung';
    if (step !== null) {
      if (member.swing < step) verdict = 'inside the bound';
      else if (PROGRESSION.has(member.currency)) {
        over += 1;
        verdict = 'OVER THE BOUND';
      } else {
        // Loud enough to notice, quiet enough that a real violation still stands out. A
        // guard that fires every run is a guard nobody reads.
        verdict = 'over, accepted (consumable)';
      }
    }

    console.log(
      [
        String(i + 1).padStart(4),
        `  ${member.name.padEnd(20)}`,
        member.currency.padStart(5),
        member.mid.toFixed(1).padStart(7),
        `${(member.swing * 100).toFixed(0)}%`.padStart(7),
        (step === null ? '-' : `${(step * 100).toFixed(0)}%`).padStart(14),
        `   ${verdict}`,
      ].join(' '),
    );
  }
}

console.log(
  over === 0
    ? '\nEvery progression currency is inside the bound: the hour is worth choosing, and\n' +
        'never worth more than going somewhere better. A row marked accepted swings wider\n' +
        'on a consumable, which the bound is not about — see docs/PLAN.md, Phase 9.'
    : `\n${over} region(s) OVER THE BOUND on scrap or fuel — the hour out-earns the map.\n` +
      'That is the case the bound was written for. Lower Kr and Kf.',
);

await pool.end();
