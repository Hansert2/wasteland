import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRUCTURES,
  UPGRADES,
  campDefence,
  campWealth,
  craftHoursMultiplier,
  productionRates,
  radDecayMultiplier,
  storageCap,
  structureEffect,
  upgradeCost,
  upgradeFor,
} from '../../src/game/structures.js';
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

test('every structure can say what it does', () => {
  // The page explains each structure from this, so a new structure without a summary
  // would render a blank line rather than an obvious omission.
  for (const [kind, spec] of Object.entries(STRUCTURES)) {
    assert.ok(spec.summary, `${kind} has no summary`);
    assert.ok(structureEffect(kind, 1), `${kind} does nothing at level 1`);
  }
});

test('the effect described is the effect produced', () => {
  // The description is derived from the same numbers as the rates, so the two cannot
  // drift: if this ever disagrees, one of them is lying to the player.
  // The page rounds; the simulation must not. 1.2 × 3 is 3.5999999999999996, and the
  // player should read "+3.6 food/h" while the tick keeps every digit.
  assert.equal(structureEffect('garden', 3), '+3.6 food/h');
  const rate = productionRates([{ kind: 'garden', level: 3 }]).food;
  assert.ok(Math.abs(rate - 3.6) < 1e-9, `described 3.6, produces ${rate}`);

  assert.equal(structureEffect('shelter', 2), '600 storage');
  assert.equal(storageCap([{ kind: 'shelter', level: 2 }]), 600);

  assert.equal(structureEffect('watchtower', 2), '16 defence');
});

test('an unbuilt structure admits it does nothing', () => {
  assert.equal(structureEffect('garden', 0), '');
  assert.equal(structureEffect('watchtower', 0), '');
  // The shelter is the exception: a camp has storage before it has a shelter.
  assert.equal(structureEffect('shelter', 0), '100 storage');
  assert.equal(structureEffect('nonsense', 3), '');
});

test('every upgrade is fitted to a structure that exists', () => {
  for (const [slug, spec] of Object.entries(UPGRADES)) {
    assert.ok(STRUCTURES[spec.kind], `${slug} is fitted to an unknown structure`);
    assert.ok(spec.summary, `${slug} has no summary`);
    assert.ok(spec.fuel > 0, `${slug} is not priced in fuel`);
    assert.equal(upgradeFor(spec.kind).slug, slug);
  }

  assert.equal(upgradeFor('garden'), null, 'not every structure has a branch yet');
});

test('the fuel track is priced in fuel, which nothing in the camp produces', () => {
  // The whole basis of the second currency: scrap is patience, fuel is danger money.
  // If a structure ever starts producing fuel, this stops being true and the fuel
  // track quietly becomes another scrap track.
  const everything = Object.keys(STRUCTURES).map((kind) => ({ kind, level: 9 }));
  assert.equal(productionRates(everything).fuel, 0);
});

test('upgrades multiply the thing they were bought to change', () => {
  assert.equal(radDecayMultiplier([]), 1, 'a camp without one is unchanged');
  assert.equal(radDecayMultiplier(undefined), 1, 'and so is a camp that has no list');
  assert.equal(radDecayMultiplier(['filtration']), 2.5);
  assert.equal(radDecayMultiplier(['machine_shop']), 1, 'the wrong upgrade does nothing');
  assert.equal(radDecayMultiplier(['nonsense']), 1, 'and neither does one that is not real');

  assert.equal(craftHoursMultiplier(['machine_shop']), 2 / 3);
  assert.ok(craftHoursMultiplier(['machine_shop']) < 1, 'a machine shop makes crafts shorter');
});

test('building defences does not make a camp a richer-looking target', () => {
  // The trap this replaced: one number counted levels and defence together, weighting
  // defence eight per level, so a watchtower quadrupled a starting camp's score. Any
  // raid frequency reading it would have punished the one building meant to help.
  const camp = [
    { kind: 'shelter', level: 1 },
    { kind: 'garden', level: 1 },
    { kind: 'water_purifier', level: 1 },
  ];
  const fortified = [...camp, { kind: 'watchtower', level: 3 }];

  assert.equal(campWealth(fortified), campWealth(camp), 'a watchtower is not loot');
  assert.ok(campDefence(fortified) > campDefence(camp), 'but it does defend');
});

test('wealth is levels plus what is actually in the stores', () => {
  const camp = [{ kind: 'garden', level: 3 }, { kind: 'watchtower', level: 2 }];

  assert.equal(campWealth(camp), 3, 'three levels of garden, and a tower worth nothing');
  assert.equal(campDefence(camp), 16);

  // A full larder is the visible part, and the part that can be carried off — so a
  // raided camp is a less interesting camp next time.
  const stocked = campWealth(camp, { food: { amount: 400 }, scrap: { amount: 200 } });
  assert.equal(stocked, 9);

  assert.equal(campWealth(camp, {}), 3, 'empty stores add nothing');
  assert.equal(campWealth([], undefined), 0, 'and an empty camp is worth nothing at all');
});

test('defence comes from the watchtower and nowhere else', () => {
  assert.equal(campDefence([{ kind: 'shelter', level: 9 }]), 0, 'a big shelter is not a wall');
  assert.equal(campDefence([{ kind: 'watchtower', level: 0 }]), 0, 'unbuilt defends nothing');
  assert.equal(campDefence([{ kind: 'nonsense', level: 4 }]), 0);
});
