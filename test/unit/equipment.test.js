import test from 'node:test';
import assert from 'node:assert/strict';

import { bestOfKind, equipmentOf } from '../../src/game/equipment.js';

const item = (overrides) => ({ kind: 'weapon', potency: 10, qty: 1, ...overrides });

test('the best of a kind is the highest potency actually carried', () => {
  const inventory = [
    item({ id: 'club', potency: 10 }),
    item({ id: 'spear', potency: 25 }),
    item({ id: 'rifle', potency: 90, qty: 0 }),
    item({ id: 'vest', kind: 'armour', potency: 99 }),
  ];

  // The rifle would win on potency, but a quantity of zero is not a rifle.
  assert.equal(bestOfKind(inventory, 'weapon').id, 'spear');
  assert.equal(bestOfKind(inventory, 'armour').id, 'vest');
  assert.equal(bestOfKind(inventory, 'ration'), null);
});

test('an unarmed survivor is multiplied by exactly one', () => {
  // This is the compatibility guarantee: every outcome that existed before gear did
  // is unchanged, roll for roll, for anyone not carrying any.
  for (const survivor of [{}, { inventory: [] }, { inventory: undefined }, undefined]) {
    const equipment = equipmentOf(survivor);
    assert.equal(equipment.hazardMultiplier, 1);
    assert.equal(equipment.damageMultiplier, 1);
    assert.equal(equipment.weapon, null);
    assert.equal(equipment.armour, null);
  }
});

test('materials are carried, not wielded', () => {
  const equipment = equipmentOf({ inventory: [item({ kind: 'material', potency: 0, qty: 9 })] });

  assert.equal(equipment.weapon, null);
  assert.equal(equipment.hazardMultiplier, 1);
});

test('potency reads as a percentage off', () => {
  const equipment = equipmentOf({
    inventory: [item({ potency: 25 }), item({ kind: 'armour', potency: 30 })],
  });

  assert.equal(equipment.hazardMultiplier, 0.75);
  assert.equal(equipment.damageMultiplier, 0.7);
});

test('no amount of gear makes the Deep Zone safe', () => {
  const overgeared = equipmentOf({
    inventory: [item({ potency: 400 }), item({ kind: 'armour', potency: 400 })],
  });

  assert.equal(overgeared.hazardMultiplier, 0.5, 'hazard avoidance caps at half');
  assert.equal(overgeared.damageMultiplier, 0.4, 'damage reduction caps at 60%');

  // A cursed item cannot make things worse than carrying nothing, either.
  const cursed = equipmentOf({ inventory: [item({ potency: -50 })] });
  assert.equal(cursed.hazardMultiplier, 1);
});
