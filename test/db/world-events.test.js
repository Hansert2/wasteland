import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { ensureWorldEvents, loadWorldEvents } from '../../src/db/world-events.js';
import { WORLD_EPOCH, activeAt } from '../../src/game/world-events.js';

const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);

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

const count = async (client) => {
  const { rows } = await client.query('select count(*)::int as n from world_events');
  return rows[0].n;
};

test('the world generates its own weather on demand, with nothing scheduled', async () => {
  await withRollback(async (client) => {
    // There is no cron anywhere in this project. A camp resolving an absence has to
    // be able to produce the weather that happened during it, on the spot.
    const written = await ensureWorldEvents(client, WORLD_EPOCH + days(40));
    assert.ok(written > 0, 'it made some weather');

    const events = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(40));
    assert.ok(events.length > 0);

    for (const event of events) {
      assert.ok(event.endsAt > event.startsAt, 'every window runs forwards');
      assert.ok(['rad_storm', 'caravan', 'blight'].includes(event.kind));
    }
  });
});

test('generating twice writes nothing the second time', async () => {
  await withRollback(async (client) => {
    await ensureWorldEvents(client, WORLD_EPOCH + days(30));
    const after = await count(client);

    const written = await ensureWorldEvents(client, WORLD_EPOCH + days(30));
    assert.equal(written, 0, 'the same request adds nothing');
    assert.equal(await count(client), after, 'and the table is unchanged');
  });
});

test('two camps ticking at once agree about the sky', async () => {
  await withRollback(async (client) => {
    // Every camp computes the missing slots itself; the primary key decides who wins
    // the insert, and both must end up looking at the same weather either way.
    await ensureWorldEvents(client, WORLD_EPOCH + days(25));
    const first = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(25));

    await ensureWorldEvents(client, WORLD_EPOCH + days(25));
    const second = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(25));

    assert.deepEqual(first, second);
  });
});

test('the window loads what overlaps it, not merely what starts inside it', async () => {
  await withRollback(async (client) => {
    // A tick replaying six weeks must see a blight that began before the window
    // opened and was still running inside it.
    await ensureWorldEvents(client, WORLD_EPOCH + days(60));
    const all = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(60));
    assert.ok(all.length > 2, 'enough weather to pick a straddling one from');

    const straddled = all[1];
    const midway = straddled.startsAt + (straddled.endsAt - straddled.startsAt) / 2;

    const window = await loadWorldEvents(client, midway, midway + hours(1));
    assert.ok(
      window.some((e) => e.slot === straddled.slot),
      'an event already in progress is still in force',
    );
    assert.deepEqual(activeAt(window, midway).map((e) => e.slot).includes(straddled.slot), true);
  });
});

test('asking for a shorter stretch than already exists is not a rewrite', async () => {
  await withRollback(async (client) => {
    await ensureWorldEvents(client, WORLD_EPOCH + days(60));
    const long = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(60));

    await ensureWorldEvents(client, WORLD_EPOCH + days(5));
    const after = await loadWorldEvents(client, WORLD_EPOCH, WORLD_EPOCH + days(60));

    assert.deepEqual(after, long, 'history is not rewritten by a smaller request');
  });
});

test.after(async () => {
  await pool.end();
});
