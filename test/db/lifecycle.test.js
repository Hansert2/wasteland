import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import {
  foundSettlement,
  raiseSuccessor,
  InputError,
} from '../../src/services/settlement-lifecycle.js';
import { createSession, findSession, destroySession } from '../../src/auth/sessions.js';

const days = (d) => d * 24 * 60 * 60 * 1000;
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

const newAccount = (overrides = {}) => ({
  email: `${uniq()}@example.test`,
  password: 'correct horse battery staple',
  settlementName: 'Testcamp',
  survivorName: 'Vera',
  ...overrides,
});

test('founding a camp creates a playable starting state', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());
    const state = await loadWorld(client, settlementId);

    assert.equal(state.survivor.alive, true);
    assert.equal(state.survivor.health, 100);

    // The starting camp must be able to run food-positive, or the very first thing
    // a new player experiences is an unavoidable death.
    assert.ok(state.settlement.resources.food.ratePerHour > 0);
    assert.ok(state.settlement.resources.water.ratePerHour > 0);

    for (const kind of ['food', 'water', 'scrap', 'fuel']) {
      assert.ok(state.settlement.resources[kind], `${kind} row exists`);
    }
  });
});

test('a new camp survives a month of neglect on its own production', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());

    const { events } = await advanceSettlement(client, settlementId, Date.now() + days(30));
    assert.equal(
      events.filter((e) => e.type === 'survivor_died').length,
      0,
      'a starting camp is sustainable, so death is always a consequence of a choice',
    );
  });
});

test('registering the same email twice is a user error, not a crash', async () => {
  await withRollback(async (client) => {
    const account = newAccount();
    await foundSettlement(client, account);

    await assert.rejects(
      foundSettlement(client, { ...account, settlementName: 'Second' }),
      (error) => error instanceof InputError && /already registered/i.test(error.message),
    );
  });
});

test('a bad email or short password is refused before anything is written', async () => {
  await withRollback(async (client) => {
    const badEmail = newAccount({ email: 'not-an-email' });
    const shortPassword = newAccount({ password: 'short' });

    await assert.rejects(foundSettlement(client, badEmail), InputError);
    await assert.rejects(foundSettlement(client, shortPassword), InputError);

    // Scoped to these two accounts rather than counting the whole table: test files
    // run in parallel and the HTTP suite commits players of its own.
    const { rows } = await client.query(
      'select count(*)::int as n from players where lower(email) = any($1)',
      [[badEmail.email, shortPassword.email]],
    );
    assert.equal(rows[0].n, 0, 'nothing was written');
  });
});

test('a successor inherits a camp knocked back a level, not a fresh one', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());

    // Empty the stores so the founder starves, then let the camp stand empty a while.
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0 where settlement_id = $1 and kind in ('garden','water_purifier')`,
      [settlementId],
    );
    await advanceSettlement(client, settlementId, Date.now() + days(10));

    const before = await client.query(
      `select level from camp_structures where settlement_id = $1 and kind = 'shelter'`,
      [settlementId],
    );
    assert.equal(before.rows[0].level, 1);

    await raiseSuccessor(client, settlementId, { name: 'Boris' });

    const after = await client.query(
      `select level from camp_structures where settlement_id = $1 and kind = 'shelter'`,
      [settlementId],
    );
    assert.equal(after.rows[0].level, 0, 'the shelter fell a level');

    const state = await loadWorld(client, settlementId);
    assert.equal(state.survivor.alive, true, 'someone is holding the camp again');

    const { rows: roster } = await client.query(
      'select name from character_history where settlement_id = $1',
      [settlementId],
    );
    assert.equal(roster.length, 1, 'the founder is on the roster');
  });
});

test('a successor never leaves resources above the shrunken storage cap', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());

    await client.query('update resources set amount = storage_cap where settlement_id = $1', [
      settlementId,
    ]);
    await client.query('update characters set died_at = now(), cause_of_death = $2 where settlement_id = $1', [
      settlementId,
      'starvation',
    ]);

    await raiseSuccessor(client, settlementId, { name: 'Boris' });

    // The resources_within_cap constraint would already have rejected a bad write;
    // this asserts the invariant explicitly rather than trusting it went unnoticed.
    const { rows } = await client.query(
      'select count(*)::int as n from resources where settlement_id = $1 and amount > storage_cap',
      [settlementId],
    );
    assert.equal(rows[0].n, 0);
  });
});

test('a successor cannot be raised while someone is still alive', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());

    await assert.rejects(
      raiseSuccessor(client, settlementId, { name: 'Interloper' }),
      (error) => error instanceof InputError && /already holding/i.test(error.message),
    );
  });
});

test('a session round-trips, and is gone once destroyed', async () => {
  await withRollback(async (client) => {
    const { playerId } = await foundSettlement(client, newAccount());

    const { token } = await createSession(client, playerId);
    assert.deepEqual(await findSession(client, token), { playerId });

    await destroySession(client, token);
    assert.equal(await findSession(client, token), null);
  });
});

test('an expired session is refused and cleaned up on read', async () => {
  await withRollback(async (client) => {
    const { playerId } = await foundSettlement(client, newAccount());

    // Backdate creation far enough that the TTL has already elapsed.
    const { token } = await createSession(client, playerId, Date.now() - days(365));
    assert.equal(await findSession(client, token), null);

    // Scoped to this player: test files run in parallel, and the HTTP suite commits
    // sessions of its own, so an unscoped count would be someone else's business.
    const { rows } = await client.query(
      'select count(*)::int as n from sessions where player_id = $1',
      [playerId],
    );
    assert.equal(rows[0].n, 0, 'the stale row was swept on read');
  });
});

test('the stored session row is not the token itself', async () => {
  await withRollback(async (client) => {
    const { playerId } = await foundSettlement(client, newAccount());
    const { token } = await createSession(client, playerId);

    const { rows } = await client.query('select token_hash from sessions');
    assert.notEqual(rows[0].token_hash, token, 'a table dump must not be replayable');
  });
});

test.after(async () => {
  await pool.end();
});
