import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STRUCTURES,
  UPGRADES,
  campDefence,
  campWealth,
  craftHoursMultiplier,
  fittingsAllowed,
  levelForFitting,
  productionRates,
  radDecayMultiplier,
  storageCap,
  structureEffect,
  upgradeCost,
  upgradesFor,
} from '../../src/game/structures.js';
import { CONFIG } from '../../src/game/constants.js';

test('production scales with level and lands on the right resource', () => {
  const rates = productionRates([
    { kind: 'garden', level: 2 },
    { kind: 'water_purifier', level: 1 },
    { kind: 'workshop', level: 3 },
  ]);

  assert.equal(rates.food, STRUCTURES.garden.perLevel * 2);
  assert.equal(rates.water, STRUCTURES.water_purifier.perLevel);
  assert.equal(rates.scrap, STRUCTURES.workshop.perLevel * 3);
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
  assert.equal(storageCap([]), 100, 'a camp with no shelter still has somewhere to put things');
  assert.equal(
    storageCap([{ kind: 'shelter', level: 2 }]),
    100 + STRUCTURES.shelter.storagePerLevel * 2,
  );
});

test('the build curve runs from seconds to days', () => {
  // The whole span, asserted at three points rather than pinned to magic numbers.
  // This opened at four hours for a first garden, which meant a new player's first
  // move was to wait half a working day — and it still has to reach the long tail
  // that makes an Ogame-style game an Ogame-style game.
  const first = upgradeCost('garden', 0);
  assert.ok(first.hours * 3600 < 60, `a first garden takes ${first.hours * 3600}s`);
  assert.ok(first.scrap <= 10, 'and is affordable from what a new camp is given');

  // Halving output per level doubled the level count, so these milestones sit twice
  // as deep as they used to. The span is the point, not where it is indexed.
  const middling = upgradeCost('garden', 16);
  assert.ok(middling.hours > 1 && middling.hours < 24, `level 17 takes ${middling.hours}h`);

  const late = upgradeCost('garden', 26);
  assert.ok(late.hours > 48, `level 27 takes ${(late.hours / 24).toFixed(1)} days`);
  assert.ok(late.scrap > first.scrap * 100, 'with a cost to match');

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
  // The page rounds; the simulation must not. Six tenths times seven is
  // 4.199999999999999, and the player should read "+4.2 food/h" while the tick keeps
  // every digit of it.
  const level = 7;
  const expected = STRUCTURES.garden.perLevel * level;
  assert.equal(structureEffect('garden', level), `+${Math.round(expected * 10) / 10} food/h`);
  const rate = productionRates([{ kind: 'garden', level }]).food;
  assert.ok(Math.abs(rate - expected) < 1e-9, `described ${expected}, produces ${rate}`);

  const shelterCap = 100 + STRUCTURES.shelter.storagePerLevel * 2;
  assert.equal(structureEffect('shelter', 2), `${shelterCap} storage`);
  assert.equal(storageCap([{ kind: 'shelter', level: 2 }]), shelterCap);

  assert.equal(
    structureEffect('watchtower', 2),
    `${STRUCTURES.watchtower.defencePerLevel * 2} defence`,
  );
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

    /*
     * Priced in exactly one currency, and which one says what the fitting is.
     *
     * Fuel buys a capability and scrap buys structure. Every instrument is fuel — a clock, a
     * glass, a radio — and a bed is scrap, because it is a thing built into a shelter rather
     * than an instrument bolted to one. This used to read `spec.fuel > 0` for everything,
     * which was the rule and the only fitting in one line; the bed is what separated them.
     *
     * Exactly one, because a fitting priced in both would be a structure level wearing a
     * fitting's clothes, and the two tracks stop meaning different things.
     */
    const priced = ['fuel', 'scrap'].filter((kind) => (spec[kind] ?? 0) > 0);
    assert.equal(priced.length, 1, `${slug} is priced in ${priced.join(' and ') || 'nothing'}`);

    // And a repeatable fitting says how its ceiling is reached; a once-only one has none.
    if (spec.repeats) {
      assert.ok(spec.perLevels > 0, `${slug} repeats but nothing caps it`);
    } else {
      assert.equal(spec.perLevels, undefined, `${slug} does not repeat and needs no ceiling`);
    }
    assert.ok(
      upgradesFor(spec.kind).some((branch) => branch.slug === slug),
      `${slug} is not offered by the structure it is fitted to`,
    );
  }

  // A list rather than one branch, because the watchtower is about to have two. What
  // stays true is that a structure with no fuel branch offers nothing rather than null.
  assert.deepEqual(upgradesFor('garden'), [], 'not every structure has a branch yet');
  assert.deepEqual(upgradesFor('nonsense'), [], 'and an unknown one is not an error');
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
  const camp = [{ kind: 'garden', level: 4 }, { kind: 'watchtower', level: 2 }];

  // Half a point a level, so wealth stayed on its old scale when levels doubled —
  // otherwise every camp would have looked twice as rich to raiders overnight.
  assert.equal(campWealth(camp), 2, 'four levels of garden, and a tower worth nothing');
  assert.equal(campDefence(camp), STRUCTURES.watchtower.defencePerLevel * 2);

  // A full larder is the visible part, and the part that can be carried off — so a
  // raided camp is a less interesting camp next time.
  const stocked = campWealth(camp, { food: { amount: 400 }, scrap: { amount: 200 } });
  assert.equal(stocked, 8, 'six hundred in the stores is six more points of interest');

  assert.equal(campWealth(camp, {}), 2, 'empty stores add nothing');
  assert.equal(campWealth([], undefined), 0, 'and an empty camp is worth nothing at all');
});

test('defence comes from the watchtower and nowhere else', () => {
  assert.equal(campDefence([{ kind: 'shelter', level: 9 }]), 0, 'a big shelter is not a wall');
  assert.equal(campDefence([{ kind: 'watchtower', level: 0 }]), 0, 'unbuilt defends nothing');
  assert.equal(campDefence([{ kind: 'nonsense', level: 4 }]), 0);
});

test('the level that buys the next fitting is the level that allows it', () => {
  /*
   * Two functions asking the same question from opposite ends, so they are checked against
   * each other rather than against a table of numbers somebody typed twice.
   *
   * The one this exists for is the bed's even-numbered step. A shelter at 4 holds two beds
   * and a shelter at 5 holds two beds, so a full bed row that says only "fitted" sits beside
   * a level track offering a level that buys no bed at all — which is how a player ends up
   * buying storage they did not want. `levelForFitting` is what lets the row name 6.
   */
  for (let n = 1; n <= 5; n += 1) {
    const level = levelForFitting('bed', n);
    assert.ok(level >= UPGRADES.bed.requiresLevel, 'never below the level the fitting needs');
    assert.ok(fittingsAllowed('bed', level) >= n, `shelter ${level} holds ${n} beds`);
    assert.ok(fittingsAllowed('bed', level - 1) < n, `and shelter ${level - 1} does not`);
  }

  assert.equal(levelForFitting('bed', 3), 6, 'the third bed is the one the shelter step hides');

  // An instrument has one level and no next: a second clock tells the same hour, and the
  // row that would name a level for it must be given nothing to say.
  assert.equal(levelForFitting('clock', 1), UPGRADES.clock.requiresLevel);
  assert.equal(levelForFitting('clock', 2), null, 'there is no level that buys a second clock');
  assert.equal(levelForFitting('nonsense', 1), null);
});
