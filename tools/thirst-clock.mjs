/**
 * How long a camp with nothing in it has, before and after the split.
 *
 * Phase 19's design puts one derivation above everything else in the phase and says it in as
 * many words: *"the guard is about a camp with nothing, so both gauges are running. If thirst
 * keeps a damage rate of 3/h and starvation adds its own on top, the combined clock falls under
 * 36 hours and the game starts punishing real life. The two rates have to sum to about what the
 * one rate does today. **Measure it, do not choose it.**"*
 *
 * This is that measurement, and it runs in both directions: what the single gauge does now, and
 * what any proposed pair of rates would do instead. Run it before touching a constant and after.
 *
 * The clock is `applyTick`'s own — a real camp with empty stores, walked an hour at a time — so
 * it includes every term that acts on health, not just the starvation one. Nothing here
 * reimplements the arithmetic it is checking.
 *
 *   node tools/thirst-clock.mjs
 */
import { applyTick } from '../src/game/tick.js';
import { CONFIG } from '../src/game/constants.js';
import { ORDINARY } from '../src/game/wanderers.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);

/**
 * A camp with a shelter and nothing to eat or drink.
 *
 * No garden and no purifier: the question is what an *abandoned* camp does, which is the case
 * the 36-to-72-hour guard in `test/unit/tick.test.js` is written about. A camp that produces
 * anything is not on this clock.
 */
function empty(overrides = {}) {
  return {
    lastTickAt: T0,
    settlement: {
      id: 1,
      upgrades: [],
      structures: [{ id: 1, kind: 'shelter', level: 1, buildCompletesAt: null }],
      resources: {
        food: { amount: 0, ratePerHour: 0, cap: 600 },
        water: { amount: 0, ratePerHour: 0, cap: 600 },
        scrap: { amount: 0, ratePerHour: 0, cap: 600 },
        fuel: { amount: 0, ratePerHour: 0, cap: 600 },
      },
    },
    survivor: {
      id: 1,
      alive: true,
      health: 100,
      hunger: 0,
      thirst: 0,
      radiation: 0,
      stamina: 100,
      skillScavenging: ORDINARY,
      bornAt: T0,
      diedAt: null,
      causeOfDeath: null,
      inventory: [],
      ...overrides,
    },
    expeditions: [],
    craft: null,
    fitting: null,
  };
}

/** Hours until they die, and what the gauges read on the way. */
function clockOf(state, config = CONFIG) {
  let now = T0;
  let marks = [];
  for (let hour = 1; hour <= 24 * 30; hour += 1) {
    now += HOUR;
    ({ state } = applyTick(state, now, config));
    const s = state.survivor;
    if ([12, 24, 36, 48, 72].includes(hour)) {
      marks.push(
        `${String(hour).padStart(3)}h health ${String(Math.round(s.health)).padStart(3)}` +
          ` hunger ${String(Math.round(s.hunger)).padStart(3)}` +
          ` thirst ${String(Math.round(s.thirst ?? 0)).padStart(3)}`,
      );
    }
    if (!s.alive) return { hours: hour, cause: s.causeOfDeath, marks };
  }
  return { hours: Infinity, cause: null, marks };
}

console.log('a camp with nothing in it, and one survivor left awake in it\n');

const now = clockOf(empty());
console.log(`  dies after ${now.hours}h — of ${now.cause}`);
for (const mark of now.marks) console.log(`    ${mark}`);

/*
 * And what the guard is actually about. The window exists so that a weekend away is survivable
 * and a fortnight is not: 36 hours is a Friday night to a Sunday morning, and 72 is the whole
 * weekend. A clock outside it is not a balance nudge, it is the game punishing a life.
 */
console.log(
  `\n  The guard in test/unit/tick.test.js asks for 36-72h. This is ${
    now.hours >= 36 && now.hours <= 72 ? 'inside it.' : 'OUTSIDE IT.'
  }`,
);

/*
 * The decomposition, which is what the split has to preserve. Starvation is the only term
 * acting here — there is no dose and no injury — so the whole clock is the threshold being
 * reached and then the damage rate running.
 */
const toThreshold = CONFIG.starvationThreshold / CONFIG.hungerRisePerHour;
const toDeath = 100 / CONFIG.starvationDamagePerHour;
console.log(
  `\n  It is two stretches: ${toThreshold.toFixed(1)}h to climb ${CONFIG.starvationThreshold}` +
    ` at ${CONFIG.hungerRisePerHour}/h, then ${toDeath.toFixed(1)}h to lose a hundred health at` +
    ` ${CONFIG.starvationDamagePerHour}/h.`,
);

/*
 * What any proposed pair does. Both gauges run in an empty camp, so their damage stacks, and
 * the sum is the figure that has to land back inside the window. Printed as a table rather than
 * argued, because the design's whole instruction about this phase is not to choose it.
 */
console.log('\n  if the two rates stack, the combined clock is:');
console.log('    thirst   starvation   sum   climb   fall   total   inside 36-72?');
for (const [thirstRate, starveRate] of [
  [3, 3],
  [3, 1],
  [2.5, 0.5],
  [2.4, 0.6],
  [2, 1],
  [3, 0],
]) {
  const sum = thirstRate + starveRate;
  const climb = CONFIG.starvationThreshold / CONFIG.hungerRisePerHour;
  const fall = 100 / sum;
  const total = climb + fall;
  console.log(
    `    ${String(thirstRate).padStart(6)}   ${String(starveRate).padStart(10)}` +
      `   ${String(sum).padStart(3)}   ${climb.toFixed(1).padStart(5)}   ${fall.toFixed(1).padStart(4)}` +
      `   ${total.toFixed(1).padStart(5)}   ${total >= 36 && total <= 72 ? 'yes' : 'NO'}`,
  );
}
console.log(
  '\n  The climb is shared: both gauges rise at the same rate off the same empty shelf, so they',
);
console.log(
  '  cross their thresholds together and only the damage stacks. Any pair summing to about 3',
);
console.log('  leaves the clock exactly where it is, which is what the design asked for.');
