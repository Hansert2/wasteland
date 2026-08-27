/**
 * The first hour, as an actually-attentive player would spend it.
 *
 * Policy: always have someone out on the shortest region that is worth it, and spend
 * scrap the moment a build is affordable, cheapest first. This is the impatient
 * player the rescale was for — the question is whether they now have anything to do.
 */
import { applyTick } from '../src/game/tick.js';
import { upgradeCost, productionRates } from '../src/game/structures.js';
import { ORDINARY } from '../src/game/wanderers.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);

const FENCE = {
  name: 'The Fence Line', danger: 1,
  loot: { scrap: [2, 6], food: [0, 2] }, finds: [], radiationPerTrip: 0,
};
const TRAVEL = 0.17;

function fresh() {
  const structures = [
    { id: 1, kind: 'shelter', level: 1, buildCompletesAt: null },
    { id: 2, kind: 'garden', level: 1, buildCompletesAt: null },
    { id: 3, kind: 'water_purifier', level: 1, buildCompletesAt: null },
    { id: 4, kind: 'workshop', level: 0, buildCompletesAt: null },
    { id: 5, kind: 'watchtower', level: 0, buildCompletesAt: null },
  ];
  const rates = productionRates(structures);
  return {
    lastTickAt: T0,
    settlement: {
      id: 1, structures, upgrades: [],
      raidSeed: 7, raidCount: 0, nextRaidAt: T0 + 3650 * 24 * HOUR,
      resources: {
        food: { amount: 40, ratePerHour: rates.food, cap: 350 },
        water: { amount: 40, ratePerHour: rates.water, cap: 350 },
        scrap: { amount: 10, ratePerHour: rates.scrap, cap: 350 },
        fuel: { amount: 0, ratePerHour: 0, cap: 350 },
      },
    },
    survivor: {
      id: 1, alive: true, health: 100, hunger: 0, radiation: 0, skillScavenging: ORDINARY,
      bornAt: T0, diedAt: null, causeOfDeath: null, inventory: [],
    },
    expedition: null, craft: null, fitting: null,
  };
}

function play(minutes, { withFence }) {
  let state = fresh();
  let now = T0;
  let seed = 1;
  const actions = [];
  const end = T0 + minutes * 60_000;

  while (now < end) {
    now = Math.min(now + 30_000, end);
    ({ state } = applyTick(state, now));
    if (!state.survivor?.alive) break;

    // Send someone out whenever they are home.
    if (withFence && state.expedition?.status !== 'active') {
      if (state.expedition?.status === 'returned') {
        actions.push({ at: now, what: 'returned from the fence line' });
      }
      state.expedition = {
        id: `e${seed}`, status: 'active', departedAt: now, returnsAt: now + TRAVEL * HOUR,
        seed: seed++, region: FENCE, resolvedAt: null, log: null,
      };
    }

    // Spend scrap on the cheapest thing going, if nothing is being built.
    const building = state.settlement.structures.some((s) => s.buildCompletesAt !== null);
    if (!building) {
      const options = state.settlement.structures
        .map((s) => ({ s, cost: upgradeCost(s.kind, s.level) }))
        .filter((o) => o.cost.scrap <= state.settlement.resources.scrap.amount)
        .sort((a, b) => a.cost.scrap - b.cost.scrap);

      if (options[0]) {
        const { s, cost } = options[0];
        state.settlement.resources.scrap.amount -= cost.scrap;
        s.buildCompletesAt = now + cost.hours * HOUR;
        actions.push({ at: now, what: `build ${s.kind} to ${s.level + 1} (${cost.scrap} scrap, ${Math.round(cost.hours * 3600)}s)` });
      }
    }
  }

  const levels = state.settlement.structures.reduce((t, s) => t + s.level, 0);
  return { actions, levels, scrap: state.settlement.resources.scrap.amount };
}

for (const [label, opts] of [
  ['WITHOUT the short regions', { withFence: false }],
  ['WITH the short regions   ', { withFence: true }],
]) {
  const r = play(60, opts);
  const builds = r.actions.filter((a) => a.what.startsWith('build'));
  console.log(`\n=== ${label} — first hour ===`);
  console.log(`  ${builds.length} builds, ${r.levels} total structure levels, ${r.scrap.toFixed(0)} scrap left`);
  for (const a of r.actions.slice(0, 12)) {
    console.log(`   t+${String(Math.round((a.at - T0) / 60000) + 'm').padStart(4)}  ${a.what}`);
  }
  if (r.actions.length > 12) console.log(`   ... and ${r.actions.length - 12} more`);
}

console.log('\n=== how far an attentive player gets ===');
for (const mins of [10, 60, 180, 720]) {
  const r = play(mins, { withFence: true });
  const label = mins < 60 ? `${mins}m` : `${mins / 60}h`;
  console.log(
    `  after ${label.padEnd(4)}: ${String(r.levels).padStart(3)} structure levels,` +
      ` ${r.actions.filter((a) => a.what.startsWith('build')).length} builds`,
  );
}
