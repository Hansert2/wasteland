import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpedition } from '../../src/game/expeditions.js';
import { MOMENTS, TURN_BACK, momentsFor } from '../../src/game/moments.js';
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

/**
 * The Deep Zone as the seed knows it: slug and travel hours, which is what placing
 * moments needs and what the two fixtures above deliberately do without.
 */
const MOMENT_REGION = {
  ...DEADLY_REGION,
  slug: 'the_deep_zone',
  travelHours: 18,
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

const SPEAR = { id: 'scrap_spear', kind: 'weapon', potency: 25, qty: 1 };
const VEST = { id: 'plate_vest', kind: 'armour', potency: 30, qty: 1 };

test('gear shifts thresholds without changing what is drawn', () => {
  // The load-bearing property. Gear must never take an extra number out of the
  // generator, or equipping a spear would silently re-roll the loot table too.
  for (let seed = 0; seed < 100; seed++) {
    const bare = resolveExpedition({ region: DEADLY_REGION, survivor: survivor(), seed });
    const geared = resolveExpedition({
      region: DEADLY_REGION,
      survivor: survivor({ inventory: [SPEAR, VEST] }),
      seed,
    });

    assert.deepEqual(geared.loot, bare.loot, 'same haul');
    assert.deepEqual(geared.finds, bare.finds, 'same finds');
    assert.equal(geared.radiation, bare.radiation, 'same dose');
  }
});

test('a weapon keeps trouble at arm’s length; armour absorbs what arrives anyway', () => {
  const totals = (inventory) => {
    let hazards = 0;
    let damage = 0;
    for (let seed = 0; seed < 400; seed++) {
      const outcome = resolveExpedition({
        region: DEADLY_REGION,
        survivor: survivor({ inventory }),
        seed,
      });
      if (outcome.damage > 0) hazards++;
      damage += outcome.damage;
    }
    return { hazards, damage };
  };

  const bare = totals([]);
  const armed = totals([SPEAR]);
  const armoured = totals([VEST]);

  assert.ok(armed.hazards < bare.hazards, 'a spear means fewer fights');
  assert.equal(armoured.hazards, bare.hazards, 'armour does not stop trouble finding you');
  assert.ok(armoured.damage < bare.damage, 'but it does soften it');
});

test('the survivor uses the better of two weapons without being asked', () => {
  const twoSpears = [SPEAR, { ...SPEAR, id: 'sharpened_spear', potency: 45 }];

  let better = 0;
  let worse = 0;
  for (let seed = 0; seed < 300; seed++) {
    if (resolveExpedition({ region: DEADLY_REGION, survivor: survivor({ inventory: twoSpears }), seed }).damage > 0) {
      better++;
    }
    if (resolveExpedition({ region: DEADLY_REGION, survivor: survivor({ inventory: [SPEAR] }), seed }).damage > 0) {
      worse++;
    }
  }

  assert.ok(better < worse, 'there is no equip step because there is no decision to make');
});

test('armour is named in the log when it earns its keep', () => {
  const softened = [];
  for (let seed = 0; seed < 200 && softened.length === 0; seed++) {
    const outcome = resolveExpedition({
      region: DEADLY_REGION,
      survivor: survivor({ inventory: [VEST] }),
      seed,
    });
    if (outcome.damage > 0) softened.push(outcome);
  }

  assert.ok(softened.length > 0, 'expected at least one hazard');
  assert.match(softened[0].log.join(' '), /plate vest took the rest/);
});

test('gear can be the difference between limping home and not coming home', () => {
  const survived = (inventory) => {
    let count = 0;
    for (let seed = 0; seed < 400; seed++) {
      if (!resolveExpedition({ region: DEADLY_REGION, survivor: survivor({ health: 12, inventory }), seed }).died) {
        count++;
      }
    }
    return count;
  };

  assert.ok(survived([SPEAR, VEST]) > survived([]), 'gear buys trips home');
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

test('an outcome comes home naming the moment it came out of', () => {
  // The gap this closes: a player answered a situation, and hours later read a line of
  // narration with nothing tying it back — "they shared a fire and little else" among
  // eight other lines, indistinguishable from the trip happening to them. Signed once
  // per moment, on the first line of its account; the rest are that account continuing.
  let narrated = 0;

  for (let seed = 1; seed <= 60; seed++) {
    const base = { region: MOMENT_REGION, survivor: survivor(), seed };
    const unattended = resolveExpedition(base);

    for (const moment of momentsFor(MOMENT_REGION, seed)) {
      for (const option of moment.options) {
        if (option.verb === 'default' || option.turnBack) continue;

        const attended = resolveExpedition({
          ...base,
          choices: [{ index: moment.index, key: moment.key, option: option.key }],
        });

        const signed = attended.log.filter((line) => line.startsWith(`${moment.title}, `));
        if (attended.log.length === unattended.log.length) {
          assert.equal(signed.length, 0, 'a silent option signs nothing');
          continue;
        }

        assert.equal(signed.length, 1, `${moment.key}/${option.key}: ${JSON.stringify(attended.log)}`);
        assert.match(signed[0], / in\. \S/, 'the signature says when, too');
        narrated += 1;
      }
    }
  }

  assert.ok(narrated > 50, `the sweep actually exercised the signing (${narrated})`);
});

test('a trip nobody answered is never signed', () => {
  // The other half, and the one that would rot quietly: attribution belongs to answers.
  // If an unattended trip ever grew a title, the phase's load-bearing guarantee would
  // already be broken somewhere upstream and this is the cheapest place to notice.
  const titles = Object.values(MOMENTS).map((moment) => moment.title);

  for (let seed = 1; seed <= 60; seed++) {
    const { log } = resolveExpedition({ region: MOMENT_REGION, survivor: survivor(), seed });
    for (const line of log) {
      assert.ok(!titles.some((title) => line.startsWith(`${title}, `)), line);
    }
  }
});

test('a moment early in a short trip is timed in minutes, not in no hours at all', () => {
  // The Service Road is forty-five minutes, so its first moment lands about seven
  // minutes in. Rounded to hours that read "0 hours in", which is both wrong and the
  // kind of wrong that only appears once short regions have moments — which they now do.
  const region = { ...MOMENT_REGION, slug: 'the_service_road', travelHours: 0.75 };

  for (let seed = 1; seed <= 40; seed++) {
    const moments = momentsFor(region, seed);
    if (moments.length === 0) continue;
    const [moment] = moments;

    const { log } = resolveExpedition({
      region,
      survivor: survivor(),
      seed,
      choices: [{ index: moment.index, key: moment.key, option: TURN_BACK.key }],
    });

    const line = log.find((entry) => /turned back/.test(entry));
    assert.ok(line, JSON.stringify(log));
    assert.doesNotMatch(line, /0 hours/, line);
  }
});
