/**
 * Would a skills system be a decision, or a number going up?
 *
 * The plan has already been wrong about this once. Phase 7 proposed "skills that rise
 * with use" on the strength of a claim about the code that turned out to be false, and
 * the columns it was written around — `skill_combat`, `skill_crafting`, `skill_medicine`
 * and `stamina` — have had no reader since migration 001. So before anything is
 * designed this time, the question gets measured.
 *
 * The question is not "can we store a skill". It is: **does the survivor in front of you
 * change what the right answer is?** A skill that only makes the reward bigger is a
 * progress bar. A skill that changes *which option wins* is a decision, and only the
 * second one is worth building — the measured complaint about this game is sameness, and
 * a multiplier does not touch sameness.
 *
 * Nothing here is hypothetical. Three axes of survivor state already exist and are
 * already read:
 *
 * - **health**, which the warned flag and every damage roll read;
 * - **radiation**, which prices a dose differently either side of the threshold;
 * - **`skill_scavenging`**, the one skill column with a live reader — +10% loot per
 *   point in `expeditions.js` — which nothing has ever written, so it sits at 1.
 *
 * Turning that last one up is a real experiment rather than a simulation of one: it is
 * exactly what a loot-scaling skill would do if something wrote to it. If a survivor at
 * scavenging 20 answers every moment the same way a novice does, then loot-scaling
 * skills are flavour, and we would know it before writing a migration.
 *
 * The value function is the one in `moment-balance.mjs`, deliberately: two instruments
 * disagreeing about what a trip is worth would make both useless. Its constants are
 * arguable and argued in that file — read them before believing this table.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/skill-sensitivity.mjs
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { momentsFor } from '../src/game/moments.js';

const SEEDS = 1200;

const { rows: dbRegions } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by danger, travel_hours`,
);
await pool.end();

const regions = dbRegions
  .map((row) => ({
    slug: row.slug,
    name: row.name,
    danger: row.danger,
    travelHours: Number(row.travel_hours),
    loot: row.loot,
    finds: row.finds,
    radiationPerTrip: Number(row.radiation_per_trip),
  }))
  .filter((region) => momentsFor(region, 1).length > 0);

/** The same value function as moment-balance.mjs. See that file for the derivations. */
const RAD = 0.3;
const DAMAGE = 1;
const FIND = 20;
const OVER_THRESHOLD = 6;
const ITEM_COST = { preserved_meal: 12, tinned_stew: 10, rad_scrubber: 28, rad_x: 22 };
const priceOf = (slugs) => Math.min(...slugs.map((slug) => ITEM_COST[slug] ?? 20));
const haul = (loot) => Object.values(loot).reduce((sum, value) => sum + value, 0);

function worth(outcome, who) {
  if (outcome.died) return -Infinity;

  const ends = Number(who?.radiation ?? 0) + outcome.radiation;
  const excess = Math.max(0, ends - 60) - Math.max(0, Number(who?.radiation ?? 0) - 60);

  return (
    haul(outcome.loot) +
    outcome.finds.reduce((sum, find) => sum + find.qty, 0) * FIND -
    outcome.radiation * RAD -
    excess * OVER_THRESHOLD -
    Math.max(0, outcome.damage - (outcome.healed ?? 0)) * DAMAGE
  );
}

function hourlyRate(region) {
  let loot = 0;
  for (let seed = 0; seed < 400; seed += 1) {
    loot += haul(
      resolveExpedition({ region, survivor: person(), seed }).loot,
    );
  }
  return loot / 400 / region.travelHours;
}

/** Whichever option this survivor should take, at this moment, on this trip. */
function bestAt(region, seed, who, moment, rate) {
  let best = moment.options.find((option) => option.verb === 'default').key;
  let bestValue = -Infinity;

  for (const option of moment.options) {
    const outcome = resolveExpedition({
      region,
      survivor: who,
      seed,
      choices: [{ index: moment.index, option: option.key }],
    });
    const value =
      worth(outcome, who) -
      (option.consumes ? priceOf(option.consumes) : 0) -
      Number(option.hours ?? 0) * rate;

    if (value > bestValue) {
      bestValue = value;
      best = option.key;
    }
  }

  return best;
}

const person = ({ health = 100, radiation = 0, scavenging = 1 } = {}) => ({
  health,
  radiation,
  skillScavenging: scavenging,
  // A pack that can pay for anything, so a spend option is compared on its merits
  // rather than being unavailable. The pure resolution does not check the pack; this
  // matches what `moment-balance` measures.
  inventory: [],
});

/**
 * The comparisons. Each is a baseline and a changed survivor, and the question asked of
 * every moment on every trip is only ever: did the answer change?
 */
const AXES = [
  ['health 100 -> 30', person(), person({ health: 30 })],
  ['health 100 -> 60', person(), person({ health: 60 })],
  ['radiation 0 -> 55', person(), person({ radiation: 55 })],
  ['radiation 0 -> 75', person(), person({ radiation: 75 })],
  ['scavenging 1 -> 4', person(), person({ scavenging: 4 })],
  ['scavenging 1 -> 8', person(), person({ scavenging: 8 })],
  ['scavenging 1 -> 20', person(), person({ scavenging: 20 })],
];

const totals = new Map(AXES.map(([label]) => [label, { seen: 0, changed: 0 }]));
const perMoment = new Map();

for (const region of regions) {
  const rate = hourlyRate(region);

  for (let seed = 0; seed < SEEDS; seed += 1) {
    for (const moment of momentsFor(region, seed)) {
      for (const [label, before, after] of AXES) {
        const a = bestAt(region, seed, before, moment, rate);
        const b = bestAt(region, seed, after, moment, rate);

        const tally = totals.get(label);
        tally.seen += 1;
        if (a !== b) tally.changed += 1;

        const key = moment.key;
        if (!perMoment.has(key)) perMoment.set(key, new Map());
        const row = perMoment.get(key);
        const cell = row.get(label) ?? { seen: 0, changed: 0 };
        cell.seen += 1;
        if (a !== b) cell.changed += 1;
        row.set(label, cell);
      }
    }
  }
}

const pct = (cell) => (cell.seen === 0 ? '  —' : `${((cell.changed / cell.seen) * 100).toFixed(0)}%`);

console.log('\n=== Does the survivor change the answer? ===\n');
console.log('  Every moment on every trip, asked twice: which option wins for this');
console.log('  survivor, and which wins for that one. "changed" means the answer moved.\n');
console.log('  axis                       occasions   answer changed');

for (const [label, cell] of totals) {
  console.log(`  ${label.padEnd(26)} ${String(cell.seen).padStart(8)}   ${pct(cell).padStart(6)}`);
}

console.log('\n  A skill that never changes the answer is a progress bar. One that does');
console.log('  is a decision, and only the second kind is worth a migration.\n');

console.log('=== Which moments are sensitive to what ===\n');

const shown = ['health 100 -> 30', 'radiation 0 -> 75', 'scavenging 1 -> 20'];
console.log('  moment              ' + shown.map((s) => s.split(' ')[0].padStart(12)).join(''));

for (const [key, row] of [...perMoment.entries()].sort()) {
  console.log(
    '  ' + key.padEnd(20) + shown.map((label) => pct(row.get(label) ?? { seen: 0, changed: 0 }).padStart(12)).join(''),
  );
}

console.log('\n  A row that is blank across the board is a moment nobody can be better');
console.log('  or worse at — whatever a skills system did, it would not reach it.\n');
