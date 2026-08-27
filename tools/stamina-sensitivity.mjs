/**
 * Would stamina be a decision, or queue discipline with a gauge attached?
 *
 * Phase 10 asks one question before anything is built, and this answers it:
 *
 *   **Does stamina ever make the right answer "send the tired one anyway"?**
 *
 * `skill-sensitivity.mjs` cannot answer it. That instrument asks whether a survivor's
 * numbers change which *moment option* wins, and stamina does not act on moments — it
 * acts on which person leaves the gate. So the question has to be asked about dispatch.
 *
 * ## What is actually being measured
 *
 * A camp with a roster picks somebody to send. What that choice is worth is not the haul,
 * because the haul comes back whoever carries it. It is the haul divided by **how long
 * that person is then unavailable**, which is the currency the whole fuel economy already
 * turns out to trade in — see `fuel-balance.mjs`.
 *
 * With one gauge the answer is trivial: radiation decides, and you send whoever is
 * cleanest. Adding stamina is only worth doing if the two gauges *disagree* often enough
 * that a player has something to weigh. So:
 *
 *     downtime = max(rads to clear / decay, stamina to refill / regen)
 *
 * and the value of sending someone is `yield / (travel + downtime)`.
 *
 * **The max is the whole mechanic.** If stamina always refills faster than radiation
 * clears, stamina never binds and it is scenery for the third time. If it sometimes binds
 * and sometimes does not, there is a decision.
 *
 * ## The three answers this prints
 *
 * - **binds** — how often stamina, rather than radiation, is what a survivor is waiting
 *   on. Zero means scenery.
 * - **contested** — how often the cleanest survivor and the most rested one are *different
 *   people*. Only there is a choice being made at all; everywhere else both gauges point
 *   the same way and any policy gets it right.
 * - **cleanest wrong** — inside those contested states, how often sending the cleanest is
 *   the worse call. This is the number that matters, because "send the cleanest" is the
 *   game as it stands: radiation is the only gauge that gates anything today.
 *
 * A first version of this counted states where the best pick was *neither* the cleanest
 * nor the most rested, and reported a flat zero at every shape. That was not a finding —
 * with two survivors and two gauges the winner is always better on at least one of them,
 * so the column could not have been anything else. It measured the arithmetic, not the
 * game, and it is recorded here because it looked exactly like a result.
 *
 * Regions come from the database, so this measures the map that shipped. Nothing here
 * writes, and nothing here needs stamina to exist in the code — that is the point of
 * measuring first.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/stamina-sensitivity.mjs
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { CONFIG } from '../src/game/constants.js';
import { ORDINARY } from '../src/game/wanderers.js';

const SEEDS = 400;
const STATES = 4000;

/**
 * How much better one pick has to be before the choice counts as a choice.
 *
 * Five percent of the rate. Below that the two survivors deliver the same trip and which
 * one goes is a matter of taste, so counting it as a disagreement would measure the
 * tiebreak rather than the mechanic.
 */
const MATERIAL = 0.05;

/**
 * The candidate shapes for stamina, since none of them exists yet.
 *
 * `cost` is stamina spent per hour of travel and `regen` is points recovered per hour at
 * rest. Their ratio is what decides whether stamina ever binds: a trip costs
 * `cost x hours` and takes `cost x hours / regen` hours to pay back, so the payback is
 * `hours x cost / regen` — and radiation's payback at the Deep Zone is about 31 hours
 * against an 18-hour trip. Anything much under that and stamina is invisible.
 */
const SHAPES = [
  ['gentle  ', { cost: 1.5, regen: 2.0 }],
  ['moderate', { cost: 3.0, regen: 1.5 }],
  ['steep   ', { cost: 4.5, regen: 1.0 }],
  ['brutal  ', { cost: 6.0, regen: 0.75 }],
];

