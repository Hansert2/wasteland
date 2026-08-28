import test from 'node:test';
import assert from 'node:assert/strict';

import { TIMERS, clock } from '../../src/web/render.js';

/**
 * `clock` as the browser gets it: its own source, evaluated in an empty scope.
 *
 * The page carries twenty lines of inline JavaScript with no build step, so the
 * browser cannot import this function — it is handed the function's source instead.
 * That removes the second copy that used to be kept in step by hand, and replaces it
 * with a single requirement: `clock` must close over nothing but globals.
 *
 * `new Function` is what proves it. Its body sees globals and nothing else, so a
 * `clock` that grew a reference to anything at module scope — a constant, a helper,
 * another import — throws here instead of silently formatting every timer in every
 * browser as `undefined`.
 */
function asTheBrowserGetsIt() {
  return new Function(`return (${clock.toString()});`)();
}

test('the browser is handed clock itself, not a copy of it', () => {
  assert.ok(
    TIMERS.includes(clock.toString()),
    'the inline script no longer contains clock() — has it been copied out by hand again?',
  );
});

test('clock closes over nothing, so handing out its source is safe', () => {
  const injected = asTheBrowserGetsIt();

  const seconds = [
    0, 1, 9, 36, 59, 60, 61, 90, 599, 600, 3599, 3600, 3601, 3661,
    7521, 86399, 86400, 86401, 90000, 293_000, 777_600, 1_000_000,
  ];

  for (const s of seconds) {
    assert.equal(injected(s), clock(s), `disagreement at ${s}s`);
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
  assert.equal(asTheBrowserGetsIt()(-5), 'now', 'and the browser agrees');
});

test('the client script is syntactically valid JavaScript', () => {
  /*
   * It lives in a template literal, so `node --check` on render.js proves only that the
   * *string* is well formed. A syntax error inside it ships a page whose timers, in-place
   * swaps, note popups and tab switch all silently do nothing, with both suites green —
   * the same shape as the backtick-in-a-CSS-comment fault the stylesheet lint exists for.
   *
   * `new Function` compiles the body without running it, which is exactly the check wanted:
   * the script talks to `document` and `window` and must not be executed here.
   */
  assert.doesNotThrow(() => new Function(TIMERS), 'TIMERS must parse');
});

test('nothing in the client script is referenced before it exists', () => {
  /*
   * `scan` calls `syncTabs`, which is declared after it — legal, because `scan` is only
   * *called* later, and fatal if that order ever changes. A temporal dead zone has caught
   * this project twice, both times in code a passing suite had already run past.
   *
   * Checked structurally rather than by executing: every `const name = ` in the script must
   * appear before the line that calls `name()` at the top level of the IIFE.
   */
  const lines = TIMERS.split(String.fromCharCode(10));
  const declaredAt = new Map();
  lines.forEach((line, i) => {
    const m = /^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (m && !declaredAt.has(m[1])) declaredAt.set(m[1], i);
  });

  /*
   * A call indented exactly two spaces is at the top level of the IIFE and runs the
   * moment the script loads. Anything deeper is inside a function body and runs later,
   * by which time every declaration in the file exists — `drop` is declared after the
   * handler that calls it and is perfectly safe.
   */
  lines.forEach((line, i) => {
    const m = /^ {2}([A-Za-z_$][\w$]*)\(\);\s*$/.exec(line);
    if (!m) return;
    const at = declaredAt.get(m[1]);
    if (at === undefined) return;
    assert.ok(at < i, `${m[1]}() is called on line ${i + 1} but declared on line ${at + 1}`);
  });
});
