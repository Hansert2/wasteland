import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { viewGraveyard } from '../../src/services/view-graveyard.js';
import { shareLeft, survives } from '../../src/game/recovery.js';

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

/*
 * The graveyard advances the camp now, which it did not used to.
 *
 * Records was the one page rendered from a plain read, on the grounds that the dead do
 * not change — true of the graves, and quietly wrong about the rail beside them. It runs
 * the tick like every other view, so these fixtures have to name the instant they are
 * asking about instead of letting it default to the wall clock: `T0` is five hundred
 * hours ago, and a camp advanced five hundred hours starves whoever is holding it.
 */

test('a camp nobody has died in has an empty graveyard', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    // The name is no longer the player's to give: a wanderer walks in and the camp
    // gets whoever that is. See src/game/wanderers.js.
    const { wanderer } = await raiseSuccessor(client, settlementId);

    const view = await viewGraveyard(client, settlementId, Date.now());
    assert.deepEqual(view.fallen, []);
    assert.equal(view.holding.name, wanderer.name, 'and says who is holding it');
  });
});

test('the fallen are remembered with what it cost them', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const { wanderer: first } = await raiseSuccessor(client, settlementId, { now: T0 });
    await bury(client, settlementId, T0 + hours(48), 'radiation');
    const { wanderer: second } = await raiseSuccessor(client, settlementId, {
      now: T0 + hours(49),
    });

    const view = await viewGraveyard(client, settlementId, T0 + hours(50));
    assert.equal(view.fallen.length, 1);

    const dead = view.fallen[0];
    assert.equal(dead.name, first.name);
    assert.equal(dead.cause, 'radiation');
    assert.equal(dead.daysSurvived, 2, 'held the camp two days');
    assert.equal(view.holding.name, second.name, 'someone else holds it now');
    assert.notEqual(second.name, first.name, 'and it is not the same person again');
  });
});

test('the dead are listed most recent first', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);

    let clock = T0;
    const held = [];
    for (let i = 0; i < 3; i += 1) {
      const { wanderer } = await raiseSuccessor(client, settlementId, { now: clock });
      held.push(wanderer.name);
      clock += hours(24);
      await bury(client, settlementId, clock);
      clock += hours(1);
    }

    // Three different people, because a camp meets all seven wanderers before it meets
    // anyone twice — which is what the prime count in WANDERERS buys.
    assert.equal(new Set(held).size, 3, `three arrivals, three people: ${held}`);

    const view = await viewGraveyard(client, settlementId, clock);
    assert.deepEqual(
      view.fallen.map((f) => f.name),
      [...held].reverse(),
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

    const view = await viewGraveyard(client, settlementId, now + hours(7));
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

    const view = await viewGraveyard(client, settlementId, T0 + hours(31));
    assert.deepEqual(view.fallen[0].carrying, [{ name: 'Rad-X', qty: 2 }]);
  });
});

test('an empty pack is remembered as an empty pack, not as missing data', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
    await bury(client, settlementId, T0 + hours(30));

    const view = await viewGraveyard(client, settlementId, T0 + hours(31));
    assert.deepEqual(view.fallen[0].carrying, []);
    assert.equal(view.fallen[0].trips, 0);
    assert.equal(view.fallen[0].lastRegion, null);
  });
});

test.after(async () => {
  await pool.end();
});

test('a death in the camp leaves part of the pack on the shelf, and records no place', async () => {
  /*
   * Phase 16, and the half of it that needs no trip. **Only a death out on the road leaves
   * anything to go and fetch**: somebody who starved fell in a camp that can see them, so what
   * they were carrying is settled at once rather than by sending a survivor to the fence line
   * to collect it.
   *
   * And not all of it — death still costs something at home. The share is `shareLeft` read at
   * zero hours, the same curve a recovery trip reads at however long they lay out there, so
   * the two cases cannot drift apart: they are one function.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });

    const { rows: living } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [settlementId],
    );
    const characterId = living[0].id;

    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, id, 4 from items where slug = 'scavenged_parts'`,
      [characterId],
    );

    // An empty larder and nothing growing: starvation, at home, on a clock the test owns.
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0
        where settlement_id = $1 and kind in ('garden', 'water_purifier')`,
      [settlementId],
    );

    const { events } = await advanceSettlement(client, settlementId, T0 + hours(400));

    const died = events.filter((one) => one.type === 'survivor_died');
    assert.equal(died.length, 1, 'they starved');
    assert.equal(died[0].inTheWire, true, 'inside the wire, which is the whole rule');

    const { rows: person } = await client.query(
      'select died_at_region_id, recovered_at from characters where id = $1',
      [characterId],
    );
    assert.equal(person[0].died_at_region_id, null, 'a death at home records no place');
    assert.equal(person[0].recovered_at, null, 'and nobody went and got them');

    // Four parts at seventy percent: three onto the shelf and one gone with them.
    const { rows: shelf } = await client.query(
      `select si.qty from store_items si join items i on i.id = si.item_id
        where si.settlement_id = $1 and i.slug = 'scavenged_parts'`,
      [settlementId],
    );
    assert.equal(Number(shelf[0]?.qty ?? 0), survives(4, shareLeft(0)), 'the share came in');

    const { rows: left } = await client.query(
      'select count(*)::int as n from inventory_items where character_id = $1',
      [characterId],
    );
    assert.equal(left[0].n, 0, 'and the rest is gone rather than left on a headstone');

    const came = events.filter((one) => one.type === 'pack_came_in');
    assert.equal(came.length, 1, 'the log says what came in');
    assert.equal(came[0].kept + came[0].lost, 4, 'and all four are accounted for');
  });
});
