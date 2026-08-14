import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { startBuild } from '../../src/services/start-build.js';
import { upgradeCost } from '../../src/game/structures.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
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

// 300 fits under a fresh camp's 350 cap — the resources_within_cap constraint
// rejects the fixture otherwise, which is precisely what it is for.
async function setup(client, { scrap = 300 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  // Founding leaves the camp empty; the first survivor moves in like any successor.
  await raiseSuccessor(client, settlementId, { name: 'Vera' });
  await client.query(
    `update resources set amount = $2 where settlement_id = $1 and kind = 'scrap'`,
    [settlementId, scrap],
  );
  return settlementId;
}

test('starting a build pays scrap now and delivers the level later', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    // Workshop level 0 -> 1: the bottom of the curve, which is now seconds rather
    // than hours. Derived from upgradeCost rather than restated, so a balance pass
    // moves this test with it instead of breaking it.
    const cost = upgradeCost('workshop', 0);
    const order = await startBuild(client, settlementId, 'workshop', now);
    assert.equal(order.toLevel, 1);
    assert.equal(order.cost.scrap, cost.scrap);
    assert.ok(cost.hours * 3600 < 60, 'a first workshop is under a minute');

    const paid = await loadWorld(client, settlementId);
    assert.equal(paid.settlement.resources.scrap.amount, 300 - cost.scrap, 'paid up front');
    const workshop = paid.settlement.structures.find((s) => s.kind === 'workshop');
    assert.equal(workshop.level, 0, 'the level has not arrived yet');
    assert.equal(workshop.buildCompletesAt, now + cost.hours * 3600_000);

    const { events } = await advanceSettlement(client, settlementId, now + hours(6));
    assert.equal(events.filter((e) => e.type === 'build_completed').length, 1);

    const done = await loadWorld(client, settlementId);
    const built = done.settlement.structures.find((s) => s.kind === 'workshop');
    assert.equal(built.level, 1);
    assert.equal(built.buildCompletesAt, null);
    assert.equal(done.settlement.resources.scrap.ratePerHour, 1, 'the workshop now produces');
  });
});

test('the queue holds one build at a time', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await startBuild(client, settlementId, 'workshop');

    await assert.rejects(
      startBuild(client, settlementId, 'garden'),
      (error) => error instanceof InputError && /being worked on/i.test(error.message),
    );
  });
});

test('you cannot spend scrap you do not have', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, { scrap: 3 });

    await assert.rejects(
      startBuild(client, settlementId, 'workshop'),
      (error) => error instanceof InputError && /not enough scrap/i.test(error.message),
    );

    const state = await loadWorld(client, settlementId);
    assert.equal(state.settlement.resources.scrap.amount, 3, 'nothing was deducted');
  });
});

test('an empty camp cannot start work, but work in flight still finishes', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();
    await startBuild(client, settlementId, 'watchtower', now);

    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(
      startBuild(client, settlementId, 'garden'),
      (error) => error instanceof InputError && /nobody here to build/i.test(error.message),
    );

    // The watchtower was scaffolded before they died; the tick finishes it anyway.
    await advanceSettlement(client, settlementId, now + hours(10));
    const state = await loadWorld(client, settlementId);
    const tower = state.settlement.structures.find((s) => s.kind === 'watchtower');
    assert.equal(tower.level, 1);
  });
});

test('a finished shelter raises every storage cap, persistently', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    const before = await loadWorld(client, settlementId);
    const capBefore = before.settlement.resources.food.cap;

    await startBuild(client, settlementId, 'shelter', now);
    await advanceSettlement(client, settlementId, now + hours(10));

    const { rows } = await client.query(
      `select distinct storage_cap from resources where settlement_id = $1`,
      [settlementId],
    );
    assert.equal(rows.length, 1, 'all four caps moved together');
    assert.equal(Number(rows[0].storage_cap), capBefore + 250);
  });
});

test('unknown structures are refused', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await assert.rejects(startBuild(client, settlementId, 'moat'), InputError);
    await assert.rejects(startBuild(client, settlementId, null), InputError);
  });
});

test.after(async () => {
  await pool.end();
});
