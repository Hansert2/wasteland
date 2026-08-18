import test from 'node:test';
import assert from 'node:assert/strict';

import { progress, stateAt, timelineOf } from '../../src/game/timeline.js';
import { resolveExpedition } from '../../src/game/expeditions.js';
import { makeRandom } from '../../src/game/random.js';

const DEEP_ZONE = {
  name: 'The Deep Zone',
  danger: 5,
  loot: { scrap: [25, 60], food: [2, 8] },
  finds: [{ slug: 'rad_x', chance: 1, qty: [1, 2] }],
  radiationPerTrip: 25,
};

const survivor = (overrides = {}) => ({ health: 100, skillScavenging: 1, ...overrides });

const tripFor = (seed, travelHours = 18) => {
  const outcome = resolveExpedition({ region: DEEP_ZONE, survivor: survivor(), seed });
  return { outcome, timeline: timelineOf({ outcome, travelHours, seed }) };
};

const SEEDS = [1, 2, 3, 7, 42, 99, 12345, 65535, 987654321];

test('progress is anchored at both ends and never goes backwards', () => {
  assert.equal(progress(0), 0);
  assert.equal(progress(1), 1, 'the total has to actually land');

  let previous = -1;
  for (let i = 0; i <= 1000; i += 1) {
    const value = progress(i / 1000);
    assert.ok(value >= previous, `progress fell between ${(i - 1) / 1000} and ${i / 1000}`);
    previous = value;
  }
});

test('progress clamps rather than extrapolating', () => {
  for (const nonsense of [-1, -0.5, 2, NaN, undefined, null, 'x']) {
    const value = progress(nonsense);
    assert.ok(value >= 0 && value <= 1, `progress(${String(nonsense)}) = ${value}`);
  }
});

test('the report lands on exactly what came home', () => {
  // The whole contract. A report that says 22 scrap and then delivers 21 is worse than
  // no report, because the player made a decision on it.
  for (const seed of SEEDS) {
    const { outcome, timeline } = tripFor(seed);
    const end = stateAt(timeline, timeline.travelHours);

    assert.deepStrictEqual(end.carrying, outcome.loot, `seed ${seed}: loot`);
    assert.equal(end.radiation, outcome.radiation, `seed ${seed}: radiation`);
    assert.equal(end.damage, outcome.damage, `seed ${seed}: damage`);
    assert.deepStrictEqual(
      end.finds,
      outcome.finds.map((find) => ({ slug: find.slug, qty: find.qty })),
      `seed ${seed}: finds`,
    );
  }
});

test('the report never goes backwards', () => {
  for (const seed of SEEDS) {
    const { timeline } = tripFor(seed);
    let previous = stateAt(timeline, 0);

    for (let hour = 0.25; hour <= timeline.travelHours; hour += 0.25) {
      const now = stateAt(timeline, hour);

      for (const [kind, amount] of Object.entries(previous.carrying)) {
        assert.ok(
          (now.carrying[kind] ?? 0) >= amount,
          `seed ${seed}: ${kind} fell from ${amount} at hour ${hour}`,
        );
      }
      assert.ok(now.radiation >= previous.radiation, `seed ${seed}: radiation fell`);
      assert.ok(now.finds.length >= previous.finds.length, `seed ${seed}: a find was lost`);

      previous = now;
    }
  }
});

test('nothing is carried before they have set out', () => {
  for (const seed of SEEDS) {
    const { timeline } = tripFor(seed);
    const start = stateAt(timeline, 0);

    assert.deepStrictEqual(start.carrying, {}, `seed ${seed}`);
    assert.equal(start.radiation, 0, `seed ${seed}`);
    assert.equal(start.damage, 0, `seed ${seed}`);
    assert.deepStrictEqual(start.finds, [], `seed ${seed}`);
  }
});

test('a hazard is reported from its hour and not before', () => {
  const withHazard = SEEDS.map((seed) => tripFor(seed)).filter((t) => t.timeline.hazard);
  assert.ok(withHazard.length > 0, 'the fixture produces hazards at all');

  for (const { timeline } of withHazard) {
    const { atHour, damage } = timeline.hazard;

    assert.equal(stateAt(timeline, atHour - 0.01).damage, 0, 'not before');
    assert.equal(stateAt(timeline, atHour).damage, damage, 'from its hour');
    assert.ok(atHour > 0 && atHour < timeline.travelHours, 'inside the trip');
  }
});

test('the timeline takes nothing from the generator the outcome was rolled with', () => {
  // The load-bearing guarantee of the whole phase: a trip that nobody attends must be
  // identical to one taken before any of this existed. Building a timeline must not
  // disturb the roll, and the way that is guaranteed is that they are separate streams.
  for (const seed of SEEDS) {
    const before = resolveExpedition({ region: DEEP_ZONE, survivor: survivor(), seed });
    timelineOf({ outcome: before, travelHours: 18, seed });
    const after = resolveExpedition({ region: DEEP_ZONE, survivor: survivor(), seed });

    assert.deepStrictEqual(after, before, `seed ${seed}`);
  }

  // And directly: the base stream is untouched by anything the timeline draws.
  const base = makeRandom(12345);
  const first = [base(), base(), base()];
  timelineOf({ outcome: tripFor(12345).outcome, travelHours: 18, seed: 12345 });
  const again = makeRandom(12345);
  assert.deepStrictEqual([again(), again(), again()], first);
});

test('the same trip always attributes the same way', () => {
  const a = timelineOf({ outcome: tripFor(42).outcome, travelHours: 18, seed: 42 });
  const b = timelineOf({ outcome: tripFor(42).outcome, travelHours: 18, seed: 42 });

  assert.deepStrictEqual(a, b);
});

test('a trip of no length reports everything at once rather than dividing by zero', () => {
  const outcome = resolveExpedition({ region: DEEP_ZONE, survivor: survivor(), seed: 5 });
  const timeline = timelineOf({ outcome, travelHours: 0, seed: 5 });

  assert.deepStrictEqual(stateAt(timeline, 0).carrying, outcome.loot);
});

test('an empty-handed trip reports nothing rather than something', () => {
  const timeline = timelineOf({
    outcome: { loot: {}, finds: [], radiation: 0, damage: 0, cause: null },
    travelHours: 4,
    seed: 3,
  });

  for (const hour of [0, 1, 2, 3, 4]) {
    const state = stateAt(timeline, hour);
    assert.deepStrictEqual(state.carrying, {});
    assert.equal(state.damage, 0);
  }
});

test('a single unit of loot appears somewhere in the trip, not only at the end', () => {
  // What the jitter is for. Without it, floor() holds a haul of one back until the
  // final instant and the report reads as empty-handed for the whole trip.
  let appearedEarly = 0;

  for (let seed = 1; seed <= 40; seed += 1) {
    const timeline = timelineOf({
      outcome: { loot: { scrap: 1 }, finds: [], radiation: 0, damage: 0, cause: null },
      travelHours: 10,
      seed,
    });
    if ((stateAt(timeline, 9).carrying.scrap ?? 0) === 1) appearedEarly += 1;

    // Whenever it appears, it must still be exactly one at the end.
    assert.equal(stateAt(timeline, 10).carrying.scrap, 1, `seed ${seed}`);
  }

  assert.ok(appearedEarly > 10, `a single unit usually shows before the end (${appearedEarly}/40)`);
});