const { rows } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions where radiation_per_trip > 0 order by danger, travel_hours`,
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

/**
 * What a trip is worth, averaged over seeds.
 *
 * Scrap and fuel only, and weighted the way the road prices them: fuel is the one nothing
 * in the camp makes, so a unit of it is worth several of scrap. The exact weight is
 * arguable; what matters here is that it is the same for every survivor, because this
 * instrument compares *who to send*, not *where*.
 */
function tripValue(region) {
  let value = 0;
  let dose = 0;
  let trips = 0;

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const out = resolveExpedition({
      region,
      survivor: { health: 100, skillScavenging: ORDINARY, inventory: [] },
      seed,
    });
    if (out.died) continue;
    value += (out.loot.scrap ?? 0) + 4 * (out.loot.fuel ?? 0);
    dose += out.radiation;
    trips += 1;
  }

  return { value: value / trips, dose: dose / trips, hours: region.travelHours };
}

const priced = regions.map((region) => ({ region, ...tripValue(region) }));

/** Hours before this survivor could be sent again, on whichever gauge is slower. */
function downtime(survivor, trip, shape) {
  const radsAfter = survivor.rads + trip.dose;
  const staminaAfter = survivor.stamina - shape.cost * trip.hours;

  // Radiation has to come back under the threshold; stamina has to come back to enough
  // for the next trip of this length. Both are "when could this person leave again".
  const radWait = Math.max(0, (radsAfter - CONFIG.radThreshold) / CONFIG.radDecayPerHour);
  const staminaWait = Math.max(0, (shape.cost * trip.hours - staminaAfter) / shape.regen);

  return { radWait, staminaWait, wait: Math.max(radWait, staminaWait) };
}

/** The rate a survivor delivers at, which is what "who should go" is actually asking. */
function rateOf(survivor, trip, shape) {
  // Cannot be sent at all: already past the threshold, or has not the stamina for it.
  if (survivor.rads >= CONFIG.radThreshold) return null;
  if (survivor.stamina < shape.cost * trip.hours) return null;

  const { wait, radWait, staminaWait } = downtime(survivor, trip, shape);
  return { rate: trip.value / (trip.hours + wait), radWait, staminaWait };
}

// ------------------------------------------------------------------ the sweep

console.log(`\n${regions.length} regions that dose at all, ${STATES} camp states each.\n`);
console.log('A camp of two picks who to send. "cleanest" and "most rested" are the two');
console.log('single-gauge policies; the best pick is the one with the highest rate.\n');
console.log(
  'shape      cost/regen   binds   contested   cleanest wrong   rested wrong',
);
console.log('  ' + '-'.repeat(76));

let anyWorthBuilding = false;

for (const [label, shape] of SHAPES) {
  let binds = 0;
  let cleanWrong = 0;
  let restedWrong = 0;
  let contested = 0;
  let occasions = 0;
  let material = 0;

  // Deterministic states rather than random ones, so a rerun is comparable.
  let n = 0;
  for (const trip of priced) {
    for (let i = 0; i < STATES; i += 1) {
      n += 1;
      const a = { rads: ((n * 37) % 60), stamina: 20 + ((n * 53) % 81) };
      const b = { rads: ((n * 71) % 60), stamina: 20 + ((n * 29) % 81) };

      const ra = rateOf(a, trip, shape);
      const rb = rateOf(b, trip, shape);
      if (!ra || !rb) continue;
      occasions += 1;

      if (ra.staminaWait > ra.radWait || rb.staminaWait > rb.radWait) binds += 1;

      /*
       * Only count it when the choice is worth making.
       *
       * With both survivors under the threshold and a light-dosing region, `radWait` is
       * zero for both and "send the cleanest" is deciding a tie on a number that changes
       * nothing. Counting those as disagreements measures the tiebreak, not the mechanic
       * — and would have reported a decision where there is none, which is the shape of
       * error this project keeps finding in its own instruments.
       *
       * So a disagreement counts only when the two picks actually deliver differently.
       */
      const gap = Math.abs(ra.rate - rb.rate) / Math.max(ra.rate, rb.rate);
      if (gap < MATERIAL) continue;
      material += 1;

      const best = ra.rate >= rb.rate ? 'a' : 'b';
      const cleanest = a.rads <= b.rads ? 'a' : 'b';
      const rested = a.stamina >= b.stamina ? 'a' : 'b';

      // The only states where anything is being decided: the two gauges point at
      // different people. Everywhere else one survivor is both cleaner and fresher and
      // every policy sends them.
      if (cleanest === rested) continue;
      contested += 1;

      if (best !== cleanest) cleanWrong += 1;
      if (best !== rested) restedWrong += 1;
    }
  }

  // Each against its own denominator: binds is about every state a survivor could be
  // sent in, and the two "wrong" figures are about the contested ones alone.
  const ofAll = (x) => `${((100 * x) / Math.max(1, occasions)).toFixed(0)}%`;
  const ofContested = (x) => `${((100 * x) / Math.max(1, contested)).toFixed(0)}%`;

  // Worth building if radiation alone gets the contested calls wrong often enough to be
  // worth a player's attention, and stamina alone does not simply replace it as the one
  // gauge that decides.
  const clean = cleanWrong / Math.max(1, contested);
  const rested_ = restedWrong / Math.max(1, contested);
  if (clean > 0.15 && rested_ > 0.15) anyWorthBuilding = true;

  console.log(
    [
      `  ${label}`,
      `${shape.cost}/${shape.regen}`.padStart(11),
      ofAll(binds).padStart(9),
      ofAll(contested).padStart(11),
      ofContested(cleanWrong).padStart(16),
      ofContested(restedWrong).padStart(15),
    ].join(' '),
  );
}

console.log();
console.log('contested = the cleanest and the most rested are different people, so');
console.log('something is actually being chosen. The two right-hand columns are read');
console.log('inside those states only.');
console.log();
console.log('If "cleanest wrong" is near zero, stamina changes nothing a player would');
console.log('notice: radiation already decides and this is a second gauge agreeing with');
console.log('it. If "rested wrong" is near zero, stamina has simply replaced radiation as');
console.log('the one thing that decides, which is a swap and not a decision. Both have to');
console.log('be substantial for there to be a weighing at all.');
console.log();

console.log(
  anyWorthBuilding
    ? 'At least one shape leaves both single-gauge policies wrong often enough to weigh.'
    : 'No shape leaves both wrong. On this evidence stamina is bookkeeping, not a decision.',
);

await pool.end();
