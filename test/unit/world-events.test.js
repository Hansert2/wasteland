import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_EPOCH,
  WORLD_EVENTS,
  activeAt,
  eventForSlot,
  expeditionFactors,
  nextBoundaryAfter,
  productionFactors,
  slotAt,
} from '../../src/game/world-events.js';

const hours = (h) => h * 60 * 60 * 1000;

test('a slot always generates the same event, for everybody', () => {
  // This is what "global" rests on. Nothing coordinates these: every camp that needs
  // slot 41 computes it, and they must all compute the same storm.
  for (const slot of [0, 1, 7, 40, 500]) {
    assert.deepStrictEqual(eventForSlot(20260101, slot), eventForSlot(20260101, slot));
  }
});

test('slots differ from one another, and worlds differ from one another', () => {
  const world = [0, 1, 2, 3, 4, 5, 6, 7].map((s) => JSON.stringify(eventForSlot(1, s)));
  assert.ok(new Set(world).size > 1, 'a world with one kind of weather is not weather');

  assert.notDeepStrictEqual(eventForSlot(1, 9), eventForSlot(2, 9), 'the seed is the world');
});

test('every generated event is a real kind, forwards in time, and after the epoch', () => {
  for (let slot = 0; slot < 200; slot++) {
    const event = eventForSlot(20260101, slot);
    assert.ok(WORLD_EVENTS[event.kind], `slot ${slot} invented a kind`);
    assert.ok(event.endsAt > event.startsAt, `slot ${slot} ends before it starts`);
    assert.ok(event.startsAt >= WORLD_EPOCH, `slot ${slot} starts before the world`);
  }
});

test('the calendar runs forwards', () => {
  // Not strictly ordered — starts are jittered within their slot — but a slot two
  // hundred later must not land earlier.
  assert.ok(eventForSlot(20260101, 200).startsAt > eventForSlot(20260101, 0).startsAt);
  assert.ok(slotAt(WORLD_EPOCH + hours(24 * 365)) > slotAt(WORLD_EPOCH));
  assert.equal(slotAt(WORLD_EPOCH - hours(1000)), 0, 'nothing happened before the world');
});

const storm = { kind: 'rad_storm', startsAt: 1000, endsAt: 2000 };
const blight = { kind: 'blight', startsAt: 1500, endsAt: 3000 };

test('an event covers its start and not its end', () => {
  // Half-open, so an event ending exactly as another begins never double-counts.
  assert.deepEqual(activeAt([storm], 999), []);
  assert.deepEqual(activeAt([storm], 1000), [storm], 'in force at the instant it starts');
  assert.deepEqual(activeAt([storm], 1999), [storm]);
  assert.deepEqual(activeAt([storm], 2000), [], 'and over at the instant it ends');
});

test('overlapping weather composes rather than competing', () => {
  assert.deepEqual(activeAt([storm, blight], 1800), [storm, blight]);

  const both = productionFactors([storm, blight]);
  assert.equal(both.water, WORLD_EVENTS.rad_storm.production.water);
  assert.equal(both.food, WORLD_EVENTS.blight.production.food);

  // Two blights are worse than one, rather than the same as one.
  const doubled = productionFactors([blight, { ...blight }]);
  assert.equal(doubled.food, WORLD_EVENTS.blight.production.food ** 2);
});

test('clear skies change nothing at all', () => {
  assert.deepEqual(productionFactors([]), {});
  assert.deepEqual(expeditionFactors([]), { loot: 1, radiation: 1 });
});

test('a storm doses harder and a caravan pays better', () => {
  const caravan = { kind: 'caravan', startsAt: 0, endsAt: 10 };

  assert.ok(expeditionFactors([storm]).radiation > 1, 'the storm is the reason to wait');
  assert.equal(expeditionFactors([storm]).loot, 1, 'and it does not touch the haul');

  assert.ok(expeditionFactors([caravan]).loot > 1, 'the caravan is the reason to go');
  assert.equal(expeditionFactors([caravan]).radiation, 1);

  // The interesting case is both at once: worth more and costs more.
  const both = expeditionFactors([storm, caravan]);
  assert.ok(both.loot > 1 && both.radiation > 1);
});

test('the next change in the weather is a boundary the tick can cut on', () => {
  assert.equal(nextBoundaryAfter([storm, blight], 0), 1000, 'the storm arriving');
  assert.equal(nextBoundaryAfter([storm, blight], 1000), 1500, 'the blight arriving');
  assert.equal(nextBoundaryAfter([storm, blight], 1500), 2000, 'the storm lifting');
  assert.equal(nextBoundaryAfter([storm, blight], 2000), 3000, 'the blight lifting');
  assert.equal(nextBoundaryAfter([storm, blight], 3000), Infinity, 'and then clear skies');
  assert.equal(nextBoundaryAfter([], 0), Infinity);
  assert.equal(nextBoundaryAfter(undefined, 0), Infinity);
});
