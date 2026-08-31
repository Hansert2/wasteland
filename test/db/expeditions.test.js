import test from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../../src/game/constants.js';
import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { ORDINARY } from '../../src/game/wanderers.js';
import { slotAt } from '../../src/game/world-events.js';
import { daylightFraction } from '../../src/game/daylight.js';

/**
 * The next instant from which a trip of `hours` is wholly in daylight.
 *
 * Needed because the sun scales what a trip turns up: in the dark a find is drawn against
 * a threshold below its own chance, so a `chance: 1` find is no longer a certainty and a
 * test asserting one lands passes or fails depending on the hour the suite happens to run.
 * That is the shape this file already flaked in once, and the answer is the same one —
 * pin the thing that was being left to chance rather than loosen the assertion.
 *
 * Daylight rather than dark because the factor is clamped at one: in the sun a certainty
 * stays a certainty, which is the only condition under which this test means what it says.
 */
function inDaylight(from, hours) {
  const HOUR = 60 * 60 * 1000;
  for (let step = 0; step <= 48 * 4; step += 1) {
    const at = from + step * 15 * 60 * 1000;
    if (daylightFraction(at, at + hours * HOUR) === 1) return at;
  }
  throw new Error('no daylight window that long, which cannot be right');
}
import { InputError } from '../../src/errors.js';

const hours = (h) => h * 60 * 60 * 1000;
const uniq = () => Math.random().toString(36).slice(2, 10);

async function withRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

/**
 * A camp, a survivor and a region, all three tuned so the outcome is not left to chance.
 *
 * The region always was. The survivor was not, and that is what made
 * `test/db/expeditions.test.js` fail roughly two runs in five for months.
 *
 * Whoever answers the gate is drawn from the camp's seed, and they are not the same
 * person twice: scavenging runs 1 to 7 across `WANDERERS`, and `rollLoot` multiplies the
 * haul by a tenth per level either side of `ORDINARY`. So a region declaring
 * `loot: { scrap: [10, 10] }` came home with 7, 8, 9, 10, 11, 12 or 13 scrap depending
 * on who took the trip — and three of the seven fail an assertion of "at least ten".
 *
 * Pinned to `ORDINARY` rather than to a number, so a rebalance of the skill curve moves
 * this with it. Medicine too: it sets the dose a survivor burns at, which is the same
 * kind of hidden variable one radiation test away from mattering.
 *
 * The alternative — pinning the expedition's seed — would have fixed nothing. Every seed
 * returns the same haul here; the region's loot range is a single value on purpose.
 */
async function setup(client, region = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  await client.query(
    `update characters set skill_scavenging = $2, skill_medicine = $2
       where settlement_id = $1 and died_at is null`,
    [settlementId, ORDINARY],
  );

  const slug = `probe_region_${uniq()}`;
  await client.query(
    `insert into regions (slug, name, danger, travel_hours, loot, finds, radiation_per_trip)
     values ($1, 'Probe Region', $2, $3, $4, $5, $6)`,
    [
      slug,
      region.danger ?? 1,
      region.travelHours ?? 4,
      JSON.stringify(region.loot ?? { scrap: [10, 10] }),
      JSON.stringify(region.finds ?? []),
      region.radiation ?? 0,
    ],
  );

  return { settlementId, slug };
}

test('dispatching records a return time and a seed, and nothing else yet', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();

    const { expeditionId } = await dispatchExpedition(client, settlementId, slug, now);

    const { rows } = await client.query(
      'select status, returns_at, seed, resolved_at, log from expeditions where id = $1',
      [expeditionId],
    );
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].resolved_at, null, 'the outcome is not decided at dispatch');
    assert.equal(rows[0].log, null);
    assert.ok(Number.isFinite(rows[0].seed));
    assert.equal(rows[0].returns_at.getTime(), now + hours(4));
  });
});

test('the survivor cannot be in two places at once', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    await dispatchExpedition(client, settlementId, slug);

    /*
     * Still refused, and the refusal names them now: "Vera is out there and cannot go
     * anywhere." Being busy became a fact about a person rather than about the camp, so
     * "somebody is already out there" is not a message a camp of three can act on.
     */
    await assert.rejects(
      dispatchExpedition(client, settlementId, slug),
      (error) => error instanceof InputError && /is out there and cannot go/i.test(error.message),
    );
  });
});

test('an unknown region is refused', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    await assert.rejects(
      dispatchExpedition(client, settlementId, 'nowhere_at_all'),
      InputError,
    );
  });
});

test('nobody can be sent from an empty camp', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(dispatchExpedition(client, settlementId, slug), InputError);
  });
});

