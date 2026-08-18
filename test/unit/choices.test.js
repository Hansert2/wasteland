import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpedition } from '../../src/game/expeditions.js';
import { momentsFor } from '../../src/game/moments.js';

/** The Deep Zone as seeded, plus the travel time moments need to be placed in. */
const DEEP_ZONE = {
  slug: 'the_deep_zone',
  name: 'The Deep Zone',
  travelHours: 18,
  danger: 5,
  loot: { scrap: [25, 60], food: [2, 8] },
  finds: [
    { slug: 'rad_x', chance: 0.4, qty: [1, 3] },
    { slug: 'scavenged_parts', chance: 0.55, qty: [2, 3] },
  ],
  radiationPerTrip: 25,
};

const survivor = (overrides = {}) => ({ health: 100, skillScavenging: 1, ...overrides });
const trip = (seed, extra = {}) =>
  resolveExpedition({ region: DEEP_ZONE, survivor: survivor(), seed, ...extra });

const SEEDS = [1, 2, 3, 7, 42, 99, 12345, 65535, 987654321];

/** Every moment on this trip answered with the option that does nothing. */
const allDefaults = (seed) =>
  momentsFor(DEEP_ZONE, seed).map((moment) => ({
    index: moment.index,
    option: moment.options.find((option) => option.verb === 'default').key,
  }));

/** The first moment offering an option with the given field, or null. */
function find(seed, field) {
  for (const moment of momentsFor(DEEP_ZONE, seed)) {
    const option = moment.options.find((candidate) => candidate[field] !== undefined);
    if (option) return { index: moment.index, option: option.key, moment, spec: option };
  }
  return null;
}

test('a trip nobody attended is the trip that would have happened anyway', () => {
  // The load-bearing guarantee of the whole phase, stated three ways: no choices at
  // all, an empty list, and every moment answered with its default must all be the
  // same trip — every field, not merely the totals.
  for (const seed of SEEDS) {
    const untouched = trip(seed);

    assert.deepStrictEqual(trip(seed, { choices: [] }), untouched, `seed ${seed}: empty`);
    assert.deepStrictEqual(
      trip(seed, { choices: allDefaults(seed) }),
      untouched,
      `seed ${seed}: defaults`,
    );
  }
});

test('answering does not disturb what the trip had already rolled', () => {
  // Consequences draw from their own stream. If they ever drew from the outcome's
  // generator, the loot would shift under a choice that has nothing to do with loot.
  for (const seed of SEEDS) {
    const untouched = trip(seed);
    const eaten = find(seed, 'heals');
    if (!eaten) continue;

    const after = trip(seed, { choices: [{ index: eaten.index, option: eaten.option }] });

    assert.deepStrictEqual(after.loot, untouched.loot, `seed ${seed}: loot`);
    assert.equal(after.radiation, untouched.radiation, `seed ${seed}: radiation`);
    assert.equal(after.damage, untouched.damage, `seed ${seed}: damage`);
    assert.ok(after.healed > 0, `seed ${seed}: and the ration did something`);
  }
});

test('an answer to a moment that does not exist is ignored', () => {
  for (const seed of SEEDS) {
    const untouched = trip(seed);

    for (const choices of [
      [{ index: 99, option: 'eat' }],
      [{ index: 0, option: 'no_such_option' }],
      [{ index: -1, option: 'eat' }],
    ]) {
      assert.deepStrictEqual(trip(seed, { choices }), untouched, `seed ${seed}`);
    }
  }
});

test('answers are applied in the order the hours happened, not the order they arrived', () => {
  for (const seed of SEEDS) {
    const choices = momentsFor(DEEP_ZONE, seed).map((moment) => ({
      index: moment.index,
      option: moment.options[moment.options.length - 1].key,
    }));
    if (choices.length < 2) continue;

    assert.deepStrictEqual(
      trip(seed, { choices: [...choices].reverse() }),
      trip(seed, { choices }),
      `seed ${seed}`,
    );
  }
});

test('turning back brings home what they were carrying and no more', () => {
  for (const seed of SEEDS) {
    const whole = trip(seed);
    const moments = momentsFor(DEEP_ZONE, seed);
    if (moments.length === 0) continue;

    const bailed = trip(seed, { choices: [{ index: 0, option: 'turn_back' }] });

    for (const [kind, amount] of Object.entries(bailed.loot)) {
      assert.ok(amount <= whole.loot[kind], `seed ${seed}: ${kind} not more than the full trip`);
    }
    assert.ok(bailed.radiation <= whole.radiation, `seed ${seed}: radiation`);
    assert.ok(bailed.finds.length <= whole.finds.length, `seed ${seed}: finds`);
  }
});

