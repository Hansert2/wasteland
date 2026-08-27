import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORLD_EPOCH,
  WORLD_EVENTS,
  activeAt,
  deriveEventsBetween,
  effectsOf,
  eventForSlot,
  expeditionFactors,
  integrateFactors,
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

test('what the page prints about the sky comes from what the tick multiplies by', () => {
  // The sky was two sentences and a countdown, so a blight slowing the garden to a
  // third was something a player inferred over days from a drifting stores figure.
  // These are derived from WORLD_EVENTS rather than written out beside the prose, so
  // a balance pass moves the page and the simulation in one edit or neither.
  for (const [kind, spec] of Object.entries(WORLD_EVENTS)) {
    const effects = effectsOf(kind);
    assert.ok(effects.length > 0, `${kind} does something, so it must say what`);

    for (const effect of effects) {
      const claimed =
        effect.what === 'haul'
          ? spec.loot
          : effect.what === 'dose'
            ? spec.radiation
            : spec.production?.[effect.what];

      assert.equal(effect.factor, claimed, `${kind}: ${effect.what} is not what it claims`);
      assert.notEqual(effect.factor, 1, `${kind}: a factor of one is not an effect`);
    }
  }
});

test('an effect is filed under where it is felt', () => {
  // The camp half and the road half answer different questions — one is what the
  // stores will do while you wait, the other is whether to send anybody at all.
  const storm = effectsOf('rad_storm');
  assert.deepEqual(
    storm.map((e) => [e.what, e.where]),
    [['water', 'camp'], ['dose', 'road']],
  );
  assert.deepEqual(effectsOf('caravan').map((e) => e.where), ['road']);
});

test('effects and the factors the tick composes agree, stacked as well as alone', () => {
  // "Two blights are worse than one" is a comment in productionFactors; this is the
  // page's version of the same claim, checked against the function itself.
  const two = [{ kind: 'blight' }, { kind: 'blight' }];
  const composed = productionFactors(two);
  const fromEffects = effectsOf('blight')[0].factor ** 2;

  assert.equal(composed.food, fromEffects);
});

test('an unknown kind says nothing rather than throwing', () => {
  // Rendered on every page load, for whatever is in the events table.
  assert.deepEqual(effectsOf('not_a_kind'), []);
  assert.deepEqual(effectsOf(undefined), []);
});

test('how long an event lasts does not decide how often you meet it', () => {
  // The bug this was written for. Three kinds drawn uniformly per slot, durations
  // spanning 2.5x, so the time a player actually spent under each was nothing like
  // equal: blight in force 31% of hours, rad storm 9%. The game's dominant weather was
  // the one with no decision attached and the one worth reading was the rarest.
  const HOUR = 3600e3;
  const seeds = [1, 7, 42, 1234, 99999, 777, 31337];
  const hours = Object.fromEntries(Object.keys(WORLD_EVENTS).map((k) => [k, 0]));
  let samples = 0;

  for (const seed of seeds) {
    const events = [];
    for (let slot = 0; slot < 400; slot += 1) events.push(eventForSlot(seed, slot));

    const from = events[10].startsAt;
    for (let t = from; t < from + 180 * 24 * HOUR; t += HOUR) {
      samples += 1;
      for (const e of activeAt(events, t)) hours[e.kind] += 1;
    }
  }

  // Time in force should track the declared share, not the duration.
  const totalShare = Object.values(WORLD_EVENTS).reduce((a, s) => a + s.share, 0);
  for (const [kind, spec] of Object.entries(WORLD_EVENTS)) {
    const actual = hours[kind] / samples;
    const wanted = (spec.share / totalShare) * (Object.values(hours).reduce((a, b) => a + b, 0) / samples);

    assert.ok(
      Math.abs(actual - wanted) < 0.012,
      `${kind}: ${(actual * 100).toFixed(1)}% of hours against ${(wanted * 100).toFixed(1)}% asked for`,
    );
  }

  // And the specific inversion that started this: the long boring one must not outweigh
  // the short interesting ones put together.
  assert.ok(hours.blight < hours.rad_storm + hours.dust, 'blight is not the weather again');
});

test('the sky is not only ever bad news', () => {
  // It used to be: 40% of hours against the player, 19% for, and the only thing that
  // ever helped helped expeditions rather than the camp. "Check the sky" was a matter
  // of finding out how you were being taxed.
  const helps = (spec) =>
    (spec.loot ?? 1) > 1 || Object.values(spec.production ?? {}).some((f) => f > 1);

  const good = Object.values(WORLD_EVENTS).filter(helps);
  assert.ok(good.length >= 3, 'several kinds are worth looking up for');
  assert.ok(
    good.some((spec) => spec.production && Object.values(spec.production).some((f) => f > 1)),
    'and at least one of them is good news for the camp rather than for a trip',
  );
});

test('a short event is short because that is what makes it a decision', () => {
  // The correct answer to dust is to wait it out, and an afternoon is a wait a player
  // will actually take. The same penalty over four days would only be a worse week.
  const mean = (spec) => (spec.hours[0] + spec.hours[1]) / 2;
  assert.ok(mean(WORLD_EVENTS.dust) < 12, 'dust blows through');
  assert.ok(mean(WORLD_EVENTS.blight) > 48, 'a blight settles in');
  assert.ok(
    Object.values(WORLD_EVENTS).some((spec) => mean(spec) < 20),
    'the calendar holds something you can sit out',
  );
});


