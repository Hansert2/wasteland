import test from 'node:test';
import assert from 'node:assert/strict';

import {
  KF_RANGE,
  KR_RANGE,
  climateAt,
  coefficientsAt,
  daylightFraction,
  sunAt,
  sunFactors,
  temperatureAt,
} from '../../src/game/daylight.js';
import { WORLD_EVENTS } from '../../src/game/world-events.js';

/**
 * The other half of `daylight.js`: not what time it is, but what the hour is worth.
 *
 * `test/unit/daylight.test.js` covers the clock, the seasons and `d`. This covers the one
 * mechanical job temperature has — setting how much `d` matters — and the factors that
 * come out of it.
 */

const HOUR = 60 * 60 * 1000;
const midnight = (y, m, d) => Date.UTC(y, m, d);
const event = (kind, from, to) => ({ slot: 1, kind, startsAt: from, endsAt: to });

const close = (actual, expected, what, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tol, `${what}: ${actual} !== ${expected}`);

test('the year is warm in summer and cold in winter, and the sky moves it', () => {
  close(climateAt(midnight(2026, 5, 21), []), 33, 'midsummer', 0.1);
  close(climateAt(midnight(2025, 11, 21), []), 7, 'midwinter', 0.1);

  // Warmth is added, not multiplied: a storm over a rain is warmer than the rain and
  // cooler than the storm, which only a sum can say.
  const day = midnight(2026, 2, 21);
  const clear = climateAt(day, []);
  const storm = climateAt(day, [event('rad_storm', 0, 1)]);
  const rain = climateAt(day, [event('hard_rain', 0, 1)]);
  const both = climateAt(day, [event('rad_storm', 0, 1), event('hard_rain', 0, 1)]);

  close(storm - clear, WORLD_EVENTS.rad_storm.warmth, 'a storm is hot');
  close(rain - clear, WORLD_EVENTS.hard_rain.warmth, 'rain is cold');
  close(both, clear + WORLD_EVENTS.rad_storm.warmth + WORLD_EVENTS.hard_rain.warmth, 'summed');
  assert.ok(both > rain && both < storm, 'and a storm over rain sits between the two');
});

test('the climate does not know what hour it is, and the thermometer does', () => {
  // The one that would be a double count. `Kr` scales the swing between day and night, so
  // feeding the current point on that swing back in as its input would make a trip's
  // factor depend on when the player happened to look at the page.
  const day = midnight(2026, 5, 14);
  const dawn = day + 4 * HOUR;
  const afternoon = day + 15 * HOUR;

  close(climateAt(dawn, []), climateAt(afternoon, []), 'the climate held still', 0.02);
  assert.ok(
    temperatureAt(afternoon, []) > temperatureAt(dawn, []) + 10,
    'but the afternoon is much hotter than before dawn',
  );
});

test('the coefficients stay inside their bands at every hour of a full year', () => {
  // The seasonal hazard, pinned: a year-long term means a suite that passes in August can
  // fail in January on a day nobody deployed. Read against every sky the world can throw,
  // including all the warm ones at once, which is what would push past a measured range
  // if the clamp were not there.
  const warmSkies = Object.keys(WORLD_EVENTS)
    .filter((kind) => (WORLD_EVENTS[kind].warmth ?? 0) > 0)
    .map((kind) => event(kind, 0, 1));
  const coldSkies = Object.keys(WORLD_EVENTS)
    .filter((kind) => (WORLD_EVENTS[kind].warmth ?? 0) < 0)
    .map((kind) => event(kind, 0, 1));

  assert.ok(warmSkies.length > 1 && coldSkies.length > 0, 'the sky can stack either way');

  for (let hour = 0; hour < 366 * 24; hour += 1) {
    const when = midnight(2026, 0, 1) + hour * HOUR;

    for (const sky of [[], warmSkies, coldSkies]) {
      const { radiation, finds } = coefficientsAt(climateAt(when, sky));

      assert.ok(
        radiation >= KR_RANGE[0] && radiation <= KR_RANGE[1],
        `Kr ${radiation} outside its band at hour ${hour}`,
      );
      assert.ok(
        finds >= KF_RANGE[0] && finds <= KF_RANGE[1],
        `Kf ${finds} outside its band at hour ${hour}`,
      );
    }
  }
});

