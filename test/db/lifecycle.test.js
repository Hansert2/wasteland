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
  ...overrides,
});

test('founding a camp creates a camp and nobody in it', async () => {
  await withRollback(async (client) => {
    // An account owns a camp and never a person. Founding stops at the camp, and the
    // first survivor arrives the same way every later one does.
    const { settlementId } = await foundSettlement(client, newAccount());
    const state = await loadWorld(client, settlementId);

    assert.equal(state.survivor, null, 'nobody has moved in yet');

    // The starting camp must be able to run food-positive, or the very first thing
    // a new player experiences is an unavoidable death.
    assert.ok(state.settlement.resources.food.ratePerHour > 0);
    assert.ok(state.settlement.resources.water.ratePerHour > 0);

    for (const kind of ['food', 'water', 'scrap', 'fuel']) {
      assert.ok(state.settlement.resources[kind], `${kind} row exists`);
    }
  });
});

test('the first survivor moves into a whole camp, not a knocked-back one', async () => {
  await withRollback(async (client) => {
    // You cannot inherit a ruin from nobody: the successor penalty is for successors.
    const { settlementId } = await foundSettlement(client, newAccount());

    const before = await loadWorld(client, settlementId);
    const stores = Object.fromEntries(
      Object.entries(before.settlement.resources).map(([kind, r]) => [kind, r.amount]),
    );

    await raiseSuccessor(client, settlementId, { name: 'Vera' });
    const after = await loadWorld(client, settlementId);

    assert.equal(after.survivor.alive, true);
    assert.equal(after.survivor.health, 100);

    const shelterBefore = before.settlement.structures.find((s) => s.kind === 'shelter');
    const shelter = after.settlement.structures.find((s) => s.kind === 'shelter');
    assert.equal(shelter.level, shelterBefore.level, 'the shelter did not fall on the way in');
    assert.ok(shelter.level > 0, 'and there was something there to lose');

    for (const [kind, amount] of Object.entries(stores)) {
      assert.equal(after.settlement.resources[kind].amount, amount, `${kind} was not halved`);
    }
  });
});

test('a new camp survives a month of neglect on its own production', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await foundSettlement(client, newAccount());
    await raiseSuccessor(client, settlementId, { name: 'Vera' });

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
    await raiseSuccessor(client, settlementId, { name: 'Vera' });

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
    const stood = Number(before.rows[0].level);
    assert.ok(stood > 0, 'there was a shelter to lose');

    await raiseSuccessor(client, settlementId, { name: 'Boris' });

    const after = await client.query(
      `select level from camp_structures where settlement_id = $1 and kind = 'shelter'`,
      [settlementId],
    );
    assert.ok(
      Number(after.rows[0].level) < stood,
      `the shelter fell: ${stood} -> ${after.rows[0].level}`,
    );

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
    await raiseSuccessor(client, settlementId, { name: 'Vera' });

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
    await raiseSuccessor(client, settlementId, { name: 'Vera' });

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

test('a camp is founded with the sun its browser implied, not with a number it asked for', async () => {
  /*
   * Migration 016 gave the camp a solar noon and left the player to set it, which is a
   * number nobody knows about themselves. It comes from the browser's zone instead.
   *
   * This asserts the wiring end to end because the last two bugs in this area were both
   * wiring: `loadWorld` never selected the column, and a `Number(x) ?? 720` that could
   * never fire. Both suites stayed green through both, because a default is quiet. So the
   * assertion here is deliberately that a *non*-default value survives the round trip.
   */
  await withRollback(async (client) => {
    const amsterdam = await foundSettlement(
      client,
      newAccount({ clockOffset: 120, zone: 'Europe/Amsterdam' }),
    );
    const warsaw = await foundSettlement(
      client,
      newAccount({ clockOffset: 120, zone: 'Europe/Warsaw' }),
    );

    const sunOf = async (settlementId) => {
      const { rows } = await client.query(
        'select clock_offset_minutes, solar_noon_minutes from settlements where id = $1',
        [settlementId],
      );
      return rows[0];
    };

    const a = await sunOf(amsterdam.settlementId);
    const b = await sunOf(warsaw.settlementId);

    assert.equal(a.solar_noon_minutes, 820, 'Amsterdam keeps its sun at 13:40');
    assert.equal(b.solar_noon_minutes, 756, 'Warsaw keeps its own at 12:36');
    assert.equal(a.clock_offset_minutes, b.clock_offset_minutes, 'on an identical clock');

    // And the tick sees it, which is the half that was missing last time.
    const world = await loadWorld(client, amsterdam.settlementId);
    assert.equal(world.settlement.solarNoon, 820 / 60);
  });
});

test('a camp founded without a zone stands on the idealised sky', async () => {
  /*
   * A browser too old for `Intl.DateTimeFormat().resolvedOptions()`, a zone nobody
   * listed, or a form posted with scripting off. None of these should refuse the camp or
   * guess at it: the default is noon at 12:00, which is the sky the game had before any
   * of this and is a correct sky rather than a wrong one.
   */
  await withRollback(async (client) => {
    const cases = [
      ['no zone at all', {}],
      ['a zone nobody listed', { zone: 'Antarctica/Troll' }],
      ['something that is not a zone', { zone: '; drop table settlements' }],
    ];

    for (const [what, overrides] of cases) {
      const { settlementId } = await foundSettlement(
        client,
        newAccount({ clockOffset: 120, ...overrides }),
      );
      const { rows } = await client.query(
        'select solar_noon_minutes from settlements where id = $1',
        [settlementId],
      );
      assert.equal(rows[0].solar_noon_minutes, 720, what);
    }
  });
});
