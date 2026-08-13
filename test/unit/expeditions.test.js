import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpedition } from '../../src/game/expeditions.js';
import { makeRandom } from '../../src/game/random.js';

const SAFE_REGION = {
  name: 'The Ruined City',
  danger: 1,
  loot: { scrap: [4, 14] },
  finds: [],
  radiationPerTrip: 0,
};

const DEADLY_REGION = {
  name: 'The Deep Zone',
  danger: 5,
  loot: { scrap: [25, 60] },
  finds: [{ slug: 'rad_x', chance: 1, qty: [2, 2] }],
  radiationPerTrip: 25,
};

const survivor = (overrides = {}) => ({ health: 100, skillScavenging: 1, ...overrides });

test('the same seed always produces the same trip', () => {
  const args = { region: DEADLY_REGION, survivor: survivor(), seed: 12345 };

  // This is the whole reason the seed is stored on the row: a retried request must
  // not re-roll the dice.
  assert.deepStrictEqual(resolveExpedition(args), resolveExpedition(args));
});

test('different seeds produce different trips', () => {
  const outcomes = [1, 2, 3, 4, 5].map((seed) =>
    JSON.stringify(resolveExpedition({ region: DEADLY_REGION, survivor: survivor(), seed })),
  );

  assert.ok(new Set(outcomes).size > 1, 'the seed actually drives the outcome');
});

test('loot lands within the region range, scaled by scavenging skill', () => {
  for (let seed = 0; seed < 200; seed++) {
    const plain = resolveExpedition({ region: SAFE_REGION, survivor: survivor(), seed });
    assert.ok(plain.loot.scrap === undefined || plain.loot.scrap <= 14);
  }

  // Skill 6 is +50%, so the ceiling rises with it.
  let skilledTotal = 0;
  let plainTotal = 0;
  for (let seed = 0; seed < 200; seed++) {
    plainTotal += resolveExpedition({ region: SAFE_REGION, survivor: survivor(), seed }).loot.scrap ?? 0;
    skilledTotal +=
      resolveExpedition({
        region: SAFE_REGION,
        survivor: survivor({ skillScavenging: 6 }),
        seed,
      }).loot.scrap ?? 0;
  }

  assert.ok(skilledTotal > plainTotal, 'a better scavenger brings back more');
});

test('a safe region is survivable and a deadly one is not always', () => {
  const deaths = (region, health) => {
    let count = 0;
    for (let seed = 0; seed < 300; seed++) {
      if (resolveExpedition({ region, survivor: survivor({ health }), seed }).died) count++;
    }
    return count;
  };

  assert.equal(deaths(SAFE_REGION, 100), 0, 'a healthy survivor never dies in the city');
  assert.ok(deaths(DEADLY_REGION, 12) > 0, 'a wounded survivor can die in the Deep Zone');
});

test('a survivor who dies out there brings nothing home', () => {
  // Find a seed that kills a badly wounded survivor.
  let fatal = null;
  for (let seed = 0; seed < 500 && fatal === null; seed++) {
    const outcome = resolveExpedition({
      region: DEADLY_REGION,
      survivor: survivor({ health: 5 }),
      seed,
    });
    if (outcome.died) fatal = outcome;
  }

  assert.ok(fatal, 'expected at least one fatal seed');
  assert.ok(fatal.cause, 'death has a cause naming what happened out there');
  assert.match(fatal.log.join(' '), /did not make it back/);
});

test('radiation is taken only where there is radiation to take', () => {
  const clean = resolveExpedition({ region: SAFE_REGION, survivor: survivor(), seed: 7 });
  const hot = resolveExpedition({ region: DEADLY_REGION, survivor: survivor(), seed: 7 });

  assert.equal(clean.radiation, 0);
  assert.ok(hot.radiation > 0);
});

test('finds respect their probability', () => {
  const certain = resolveExpedition({ region: DEADLY_REGION, survivor: survivor(), seed: 99 });
  assert.deepEqual(certain.finds, [{ slug: 'rad_x', qty: 2 }], 'chance 1 always fires');

  const never = resolveExpedition({
    region: { ...DEADLY_REGION, finds: [{ slug: 'rad_x', chance: 0, qty: [1, 1] }] },
    survivor: survivor(),
    seed: 99,
  });
  assert.deepEqual(never.finds, [], 'chance 0 never fires');
});

test('the generator is uniform enough to trust for loot ranges', () => {
  const random = makeRandom(4242);
  let sum = 0;
  const draws = 20000;

  for (let i = 0; i < draws; i++) {
    const value = random();
    assert.ok(value >= 0 && value < 1, 'stays in [0, 1)');
    sum += value;
  }

  assert.ok(Math.abs(sum / draws - 0.5) < 0.02, 'mean sits near 0.5');
});
