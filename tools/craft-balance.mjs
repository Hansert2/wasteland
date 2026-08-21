/**
 * Is the gear worth what it costs, and is a death worth what it costs?
 *
 * Two unmeasured things. Crafted gear is priced in scrap and parts; the question is
 * what that buys in damage not taken. The successor penalty is priced in levels and
 * stores; the question is how long a camp takes to climb back.
 */
import { resolveExpedition } from '../src/game/expeditions.js';
import { applyTick } from '../src/game/tick.js';
import { upgradeCost } from '../src/game/structures.js';
import { ORDINARY } from '../src/game/wanderers.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2287, 0, 1);
const SEEDS = 4000;

const DEEP = {
  name: 'The Deep Zone', danger: 5,
  loot: { scrap: [25, 60], fuel: [10, 25] },
  finds: [{ slug: 'scavenged_parts', chance: 0.55, qty: [2, 3] }],
  radiationPerTrip: 25,
};
const COASTAL = {
  name: 'Coastal Wreckage', danger: 4,
  loot: { scrap: [15, 35], fuel: [5, 15], water: [5, 15] },
  finds: [], radiationPerTrip: 4,
};

const SPEAR = { id: 'scrap_spear', kind: 'weapon', potency: 25, qty: 1 };
const VEST = { id: 'plate_vest', kind: 'armour', potency: 30, qty: 1 };

function damageOver(region, inventory, health = 100) {
  let damage = 0;
  let deaths = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const out = resolveExpedition({
      region, seed,
      survivor: { health, skillScavenging: ORDINARY, inventory },
    });
    damage += out.damage;
    if (out.died) deaths += 1;
  }
  return { perTrip: damage / SEEDS, deathRate: deaths / SEEDS };
}

console.log('=== what gear is worth, per trip ===');
console.log('  region    gear                cost         dmg/trip   saved');
console.log('  ' + '-'.repeat(64));

for (const [name, region] of [['deep    ', DEEP], ['coastal ', COASTAL]]) {
  const bare = damageOver(region, []);
  const kit = [
    ['nothing            ', '—            ', []],
    ['scrap spear        ', '20 scrap     ', [SPEAR]],
    ['plate vest         ', '45 scrap + 2p', [VEST]],
    ['both               ', '65 scrap + 2p', [SPEAR, VEST]],
  ];
  for (const [label, cost, inv] of kit) {
    const m = damageOver(region, inv);
    const saved = bare.perTrip - m.perTrip;
    console.log(
      `  ${name}  ${label}${cost}  ${m.perTrip.toFixed(2).padStart(8)}` +
        `   ${saved > 0 ? saved.toFixed(2) : '—'}`,
    );
  }
  console.log('');
}

console.log('=== gear as survival, for a survivor already hurt ===');
console.log('  health  gear      death rate in the Deep Zone');
for (const health of [50, 35, 20]) {
  const bare = damageOver(DEEP, [], health);
  const kitted = damageOver(DEEP, [SPEAR, VEST], health);
  console.log(
    `  ${String(health).padStart(6)}  none      ${(bare.deathRate * 100).toFixed(1)}%` +
      `   ->  both  ${(kitted.deathRate * 100).toFixed(1)}%`,
  );
}

// --- the successor penalty -------------------------------------------------
console.log('\n=== what a death costs the camp ===');

const structures = (level) => [
  { id: 1, kind: 'shelter', level, buildCompletesAt: null },
  { id: 2, kind: 'garden', level, buildCompletesAt: null },
  { id: 3, kind: 'water_purifier', level, buildCompletesAt: null },
  { id: 4, kind: 'workshop', level, buildCompletesAt: null },
];

for (const level of [2, 4, 6]) {
  // A successor drops every structure one level. What does climbing back cost?
  const scrap = structures(level).reduce(
    (total, s) => total + upgradeCost(s.kind, s.level - 1).scrap, 0,
  );
  const hoursOfWork = structures(level).reduce(
    (total, s) => total + upgradeCost(s.kind, s.level - 1).hours, 0,
  );

  // How long the camp takes to earn that scrap back at the reduced workshop rate.
  const state = {
    lastTickAt: T0,
    settlement: {
      id: 1, structures: structures(level - 1), upgrades: [],
      raidSeed: 1, raidCount: 0, nextRaidAt: T0 + 3650 * 24 * HOUR,
      resources: {
        food: { amount: 500, ratePerHour: 1.2 * (level - 1), cap: 100000 },
        water: { amount: 500, ratePerHour: 2.5 * (level - 1), cap: 100000 },
        scrap: { amount: 0, ratePerHour: 1 * (level - 1), cap: 100000 },
        fuel: { amount: 0, ratePerHour: 0, cap: 100000 },
      },
    },
    survivor: {
      id: 1, alive: true, health: 100, hunger: 0, radiation: 0, skillScavenging: ORDINARY,
      bornAt: T0, diedAt: null, causeOfDeath: null, inventory: [],
    },
    expedition: null, craft: null, fitting: null,
  };

  let hours = 0;
  let s = state;
  while (s.settlement.resources.scrap.amount < scrap && hours < 24 * 400) {
    ({ state: s } = applyTick(s, T0 + ++hours * HOUR));
  }

  console.log(
    `  level ${level} camp: ${scrap} scrap and ${hoursOfWork.toFixed(0)} h of building to undo` +
      ` — ${(hours / 24).toFixed(1)} days to earn back from the workshop alone`,
  );
}
