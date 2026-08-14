import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { viewGraveyard } from '../../src/services/view-graveyard.js';

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

async function setup(client) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  return settlementId;
}

/**
 * Deaths are given an explicit hour rather than `now()`.
 *
 * Postgres `now()` is the *transaction* timestamp, and these tests run inside one
 * transaction that began before any of these survivors existed — so `now()` would
 * bury them before they were born, and bury all of them at the same instant, leaving
 * "most recent first" with nothing to sort by.
 */
const bury = async (client, settlementId, at, cause = 'starvation') => {
  await client.query(
    `update characters set died_at = $3, cause_of_death = $2
      where settlement_id = $1 and died_at is null`,
    [settlementId, cause, new Date(at)],
  );
};

/** A fixed clock, well in the past, so every lifespan is positive and known. */
const T0 = Date.now() - hours(500);

test('a camp nobody has died in has an empty graveyard', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera' });

    const view = await viewGraveyard(client, settlementId);
    assert.deepEqual(view.fallen, []);
    assert.equal(view.holding.name, 'Vera', 'and says who is holding it');
  });
});

test('the fallen are remembered with what it cost them', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
    await bury(client, settlementId, T0 + hours(48), 'radiation');
    await raiseSuccessor(client, settlementId, { name: 'Boris', now: T0 + hours(49) });

    const view = await viewGraveyard(client, settlementId);
    assert.equal(view.fallen.length, 1);

    const vera = view.fallen[0];
    assert.equal(vera.name, 'Vera');
    assert.equal(vera.cause, 'radiation');
    assert.equal(vera.daysSurvived, 2, 'held the camp two days');
    assert.equal(view.holding.name, 'Boris', 'someone else holds it now');
  });
});

test('the dead are listed most recent first', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);

    let clock = T0;
    for (const name of ['Vera', 'Boris', 'Cass']) {
      await raiseSuccessor(client, settlementId, { name, now: clock });
      clock += hours(24);
      await bury(client, settlementId, clock);
      clock += hours(1);
    }

    const view = await viewGraveyard(client, settlementId);
    assert.deepEqual(
      view.fallen.map((f) => f.name),
      ['Cass', 'Boris', 'Vera'],
    );
    assert.equal(view.holding, null, 'and nobody is holding the camp');
  });
});

test('a memorial records the trips they made and where they went last', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);

    // One clock for the whole test: born, sent out, home, buried. Mixing a real-time
    // birth with a past-dated death would advance the tick across the difference and
    // starve them before the assertion.
    const now = Date.now();
    await raiseSuccessor(client, settlementId, { name: 'Vera', now });

    const slug = `probe_region_${uniq()}`;
    await client.query(
      `insert into regions (slug, name, danger, travel_hours, loot, finds, radiation_per_trip)
       values ($1, 'The Long Walk', 1, 4, '{"scrap":[1,1]}'::jsonb, '[]'::jsonb, 0)`,
      [slug],
    );

    await dispatchExpedition(client, settlementId, slug, now);
    await advanceSettlement(client, settlementId, now + hours(5));
    await bury(client, settlementId, now + hours(6));

    const view = await viewGraveyard(client, settlementId);
    assert.equal(view.fallen[0].trips, 1);
    assert.equal(view.fallen[0].lastRegion, 'The Long Walk');
  });
});

test('and what they were still carrying', async () => {
  await withRollback(async (client) => {
    // Nothing in the game cleans up after the dead, which is what makes this
    // possible: their pack is still sitting there to be read.
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });

    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 2 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null and i.slug = 'rad_x'`,
      [settlementId],
    );
    await bury(client, settlementId, T0 + hours(30), 'radiation');

    const view = await viewGraveyard(client, settlementId);
    assert.deepEqual(view.fallen[0].carrying, [{ name: 'Rad-X', qty: 2 }]);
  });
});

test('an empty pack is remembered as an empty pack, not as missing data', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
    await bury(client, settlementId, T0 + hours(30));

    const view = await viewGraveyard(client, settlementId);
    assert.deepEqual(view.fallen[0].carrying, []);
    assert.equal(view.fallen[0].trips, 0);
    assert.equal(view.fallen[0].lastRegion, null);
  });
});

test.after(async () => {
  await pool.end();
});