// ---------------------------------------------------------------------------
// Integrating the sky across a trip, rather than sampling it at the return hour.
// ---------------------------------------------------------------------------

const T0 = WORLD_EPOCH + hours(1000);
// Weighted means are computed in milliseconds, so exact equality would be asserting
// something about IEEE754 rather than about the sky.
const close = (actual, expected, what) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} !== ${expected}`);
const stormFrom = (from, to) => ({ slot: 1, kind: 'rad_storm', startsAt: from, endsAt: to });

test('a trip wholly inside one sky gets exactly what sampling gave it', () => {
  // The constant case is the compatibility guarantee: integration must not move a trip
  // that had nothing to average, or every measured number moves for no reason.
  const events = [stormFrom(T0 - hours(10), T0 + hours(30))];

  const sampled = expeditionFactors(activeAt(events, T0 + hours(9)));
  const integrated = integrateFactors(events, T0, T0 + hours(9));

  assert.equal(integrated.radiation, sampled.radiation);
  assert.equal(integrated.loot, sampled.loot);
});

test('a trip under a storm for a third of it takes a third of the surcharge', () => {
  // The arithmetic stated as an assertion: a mean weighted by hours, not a reading at
  // either end. The storm covers the first three hours of a nine-hour trip.
  const events = [stormFrom(T0, T0 + hours(3))];
  const { radiation } = integrateFactors(events, T0, T0 + hours(9));

  const full = WORLD_EVENTS.rad_storm.radiation;
  close(radiation, (full * 3 + 1 * 6) / 9, 'three hours of nine');
  assert.ok(radiation > 1 && radiation < full, 'neither none of it nor all of it');
});

test('a trip that ends as the storm clears is no longer free of it', () => {
  // The exploit, written down. The page prints a countdown to the sky clearing, so
  // under sampling this trip was the correct play: walk through the whole storm and
  // arrive one minute after it lifts, paying nothing.
  const events = [stormFrom(T0, T0 + hours(8))];

  const sampled = expeditionFactors(activeAt(events, T0 + hours(8)));
  assert.equal(sampled.radiation, 1, 'which is what made it worth doing');

  const { radiation } = integrateFactors(events, T0, T0 + hours(8));
  close(radiation, WORLD_EVENTS.rad_storm.radiation, 'the whole trip was in it');
});

test('weather that turns twice mid-trip integrates all three pieces', () => {
  // Boundaries inside the window are cut, not rounded to the nearest end.
  const events = [
    stormFrom(T0 + hours(2), T0 + hours(4)),
    { slot: 2, kind: 'dust', startsAt: T0 + hours(6), endsAt: T0 + hours(10) },
  ];

  const { radiation, loot } = integrateFactors(events, T0, T0 + hours(10));

  close(radiation, (1 * 2 + WORLD_EVENTS.rad_storm.radiation * 2 + 1 * 6) / 10, 'dose');
  close(loot, (1 * 6 + WORLD_EVENTS.dust.loot * 4) / 10, 'haul');
});

test('concurrent events still compose multiplicatively inside a slice', () => {
  // Integration is across *time*. Composition across events is a separate rule and
  // must not be quietly flattened into an average by this change.
  const events = [
    stormFrom(T0, T0 + hours(4)),
    { slot: 2, kind: 'blight', startsAt: T0, endsAt: T0 + hours(4) },
    { slot: 3, kind: 'dust', startsAt: T0, endsAt: T0 + hours(4) },
  ];

  const both = integrateFactors(events, T0, T0 + hours(4));
  const sampled = expeditionFactors(activeAt(events, T0 + hours(1)));

  close(both.loot, sampled.loot, 'same composition');
  close(both.loot, WORLD_EVENTS.dust.loot, 'the two that touch loot, multiplied');
});

test('a clear sky integrates to exactly no change at all', () => {
  const { loot, radiation } = integrateFactors([], T0, T0 + hours(26));
  assert.equal(loot, 1);
  assert.equal(radiation, 1);
});

test('a missing bound throws rather than quietly reporting clear skies', () => {
  // A silent 1.0 here would disable the weather everywhere at once and look like
  // nothing had happened, which is the failure this project keeps meeting.
  assert.throws(() => integrateFactors([], undefined, T0), TypeError);
  assert.throws(() => integrateFactors([], T0, NaN), TypeError);
});

test('derived events match the ones a slot generates, and are sorted', () => {
  // The database is a cache of this function; for any slot the two must agree, which
  // is what lets a report use stored rows for the past and derived ones for the future.
  const from = WORLD_EPOCH + hours(500);
  const to = from + hours(400);
  const derived = deriveEventsBetween(20260101, from, to);

  assert.ok(derived.length > 0, 'four hundred hours of world has weather in it');
  for (const event of derived) {
    assert.deepEqual(event, eventForSlot(20260101, event.slot));
    assert.ok(event.startsAt < to && event.endsAt > from, 'and it overlaps the window');
  }

  const starts = derived.map((event) => event.startsAt);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));
});

test('an event running when the window opens is not missed', () => {
  // The reason `OVERLAP_MARGIN_SLOTS` exists: a blight can begin well before a window
  // and still be in force throughout it.
  const seed = 20260101;
  const early = eventForSlot(seed, 40);
  const midway = early.startsAt + (early.endsAt - early.startsAt) / 2;

  const derived = deriveEventsBetween(seed, midway, midway + hours(1));
  assert.ok(
    derived.some((event) => event.slot === 40),
    'the event in force at the window`s opening is in the set',
  );
});
