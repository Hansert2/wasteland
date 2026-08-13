import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTick } from '../../src/game/tick.js';
import { CONFIG } from '../../src/game/constants.js';

const T0 = Date.UTC(2287, 0, 1);
const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);

/** A camp with a healthy survivor and enough production to sustain them. */
function makeState(overrides = {}) {
  const { resources = {}, survivor = {}, ...rest } = overrides;
  return {
    lastTickAt: T0,
    settlement: {
      resources: {
        food: { amount: 50, ratePerHour: 2, cap: 500 },
        water: { amount: 50, ratePerHour: 2, cap: 500 },
        scrap: { amount: 0, ratePerHour: 1, cap: 10_000 },
        ...resources,
      },
    },
    survivor: survivor === null
      ? null
      : {
          alive: true,
          health: 100,
          hunger: 0,
          radiation: 0,
          bornAt: T0,
          diedAt: null,
          causeOfDeath: null,
          inventory: [],
          ...survivor,
        },
    expedition: null,
    ...rest,
  };
}

/** A camp whose stores are empty and whose production has stopped. */
function starvingState(overrides = {}) {
  return makeState({
    resources: {
      food: { amount: 0, ratePerHour: 0, cap: 500 },
      water: { amount: 0, ratePerHour: 0, cap: 500 },
    },
    ...overrides,
  });
}

test('no elapsed time leaves the world untouched', () => {
  const before = makeState();
  const { state, events } = applyTick(before, T0);

  assert.deepStrictEqual(state, before);
  assert.equal(events.length, 0);
});

test('a clock that runs backwards is ignored rather than rewinding the world', () => {
  const before = makeState();
  const { state } = applyTick(before, T0 - hours(5));

  assert.equal(state.lastTickAt, T0);
  assert.deepStrictEqual(state, before);
});

test('resources accrue over the elapsed interval and clamp at storage cap', () => {
  const { state } = applyTick(
    makeState({ resources: { scrap: { amount: 0, ratePerHour: 10, cap: 100 } }, survivor: null }),
    T0 + hours(50),
  );

  assert.equal(state.settlement.resources.scrap.amount, 100, 'clamped at cap, not 500');
});

test('a supplied survivor is fine after a month away', () => {
  const { state, events } = applyTick(makeState({ survivor: { health: 60 } }), T0 + days(30));

  assert.equal(state.survivor.alive, true);
  assert.equal(state.survivor.hunger, 0);
  assert.equal(state.survivor.health, 100, 'regenerated to full');
  assert.equal(events.length, 0, 'a well-run camp is a quiet log');
});

test('an unsupplied survivor starves to death', () => {
  const { state, events } = applyTick(starvingState(), T0 + days(7));

  assert.equal(state.survivor.alive, false);
  assert.equal(state.survivor.causeOfDeath, 'starvation');
  assert.equal(events.filter((e) => e.type === 'survivor_died').length, 1);
});

test('tuning guard: starvation takes one to three days, so a weekend away is survivable', () => {
  const { state } = applyTick(starvingState(), T0 + days(14));
  const elapsedHours = (state.survivor.diedAt - T0) / hours(1);

  assert.ok(
    elapsedHours > 36 && elapsedHours < 72,
    `expected death between 36h and 72h, got ${elapsedHours.toFixed(1)}h`,
  );
});

test('death partitions the interval: the settlement keeps producing afterwards', () => {
  const { state } = applyTick(starvingState(), T0 + days(10));

  const diedAfterHours = (state.survivor.diedAt - T0) / hours(1);
  assert.ok(diedAfterHours < 240, 'died partway through the interval');

  // Scrap production is indifferent to whether anyone is alive to stack it.
  assert.equal(state.settlement.resources.scrap.amount, 240, 'accrued for the full 10 days');
});