test('the haul arrives in the settlement stores when the trip ends', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();

    const before = await loadWorld(client, settlementId);
    await dispatchExpedition(client, settlementId, slug, now);

    const { events } = await advanceSettlement(client, settlementId, now + hours(5));
    assert.equal(events.filter((e) => e.type === 'expedition_returned').length, 1);

    const after = await loadWorld(client, settlementId);
    assert.ok(
      after.settlement.resources.scrap.amount >= before.settlement.resources.scrap.amount + 10,
      'ten scrap, plus whatever the workshop made',
    );

    const { rows } = await client.query(
      `select status, log from expeditions where character_id in
         (select id from characters where settlement_id = $1)`,
      [settlementId],
    );
    assert.equal(rows[0].status, 'returned');
    assert.ok(Array.isArray(rows[0].log), 'the readable log was persisted');
  });
});

test('a found item ends up in the pack', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client, {
      finds: [{ slug: 'tinned_stew', chance: 1, qty: [2, 2] }],
    });
    await client.query(
      `insert into items (slug, name, kind, potency) values ('tinned_stew', 'Tinned Stew', 'ration', 80)
       on conflict (slug) do nothing`,
    );

    // Sent in daylight on purpose: see `inDaylight`. The region's trip is four hours.
    const now = inDaylight(Date.now(), 4);
    await dispatchExpedition(client, settlementId, slug, now);
    await advanceSettlement(client, settlementId, now + hours(5));

    const { rows } = await client.query(
      `select ii.qty from inventory_items ii
         join items i on i.id = ii.item_id
         join characters c on c.id = ii.character_id
        where c.settlement_id = $1 and i.slug = 'tinned_stew'`,
      [settlementId],
    );
    assert.equal(rows[0].qty, 2);
  });
});

test('resolving the same trip twice does not pay out twice', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();
    await dispatchExpedition(client, settlementId, slug, now);

    await advanceSettlement(client, settlementId, now + hours(5));
    const once = await loadWorld(client, settlementId);

    // The expedition is no longer active, so a later tick must not find it again.
    await advanceSettlement(client, settlementId, now + hours(9));
    const twice = await loadWorld(client, settlementId);

    // Derived from the camp's actual rate rather than assumed: a starting settlement
    // has no workshop, so hardcoding a number here would test the fixture, not the code.
    const produced = once.settlement.resources.scrap.ratePerHour * 4;
    assert.equal(
      twice.settlement.resources.scrap.amount,
      once.settlement.resources.scrap.amount + produced,
      'the difference is production alone, not a second haul',
    );
  });
});

