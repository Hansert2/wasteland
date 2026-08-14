/**
 * Does filtration ease the radiation constraint, or delete it?
 *
 * No database and no guessing: applyTick is a pure function of (state, now), so a
 * month of play runs in milliseconds. The policy below is the impatient player —
 * send to the Deep Zone the moment radiation is low enough to come back alive.
 */
import { applyTick } from '../src/game/tick.js';
import { CONFIG } from '../src/game/constants.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);

const DEEP_ZONE = {
  slug: 'the_deep_zone',
  name: 'The Deep Zone',
  danger: 5,
  loot: { scrap: [25, 60], fuel: [10, 25] },
  finds: [
    { slug: 'rad_x', chance: 0.4, qty: [1, 3] },
    { slug: 'scavenged_parts', chance: 0.55, qty: [2, 3] },
  ],
  radiationPerTrip: 25,
};
const TRAVEL_HOURS = 18;

function makeCamp(upgrades) {
  return {
    lastTickAt: T0,
    settlement: {
      id: 1,
      upgrades,
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
    survivor: {
      id: 1,
      alive: true,
      health: 100,
      hunger: 0,
      radiation: 0,
      skillScavenging: 1,
      bornAt: T0,
      diedAt: null,
      causeOfDeath: null,
      inventory: [],
    },
    expedition: null,
    craft: null,
    fitting: null,
  };
}

/**
 * @param {number[]} upgrades slugs fitted
 * @param {number} goAt send out whenever radiation is at or below this
 */
function run({ upgrades = [], goAt, days = 60, seed0 = 1 }) {
  let state = makeCamp(upgrades);
  let seed = seed0;
  let now = T0;
  const end = T0 + days * 24 * HOUR;

  let trips = 0;
  let fuel = 0;
  let waiting = 0; // hours spent at home unable to leave
  let out = 0;

  while (now < end) {
    const next = now + HOUR;
    const before = state.expedition?.status;
    ({ state } = applyTick(state, next));
    now = next;

    if (!state.survivor?.alive) {
      return { trips, fuel, waiting, out, diedAfterDays: (state.survivor.diedAt - T0) / (24 * HOUR) };
    }

    if (before === 'active' && state.expedition.status !== 'active') {
      trips += 1;
      fuel = state.settlement.resources.fuel.amount;
    }

    if (state.expedition?.status === 'active') {
      out += 1;
      continue;
    }

    if (state.survivor.radiation <= goAt) {
      state.expedition = {
        id: `e${seed}`,
        status: 'active',
        returnsAt: now + TRAVEL_HOURS * HOUR,
        seed: seed++,
        region: DEEP_ZONE,
        resolvedAt: null,
        log: null,
      };
    } else {
      waiting += 1;
    }
  }

  return { trips, fuel: state.settlement.resources.fuel.amount, waiting, out, diedAfterDays: null };
}

const pct = (a, b) => `${((a / (a + b)) * 100).toFixed(0)}%`;

console.log(`rad decay: ${CONFIG.radDecayPerHour}/h base, threshold ${CONFIG.radThreshold}\n`);
console.log('60 days of an impatient player, sending to the Deep Zone whenever safe:\n');
console.log('  policy   upgrade      trips   fuel   idle at home   died');
console.log('  ' + '-'.repeat(62));

for (const goAt of [10, 30, 50]) {
  for (const [label, upgrades] of [['none      ', []], ['filtration', ['filtration']]]) {
    const rows = [1, 2, 3, 4, 5].map((s) => run({ upgrades, goAt, seed0: s * 1000 }));
    const avg = (f) => (rows.reduce((t, r) => t + f(r), 0) / rows.length).toFixed(1);
    const died = rows.filter((r) => r.diedAfterDays !== null).length;
    const waiting = rows.reduce((t, r) => t + r.waiting, 0);
    const out = rows.reduce((t, r) => t + r.out, 0);

    console.log(
      `  <=${String(goAt).padEnd(6)} ${label}   ${avg((r) => r.trips).padStart(5)}` +
        `  ${avg((r) => r.fuel).padStart(6)}   ${pct(waiting, out).padStart(11)}` +
        `   ${died}/5`,
    );
  }
}

console.log('\nRecovery: hours from a fresh Deep Zone dose back to a safe threshold.');
for (const [label, upgrades] of [['none      ', []], ['filtration', ['filtration']]]) {
  let state = makeCamp(upgrades);
  state.survivor.radiation = 35;
  let hours = 0;
  let now = T0;
  while (state.survivor.radiation > 10 && hours < 500) {
    ({ state } = applyTick(state, (now += HOUR)));
    hours += 1;
  }
  console.log(`  ${label}  35 rads -> 10 rads in ${hours} h`);
}
