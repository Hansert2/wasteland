import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GRAMS_PER_FOOD,
  LITRES_PER_WATER,
  UNITS,
  inUnits,
  says,
  saysRange,
  saysRate,
} from '../../src/game/units.js';
import { STORE_UNITS } from '../../src/web/render.js';
import { CONFIG } from '../../src/game/constants.js';

test('the conversion is the one the design derived, and the day it implies is a person', () => {
  /*
   * The whole argument for Phase 18 being cheap: the rates were already realistic and only
   * the label was missing. If somebody retunes `foodPerHour` or `waterPerHour` without
   * re-deriving the unit, this is the test that says the page has started lying about what a
   * person needs.
   */
  const gramsADay = CONFIG.foodPerHour * 24 * GRAMS_PER_FOOD;
  const litresADay = CONFIG.waterPerHour * 24 * LITRES_PER_WATER;

  assert.equal(gramsADay, 1500, 'a survivor should eat 1.5 kg a day');
  assert.equal(Number(litresADay.toFixed(2)), 3.6, 'and drink 3.6 L');
});

test('every store is written the same way in both files, or the page contradicts itself', () => {
  /*
   * `render.js` imports nothing by design — the client script at the bottom is inline
   * JavaScript with no build step — so the four call sites that format a bare cost object
   * carry a second copy of the conversion. This is what stops the two drifting: the copy is
   * pinned rather than trusted, which is the only honest way to hold a fact twice.
   */
  for (const [kind, scale] of Object.entries(STORE_UNITS)) {
    assert.ok(UNITS[kind], `${kind} is written by the renderer and unknown to units.js`);
    assert.deepEqual(scale, UNITS[kind], `${kind} is written differently in the two files`);
  }

  // And nothing with a unit is missing from the renderer's copy, which is the other direction.
  for (const [kind, spec] of Object.entries(UNITS)) {
    if (!spec.stock.unit) continue;
    assert.ok(STORE_UNITS[kind], `${kind} has a unit that a price would never print`);
  }
});

test('a store reads in its own unit, and the two that have none read as numbers', () => {
  assert.equal(says(340, 'food'), '42.5 kg');
  assert.equal(says(340, 'water'), '68 L');
  assert.equal(says(20, 'food'), '2.5 kg', 'the workshop recipe');
  assert.equal(says(90, 'water'), '18 L', 'the Wellkeepers’ bulk offer');
  assert.equal(says(350, 'scrap'), '350');
  assert.equal(says(0, 'fuel'), '0');
  assert.equal(says(12, 'nonsense'), '12', 'an unknown store is a bare number, not a crash');
});

test('a rate is in a unit that cannot round a real shortfall away to nothing', () => {
  /*
   * The reason food's rate is grams and its stock is kilograms. At two decimals in kilograms
   * a net of thirty grams an hour — 0.7 kg a day, half a person — prints as "0.00 kg/h", and
   * a figure saying nothing is happening while the larder empties is the one thing the stores
   * table must not print.
   */
  assert.equal(saysRate(-0.5, 'food'), '-63 g/h', 'one survivor eating');
  assert.equal(saysRate(1.8, 'food'), '+225 g/h', 'a garden at level three');
  assert.equal(saysRate(0.24, 'food'), '+30 g/h', 'and the shortfall that kilograms would lose');

  assert.equal(saysRate(-0.75, 'water'), '-0.15 L/h');
  assert.equal(saysRate(0, 'food'), null, 'nothing happening is a dash, not a zero');
});

test('a range says its unit once, at the end', () => {
  // The same reading `saysLoad` settled: two figures and one unit are a single quantity, and
  // saying the unit twice describes two.
  // One decimal, the same as the rail: a place paying 0.75 kg reads "0.8", which is the
  // precision a pay range is compared at and one digit fewer than the arithmetic has.
  assert.equal(saysRange(6, 18, 'food'), '0.8–2.3 kg');
  assert.equal(saysRange(10, 24, 'water'), '2–4.8 L');
  assert.equal(saysRange(25, 60, 'scrap'), '25–60');
});

test('converting is exact at the boundaries the stores actually hit', () => {
  assert.equal(inUnits(0, 'food'), 0);
  assert.equal(inUnits(0, 'water'), 0);
  // The shelter's shared cap, which is the largest figure either store ever shows.
  assert.equal(inUnits(600, 'food'), 75, '600 points of food is 75 kg');
  assert.equal(inUnits(600, 'water'), 120, 'and 120 L of water');
  assert.equal(UNITS.scrap.stock.per, 1, 'scrap and fuel are not converted at all');
  assert.equal(UNITS.fuel.stock.per, 1);
});