test('a survivor who starves while away is not brought home by the tick', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client, { travelHours: 200 });
    const now = Date.now();

    // Strip the camp so the founder starves long before the trip would end.
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0 where settlement_id = $1 and kind in ('garden','water_purifier')`,
      [settlementId],
    );
    await dispatchExpedition(client, settlementId, slug, now);

    const { events } = await advanceSettlement(client, settlementId, now + hours(24 * 10));

    assert.equal(events.filter((e) => e.type === 'survivor_died').length, 1);
    const { rows } = await client.query(
      `select status, resolved_at from expeditions where character_id in
         (select id from characters where settlement_id = $1)`,
      [settlementId],
    );
    assert.equal(rows[0].status, 'lost');
    assert.ok(rows[0].resolved_at, 'a lost expedition still records when it ended');
  });
});

test('checking in mid-trip does not change the trip', async () => {
  // The bug the widened weather window fixes, pinned as a property rather than as a
  // number. The sky is integrated across the whole trip, so resolution needs the events
  // covering it — but the loader used to fetch only `[lastTickAt, now]`. A player who
  // checked in halfway therefore moved `lastTickAt` past the first half of their own
  // trip, and the weather in those hours was no longer found. `activeAt` reports that as
  // clear sky, so a storm walked through silently cost nothing, and the more attentive
  // the player the more of their own weather they erased.
  //
  // Two identical camps under the same global sky, sharing an expedition seed so the
  // rolls match: one is watched halfway and one is not. The trip must not care.
  await withRollback(async (client) => {
    const region = { travelHours: 20, radiation: 20, loot: { scrap: [10, 10] } };
    const watched = await setup(client, region);
    const alone = await setup(client, region);

    const now = Date.now();
    await advanceSettlement(client, watched.settlementId, now);
    await advanceSettlement(client, alone.settlementId, now);

    const a = await dispatchExpedition(client, watched.settlementId, watched.slug, now);
    const b = await dispatchExpedition(client, alone.settlementId, alone.slug, now);

    // Same dice for both, so anything that differs is the weather and not the roll.
    await client.query('update expeditions set seed = 4242 where id in ($1, $2)', [
      a.expeditionId,
      b.expeditionId,
    ]);

    // A storm that begins and ends inside the *first half* of the trip, so it is exactly
    // what a mid-trip check-in would erase. Written explicitly rather than left to the
    // calendar: whether a real event happens to open and close inside those ten hours is
    // a property of the day the suite runs, which is how a test like this becomes a
    // flake instead of a guard. Whatever else the sky is doing reaches both camps
    // equally, so the window is still the only difference between them.
    const slot = slotAt(now);
    await client.query('delete from world_events where slot = $1', [slot]);
    await client.query(
      `insert into world_events (slot, kind, starts_at, ends_at) values ($1, 'rad_storm', $2, $3)`,
      [slot, new Date(now + hours(2)), new Date(now + hours(8))],
    );

    // The watched camp is looked at halfway, which is what used to erase the first half
    // of its weather. The other is left alone until the trip lands.
    await advanceSettlement(client, watched.settlementId, now + hours(10));

    await advanceSettlement(client, watched.settlementId, now + hours(20));
    await advanceSettlement(client, alone.settlementId, now + hours(20));

    const { rows } = await client.query(
      'select id, log from expeditions where id in ($1, $2) order by id',
      [a.expeditionId, b.expeditionId],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].log, rows[1].log, 'watching a trip changed what it brought home');
  });
});

test('the report on a trip in flight agrees with the trip that lands', async () => {
  // The other half of the same change. The sky is integrated across the whole trip, and
  // a trip in flight ends in the future: the report takes stored rows for the hours
  // already elapsed and derives the rest from the world seed, while the tick — running
  // later, when those hours are past — reads every one of them from the table. If the
  // two ever disagreed, the page would describe a trip that did not happen.
  //
  // The dose is what this measures, because it is the outcome the sky scales hardest.
  await withRollback(async (client) => {
    /*
     * A dose large enough to out-run the decay that is scrubbing it.
     *
     * At 20 rads over 20 hours the walk also decays 0.8/h, so 16 of them are gone by the
     * gate and the survivor can arrive at zero — which made the accrual assertion below read
     * `0 > 0` and fail, on a test whose start instant is `Date.now()` and whose sun therefore
     * differs every run. It was flaky from the moment it was written and passed on luck.
     */
    const { settlementId, slug } = await setup(client, {
      travelHours: 20,
      radiation: 60,
      loot: { scrap: [10, 10] },
    });

    // `Date.now()` rather than a chosen instant: a camp is founded at the wall clock, and
    // `applyTick` refuses to run backwards, so a fixed past date silently does nothing.
    const now = Date.now();
    await advanceSettlement(client, settlementId, now);
    await dispatchExpedition(client, settlementId, slug, now);

    // One instant short of the return, so the report's prediction covers the whole trip
    // and is still a prediction.
    const view = await viewCamp(client, settlementId, now + hours(20) - 1);
    assert.ok(view.expedition, 'somebody is out there');
    const predictedDose = view.expedition.radiation;
    assert.ok(predictedDose > 0, 'and the region doses them');

    const before = await loadWorld(client, settlementId);
    const { events } = await advanceSettlement(client, settlementId, now + hours(20));
    const after = await loadWorld(client, settlementId);

    assert.ok(
      events.some((event) => event.type === 'expedition_returned'),
      'and they came back',
    );

    /*
     * Measured across the whole trip rather than across the instant it ends.
     *
     * The dose used to land in one step at `returns_at`, so the delta over the final
     * instant was the whole of it. It accrues across the hours now, so that delta is very
     * nearly nothing and the old measurement would pass only by measuring nothing.
     *
     * What is still exactly true is the invariant this test exists for: the page's
     * prediction and the tick's settlement integrate the same sky. So the survivor's dose at
     * the gate is the prediction less whatever decayed on the way — which is bounded, and
     * bounded tightly enough to catch a disagreement.
     */
    const carried = Number(after.survivor.radiation);
    const decayed = CONFIG.radDecayPerHour * 20;

    assert.ok(
      carried <= predictedDose + 0.05,
      `the page said ${predictedDose} rads and the trip delivered more: ${carried}`,
    );
    assert.ok(
      carried >= predictedDose - decayed - 0.05,
      `the page said ${predictedDose} rads and only ${carried} arrived, ` +
        `which is more than the ${decayed} the walk could have scrubbed`,
    );

    // And it did arrive gradually rather than all at once: `before` is one instant short of
    // the gate and already carries nearly the whole dose. This is the half that would fail
    // if the tick went back to settling at `returns_at`.
    assert.ok(
      Number(before.survivor.radiation) > carried * 0.9,
      'the dose accrued across the trip rather than landing at the gate',
    );
  });
});

test.after(async () => {
  await pool.end();
});
