import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRandom, mix } from '../../src/game/random.js';

/**
 * The golden values.
 *
 * `mix` is frozen: seeds are stored on rows and replayed at resolution, so this
 * arithmetic *is* the trip a player is currently on. These are not here to prove the
 * function is correct — they are here so that changing it is impossible to do quietly.
 * If this test fails and the change was deliberate, every expedition in flight has just
 * become a different expedition, and the fix is a new salt or a new function beside the
 * old one, never new constants inside it.
 */
const GOLDEN = [
  [0, 'timeline', 3341992511],
  [0, 'moments', 1706783668],
  [1, 'timeline', 1086595318],
  [1, 'moments', 1345098861],
  [12345, 'timeline', 2708587410],
  [12345, 'moments', 1253723356],
  [2147483647, 'timeline', 1001914786],
  [999, '', 939883323],
];

test('mix produces exactly the values it has always produced', () => {
  for (const [seed, salt, expected] of GOLDEN) {
    assert.equal(mix(seed, salt), expected, `mix(${seed}, ${JSON.stringify(salt)})`);
  }
});

test('mix returns a uint32, which is what makeRandom takes', () => {
  for (const seed of [0, 1, -1, 12345, 2 ** 31, 2 ** 32 - 1, 1.5]) {
    for (const salt of ['timeline', 'moments', 'a', '']) {
      const value = mix(seed, salt);
      assert.ok(Number.isInteger(value), `${value} is a whole number`);
      assert.ok(value >= 0 && value <= 0xffffffff, `${value} fits in a uint32`);
    }
  }
});

test('the same seed and salt always give the same stream', () => {
  const a = makeRandom(mix(7, 'timeline'));
  const b = makeRandom(mix(7, 'timeline'));

  for (let i = 0; i < 20; i += 1) assert.equal(a(), b());
});

test('different salts on one seed are different streams', () => {
  // The point of salting: a trip's timeline and its moments must not be able to
  // predict one another, or "separate generators" buys nothing.
  for (const seed of [0, 1, 42, 12345, 987654321]) {
    const timeline = makeRandom(mix(seed, 'timeline'));
    const moments = makeRandom(mix(seed, 'moments'));
    const base = makeRandom(seed);

    const first = [timeline(), moments(), base()];
    assert.equal(new Set(first).size, 3, `seed ${seed}: three distinct streams`);
  }
});

test('neighbouring seeds do not produce neighbouring streams', () => {
  // Seeds come from newSeed() and are dense in practice, so adjacent values landing on
  // adjacent streams would show up as camps sharing outcomes.
  const draws = [];
  for (let seed = 0; seed < 200; seed += 1) {
    draws.push(makeRandom(mix(seed, 'timeline'))());
  }

  assert.equal(new Set(draws).size, 200, 'no two seeds collide on the first draw');

  // Consecutive seeds should not walk in step, which a weak mix would show as a
  // consistently small gap between them.
  const gaps = draws.slice(1).map((value, i) => Math.abs(value - draws[i]));
  const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  assert.ok(mean > 0.2, `consecutive seeds are decorrelated (mean gap ${mean.toFixed(3)})`);
});

test('a salt is read as text, so nothing depends on how it was typed', () => {
  assert.equal(mix(5, 'timeline'), mix(5, String('timeline')));
  assert.notEqual(mix(5, 'timeline'), mix(5, 'Timeline'));
});
