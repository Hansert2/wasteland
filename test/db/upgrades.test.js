import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { startBuild } from '../../src/services/start-build.js';
import { startCraft } from '../../src/services/start-craft.js';
import { startUpgrade } from '../../src/services/start-upgrade.js';
import { foundSettlement } from '../../src/services/settlement-lifecycle.js';
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

/** A camp with fuel in the tank and the structures the fuel track needs. */
async function setup(client, { fuel = 200, purifier = 2, workshop = 2 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
    survivorName: 'Vera',
  });

  await client.query(
    `update resources set amount = $2 where settlement_id = $1 and kind = 'fuel'`,
    [settlementId, fuel],
  );
  await client.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'water_purifier'`,
    [settlementId, purifier],
  );
  await client.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'workshop'`,
    [settlementId, workshop],
  );

  return settlementId;
}

const fuelOf = async (client, settlementId) => {
  const { rows } = await client.query(
    `select amount from resources where settlement_id = $1 and kind = 'fuel'`,
    [settlementId],
  );
  return Number(rows[0].amount);
};

test('fitting an upgrade pays fuel now and installs it later', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    const order = await startUpgrade(client, settlementId, 'filtration', now);
    assert.equal(order.completesAt.getTime(), now + hours(8));
    assert.equal(await fuelOf(client, settlementId), 140, 'paid up front');

    const paid = await loadWorld(client, settlementId);
    assert.equal(paid.fitting.upgrade, 'filtration');
    assert.deepEqual(paid.settlement.upgrades, [], 'not a capability yet');

    const { events } = await advanceSettlement(client, settlementId, now + hours(9));
    assert.equal(events.filter((e) => e.type === 'upgrade_fitted').length, 1);

    const done = await loadWorld(client, settlementId);
    assert.deepEqual(done.settlement.upgrades, ['filtration']);
    assert.equal(done.fitting, null, 'the crew is free again');
  });
});

test('the crew does one job: a build and a fitting cannot run together', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startUpgrade(client, settlementId, 'filtration');
    await assert.rejects(
      startBuild(client, settlementId, 'garden'),
      (error) => error instanceof InputError && /fitting the filtration/i.test(error.message),
    );
  });
});

test('and the same the other way round', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startBuild(client, settlementId, 'garden');
    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) => error instanceof InputError && /already being worked on/i.test(error.message),
    );
  });
});

test('the bench is a different crew, though — crafting is unaffected', async () => {
  await withRollback(async (client) => {
    // Fitting shares the build queue, not the craft queue. They are different work.
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startUpgrade(client, settlementId, 'filtration');
    await startCraft(client, settlementId, 'scrap_spear');

    const state = await loadWorld(client, settlementId);
    assert.equal(state.fitting.upgrade, 'filtration');
    assert.equal(state.craft.status, 'active', 'both are in flight');
  });
});

test('an upgrade needs the structure it bolts onto', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, { purifier: 1 });

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) => error instanceof InputError && /water purifier at level 2/i.test(error.message),
    );

    await client.query(
      `update camp_structures set level = 2 where settlement_id = $1 and kind = 'water_purifier'`,
      [settlementId],
    );
    await startUpgrade(client, settlementId, 'filtration');
  });
});

test('an upgrade is fitted once, not levelled', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    await startUpgrade(client, settlementId, 'filtration', now);
    await advanceSettlement(client, settlementId, now + hours(9));

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration', now + hours(9)),
      (error) => error instanceof InputError && /already fitted/i.test(error.message),
    );
  });
});

test('fuel you do not have cannot be spent, and only trips bring it in', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, { fuel: 10 });

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) => error instanceof InputError && /not enough fuel/i.test(error.message),
    );

    assert.equal(await fuelOf(client, settlementId), 10, 'nothing was deducted');
  });
});

test('an empty camp cannot start a fitting, but one in flight still finishes', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    await startUpgrade(client, settlementId, 'filtration', now);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(
      startUpgrade(client, settlementId, 'machine_shop'),
      (error) => error instanceof InputError && /nobody here to fit it/i.test(error.message),
    );

    // Fitting is building work: the crew finishes what was already on the bench.
    await advanceSettlement(client, settlementId, now + hours(9));
    const state = await loadWorld(client, settlementId);
    assert.deepEqual(state.settlement.upgrades, ['filtration']);
  });
});

test('a machine shop shortens every craft that starts after it', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );
    const now = Date.now();

    // The scrap spear is a three-hour recipe.
    const before = await startCraft(client, settlementId, 'scrap_spear', now);
    assert.equal(before.completesAt.getTime(), now + hours(3));

    await advanceSettlement(client, settlementId, now + hours(4));
    await startUpgrade(client, settlementId, 'machine_shop', now + hours(4));
    await advanceSettlement(client, settlementId, now + hours(15));

    const after = await startCraft(client, settlementId, 'scrap_spear', now + hours(15));
    assert.equal(after.completesAt.getTime(), now + hours(15) + hours(2), 'a third off');
  });
});

test('unknown upgrades are refused', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await assert.rejects(startUpgrade(client, settlementId, 'perpetual_motion'), InputError);
    await assert.rejects(startUpgrade(client, settlementId, null), InputError);
  });
});

test.after(async () => {
  await pool.end();
});