test('the death event reports days survived from birth, not from last login', () => {
  const bornAt = T0 - days(12);
  const { events } = applyTick(starvingState({ survivor: { bornAt } }), T0 + days(7));

  const death = events.find((e) => e.type === 'survivor_died');
  assert.ok(death.daysSurvived > 13, `expected >13 days, got ${death.daysSurvived.toFixed(2)}`);
});

test('an emergency ration is eaten automatically instead of starving beside it', () => {
  const inventory = [{ id: 'tinned_stew', kind: 'ration', potency: 80, qty: 1 }];
  const { state, events } = applyTick(starvingState({ survivor: { inventory } }), T0 + hours(60));

  assert.equal(state.survivor.alive, true, 'the survivor is not an idiot');
  assert.equal(state.survivor.inventory[0].qty, 0, 'the ration was consumed');
  assert.equal(events.filter((e) => e.type === 'auto_consumed').length, 1);
});

test('without the ration, the same camp kills the same survivor', () => {
  const { state } = applyTick(starvingState(), T0 + hours(60));

  assert.equal(state.survivor.alive, false, 'control case: the rescue is what saved them');
});

test('anti-rad meds are taken automatically when radiation turns lethal', () => {
  const inventory = [{ id: 'rad_x', kind: 'antirad', potency: 60, qty: 1 }];
  const irradiated = { health: 10, radiation: 95, inventory };

  const { state } = applyTick(makeState({ survivor: irradiated }), T0 + hours(8));
  assert.equal(state.survivor.alive, true);
  assert.equal(state.survivor.inventory[0].qty, 0);

  const { state: untreated } = applyTick(
    makeState({ survivor: { ...irradiated, inventory: [] } }),
    T0 + hours(8),
  );
  assert.equal(untreated.survivor.alive, false);
  assert.equal(untreated.survivor.causeOfDeath, 'radiation');
});

test('an expedition in flight is lost when the survivor dies at home', () => {
  const expedition = { id: 'exp_1', region: 'ruined_city', status: 'active' };
  const { state, events } = applyTick(starvingState({ expedition }), T0 + days(7));

  assert.equal(state.expedition.status, 'lost');
  assert.equal(events.filter((e) => e.type === 'expedition_lost').length, 1);
  // The schema requires a resolution timestamp on any non-active expedition.
  assert.equal(state.expedition.resolvedAt, state.survivor.diedAt);
});

test('the dead consume nothing and decay no further', () => {
  const dead = { alive: false, health: 0, hunger: 100, diedAt: T0 };
  const { state } = applyTick(
    makeState({ survivor: dead, resources: { food: { amount: 100, ratePerHour: 0, cap: 500 } } }),
    T0 + days(20),
  );

  assert.equal(state.settlement.resources.food.amount, 100, 'stores untouched');
  assert.equal(state.survivor.hunger, 100, 'stats frozen at death');
});

test('applyTick does not mutate the state it was given', () => {
  const before = starvingState();
  const snapshot = JSON.stringify(before);

  applyTick(before, T0 + days(7));

  assert.equal(JSON.stringify(before), snapshot);
});

test('identical inputs produce identical outputs', () => {
  const a = applyTick(starvingState(), T0 + days(7));
  const b = applyTick(starvingState(), T0 + days(7));

  assert.deepStrictEqual(a, b);
});

test('a finer simulation slice does not move the outcome', () => {
  const coarse = applyTick(starvingState(), T0 + days(7), { ...CONFIG, stepMs: hours(1) });
  const fine = applyTick(starvingState(), T0 + days(7), { ...CONFIG, stepMs: 60_000 });

  const drift = Math.abs(coarse.state.survivor.diedAt - fine.state.survivor.diedAt);
  assert.ok(drift < hours(1), `slice size shifted death by ${(drift / hours(1)).toFixed(2)}h`);
});

const REGION = {
  name: 'The Ruined City',
  danger: 1,
  loot: { scrap: [10, 10] },
  finds: [{ slug: 'tinned_stew', chance: 1, qty: [1, 1] }],
  radiationPerTrip: 0,
};

