import test from 'node:test';
import assert from 'node:assert/strict';

import { TIMERS, clock } from '../../src/web/render.js';

/**
 * The client's formatter, lifted out of the inline script and made callable.
 *
 * The page carries twenty lines of JavaScript with no build step, so the browser's
 * copy of this logic cannot import the server's — it is duplicated on purpose. What
 * follows makes the duplication safe: the two are run against the same inputs and
 * required to agree, so a change to one that is not made to the other fails here
 * rather than in front of somebody watching a timer.
 */
function clientFormatter() {
  const source = TIMERS.match(/const fmt = \(ms\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(source, 'could not find fmt in the inline script — has it been rewritten?');
  return new Function(`${source[0]} return fmt;`)();
}

test('the server and the browser format a duration identically', () => {
  const fmt = clientFormatter();

  const seconds = [
    0, 1, 9, 36, 59, 60, 61, 90, 599, 600, 3599, 3600, 3601, 3661,
    7521, 86399, 86400, 86401, 90000, 293_000, 777_600, 1_000_000,
  ];

  for (const s of seconds) {
    assert.equal(fmt(s * 1000), clock(s), `disagreement at ${s}s`);
  }
});

test('hours, minutes and seconds are all visible, and padded so they do not jump', () => {
  // A countdown that reads "2.1 h" for six minutes looks broken. Seconds are what
  // make it legibly alive, and padding stops the text jittering as digits drop.
  assert.equal(clock(36), '36s');
  assert.equal(clock(90), '1m 30s');
  assert.equal(clock(605), '10m 05s');
  assert.equal(clock(3661), '1h 01m 01s');
  assert.equal(clock(7521), '2h 05m 21s');
});

test('past a day the seconds are dropped — nobody watches those tick', () => {
  assert.equal(clock(86400), '1d 00h 00m');
  assert.equal(clock(293_000), '3d 09h 23m');
  assert.equal(clock(777_600), '9d 00h 00m');
});

test('an elapsed or nonsense duration reads as now rather than as a negative', () => {
  for (const value of [0, -1, -99999, NaN, undefined, null, 'nonsense']) {
    assert.equal(clock(value), 'now', `clock(${String(value)})`);
  }
  assert.equal(clientFormatter()(-5000), 'now', 'and the browser agrees');
});