test('a trip with as much light as dark is multiplied by exactly one', () => {
  // The compatibility guarantee, and note what it is *not*: a full twenty-four hours is
  // neutral only at the equinox, because a summer day is fifteen hours of light against
  // nine of dark. What is centred is `d`, not the clock.
  const day = midnight(2026, 5, 14);
  const { sunset } = sunAt(day);

  const from = day + (sunset - 3) * HOUR;
  const to = day + (sunset + 3) * HOUR;
  close(daylightFraction(from, to), 0.5, 'half and half by construction');

  const { radiation, finds } = sunFactors([], from, to);
  close(radiation, 1, 'the dose is untouched');
  close(finds, 1, 'and so is what turns up');
});

test('daylight costs on the counter and pays in what turns up', () => {
  const day = midnight(2026, 5, 14);
  const { sunrise } = sunAt(day);

  const lit = sunFactors([], day + (sunrise + 1) * HOUR, day + (sunrise + 5) * HOUR);
  const dark = sunFactors([], day + 1 * HOUR, day + 3 * HOUR);

  assert.ok(lit.radiation > 1, 'the sun doses harder');
  assert.ok(lit.finds > 1, 'and turns more up');
  assert.ok(dark.radiation < 1, 'the dark is kinder on the counter');
  assert.ok(dark.finds < 1, 'and thinner on what is found');

  // Symmetric about one: whatever the day adds, the night takes off.
  close(lit.radiation + dark.radiation, 2, 'dose is centred', 0.01);
  close(lit.finds + dark.finds, 2, 'finds are centred', 0.01);
});

test('a hot sky widens the gap between day and night, and a wet one narrows it', () => {
  // Temperature's entire mechanical job, asserted. Same hours, same season, different sky.
  const day = midnight(2026, 2, 21);
  const { sunrise } = sunAt(day);
  const from = day + (sunrise + 1) * HOUR;
  const to = day + (sunrise + 5) * HOUR;

  const clear = sunFactors([], from, to);
  const hot = sunFactors([event('rad_storm', from - HOUR, to + HOUR)], from, to);
  const wet = sunFactors([event('hard_rain', from - HOUR, to + HOUR)], from, to);

  assert.ok(hot.radiation > clear.radiation, 'heat makes the daylight dearer');
  assert.ok(wet.radiation < clear.radiation, 'and cloud makes it matter less');
  assert.ok(hot.finds > clear.finds && wet.finds < clear.finds, 'the same on both levers');
});

test('the factors are integrated piecewise, not formed from two averages', () => {
  // A trip whose weather turns halfway. Taking the trip's mean `d` and its mean climate
  // and combining them once would misattribute a hot spell that fell entirely in the
  // dark, so the walk has to cut where the sky does.
  const day = midnight(2026, 2, 21);
  const { sunrise } = sunAt(day);

  // Four hours: two before sunrise under a storm, two after it in the clear.
  const from = day + (sunrise - 2) * HOUR;
  const to = day + (sunrise + 2) * HOUR;
  const stormInTheDark = [event('rad_storm', from, day + sunrise * HOUR)];

  const clear = sunFactors([], from, to);
  close(clear.radiation, 1, 'clear and half-and-half is neutral', 0.02);

  // The storm sat entirely in the dark, so it deepens the discount those hours already
  // had rather than lifting the trip. A product of two averages would have raised it.
  const piecewise = sunFactors(stormInTheDark, from, to);
  assert.ok(
    piecewise.radiation < clear.radiation,
    `a storm confined to the dark hours must not raise the trip: ${piecewise.radiation}`,
  );
});

test('an empty window and a missing bound behave like the rest of the module', () => {
  assert.deepEqual(sunFactors([], 1000, 1000), { radiation: 1, finds: 1 });
  assert.throws(() => sunFactors([], undefined, 1000), TypeError);
  assert.throws(() => climateAt(NaN, []), TypeError);
  assert.throws(() => temperatureAt(undefined, []), TypeError);
});
