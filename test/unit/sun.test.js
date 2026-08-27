import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveExpedition } from '../../src/game/expeditions.js';
import { sunAt, travelFactors } from '../../src/game/daylight.js';
import { WORLD_EVENTS } from '../../src/game/world-events.js';
import { ORDINARY } from '../../src/game/wanderers.js';

/**
 * What the hour of departure does to a trip, once the sun is wired into resolution.
 *
 * The two modules either side of this have their own files: `daylight.test.js` for the
 * clock and `temperature.test.js` for what the hour is worth. This is the join — the
 * factors reaching an actual expedition, and the one region that must not feel them.
 */

const HOUR = 60 * 60 * 1000;
const midnight = (y, m, d) => Date.UTC(y, m, d);
const event = (kind, from, to) => ({ slot: 1, kind, startsAt: from, endsAt: to });

const survivor = () => ({ health: 100, skillScavenging: ORDINARY });

/** The Deep Zone's shape: a rich find table and a heavy dose, so both levers are live. */
const DEEP = {
  name: 'The Deep Zone',
  danger: 5,
  loot: { scrap: [25, 60], fuel: [10, 25] },
  finds: [
    { slug: 'rad_x', chance: 0.4, qty: [1, 2] },
    { slug: 'scavenged_parts', chance: 0.55, qty: [2, 3] },
  ],
  radiationPerTrip: 25,
};

/** The Fence Line's shape: ten minutes, nothing to find, nothing to catch. */
const FENCE = {
  name: 'The Fence Line',
  danger: 1,
  loot: { scrap: [2, 6], food: [0, 2] },
  finds: [],
  radiationPerTrip: 0,
};

/** A day well inside the calendar, and the two windows either side of its sunset. */
const DAY = midnight(2026, 5, 14);
const { sunrise, sunset } = sunAt(DAY);

const inTheSun = [DAY + (sunrise + 1) * HOUR, DAY + (sunrise + 5) * HOUR];
const inTheDark = [DAY + 0.5 * HOUR, DAY + 4.5 * HOUR];
const halfAndHalf = [DAY + (sunset - 2) * HOUR, DAY + (sunset + 2) * HOUR];

test('The Fence Line cannot tell what time it is', () => {
  // The reason daylight pays in finds rather than in bulk loot, asserted on the region
  // that forced the decision. Ten minutes to the wire with `finds: []` and no dose: it is
  // already about seven times the scrap-per-hour of any long region, and under a loot
  // multiplier it would have taken the whole upside of this phase and paid nothing for
  // it. There is no exception written anywhere — it falls out of the region having
  // neither lever.
  const day = resolveExpedition({
    region: FENCE,
    survivor: survivor(),
    seed: 4242,
    weather: travelFactors([], ...inTheSun),
  });
  const night = resolveExpedition({
    region: FENCE,
    survivor: survivor(),
    seed: 4242,
    weather: travelFactors([], ...inTheDark),
  });

  assert.deepEqual(day.loot, night.loot, 'the haul is the same at any hour');
  assert.deepEqual(day.finds, night.finds, 'and so is what turned up');
  assert.equal(day.radiation, night.radiation, 'and the counter never moves');
  assert.deepEqual(day.log, night.log, 'the trip is the same trip, word for word');
});

test('a trip with as much light as dark rolls what it always rolled', () => {
  // The compatibility guarantee at the point it actually matters: not a claim about the
  // factors, but about an expedition. Half and half must be indistinguishable from a game
  // with no sun in it at all.
  const withSun = resolveExpedition({
    region: DEEP,
    survivor: survivor(),
    seed: 909,
    weather: travelFactors([], ...halfAndHalf),
  });
  const without = resolveExpedition({ region: DEEP, survivor: survivor(), seed: 909 });

  assert.deepEqual(withSun.log, without.log, 'roll for roll, not merely in total');
  assert.equal(withSun.radiation, without.radiation);
  assert.deepEqual(withSun.loot, without.loot);
});

test('the dark is cheaper on the counter and thinner on what turns up', () => {
  // The trade, over enough seeds that it is the mechanic being measured and not one roll.
  let sunDose = 0;
  let darkDose = 0;
  let sunFinds = 0;
  let darkFinds = 0;

  for (let seed = 0; seed < 400; seed += 1) {
    const day = resolveExpedition({
      region: DEEP,
      survivor: survivor(),
      seed,
      weather: travelFactors([], ...inTheSun),
    });
    const night = resolveExpedition({
      region: DEEP,
      survivor: survivor(),
      seed,
      weather: travelFactors([], ...inTheDark),
    });

    sunDose += day.radiation;
    darkDose += night.radiation;
    sunFinds += day.finds.length;
    darkFinds += night.finds.length;
  }

  assert.ok(darkDose < sunDose, `the dark should dose less: ${darkDose} vs ${sunDose}`);
  assert.ok(darkFinds < sunFinds, `and turn up less: ${darkFinds} vs ${sunFinds}`);

  // Both directions have to be worth having, or one of them is not a choice. The dose
  // saved is the survivor's bench time, which is the currency this phase trades in.
  assert.ok(sunDose / darkDose > 1.2, 'the dose gap is worth crossing the day for');
  assert.ok(sunFinds / darkFinds > 1.2, 'and so is the find gap');
});

test('bulk loot belongs to the sky alone, at every hour', () => {
  // Daylight moves finds and dose and nothing else. If this ever fails, the Fence Line
  // has quietly been handed a multiplier again.
  for (const window of [inTheSun, inTheDark, halfAndHalf]) {
    assert.equal(travelFactors([], ...window).loot, 1, 'a clear sky pays scale on nothing');
  }

  const stormy = travelFactors(
    [event('caravan', DAY - HOUR, DAY + 48 * HOUR)],
    ...inTheDark,
  );
  assert.equal(stormy.loot, WORLD_EVENTS.caravan.loot, 'and the sky keeps its own lever');
});

test('the sky and the sun compose on the dose rather than one replacing the other', () => {
  // A daylight trip under a rad storm is dearer than either alone, which is both what the
  // fiction says and what two independent scalings mean.
  const storm = [event('rad_storm', DAY - HOUR, DAY + 48 * HOUR)];

  const clearDay = travelFactors([], ...inTheSun).radiation;
  const stormyHalf = travelFactors(storm, ...halfAndHalf).radiation;
  const stormyDay = travelFactors(storm, ...inTheSun).radiation;

  assert.ok(clearDay > 1, 'daylight alone costs something');
  assert.ok(stormyHalf > clearDay, 'and a storm alone costs more');
  assert.ok(stormyDay > stormyHalf, 'and the two together cost more than the storm did');
});

test('a find is a probability, so the sun cannot push one past certain', () => {
  // Nothing in the seed data is near the ceiling — `scavenged_parts` at 0.55 against a
  // find factor that tops out at 1.65 — but a chance above one is a bug that would show
  // up as a find that never misses rather than as an error.
  const certain = {
    ...DEEP,
    finds: [{ slug: 'rad_x', chance: 1, qty: [1, 1] }],
  };

  for (let seed = 0; seed < 50; seed += 1) {
    const trip = resolveExpedition({
      region: certain,
      survivor: survivor(),
      seed,
      weather: travelFactors([], ...inTheSun),
    });
    assert.equal(trip.finds.length, 1, 'clamped to certain, not beyond it');
  }
});
