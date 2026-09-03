import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BANDS,
  saysBand,
  bandAt,
  daylightFraction,
  daylightHoursAt,
  hourAt,
  isLit,
  nextBandChange,
  splitOf,
  sunAt,
  worldTimeAt,
} from '../../src/game/daylight.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A world day well inside the calendar, at midnight. */
const midnight = (y, m, d) => Date.UTC(y, m, d);
const at = (y, m, d, h) => Date.UTC(y, m, d) + h * HOUR;

const close = (actual, expected, what, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tol, `${what}: ${actual} !== ${expected}`);

test('the world hour is arithmetic on the instant, not a reading of the machine', () => {
  // The load-bearing property: two players' machines cannot disagree about what o'clock
  // it is in the world, whatever they have their own clocks set to. Computed from the
  // epoch rather than through Date's local getters, so there is nothing to disagree with.
  close(hourAt(midnight(2026, 5, 14)), 0, 'midnight');
  close(hourAt(at(2026, 5, 14, 13.5)), 13.5, 'half past one');
  close(hourAt(at(2026, 5, 14, 23.999)), 23.999, 'just before midnight');

  const time = worldTimeAt(at(2026, 5, 14, 13.5));
  assert.equal(time.hour, 13);
  assert.equal(time.minute, 30);
});

test('the day is longest at midsummer and shortest at midwinter', () => {
  // Nine hours to fifteen. The swing is wide on purpose: a season that moved the daylight
  // by an hour would move nothing anybody could plan around.
  const winter = daylightHoursAt(midnight(2025, 11, 21));
  const summer = daylightHoursAt(midnight(2026, 5, 21));

  close(winter, 9, 'the shortest day', 0.02);
  close(summer, 15, 'the longest day', 0.02);

  // And the equinoxes sit in the middle of the two.
  close(daylightHoursAt(midnight(2026, 2, 21)), 12, 'the spring equinox', 0.15);
  close(daylightHoursAt(midnight(2026, 8, 22)), 12, 'the autumn equinox', 0.15);
});

test('the daylight window never crosses midnight, at any point in the year', () => {
  // Everything downstream reads "lit" as a single interval inside one day. The widest the
  // day ever gets is fifteen hours, which is what keeps that true — and a later balance
  // pass widening the swing is exactly what would break it, silently.
  for (let day = 0; day < 366; day += 1) {
    const when = midnight(2026, 0, 1) + day * DAY;
    const { sunrise, sunset } = sunAt(when);

    assert.ok(sunrise > 0, `sunrise before midnight on day ${day}: ${sunrise}`);
    assert.ok(sunset < 24, `sunset after midnight on day ${day}: ${sunset}`);
    assert.ok(sunrise < sunset, `the sun sets before it rises on day ${day}`);
  }
});

test('sunrise and sunset are symmetric about solar noon', () => {
  for (const day of [0, 90, 180, 270]) {
    const when = midnight(2026, 0, 1) + day * DAY;
    const { sunrise, sunset, hours } = sunAt(when);

    close((sunrise + sunset) / 2, 12, 'noon is the middle of the day');
    close(sunset - sunrise, hours, 'the span is the stated length');
  }
});

test('the five bands cover the whole day, with no gap and no overlap', () => {
  // Read minute by minute across a summer day and a winter one, because the boundaries
  // are fractions of a daylight span that changes: a set of bands that tiles at the
  // equinox can leave a hole at the solstice.
  for (const start of [midnight(2026, 5, 21), midnight(2025, 11, 21)]) {
    const seen = [];
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const band = bandAt(start + minute * 60_000);
      assert.ok(BANDS.includes(band), `${band} is not one of the five`);
      if (band !== seen[seen.length - 1]) seen.push(band);
    }

    // Night wraps midnight, so it is allowed to bookend the list. Everything between must
    // run in order and appear once.
    const middle = seen[0] === 'night' ? seen.slice(1) : seen;
    const run = middle[middle.length - 1] === 'night' ? middle.slice(0, -1) : middle;

    assert.deepEqual(
      run,
      ['before dawn', 'morning', 'the heat of the day', 'evening'],
      `the day did not run through its bands in order: ${seen.join(' -> ')}`,
    );
  }
});