const awayState = (overrides = {}) =>
  makeState({
    // No scrap production, so these tests measure the haul rather than the workshop.
    resources: { scrap: { amount: 0, ratePerHour: 0, cap: 10_000 } },
    expedition: {
      id: 'exp_1',
      status: 'active',
      returnsAt: T0 + hours(4),
      seed: 1234,
      region: REGION,
      resolvedAt: null,
      log: null,
    },
    ...overrides,
  });

test('an expedition resolves when its hour comes, and the haul lands in the stores', () => {
  const { state, events } = applyTick(awayState(), T0 + hours(6));

  assert.equal(state.expedition.status, 'returned');
  assert.ok(state.expedition.resolvedAt <= T0 + hours(6));
  assert.equal(state.settlement.resources.scrap.amount, 10, 'loot arrived');
  assert.equal(events.filter((e) => e.type === 'expedition_returned').length, 1);
  assert.equal(events.filter((e) => e.type === 'item_found').length, 1);
});

test('an expedition still out is left alone', () => {
  const { state, events } = applyTick(awayState(), T0 + hours(2));

  assert.equal(state.expedition.status, 'active');
  assert.equal(state.settlement.resources.scrap.amount, 0);
  assert.equal(events.length, 0);
});

test('an expedition already overdue at load resolves on the first slice', () => {
  // The player was away for a week; the trip ended days ago and must not be stuck.
  const { state } = applyTick(awayState(), T0 + days(7));

  assert.equal(state.expedition.status, 'returned');
  assert.ok(state.expedition.resolvedAt < T0 + days(1));
});

test('loot beyond the storage cap is lost rather than overflowing it', () => {
  const state = awayState({
    resources: { scrap: { amount: 95, ratePerHour: 0, cap: 100 } },
  });

  const { state: after } = applyTick(state, T0 + hours(6));
  assert.equal(after.settlement.resources.scrap.amount, 100, 'clamped, not 105');
});

test('dying out there loses the expedition and everything in it', () => {
  const deadly = {
    ...REGION,
    name: 'The Deep Zone',
    danger: 5,
    loot: { scrap: [50, 50] },
    radiationPerTrip: 20,
  };

  // Hunt for a seed that kills a badly wounded survivor in that region.
  let result = null;
  for (let seed = 0; seed < 500 && result === null; seed++) {
    const state = makeState({
      resources: { scrap: { amount: 0, ratePerHour: 0, cap: 10_000 } },
      survivor: { health: 4 },
      expedition: {
        id: 'exp_1',
        status: 'active',
        returnsAt: T0 + hours(4),
        seed,
        region: deadly,
        resolvedAt: null,
        log: null,
      },
    });

    const { state: after, events } = applyTick(state, T0 + hours(6));
    if (!after.survivor.alive) result = { after, events };
  }

  assert.ok(result, 'expected a fatal seed');
  assert.equal(result.after.expedition.status, 'lost');
  assert.equal(result.after.settlement.resources.scrap.amount, 0, 'the haul never arrived');
  assert.equal(result.events.filter((e) => e.type === 'item_found').length, 0);
  assert.equal(result.events.filter((e) => e.type === 'survivor_died').length, 1);
});

test('the outcome does not depend on how finely the interval is sliced', () => {
  const coarse = applyTick(awayState(), T0 + hours(6), { ...CONFIG, stepMs: hours(1) });
  const fine = applyTick(awayState(), T0 + hours(6), { ...CONFIG, stepMs: 60_000 });

  assert.deepStrictEqual(
    coarse.state.settlement.resources.scrap.amount,
    fine.state.settlement.resources.scrap.amount,
  );
});

test('now must actually be a number', () => {
  assert.throws(() => applyTick(makeState(), new Date(T0)), TypeError);
});
