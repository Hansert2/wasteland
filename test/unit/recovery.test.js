import test from 'node:test';
import assert from 'node:assert/strict';

import { AT_ONCE, HALF_LIFE_HOURS, shareLeft, survives, whatIsLeft } from '../../src/game/recovery.js';

test('nothing is ever wholly recoverable, and the curve has no end', () => {
  /*
   * Half-life rather than a straight line to zero, and the reason is that a straight line needs
   * an end — a day on which a pack becomes exactly nothing — and every such day is a number
   * nothing derives. This needs one figure instead: how long until half of it is gone.
   */
  assert.equal(shareLeft(0), AT_ONCE, 'reached at once is not reached intact');
  assert.ok(AT_ONCE < 1, 'what killed them took something');

  assert.ok(Math.abs(shareLeft(HALF_LIFE_HOURS) - AT_ONCE / 2) < 1e-9, 'half gone at the half-life');
  assert.ok(Math.abs(shareLeft(HALF_LIFE_HOURS * 2) - AT_ONCE / 4) < 1e-9, 'and half again');

  // Falling everywhere, and never off the end into nothing.
  let last = shareLeft(0);
  for (const hours of [1, 6, 24, 72, 168, 720, 10_000]) {
    const now = shareLeft(hours);
    assert.ok(now < last, `${hours}h is worse than the hour before it`);
    assert.ok(now > 0, `${hours}h still leaves something, because a half-life has no end`);
    last = now;
  }
});

test('a clock that has gone backwards cannot hand back more than was there', () => {
  // Fixtures and corrected clocks both produce negative spans; neither may be profitable.
  assert.equal(shareLeft(-1), AT_ONCE);
  assert.equal(shareLeft(Number.NaN), AT_ONCE);
  assert.equal(shareLeft(undefined), AT_ONCE);
});

test('a single item comes home from a fresh death and not from an old one', () => {
  /*
   * Rounded rather than floored, and it matters at the small end: a pack holding one of
   * something is the ordinary case, and flooring would make every single item in the game
   * unrecoverable however fast anybody got there. Rounding lets the rule say the sentence it
   * is for — the spear comes back if you go now.
   */
  assert.equal(survives(1, shareLeft(0)), 1, 'one spear, reached at once');
  assert.equal(survives(1, shareLeft(HALF_LIFE_HOURS)), 0, 'and not three days later');
  assert.equal(survives(0, shareLeft(0)), 0);
  assert.equal(survives(4, 1), 4, 'and a share of everything is everything');
});

test('what is left is the same rows, thinned, with the empty ones gone', () => {
  const pack = [
    { slug: 'scrap_spear', qty: 1 },
    { slug: 'scavenged_parts', qty: 4 },
    { slug: 'preserved_meal', qty: 2 },
  ];

  const atOnce = whatIsLeft(pack, 0);
  assert.deepStrictEqual(
    atOnce.map((one) => [one.slug, one.qty]),
    [['scrap_spear', 1], ['scavenged_parts', 3], ['preserved_meal', 1]],
  );

  // A week out, and what is left is a handful of parts — no zero rows for a caller to think
  // about when it writes this into a box.
  const aWeek = whatIsLeft(pack, 168);
  assert.ok(aWeek.every((one) => one.qty > 0), 'nothing comes back at zero');
  assert.ok(
    aWeek.reduce((sum, one) => sum + one.qty, 0) < atOnce.reduce((sum, one) => sum + one.qty, 0),
    'and less of it than on the day',
  );

  assert.deepStrictEqual(whatIsLeft([], 0), []);
  assert.deepStrictEqual(whatIsLeft(undefined, 0), []);
});

test('the half-life is priced against the map, not against a feeling', () => {
  /*
   * 72 hours, and the decision it exists to create is "go now, or go when it suits you": the
   * longest walk on the map is 26 hours, so a camp that turns a trip straight round is inside
   * the first half-life and one that finishes what it was doing first is not.
   */
  const longestWalk = 26;
  assert.ok(HALF_LIFE_HOURS > longestWalk * 2, 'a there-and-back is comfortably inside it');
  assert.ok(HALF_LIFE_HOURS < longestWalk * 4, 'and a day of dithering is not');
});