test('a band agrees with whether the sun is actually up', () => {
  const day = midnight(2026, 5, 14);
  const { sunrise, sunset } = sunAt(day);

  assert.equal(isLit(day + (sunrise + 0.01) * HOUR), true, 'just after sunrise');
  assert.equal(isLit(day + (sunrise - 0.01) * HOUR), false, 'just before it');
  assert.equal(isLit(day + (sunset - 0.01) * HOUR), true, 'just before sunset');
  assert.equal(isLit(day + (sunset + 0.01) * HOUR), false, 'just after it');

  assert.equal(bandAt(day + (sunrise - 0.5) * HOUR), 'before dawn');
  assert.equal(bandAt(day + (sunrise + 0.5) * HOUR), 'morning');
});

test('the daylight fraction is measured across the window, not read off an end', () => {
  // The whole reason this is an integral. A trip that is mostly in the sun and happens to
  // arrive after dark is a daylight trip, and under a reading taken at the return it
  // would have been the opposite — which would make "always arrive at 2am" beat choosing
  // a destination.
  const day = midnight(2026, 2, 21);
  const { sunrise, sunset } = sunAt(day);

  // Wholly inside the lit window.
  close(daylightFraction(day + (sunrise + 1) * HOUR, day + (sunrise + 4) * HOUR), 1, 'noon');

  // Wholly inside the dark.
  close(daylightFraction(day + 1 * HOUR, day + 3 * HOUR), 0, 'small hours');

  // Straddling sunset: two hours of light, then two of dark.
  const straddle = daylightFraction(day + (sunset - 2) * HOUR, day + (sunset + 2) * HOUR);
  close(straddle, 0.5, 'half in, half out');

  // Nine-tenths lit and landing after dark is still a daylight trip.
  const mostly = daylightFraction(day + (sunset - 9) * HOUR, day + (sunset + 1) * HOUR);
  close(mostly, 0.9, 'nine hours of ten');
});

test('a trip longer than a day averages towards the day it spans', () => {
  // The reach result, asserted rather than described: past twenty-four hours a trip
  // collects a whole day's light whenever it leaves, so the hour it departs stops being
  // a decision. Harrow End is the one region this is true of.
  const day = midnight(2026, 2, 21);
  const lit = daylightHoursAt(day);

  const spans = [];
  for (let hour = 0; hour < 24; hour += 1) {
    spans.push(daylightFraction(day + hour * HOUR, day + (hour + 26) * HOUR));
  }

  const lowest = Math.min(...spans);
  const highest = Math.max(...spans);

  assert.ok(highest - lowest < 0.1, `26h still swings ${(highest - lowest).toFixed(3)}`);
  close((lowest + highest) / 2, lit / 24, 'and it centres on the day itself', 0.02);

  // Against a nine-hour trip on the same day, which has the whole range available.
  const short = [];
  for (let hour = 0; hour < 24; hour += 1) {
    short.push(daylightFraction(day + hour * HOUR, day + (hour + 9) * HOUR));
  }
  close(Math.min(...short), 0, 'a nine-hour trip can be sent wholly into the dark');
  close(Math.max(...short), 1, 'and wholly into the sun');
});

test('an empty window scales nothing', () => {
  // 0.5 is the neutral value: the factors are centred there, so a zero-length trip is
  // multiplied by one. The same choice `integrateFactors` makes for the same reason.
  close(daylightFraction(1000, 1000), 0.5, 'zero length');
  close(daylightFraction(2000, 1000), 0.5, 'backwards');
});

test('the split is the fraction stated in hours', () => {
  const day = midnight(2026, 2, 21);
  const { sunset } = sunAt(day);

  const { light, dark } = splitOf(day + (sunset - 6) * HOUR, day + (sunset + 3) * HOUR);
  close(light, 6, 'six hours of light');
  close(dark, 3, 'and three of dark');
});

