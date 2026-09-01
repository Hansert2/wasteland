/**
 * What does a week away cost, once hiding is the harsher outcome?
 *
 * Phase 12's one contentious number. Hiding — nobody answered the window — is to cost a
 * little more than a raid costs today; that is the user's call, made against the objection
 * that a week away must not be punished. The plan carries the bound rather than the
 * intention, and this is the bound:
 *
 *     the share is measured against a week offline, not against one raid
 *
 * Raids resolve in sequence. A factor that is gentle once is not necessarily gentle eight
 * times, and an absent player meets the whole run of them at their next page load.
 *
 * ## What is real here
 *
 * `nextRaidAt` schedules them and `resolveRaid` settles them — the game's own scheduler and
 * the game's own arithmetic, with `shareBoost` carrying the candidate factor, which is the
 * field standing's hostility already uses. Nothing reimplements the raid.
 *
 * The camp is held at its storage cap between raids, which is the honest worst case and the
 * ordinary one: every camp measured sits at its cap. It is also what makes the compounding
 * legible — a raid takes a share of what is *there*, so a camp that refills between visits
 * pays the share again in full, where a camp that does not pays it on a smaller pile.
 *
 * ## What to read
 *
 * The first column is today. The others are what an absent player would meet. **Read the
 * seven-day row against the thirty-day row**: the first is a holiday and the second is the
 * failure the plan is guarding against, where a camp comes back to nothing rather than to a
 * mess.
 *
 *   node tools/raid-absence.mjs
 */
import { nextRaidAt, resolveRaid } from '../src/game/raids.js';
import { campWealth, campDefence } from '../src/game/structures.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 3, 1);

/** A mid-game camp: fed, stocked, one watchtower level, sitting at its cap. */
const STRUCTURES = [
  { kind: 'shelter', level: 2 },
  { kind: 'garden', level: 3 },
  { kind: 'water_purifier', level: 3 },
  { kind: 'workshop', level: 2 },
  { kind: 'watchtower', level: 1 },
];

const CAP = 350;
const stocked = () => ({
  food: { amount: CAP },
  water: { amount: CAP },
  scrap: { amount: CAP },
  fuel: { amount: 90 },
});

const BOOSTS = [
  ['today', 1],
  ['+15%', 1.15],
  ['+30%', 1.3],
  ['+50%', 1.5],
];

const SPANS = [
  ['a night', 1],
  ['a weekend', 3],
  ['a week', 7],
  ['a fortnight', 14],
  ['a month', 30],
];

/**
 * One absence, resolved raid by raid.
 *
 * `refill` is what the camp puts back between visits. At its cap it is whole again by the
 * next raid two to seven days later, which is the case worth measuring; at zero it is the
 * pile getting smaller, which flatters every factor and would hide the compounding.
 */
function absence({ days, boost, seed, refill = true }) {
  const resources = stocked();
  const wealth = campWealth(STRUCTURES, resources);
  const defence = campDefence(STRUCTURES);

  let taken = { food: 0, water: 0, scrap: 0, fuel: 0 };
  let raids = 0;
  let at = nextRaidAt(T0, wealth, seed, 0);

  for (let index = 1; at < T0 + days * DAY; index += 1) {
    const outcome = resolveRaid({
      wealth: campWealth(STRUCTURES, resources),
      defence,
      resources,
      // Nobody answered, so nobody stood: this is the hidden case in every row.
      defenders: [],
      seed: seed + index,
      temper: { repelBonus: 0, softening: 0, shareBoost: boost },
    });

    raids += 1;
    for (const [kind, amount] of Object.entries(outcome.taken ?? {})) {
      taken[kind] += amount;
      resources[kind].amount -= amount;
    }
    /*
     * The camp puts back what it makes, and **fuel is not on that list.**
     *
     * Food, water and scrap have a structure producing them, so at a cap and a gap of two to
     * seven days they are whole again by the next visit. Nothing in the camp makes fuel — it
     * only ever walks in from an expedition — so a raided pile stays raided, and each visit
     * takes its share of a smaller one. Refilling it was the first version of this and it
     * overstated a month's loss by better than double: the compounding is the whole story
     * for the one resource an absent player cannot replace.
     */
    if (refill) {
      for (const kind of ['food', 'water', 'scrap']) resources[kind].amount = CAP;
    }
    at = nextRaidAt(at, campWealth(STRUCTURES, resources), seed, index);
  }

  return { raids, taken };
}

/** Averaged over seeds, because one run is a story and this needs a rate. */
function mean(days, boost) {
  let raids = 0;
  let food = 0;
  let fuel = 0;
  const runs = 400;
  for (let seed = 0; seed < runs; seed += 1) {
    const out = absence({ days, boost, seed: seed * 7919 });
    raids += out.raids;
    food += out.taken.food;
    fuel += out.taken.fuel;
  }
  return { raids: raids / runs, food: food / runs, fuel: fuel / runs };
}

console.log('\nnobody answered, so nobody stood. A camp at its cap, one watchtower level.\n');
console.log(
  `  ${'away for'.padEnd(12)}${'raids'.padStart(7)}` +
    BOOSTS.map(([label]) => `${label} food`.padStart(14)).join(''),
);
console.log('  ' + '-'.repeat(19 + BOOSTS.length * 14));

for (const [spanName, days] of SPANS) {
  const cells = BOOSTS.map(([, boost]) => mean(days, boost).food.toFixed(0).padStart(14)).join('');
  const raids = mean(days, 1).raids.toFixed(1).padStart(7);
  console.log(`  ${spanName.padEnd(12)}${raids}${cells}`);
}

console.log('\nthe same, as a multiple of what today takes:\n');
console.log(`  ${'away for'.padEnd(12)}` + BOOSTS.map(([l]) => l.padStart(11)).join(''));
console.log('  ' + '-'.repeat(12 + BOOSTS.length * 11));
for (const [spanName, days] of SPANS) {
  const base = mean(days, 1).food;
  const cells = BOOSTS.map(([, boost]) =>
    `${(mean(days, boost).food / Math.max(1, base)).toFixed(2)}x`.padStart(11),
  ).join('');
  console.log(`  ${spanName.padEnd(12)}${cells}`);
}

console.log('\nand the fuel, which is the one a camp cannot make:\n');
console.log(`  ${'away for'.padEnd(12)}` + BOOSTS.map(([l]) => l.padStart(11)).join(''));
console.log('  ' + '-'.repeat(12 + BOOSTS.length * 11));
for (const [spanName, days] of SPANS) {
  const cells = BOOSTS.map(([, boost]) => mean(days, boost).fuel.toFixed(0).padStart(11)).join('');
  console.log(`  ${spanName.padEnd(12)}${cells}`);
}
console.log();