test('turning back at the first moment is worse than finishing, or the verb dominates', () => {
  // The bug the walk home exists to kill, checked from the other side: bailing early
  // must actually cost a haul, or "turn back" is simply the best move every time.
  let poorer = 0;

  for (const seed of SEEDS) {
    const whole = trip(seed);
    const bailed = trip(seed, { choices: [{ index: 0, option: 'turn_back' }] });

    const total = (loot) => Object.values(loot).reduce((sum, value) => sum + value, 0);
    if (total(bailed.loot) < total(whole.loot)) poorer += 1;
  }

  assert.equal(poorer, SEEDS.length, 'bailing at the first moment always costs loot');
});

test('pressing on adds to the haul without touching anything else', () => {
  const region = { ...DEEP_ZONE, slug: 'coastal_wreckage', travelHours: 12 };
  const args = { region, survivor: survivor(), seed: 4 };

  const overload = momentsFor(region, 4)
    .map((moment) => ({ moment, option: moment.options.find((o) => o.lootFactor > 1) }))
    .find((candidate) => candidate.option);

  if (!overload) return; // this seed offered no press-on moment

  const before = resolveExpedition(args);
  const after = resolveExpedition({
    ...args,
    choices: [{ index: overload.moment.index, option: overload.option.key }],
  });

  const total = (loot) => Object.values(loot).reduce((sum, value) => sum + value, 0);
  assert.ok(total(after.loot) > total(before.loot), 'the haul grew');
  assert.equal(after.radiation, before.radiation, 'and the dose did not');
});

test('confronting something can only kill a survivor already in trouble', () => {
  // Lethality by disclosure, checked against the simulation rather than the label: at
  // full health the worst an option can do must not reach them, so no amount of
  // answering badly turns a healthy trip into a fatal one.
  for (const seed of SEEDS) {
    const confront = find(seed, 'hazard');
    if (!confront) continue;

    const choices = [{ index: confront.index, option: confront.option }];
    const healthy = resolveExpedition({
      region: DEEP_ZONE,
      survivor: survivor({ health: 100 }),
      seed,
      choices,
    });

    assert.equal(healthy.died, false, `seed ${seed}: a healthy survivor came home`);
  }
});

test('a chosen risk still reads as damage in the log and the number', () => {
  for (const seed of SEEDS) {
    const confront = find(seed, 'hazard');
    if (!confront) continue;

    const choices = [{ index: confront.index, option: confront.option }];
    const before = trip(seed);
    const after = trip(seed, { choices });

    assert.ok(
      after.damage !== before.damage || after.log.length > before.log.length,
      `seed ${seed}: confronting something is not silent`,
    );
  }
});

test('standing decides a parley, and hostility costs', () => {
  for (const seed of SEEDS) {
    const hail = find(seed, 'parley');
    if (!hail) continue;

    const choices = [{ index: hail.index, option: hail.option }];
    const total = (loot) => Object.values(loot).reduce((sum, value) => sum + value, 0);

    const trusted = total(trip(seed, { choices, standings: { junction_crews: 90, green_river: 90 } }).loot);
    const strangers = total(trip(seed, { choices, standings: {} }).loot);
    const hated = total(trip(seed, { choices, standings: { junction_crews: -90, green_river: -90 } }).loot);

    assert.ok(trusted >= strangers, `seed ${seed}: friends do better than strangers`);
    assert.ok(hated <= strangers, `seed ${seed}: enemies do worse`);
  }
});

test('the same answers always produce the same trip', () => {
  for (const seed of SEEDS) {
    const choices = momentsFor(DEEP_ZONE, seed).map((moment) => ({
      index: moment.index,
      option: moment.options[moment.options.length - 1].key,
    }));

    assert.deepStrictEqual(trip(seed, { choices }), trip(seed, { choices }), `seed ${seed}`);
  }
});

test('a region with no moments cannot be answered at all', () => {
  const fence = { ...DEEP_ZONE, slug: 'the_fence_line', travelHours: 0.17 };
  const args = { region: fence, survivor: survivor(), seed: 9 };

  assert.deepStrictEqual(
    resolveExpedition({ ...args, choices: [{ index: 0, option: 'turn_back' }] }),
    resolveExpedition(args),
  );
});
