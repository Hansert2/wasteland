import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CARRY_CAP_GRAMS,
  howManyFit,
  roomLeft,
  saysWeight,
  weighPack,
} from '../../src/game/carrying.js';

const pack = (...items) => items.map(([weightGrams, qty]) => ({ weightGrams, qty }));

test('a stack weighs its quantity, not its kind', () => {
  assert.equal(weighPack(pack([750, 3])), 2250);
  assert.equal(weighPack(pack([417, 2], [20, 5])), 934);
  assert.equal(weighPack([]), 0);
});

test('an item with no weight is carried for free', () => {
  // Every item was weightless before this phase, and a database that has migrated but not
  // re-seeded is exactly that. It must behave as it did yesterday rather than refusing
  // everything or refusing nothing at random.
  assert.equal(weighPack(pack([0, 99])), 0);
  assert.equal(howManyFit(pack([0, 99]), 0, 4), 4);
});

test('a full pack takes what fits and leaves the rest', () => {
  // The answer is a number rather than a yes: half a stack going in and half staying on the
  // ground is what the returning log has to be able to describe.
  const nearlyFull = pack([CARRY_CAP_GRAMS - 1600, 1]);
  assert.equal(howManyFit(nearlyFull, 750, 3), 2);
  assert.equal(howManyFit(nearlyFull, 9000, 1), 0);
  assert.equal(roomLeft(nearlyFull), 1600);
});

test('an over-full pack has no room, not anti-room', () => {
  const overloaded = pack([CARRY_CAP_GRAMS + 500, 1]);
  assert.equal(roomLeft(overloaded), 0);
  assert.equal(howManyFit(overloaded, 20, 1), 0);
});

test('the cap still fits the longest walk, kit and all', () => {
  /*
   * The derivation, pinned rather than restated. `tools/carry-balance.mjs` measured the kit
   * at 11 kg and the 90th-percentile haul of Harrow End at 3 kg, and the cap is the sum plus
   * what the walk needs. If a weight change ever makes a kitted survivor unable to carry an
   * ordinary haul home, the cap is wrong and this fails — which is the whole point of a rule
   * about the map rather than a number off a sweep.
   */
  const kit = pack([2000, 1], [9000, 1]);
  assert.ok(roomLeft(kit) >= 3000, `a kitted survivor has ${roomLeft(kit)} g for a 3 kg haul`);
});

test('weights are always said in kilograms', () => {
  assert.equal(saysWeight(20), '0.02 kg');
  assert.equal(saysWeight(417), '0.42 kg', 'two decimals, so a tin is not weighed to the gram');
  assert.equal(saysWeight(850), '0.85 kg');
  assert.equal(saysWeight(1668), '1.67 kg');
  assert.equal(saysWeight(1400), '1.4 kg');
  assert.equal(saysWeight(15000), '15 kg');
});
