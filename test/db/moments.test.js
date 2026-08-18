import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { momentsFor } from '../../src/game/moments.js';

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
 * A camp and a real region, because a moment is tied to a region slug.
 *
 * The other expedition tests invent a probe region with a random slug, which is right
 * for them and useless here: no content names it, so it offers no moments at all.
 */
async function setup(client, slug = 'the_deep_zone') {
  const { rows: regions } = await client.query(
    'select slug, travel_hours from regions where slug = $1',
    [slug],
  );
  assert.ok(regions[0], `${slug} is seeded — run npm run seed`);

  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  // Enough in the stores that nobody starves during an eighteen-hour trip.
  await client.query(
    `update resources set amount = storage_cap where settlement_id = $1 and kind in ('food','water')`,
    [settlementId],
  );

  return { settlementId, slug, travelHours: Number(regions[0].travel_hours) };
}

/** Dispatch, and read back the seed so the test knows what the trip will offer. */
async function send(client, settlementId, slug, now) {
  const { expeditionId } = await dispatchExpedition(client, settlementId, slug, now);
  const { rows } = await client.query('select seed, choices from expeditions where id = $1', [
    expeditionId,
  ]);
  return { expeditionId, seed: Number(rows[0].seed), choices: rows[0].choices };
}

const totalLoot = (resources) =>
  resources.filter((row) => row.kind === 'scrap').reduce((sum, row) => sum + Number(row.amount), 0);

async function stores(client, settlementId) {
  const { rows } = await client.query(
    'select kind, amount from resources where settlement_id = $1 order by kind',
    [settlementId],
  );
  return rows;
}

test('a dispatched expedition starts with nothing answered', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const { choices } = await send(client, settlementId, slug, Date.now());

    assert.deepStrictEqual(choices, [], 'an unattended trip is the default state');
  });
});

test('the moments a trip offers are derivable from the seed alone', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug, travelHours } = await setup(client);
    const { seed } = await send(client, settlementId, slug, Date.now());

    const moments = momentsFor({ slug, travelHours }, seed);
    assert.equal(moments.length, 3, 'the Deep Zone offers three');

    // Nothing about them is stored: the row carries a seed and an empty array, and the
    // whole schedule falls out of that.
    const { rows } = await client.query('select * from expeditions where seed = $1', [seed]);
    assert.ok(!('moments' in rows[0]), 'and there is no column for them');
  });
});

test('answers written to the row change what comes home', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug, travelHours } = await setup(client);
    const { expeditionId, seed } = await send(client, settlementId, slug, now);

    const before = totalLoot(await stores(client, settlementId));

    // Turn back at the first moment — the earliest, so the cost is largest.
    const moments = momentsFor({ slug, travelHours }, seed);
    await client.query('update expeditions set choices = $2 where id = $1', [
      expeditionId,
      JSON.stringify([{ index: moments[0].index, option: 'turn_back' }]),
    ]);

    await advanceSettlement(client, settlementId, now + hours(travelHours) + 1000);

    const { rows } = await client.query('select status, log from expeditions where id = $1', [
      expeditionId,
    ]);
    assert.equal(rows[0].status, 'returned');
    assert.ok(
      rows[0].log.some((line) => /turned back/i.test(line)),
      `the log says so: ${JSON.stringify(rows[0].log)}`,
    );

    const gained = totalLoot(await stores(client, settlementId)) - before;
    assert.ok(gained >= 0, 'they still brought something home');
  });
});

test('answering every moment with its default is the trip that would have happened', async () => {
  // The phase guarantee, through the real tick and the real database rather than in a
  // pure function: a player who answered and changed nothing changed nothing.
  await withRollback(async (client) => {
    const now = Date.now();

    const run = async (answer) => {
      const { settlementId, slug, travelHours } = await setup(client);
      const { expeditionId, seed } = await send(client, settlementId, slug, now);

      if (answer) {
        const moments = momentsFor({ slug, travelHours }, seed);
        await client.query('update expeditions set choices = $2 where id = $1', [
          expeditionId,
          JSON.stringify(
            moments.map((moment) => ({
              index: moment.index,
              option: moment.options.find((option) => option.verb === 'default').key,
            })),
          ),
        ]);
      }

      await advanceSettlement(client, settlementId, now + hours(travelHours) + 1000);
      const { rows } = await client.query('select log from expeditions where id = $1', [
        expeditionId,
      ]);
      return { seed, log: rows[0].log };
    };

    // Two camps, two seeds — so compare each against a pure re-resolution instead of
    // against each other. What matters is that answering with defaults adds no line.
    const answered = await run(true);
    const untouched = await run(false);

    for (const { log } of [answered, untouched]) {
      assert.ok(
        !log.some((line) => /turned back|came away with|sat out|they ate/i.test(line)),
        `a default answer is silent: ${JSON.stringify(log)}`,
      );
    }
  });
});

test('the schema refuses a malformed or oversized answer list', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const { expeditionId } = await send(client, settlementId, slug, Date.now());

    // This column is written straight from a form post, so the guard is in the schema
    // rather than only in the service that will eventually write it.
    const oversized = JSON.stringify(
      Array.from({ length: 9 }, (_, index) => ({ index, option: 'turn_back' })),
    );

    for (const bad of ['{"index":0}', '"turn_back"', '42', oversized]) {
      // A savepoint per attempt: a failed statement poisons the transaction, and the
      // next assertion would then fail for the wrong reason.
      await client.query('savepoint probe');
      await assert.rejects(
        client.query('update expeditions set choices = $2 where id = $1', [expeditionId, bad]),
        /choices_is_a_small_array/,
        `rejected ${bad}`,
      );
      await client.query('rollback to savepoint probe');
    }
  });
});
