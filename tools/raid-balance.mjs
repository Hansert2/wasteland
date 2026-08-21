/**
 * Do raids punish neglect, or punish having a life?
 *
 * The plan's tuning guard says death is the price of neglect, not of a weekend away.
 * Raids are the first mechanic that can take things while you are not looking, so the
 * question is whether an unattended camp is ground down or merely inconvenienced.
 */
import { applyTick } from '../src/game/tick.js';
import { campWealth, campDefence } from '../src/game/structures.js';
import { ORDINARY } from '../src/game/wanderers.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);

function camp({ levels, tower = 0, stores, seed }) {
  const structures = [
    { id: 1, kind: 'shelter', level: levels, buildCompletesAt: null },
    { id: 2, kind: 'garden', level: levels, buildCompletesAt: null },
    { id: 3, kind: 'water_purifier', level: levels, buildCompletesAt: null },
    { id: 4, kind: 'workshop', level: levels, buildCompletesAt: null },
    { id: 5, kind: 'watchtower', level: tower, buildCompletesAt: null },
  ];
  const cap = 100 + 250 * levels;
  return {
    lastTickAt: T0,
    settlement: {
      id: 1,
      structures,
      upgrades: [],
      raidSeed: seed,
      raidCount: 0,
      nextRaidAt: null,
      resources: {
        food: { amount: Math.min(stores, cap), ratePerHour: 1.2 * levels, cap },
        water: { amount: Math.min(stores, cap), ratePerHour: 2.5 * levels, cap },
        scrap: { amount: Math.min(stores, cap), ratePerHour: 1 * levels, cap },
        fuel: { amount: Math.min(stores, cap), ratePerHour: 0, cap },
      },
    },
    survivor: {
      id: 1, alive: true, health: 100, hunger: 0, radiation: 0, skillScavenging: ORDINARY,
      bornAt: T0, diedAt: null, causeOfDeath: null, inventory: [],
    },
    expedition: null, craft: null, fitting: null,
  };
}

function run(opts, days) {
  const { state, events } = applyTick(camp(opts), T0 + days * 24 * HOUR);
  const raids = events.filter((e) => e.type === 'raid');
  const repelled = events.filter((e) => e.type === 'raid_repelled');
  return {
    raids: raids.length,
    repelled: repelled.length,
    died: !state.survivor.alive,
    health: state.survivor.health,
    food: state.settlement.resources.food.amount,
    taken: raids.reduce((t, r) => t + Object.values(r.taken).reduce((a, b) => a + b, 0), 0),
  };
}

const avg = (rows, f) => (rows.reduce((t, r) => t + f(r), 0) / rows.length).toFixed(1);

for (const days of [7, 30]) {
  console.log(`\n=== ${days} days of total neglect ===`);
  console.log('  camp                  raids  repelled  taken   health   died');
  console.log('  ' + '-'.repeat(62));

  const cases = [
    ['starting camp       ', { levels: 1, stores: 40 }],
    ['established, no tower', { levels: 4, stores: 600 }],
    ['established, tower 3 ', { levels: 4, tower: 3, stores: 600 }],
    ['established, tower 6 ', { levels: 4, tower: 6, stores: 600 }],
  ];

  for (const [label, opts] of cases) {
    const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => run({ ...opts, seed: s * 104729 }, days));
    const died = rows.filter((r) => r.died).length;
    console.log(
      `  ${label} ${avg(rows, (r) => r.raids).padStart(6)}` +
        `  ${avg(rows, (r) => r.repelled).padStart(8)}` +
        `  ${avg(rows, (r) => r.taken).padStart(6)}` +
        `  ${avg(rows, (r) => r.health).padStart(7)}   ${died}/8`,
    );
  }
}

console.log('\nWhat the tower is worth:');
for (const tower of [0, 2, 4, 6]) {
  const s = [{ levels: 4, tower, stores: 600 }];
  const structures = camp({ ...s[0], seed: 1 }).settlement.structures;
  console.log(
    `  tower ${tower}: wealth ${campWealth(structures)}  defence ${campDefence(structures)}`,
  );
}

// --- standing: what allegiance is worth ------------------------------------
const { } = {};
console.log('\nWhat standing is worth (30 days, established camp, no tower):');
for (const [label, standings] of [
  ['hated by both   (-90)', { junction_crews: -90, green_river: -90 }],
  ['strangers         (0)', {}],
  ['trusted by both (+90)', { junction_crews: 90, green_river: 90 }],
]) {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => {
    const state = camp({ levels: 4, stores: 600, seed: s * 104729 });
    state.settlement.standings = standings;
    const { state: after, events } = applyTick(state, T0 + 30 * 24 * HOUR);
    const raids = events.filter((e) => e.type === 'raid');
    return {
      raids: raids.length + events.filter((e) => e.type === 'raid_repelled').length,
      taken: raids.reduce((t, r) => t + Object.values(r.taken).reduce((a, b) => a + b, 0), 0),
      died: !after.survivor.alive,
    };
  });
  const avg = (f) => (rows.reduce((t, r) => t + f(r), 0) / rows.length).toFixed(1);
  console.log(
    `  ${label}  raids ${avg((r) => r.raids).padStart(5)}  taken ${avg((r) => r.taken).padStart(7)}` +
      `  died ${rows.filter((r) => r.died).length}/8`,
  );
}
