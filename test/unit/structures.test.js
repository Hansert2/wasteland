import test from 'node:test';
import assert from 'node:assert/strict';

import { productionRates, storageCap, campStrength, upgradeCost } from '../../src/game/structures.js';
import { CONFIG } from '../../src/game/constants.js';

test('production scales with level and lands on the right resource', () => {
  const rates = productionRates([
    { kind: 'garden', level: 2 },
    { kind: 'water_purifier', level: 1 },
    { kind: 'workshop', level: 3 },
  ]);

  assert.equal(rates.food, 2.4);
  assert.equal(rates.water, 2.5);
  assert.equal(rates.scrap, 3);
  assert.equal(rates.fuel, 0, 'nothing produces fuel yet');
});

test('an unbuilt structure produces nothing', () => {
  const rates = productionRates([
    { kind: 'garden', level: 0 },
    { kind: 'shelter', level: 4 },
    { kind: 'watchtower', level: 2 },
  ]);

  assert.deepEqual(rates, { water: 0, food: 0, scrap: 0, fuel: 0 });
});

test('a level 1 garden outproduces a survivor, so a basic camp is sustainable', () => {
  // The offline-death design rests on this: starvation has to be a consequence of
  // neglect, which requires that a maintained camp can actually run food-positive.
  const rates = productionRates([
    { kind: 'garden', level: 1 },
    { kind: 'water_purifier', level: 1 },
  ]);

  assert.ok(rates.food > CONFIG.foodPerHour, 'food production exceeds consumption');
  assert.ok(rates.water > CONFIG.waterPerHour, 'water production exceeds consumption');
});

test('storage comes from the shelter, with a floor for a camp that has none', () => {
  assert.equal(storageCap([]), 100);
  assert.equal(storageCap([{ kind: 'shelter', level: 2 }]), 600);
});

test('upgrade costs escalate, which is what gives the game its long tail', () => {
  const early = upgradeCost('workshop', 0);
  const late = upgradeCost('workshop', 6);

  assert.equal(early.scrap, 25);
  assert.ok(late.scrap > early.scrap * 10, 'level 7 costs an order of magnitude more');
  assert.ok(late.hours > early.hours, 'and takes correspondingly longer');
  assert.equal(upgradeCost('nonsense', 0), null);
});

test('camp strength counts levels and weights defences', () => {
  const quiet = campStrength([{ kind: 'garden', level: 3 }]);
  const fortified = campStrength([
    { kind: 'garden', level: 3 },
    { kind: 'watchtower', level: 1 },
  ]);

  assert.equal(quiet, 3);
  assert.equal(fortified, 12, 'a watchtower is worth far more than its level');
});