test('a missing instant throws rather than answering about 1970', () => {
  // `Number.isFinite(undefined)` is false and `undefined / DAY_MS` is NaN, which would
  // otherwise propagate into a factor as a silent 1.0 — the failure this project keeps
  // meeting. Loud, like `applyTick` and `integrateFactors`.
  assert.throws(() => worldTimeAt(undefined), TypeError);
  assert.throws(() => bandAt(NaN), TypeError);
  assert.throws(() => daylightFraction(undefined, 1000), TypeError);
  assert.throws(() => daylightFraction(1000, null), TypeError);
});

test('the next band change is the instant the word on the page stops being true', () => {
  // What the strip arms its timer on. The turn of the light is not enough by itself:
  // `evening` begins three-quarters of the way through the daylight and `night` an hour
  // after sunset, so a strip woken only at sunrise and sunset sits on a stale word.
  const day = midnight(2026, 5, 14);

  for (let hour = 0; hour < 24; hour += 1) {
    const from = day + hour * HOUR;
    const next = nextBandChange(from);

    assert.ok(next > from, `did not move forward from hour ${hour}`);
    assert.notEqual(bandAt(next), bandAt(from), `hour ${hour}: the band did not change`);
    assert.ok(next - from <= DAY, `hour ${hour}: more than a day to the next band`);

    // And nothing changed earlier than it claims: the instant before is still this band.
    assert.equal(bandAt(next - 60_000), bandAt(from), `hour ${hour}: it changed sooner`);
  }
});

test('a band boundary is not always a turn of the light', () => {
  // The reason the alarm is on the band rather than on sunrise and sunset. Somewhere in
  // the day there is a change of word with the sun still up, and one with it still down.
  const day = midnight(2026, 5, 14);
  const changes = [];
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    const when = day + minute * 60_000;
    if (bandAt(when) !== bandAt(when - 60_000)) changes.push(when);
  }

  assert.ok(changes.length >= 4, `only ${changes.length} band changes in a day`);
  assert.ok(
    changes.some((when) => isLit(when)) && changes.some((when) => !isLit(when)),
    'every band change coincided with the light turning, which cannot be right',
  );
});

test('the alarm throws on a missing instant like the rest of the module', () => {
  assert.throws(() => nextBandChange(undefined), TypeError);
});

test('every band can be said as a phrase, and the five stay one vocabulary', () => {
  /*
   * The trip line puts a band after "set out" and "home", where the bare word the strip
   * uses reads as a caption rather than as a time. The phrases live beside `BANDS` so a
   * sixth band cannot be added without one — which is what this checks, rather than the
   * wording, because the wording is a design decision and the coverage is an invariant.
   */
  for (const band of BANDS) {
    assert.match(saysBand(band), /^(in|at|before) /, `${band} reads as a phrase, not a label`);
  }

  // Anything it has no phrase for comes back as it went in: a line that says the band is
  // better than a line that says "undefined".
  assert.equal(saysBand('the long dark'), 'the long dark');
  assert.equal(saysBand(null), '');
});

test('an instant on the minute is printed as that minute', () => {
  /*
   * Found by putting a trip's departure on the page: dispatched at 07:15, the card said
   * 07:14. The hour was derived by multiplying a float back out — 7.25 arrives as
   * 7.249999999999999 and floors a minute short — and it went unnoticed while the only
   * hours printed were a sunrise and a sunset, which land on no particular minute.
   *
   * Walked across a whole day rather than asserted at the one instant that failed,
   * because the fault was in the arithmetic and arithmetic is wrong for classes of input.
   */
  const midnight = Date.UTC(2026, 8, 3);
  for (let m = 0; m < 24 * 60; m += 1) {
    const said = worldTimeAt(midnight + m * 60_000);
    assert.deepEqual(
      [said.hour, said.minute],
      [Math.floor(m / 60), m % 60],
      `minute ${m} of the day`,
    );
  }

  // And seconds inside a minute belong to it: 07:15:59 is still a quarter past seven.
  const late = worldTimeAt(Date.UTC(2026, 8, 3, 7, 15, 59));
  assert.deepEqual([late.hour, late.minute], [7, 15]);

  // The camp's own clock moves the reading and not the instant.
  const shifted = worldTimeAt(Date.UTC(2026, 8, 3, 7, 15), 90);
  assert.deepEqual([shifted.hour, shifted.minute], [8, 45]);
});
