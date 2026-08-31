import test from 'node:test';
import assert from 'node:assert/strict';

import { applyTick } from '../../src/game/tick.js';
import { CONFIG } from '../../src/game/constants.js';
import { STRUCTURES } from '../../src/game/structures.js';

// Midday rather than midnight, and the reason is the sun. A trip's finds are scaled by
// how much of it happened in daylight, so a fixture departing at midnight in deep
// midwinter is a pure night trip — and the `chance: 1` find below, which several tests
// read as a certainty, becomes a coin weighted by the season. Midday puts the four-hour
// probe trip inside the shortest day of the year with hours to spare, where the clamp
// makes a certain find certain again. This is the same lesson `test/db/expeditions.test.js`
// already carries: a fixture that calls itself tuned must actually be tuned.
const T0 = Date.UTC(2287, 0, 1, 9);
const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);

/**
 * Walking an interval in fifteen-minute slices accumulates float error, so a figure
 * that is exactly 42 on paper arrives as 41.999999999999886. The tolerance is for
 * that and nothing else: the quantities under test here differ by whole units when
 * the mechanism is wrong.
 */
const close = (actual, expected, message) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `${message} — expected about ${expected}, got ${actual}`,
  );

/** A camp with a healthy survivor and enough production to sustain them. */
function makeState(overrides = {}) {
  const { resources = {}, survivor = {}, ...rest } = overrides;
  return {
    lastTickAt: T0,
    settlement: {
      raidSeed: 42,
      raidCount: 0,
      // Ten years out, so a test that is not about raiders never meets one. Leaving
      // this null would schedule a raid on the first tick and quietly turn every
      // other assertion in this file into a test of the raid table.
      nextRaidAt: T0 + days(3650),
      // Caravans likewise: pinned out of the way unless a test invites one.
      caravanSeed: 42,
      caravanCount: 0,
      nextCaravanAt: T0 + days(3650),
      standings: {},
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
      departedAt: T0,
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
        departedAt: T0,
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

test('a build finishing mid-interval changes production from its exact hour', () => {
  const state = makeState({
    resources: { scrap: { amount: 0, ratePerHour: 1, cap: 100000 } },
  });
  // A workshop at level 2 upgrading to 3 at hour 10 of 20. Levels rather than rates
  // are stated here so the test survives a change to what a level is worth.
  const perLevel = STRUCTURES.workshop.perLevel;
  state.settlement.structures = [
    { id: 1, kind: 'shelter', level: 400, buildCompletesAt: null },
    { id: 2, kind: 'workshop', level: 2, buildCompletesAt: T0 + hours(10) },
  ];
  state.settlement.resources.scrap.ratePerHour = perLevel * 2;

  const { state: after, events } = applyTick(state, T0 + hours(20));

  // Ten hours at two levels' worth, then ten at three — not twenty of either.
  close(
    after.settlement.resources.scrap.amount,
    perLevel * 2 * 10 + perLevel * 3 * 10,
    'the rate changed at hour 10',
  );
  assert.equal(after.settlement.structures[1].level, 3);
  assert.equal(after.settlement.structures[1].buildCompletesAt, null);
  assert.deepEqual(
    events.filter((e) => e.type === 'build_completed'),
    [{ at: T0 + hours(10), type: 'build_completed', kind: 'workshop', level: 3 }],
  );
});

test('the completion hour does not depend on slice size, even an awkward one', () => {
  const build = () => {
    const state = makeState({
      resources: { scrap: { amount: 0, ratePerHour: 1, cap: 100000 } },
    });
    state.settlement.structures = [
      { id: 1, kind: 'shelter', level: 400, buildCompletesAt: null },
      { id: 2, kind: 'workshop', level: 2, buildCompletesAt: T0 + hours(10) },
    ];
    state.settlement.resources.scrap.ratePerHour = STRUCTURES.workshop.perLevel * 2;
    return state;
  };

  // 7 hours does not divide 10, so without exact event boundaries the rate change
  // would land at hour 14 and the totals would drift apart.
  const awkward = applyTick(build(), T0 + hours(20), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(build(), T0 + hours(20), { ...CONFIG, stepMs: 60_000 });

  // Tolerance is for floating-point accumulation across many small slices, not for
  // the mechanism: without exact boundaries the difference would be whole hours.
  const drift = Math.abs(
    awkward.state.settlement.resources.scrap.amount -
      fine.state.settlement.resources.scrap.amount,
  );
  const perLevel = STRUCTURES.workshop.perLevel;
  close(
    awkward.state.settlement.resources.scrap.amount,
    perLevel * 2 * 10 + perLevel * 3 * 10,
    'the awkward slicing still changed rate at hour 10',
  );
  assert.ok(drift < 1e-6, `slice size shifted the total by ${drift}`);
});

test('a finished shelter raises the storage cap from its completion hour', () => {
  // No survivor: this measures the cap mechanics alone, without anyone eating.
  const state = makeState({
    survivor: null,
    resources: { food: { amount: 95, ratePerHour: 6, cap: 100 } },
  });
  state.settlement.structures = [
    { id: 1, kind: 'shelter', level: 0, buildCompletesAt: T0 + hours(5) },
    { id: 2, kind: 'garden', level: 5, buildCompletesAt: null },
  ];

  const { state: after } = applyTick(state, T0 + hours(10));

  // Five hours pinned at the old cap of 100, then five hours of growth under the
  // raised one. Note the rate for those second five hours is the *garden's* — the
  // fixture's 6/hr is overwritten when the build completes, because finishing a
  // structure recomputes every rate from what the camp now has.
  const raised = 100 + STRUCTURES.shelter.storagePerLevel;
  const gardenRate = STRUCTURES.garden.perLevel * 5;

  assert.equal(after.settlement.resources.food.cap, raised);
  close(after.settlement.resources.food.amount, 100 + 5 * gardenRate, 'grew at the real rate');
});

test('builds finish even when nobody is alive to watch', () => {
  const state = makeState({ survivor: null });
  state.settlement.structures = [
    { id: 1, kind: 'workshop', level: 0, buildCompletesAt: T0 + hours(2) },
  ];

  const { state: after, events } = applyTick(state, T0 + hours(4));

  assert.equal(after.settlement.structures[0].level, 1);
  assert.equal(events.filter((e) => e.type === 'build_completed').length, 1);
});

const craftState = (overrides = {}, craft = {}) =>
  makeState({
    craft: {
      id: 'craft_1',
      status: 'active',
      completesAt: T0 + hours(4),
      resolvedAt: null,
      name: 'Scrap Spear',
      output: { slug: 'scrap_spear', qty: 1 },
      ...craft,
    },
    ...overrides,
  });

test('an order comes off the bench at its hour, and the goods are left to the caller', () => {
  const { state, events } = applyTick(craftState(), T0 + hours(6));

  assert.equal(state.craft.status, 'delivered');
  assert.equal(state.craft.resolvedAt, T0 + hours(4), 'resolved at its hour, not at now');

  // The tick deals in slugs; turning one into a row in the pack is the caller's job,
  // exactly as it is for an expedition's finds.
  assert.deepEqual(events.filter((e) => e.type === 'craft_delivered'), [
    {
      at: T0 + hours(4),
      type: 'craft_delivered',
      craftId: 'craft_1',
      name: 'Scrap Spear',
      slug: 'scrap_spear',
      qty: 1,
    },
  ]);
});

test('an order still on the bench is left alone', () => {
  const { state, events } = applyTick(craftState(), T0 + hours(2));

  assert.equal(state.craft.status, 'active');
  assert.equal(state.craft.resolvedAt, null);
  assert.equal(events.length, 0);
});

test('an order that finishes in an empty camp is forfeit', () => {
  const { state, events } = applyTick(craftState({ survivor: null }), T0 + hours(6));

  assert.equal(state.craft.status, 'lost');
  assert.equal(state.craft.resolvedAt, T0 + hours(4));
  assert.equal(events.filter((e) => e.type === 'craft_lost').length, 1);
  assert.equal(events.filter((e) => e.type === 'craft_delivered').length, 0);
});

test('the bench keeps working after a death, but there is nobody to take the result', () => {
  // Starvation kills at ~53h; the spear is finished at 80h, long after.
  const { state, events } = applyTick(
    craftState(starvingState(), { completesAt: T0 + hours(80) }),
    T0 + days(7),
  );

  assert.equal(state.survivor.alive, false);
  assert.ok(state.survivor.diedAt < T0 + hours(80), 'died before it was finished');
  assert.equal(state.craft.status, 'lost', 'the order was not cancelled at death, only unclaimed');
  assert.equal(state.craft.resolvedAt, T0 + hours(80), 'it finished on schedule regardless');
  assert.equal(events.filter((e) => e.type === 'craft_lost').length, 1);
});

test('an order finished before a death is still delivered', () => {
  const { state, events } = applyTick(
    craftState(starvingState(), { completesAt: T0 + hours(4) }),
    T0 + days(7),
  );

  assert.equal(state.craft.status, 'delivered');
  assert.equal(events.filter((e) => e.type === 'craft_delivered').length, 1);
  assert.equal(state.survivor.alive, false, 'they died later, holding a spear');
});

test('the delivery hour does not depend on how finely the interval is sliced', () => {
  const coarse = applyTick(craftState(), T0 + hours(6), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(craftState(), T0 + hours(6), { ...CONFIG, stepMs: 60_000 });

  assert.equal(coarse.state.craft.resolvedAt, T0 + hours(4));
  assert.equal(fine.state.craft.resolvedAt, T0 + hours(4));
});

const fittingState = (overrides = {}, fitting = {}) =>
  makeState({
    fitting: {
      id: 'fit_1',
      kind: 'water_purifier',
      upgrade: 'filtration',
      name: 'Filtration',
      completesAt: T0 + hours(4),
      installedAt: null,
      ...fitting,
    },
    ...overrides,
  });

test('a fitting installs at its hour and becomes a capability of the camp', () => {
  const { state, events } = applyTick(fittingState(), T0 + hours(6));

  assert.equal(state.fitting.installedAt, T0 + hours(4));
  assert.deepEqual(state.settlement.upgrades, ['filtration']);
  assert.deepEqual(events.filter((e) => e.type === 'upgrade_fitted'), [
    {
      at: T0 + hours(4),
      type: 'upgrade_fitted',
      kind: 'water_purifier',
      upgrade: 'filtration',
      name: 'Filtration',
    },
  ]);
});

test('a fitting still in progress is left alone', () => {
  const { state, events } = applyTick(fittingState(), T0 + hours(2));

  assert.equal(state.fitting.installedAt, null);
  assert.deepEqual(state.settlement.upgrades ?? [], []);
  assert.equal(events.length, 0);
});

test('a fitting finishes even when nobody is alive to watch', () => {
  // Fitting is building work: starting it needed hands, finishing it does not.
  const { state } = applyTick(fittingState({ survivor: null }), T0 + hours(6));

  assert.equal(state.fitting.installedAt, T0 + hours(4));
  assert.deepEqual(state.settlement.upgrades, ['filtration']);
});

test('filtration scrubs radiation faster than the camp does on its own', () => {
  const irradiated = { radiation: 50 };

  const { state: bare } = applyTick(makeState({ survivor: irradiated }), T0 + hours(10));
  close(bare.survivor.radiation, 42, '0.8/h for ten hours');

  const fitted = makeState({ survivor: irradiated });
  fitted.settlement.upgrades = ['filtration'];
  const { state: scrubbed } = applyTick(fitted, T0 + hours(10));

  close(scrubbed.survivor.radiation, 30, '2.0/h once filtration is fitted');
});

test('filtration stays in the camp and does not follow anyone into the wasteland', () => {
  // The balance rests on this. An 18-hour Deep Zone trip doses 25 rads, and
  // filtration running while away would scrub 36 of them — so a survivor would come
  // home cleaner than they left, radiation would stop being a constraint, and going
  // out recklessly would be *safer* than waiting. Measured, not guessed: with the
  // filter following them, an aggressive policy died 0 times in 5 sixty-day runs;
  // with it left at home, 5 times out of 5, exactly as it does with no upgrade.
  const away = makeState({
    survivor: { radiation: 50 },
    expedition: {
      id: 'exp_1',
      status: 'active',
      departedAt: T0,
      returnsAt: T0 + hours(100),
      seed: 1,
      region: REGION,
      resolvedAt: null,
      log: null,
    },
  });
  away.settlement.upgrades = ['filtration'];

  /*
   * Fifty, not forty-two. The filter never followed them, and since 2026-08-30 the base
   * rate does not either — the road scrubs nothing at all, because a walk that quietly
   * removed 0.8 an hour was what made four regions advertise a dose and deliver none.
   *
   * Which makes the property this test is about stronger rather than weaker: with the
   * filter following, the trip would come home cleaner than it left; with nothing
   * following, what a region doses is what arrives.
   */
  const { state } = applyTick(away, T0 + hours(10));
  close(state.survivor.radiation, 50, 'nothing scrubs out there, fitted or not');
});

test('a fitting finishing mid-interval changes the rate from its exact hour', () => {
  // The same property the build test pins for production: the slice that ends at the
  // completion hour still runs at the old rate, and everything after it at the new.
  const { state } = applyTick(
    fittingState({ survivor: { radiation: 60 } }, { completesAt: T0 + hours(10) }),
    T0 + hours(20),
  );

  // Ten hours at 0.8/h, then ten at 2.0/h — not 16 and not 40.
  close(state.survivor.radiation, 32, 'the rate changed at hour 10');
});

test('the fitting hour does not depend on how finely the interval is sliced', () => {
  const coarse = applyTick(fittingState(), T0 + hours(6), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(fittingState(), T0 + hours(6), { ...CONFIG, stepMs: 60_000 });

  assert.equal(coarse.state.fitting.installedAt, T0 + hours(4));
  assert.equal(fine.state.fitting.installedAt, T0 + hours(4));
});

const raidedState = (overrides = {}, settlement = {}) => {
  const state = makeState(overrides);
  state.settlement.nextRaidAt = T0 + hours(4);
  state.settlement.structures = [
    { id: 1, kind: 'shelter', level: 2, buildCompletesAt: null },
    { id: 2, kind: 'garden', level: 3, buildCompletesAt: null },
    ...(settlement.structures ?? []),
  ];
  state.settlement.resources.scrap = { amount: 400, ratePerHour: 0, cap: 600 };
  Object.assign(state.settlement, settlement.overrides ?? {});
  return state;
};

test('raiders arrive on the hour and carry off part of the stores', () => {
  const before = raidedState();
  const scrapBefore = before.settlement.resources.scrap.amount;

  const { state, events } = applyTick(before, T0 + hours(6));
  const raids = events.filter((e) => e.type === 'raid');

  assert.equal(raids.length, 1);
  assert.equal(raids[0].at, T0 + hours(4), 'at their hour, not at login');
  assert.ok(state.settlement.resources.scrap.amount < scrapBefore, 'they took something');
  assert.ok(raids[0].log.join(' ').length > 0, 'and the player is told what happened');
});

test('a raid wounds but never kills, however badly it goes', () => {
  // The settled rule. Losing a survivor to something you could not have seen while
  // offline is the one death that would feel unfair.
  for (let seed = 0; seed < 200; seed++) {
    const state = raidedState({ survivor: { health: 1 } }, { overrides: { raidSeed: seed } });
    const { state: after } = applyTick(state, T0 + hours(5));

    assert.equal(after.survivor.alive, true, `seed ${seed} killed them outright`);
    assert.ok(after.survivor.health >= 1, `seed ${seed} took them below 1`);
  }
});

test('a watchtower turns raids away, and softens the ones it does not', () => {
  const outcomes = (defence) => {
    let repelled = 0;
    let taken = 0;
    for (let seed = 0; seed < 120; seed++) {
      const state = raidedState(
        {},
        { structures: [{ id: 3, kind: 'watchtower', level: defence, buildCompletesAt: null }],
          overrides: { raidSeed: seed } },
      );
      const scrapBefore = state.settlement.resources.scrap.amount;
      const { state: after, events } = applyTick(state, T0 + hours(5));

      if (events.some((e) => e.type === 'raid_repelled')) repelled += 1;
      taken += scrapBefore - after.settlement.resources.scrap.amount;
    }
    return { repelled, taken };
  };

  const bare = outcomes(0);
  const guarded = outcomes(5);

  assert.equal(bare.repelled, 0, 'an undefended camp is never spared');
  assert.ok(guarded.repelled > 0, 'a tower sends some of them home');
  assert.ok(guarded.taken < bare.taken, 'and the rest leave with less');
});

test('a camp with nothing worth taking is left alone', () => {
  const poor = makeState({ survivor: null, resources: {
    food: { amount: 0, ratePerHour: 0, cap: 500 },
    water: { amount: 0, ratePerHour: 0, cap: 500 },
    scrap: { amount: 0, ratePerHour: 0, cap: 500 },
  } });
  poor.settlement.nextRaidAt = T0 + hours(4);
  poor.settlement.structures = [{ id: 1, kind: 'garden', level: 1, buildCompletesAt: null }];

  const { events } = applyTick(poor, T0 + hours(6));
  const raid = events.find((e) => e.type === 'raid');

  assert.deepEqual(raid.taken, {}, 'nothing to take');
  assert.match(raid.log.join(' '), /nothing worth carrying/);
});

test('a long absence resolves a sequence of raids, not one big one', () => {
  const { state, events } = applyTick(raidedState(), T0 + days(30));
  const raids = events.filter((e) => e.type === 'raid' || e.type === 'raid_repelled');

  assert.ok(raids.length > 1, `expected several raids in a month, got ${raids.length}`);
  assert.equal(state.settlement.raidCount, raids.length, 'the count keeps up');

  const hours = raids.map((r) => r.at);
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b), 'and they arrive in order');
  assert.ok(state.settlement.nextRaidAt > T0 + days(30), 'with the next one already booked');
});

test('the raid schedule does not depend on how finely the interval is sliced', () => {
  const coarse = applyTick(raidedState(), T0 + days(20), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(raidedState(), T0 + days(20), { ...CONFIG, stepMs: 60_000 });

  assert.deepEqual(
    coarse.events.filter((e) => e.type.startsWith('raid')).map((e) => e.at),
    fine.events.filter((e) => e.type.startsWith('raid')).map((e) => e.at),
  );
  assert.equal(coarse.state.settlement.raidCount, fine.state.settlement.raidCount);
});

test('a camp with no raid on the books gets one scheduled rather than none', () => {
  const state = makeState();
  state.settlement.nextRaidAt = null;

  const { state: after } = applyTick(state, T0 + hours(1));
  assert.ok(after.settlement.nextRaidAt > T0, 'the tick booked one');
});

test('a blight halves the garden from its exact hour, not from login', () => {
  const state = makeState({
    survivor: null,
    resources: { food: { amount: 0, ratePerHour: 10, cap: 100_000 } },
  });
  state.worldEvents = [{ kind: 'blight', startsAt: T0 + hours(10), endsAt: T0 + hours(20) }];

  const { state: after } = applyTick(state, T0 + hours(30));

  // 10 h at 10/h, then 10 h at 3.5/h under the blight, then 10 h clear again.
  close(after.settlement.resources.food.amount, 100 + 35 + 100, 'the blight had a beginning and an end');
});

test('weather changes land on the hour whatever the slice size', () => {
  const build = () => {
    const state = makeState({
      survivor: null,
      resources: { food: { amount: 0, ratePerHour: 10, cap: 100_000 } },
    });
    state.worldEvents = [{ kind: 'blight', startsAt: T0 + hours(10), endsAt: T0 + hours(20) }];
    return state;
  };

  // Seven does not divide ten, so without exact boundaries the blight would land late.
  const awkward = applyTick(build(), T0 + hours(30), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(build(), T0 + hours(30), { ...CONFIG, stepMs: 60_000 });

  close(
    awkward.state.settlement.resources.food.amount,
    fine.state.settlement.resources.food.amount,
    'slice size shifted the total',
  );
});

test('a rad storm makes the same trip dirtier without changing what it found', () => {
  const build = (worldEvents) => {
    // The default probe region is clean, and a storm has nothing to multiply there.
    const state = awayState({
      expedition: {
        id: 'exp_1',
        status: 'active',
        departedAt: T0,
        returnsAt: T0 + hours(4),
        seed: 1234,
        region: { ...REGION, radiationPerTrip: 20 },
        resolvedAt: null,
        log: null,
      },
    });
    state.worldEvents = worldEvents;
    return state;
  };

  const clear = applyTick(build([]), T0 + hours(6)).state;
  const stormy = applyTick(
    build([{ kind: 'rad_storm', startsAt: T0, endsAt: T0 + hours(24) }]),
    T0 + hours(6),
  ).state;

  assert.ok(stormy.survivor.radiation > clear.survivor.radiation, 'the sky was hotter');
  assert.equal(
    stormy.settlement.resources.scrap.amount,
    clear.settlement.resources.scrap.amount,
    'a storm does not change what was lying around to be found',
  );
});

test('a world with no weather in it behaves exactly as it did before there was any', () => {
  // The compatibility guarantee, same as gear: clear skies must not perturb a thing.
  const withNone = applyTick(makeState({ survivor: { health: 60 } }), T0 + days(20));

  const withEmpty = makeState({ survivor: { health: 60 } });
  withEmpty.worldEvents = [];
  const withEmptyResult = applyTick(withEmpty, T0 + days(20));

  assert.deepStrictEqual(withEmptyResult.state.survivor, withNone.state.survivor);
  assert.deepStrictEqual(
    withEmptyResult.state.settlement.resources,
    withNone.state.settlement.resources,
  );
});

const caravanState = (overrides = {}) => {
  const state = makeState(overrides);
  state.settlement.caravanSeed = 7;
  state.settlement.nextCaravanAt = T0 + hours(4);
  return state;
};

test('a caravan arrives at its hour, stays its stay, and books the next visit', () => {
  const { state, events } = applyTick(caravanState(), T0 + days(3));

  const arrivals = events.filter((e) => e.type === 'caravan_arrived');
  const departures = events.filter((e) => e.type === 'caravan_departed');

  assert.ok(arrivals.length >= 1);
  assert.equal(arrivals[0].at, T0 + hours(4), 'at its hour, not at login');
  assert.ok(arrivals[0].name, 'the crew is named');
  assert.equal(arrivals[0].until - arrivals[0].at >= hours(8), true, 'a real window');

  assert.equal(departures.length, arrivals.length, 'every visit that opened also closed');
  assert.equal(state.settlement.caravanCount, departures.length, 'the count keeps up');
  assert.ok(state.settlement.nextCaravanAt > arrivals[0].at, 'the next one is booked');
});

test('the caravan schedule does not depend on how finely the interval is sliced', () => {
  const coarse = applyTick(caravanState(), T0 + days(10), { ...CONFIG, stepMs: hours(7) });
  const fine = applyTick(caravanState(), T0 + days(10), { ...CONFIG, stepMs: 60_000 });

  assert.deepEqual(
    coarse.events.filter((e) => e.type.startsWith('caravan')).map((e) => [e.type, e.at]),
    fine.events.filter((e) => e.type.startsWith('caravan')).map((e) => [e.type, e.at]),
  );
  assert.equal(coarse.state.settlement.nextCaravanAt, fine.state.settlement.nextCaravanAt);
});

test('a camp with no caravan on the books gets one scheduled', () => {
  const state = makeState();
  state.settlement.nextCaravanAt = null;

  const { state: after } = applyTick(state, T0 + hours(1));
  assert.ok(after.settlement.nextCaravanAt > T0, 'the tick booked a visit');
});

test('caravans keep coming to an empty camp — the visit needs no hands, only trading does', () => {
  const { events } = applyTick(caravanState({ survivor: null }), T0 + days(3));
  assert.ok(events.some((e) => e.type === 'caravan_arrived'));
});

test('standing with a crew changes how their raids land, not whether raids exist', () => {
  const raidsOver = (standings) => {
    const state = raidedState();
    state.settlement.standings = standings;
    const { state: after, events } = applyTick(state, T0 + days(60));
    return {
      count: events.filter((e) => e.type === 'raid' || e.type === 'raid_repelled').length,
      taken: events
        .filter((e) => e.type === 'raid')
        .reduce((t, r) => t + Object.values(r.taken).reduce((a, b) => a + b, 0), 0),
      alive: after.survivor.alive,
    };
  };

  // Friendly with both crews versus hated by both: same world, different weather.
  const loved = raidsOver({ junction_crews: 90, green_river: 90 });
  const hated = raidsOver({ junction_crews: -90, green_river: -90 });

  assert.ok(hated.count > loved.count, `hated ${hated.count} raids vs loved ${loved.count}`);
  assert.ok(hated.taken > loved.taken, 'and they leave with more');
  assert.equal(hated.alive, true, 'but even hatred never kills — the rule holds');
});

test('a raid event names the crew it answers to', () => {
  const { events } = applyTick(raidedState(), T0 + hours(5));
  const raid = events.find((e) => e.type === 'raid' || e.type === 'raid_repelled');

  assert.ok(raid.faction, 'attributed');
  assert.match(raid.log.join(' '), /Raiders out of The /, 'and named in the story');
});

test('now must actually be a number', () => {
  assert.throws(() => applyTick(makeState(), new Date(T0)), TypeError);
});

test('a dose decays in the camp and not on the road', () => {
  /*
   * The walk used to scrub 0.8 rads an hour, which was invisible because nothing showed
   * what a trip actually delivered. Measured 2026-08-30: a twelve-hour trip removed 9.6
   * against Coastal Wreckage's listed 4, so four regions advertised a dose and delivered a
   * mean of nothing. The listed number was not a number.
   *
   * This is the invariant that keeps it honest, and it is the whole of the change: away,
   * nothing is scrubbed; home, it is. A survivor recovers where there is water and shelter
   * to recover in.
   */
  const carrying = { health: 100, hunger: 0, radiation: 60 };

  // Out there, on a region that doses nobody, so the only thing that could move the
  // number is decay.
  const away = applyTick(
    makeState({
      survivor: carrying,
      expedition: {
        id: 'exp_1',
        status: 'active',
        departedAt: T0,
        returnsAt: T0 + hours(40),
        seed: 7,
        region: { ...REGION, radiationPerTrip: 0, travelHours: 40 },
        resolvedAt: null,
        log: null,
      },
    }),
    T0 + hours(12),
  );
  assert.equal(Number(away.state.survivor.radiation), 60, 'the road scrubs nothing');

  // Standing in it, the same twelve hours take 0.8 an hour off.
  const home = applyTick(makeState({ survivor: carrying }), T0 + hours(12));
  assert.ok(
    Math.abs(Number(home.state.survivor.radiation) - (60 - CONFIG.radDecayPerHour * 12)) < 1e-6,
    `the camp scrubs, got ${home.state.survivor.radiation}`,
  );
});

test('one survivor dying does not forfeit the trip of another', () => {
  /*
   * `kill` read "the expedition" and marked it lost, which was right while a camp had one
   * survivor and so at most one trip. With a roster it is a haul belonging to somebody who
   * is halfway to Harrow End, forfeited because a different person starved at home.
   *
   * The trip carries whose it is now, and `kill` only takes its own.
   */
  /*
   * Killed by the dose rather than by hunger, which took a first attempt to see: an away
   * survivor still eats from the camp's stores, so emptying them starves the traveller too
   * and the trip is forfeit for the honest reason. Radiation is carried by the person.
   */
  const away = { id: 41, alive: true, health: 100, hunger: 0, radiation: 0, bornAt: T0 };
  const home = { id: 42, alive: true, health: 4, hunger: 0, radiation: 96, bornAt: T0 };

  const state = makeState({ survivor: home });
  state.survivors = [home, away];
  state.expedition = {
    id: 'exp_1',
    status: 'active',
    characterId: away.id,
    departedAt: T0,
    returnsAt: T0 + days(4),
    seed: 3,
    region: { ...REGION, travelHours: 96 },
    resolvedAt: null,
    log: null,
  };

  const { state: after, events } = applyTick(state, T0 + days(3));

  assert.equal(after.survivors.find((one) => one.id === away.id).alive, true, 'the walker lives');

  assert.equal(after.survivors.find((one) => one.id === home.id).alive, false, 'the one at home died');
  assert.ok(events.some((e) => e.type === 'survivor_died'), 'and it was recorded');
  assert.equal(after.expedition.status, 'active', 'the trip is still walking');
  assert.equal(
    events.filter((e) => e.type === 'expedition_lost').length,
    0,
    'nobody else lost their haul for it',
  );
});

test('two trips in flight are settled separately, each on its own hour', () => {
  /*
   * The shape Phase 7 needs, tested before anything can dispatch a second trip — the tick
   * has to be able to settle two before the service is allowed to create them, or the first
   * camp to send two people would be the thing that discovers it cannot.
   *
   * Two people, two regions, two different lengths. What is checked is that neither trip is
   * settled with the other's numbers: the haul of each lands, and the damage of each lands
   * on the person who walked it.
   */
  const early = { id: 41, alive: true, health: 100, hunger: 0, radiation: 0, bornAt: T0 };
  const late = { id: 42, alive: true, health: 100, hunger: 0, radiation: 0, bornAt: T0 };

  const state = makeState({
    survivor: early,
    resources: { scrap: { amount: 0, ratePerHour: 0, cap: 10_000 } },
  });
  state.survivors = [early, late];

  // `span` and not `hours`: the file already has an `hours()` helper and a parameter of
  // that name shadows it inside the very expression that calls it.
  const trip = (id, characterId, span, loot) => ({
    id,
    status: 'active',
    characterId,
    departedAt: T0,
    returnsAt: T0 + hours(span),
    seed: id === 'a' ? 5 : 9,
    region: { ...REGION, travelHours: span, loot },
    resolvedAt: null,
    log: null,
  });

  state.expeditions = [
    trip('a', early.id, 4, { scrap: [10, 10] }),
    trip('b', late.id, 9, { scrap: [30, 30] }),
  ];
  state.expedition = state.expeditions[0];

  // Past the first return and short of the second.
  const midway = applyTick(state, T0 + hours(6));
  assert.equal(midway.state.expeditions[0].status, 'returned', 'the short trip is home');
  assert.equal(midway.state.expeditions[1].status, 'active', 'the long one is still walking');
  assert.equal(
    Number(midway.state.settlement.resources.scrap.amount),
    10,
    'and only the short one has paid out',
  );

  // Past both.
  const done = applyTick(state, T0 + hours(12));
  assert.equal(done.state.expeditions[1].status, 'returned', 'the long trip is home too');
  assert.equal(
    Number(done.state.settlement.resources.scrap.amount),
    40,
    'both hauls landed, and neither was settled twice',
  );
  assert.equal(
    done.events.filter((e) => e.type === 'expedition_returned').length,
    2,
    'two arrivals, reported separately',
  );
});
