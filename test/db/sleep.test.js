import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { CONFIG } from '../../src/game/constants.js';
import { startSleep } from '../../src/services/start-sleep.js';
import { startBuild } from '../../src/services/start-build.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { occupations } from '../../src/services/who-is-free.js';
import { viewCamp } from '../../src/services/view-camp.js';

const T0 = Date.UTC(2287, 0, 1);
const HOUR = 60 * 60 * 1000;
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
 * A camp with a tired survivor and stores deep enough to feed a sleeper.
 *
 * The stores matter more here than in most fixtures: recovery draws six times a mouth per
 * point, so a sleeping survivor takes eleven food an hour, and a camp that cannot meet that
 * recovers at a fraction of the rate. A test of sleep run on a thin larder is a test of
 * `fedFraction`.
 */
async function seed(client, { stamina = 40, people = 1 } = {}) {
  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );
  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at) values ($1, 'Probe', $2) returning id`,
    [players[0].id, new Date(T0)],
  );
  const settlementId = settlements[0].id;

  for (const kind of ['shelter', 'garden', 'water_purifier', 'workshop', 'watchtower']) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, 2)',
      [settlementId, kind],
    );
  }
  for (const kind of ['food', 'water', 'scrap', 'fuel']) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, 5000, 100000)`,
      [settlementId, kind],
    );
  }

  const ids = [];
  for (let n = 0; n < people; n += 1) {
    const { rows } = await client.query(
      `insert into characters (settlement_id, name, born_at, stamina)
       values ($1, $2, $3, $4) returning id`,
      [settlementId, ['Vera', 'Hansert'][n] ?? `Someone ${n}`, new Date(T0 + n), stamina],
    );
    ids.push(Number(rows[0].id));
  }

  return { settlementId, ids };
}

test('sleeping recovers at the sleeping rate, and stops when they wake', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { stamina: 40 });

    await startSleep(client, settlementId, ids[0], 4, T0);

    // Six hours: four under, two awake. The rate has to change at the fourth.
    const view = await viewCamp(client, settlementId, T0 + 6 * HOUR);
    const [person] = view.roster;

    const expected = 40 + CONFIG.staminaSleepPerHour * 4 + CONFIG.staminaRegenPerHour * 2;
    assert.ok(
      Math.abs(person.stamina - expected) < 0.01,
      `expected about ${expected}, got ${person.stamina}`,
    );
    assert.equal(person.busy, null, 'and they are free again once the hour has passed');
  });
});

test('somebody asleep cannot be sent, set to build, or put under again', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { stamina: 40 });

    await startSleep(client, settlementId, ids[0], 8, T0);

    const busy = await occupations(client, settlementId, T0 + HOUR);
    assert.equal(busy.get(ids[0])?.kind, 'sleeping');

    await assert.rejects(
      () => dispatchExpedition(client, settlementId, 'the_fence_line', T0 + HOUR, ids[0]),
      /asleep/i,
      'the gate refuses a sleeper',
    );
    await assert.rejects(
      () => startBuild(client, settlementId, 'garden', T0 + HOUR, ids[0]),
      /asleep/i,
      'and so does the yard',
    );
    await assert.rejects(
      () => startSleep(client, settlementId, ids[0], 4, T0 + HOUR),
      /already asleep/i,
      'and a second submit says what is actually true rather than quoting the rule',
    );
    /*
     * The same sentence when nobody is named, which is a different branch: without a `who`
     * the service takes the first free survivor, finds none, and falls through to the
     * camp-of-one message. Found by driving the running server rather than by either suite —
     * it answered "asleep and cannot lie down" there while the named path said "already
     * asleep", and one refusal in two voices is a page arguing with itself.
     */
    await assert.rejects(
      () => startSleep(client, settlementId, null, 4, T0 + HOUR),
      /already asleep/i,
      'named or not, one refusal',
    );
  });
});

test('a rested survivor is refused, because the hours would buy nothing', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { stamina: 100 });

    await assert.rejects(
      () => startSleep(client, settlementId, ids[0], 4, T0),
      /nothing to sleep off/i,
    );
  });
});

test('only the offered durations, and only a survivor of this camp', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { stamina: 40 });
    const { ids: elsewhere } = await seed(client, { stamina: 40 });

    await assert.rejects(() => startSleep(client, settlementId, ids[0], 5, T0), /that long/i);
    await assert.rejects(
      () => startSleep(client, settlementId, elsewhere[0], 4, T0),
      /answers to that/i,
      "another camp's survivor is not one of these",
    );
  });
});

test('a sleeper leaves the stores line, because they stop drawing on it', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { stamina: 40, people: 2 });

    const before = await viewCamp(client, settlementId, T0);
    await startSleep(client, settlementId, ids[0], 8, T0);
    const after = await viewCamp(client, settlementId, T0);

    /*
     * Both are mouths to begin with — recovery does not change what somebody eats, only how
     * hungry they get. Putting one of them under takes their whole mouth off the camp, because
     * nobody eats in their sleep, and it is asserted against `CONFIG` rather than a literal
     * because the page must never quote a draw the tick is not taking.
     */
    const drawOf = (view, kind) => view.resources.find((row) => row.kind === kind).breakdown.eaten;
    const gone = CONFIG.foodPerHour;

    const fell = drawOf(before, 'food') - drawOf(after, 'food');
    assert.ok(
      Math.abs(fell - gone) < 0.01,
      `expected the food drawn to fall by about ${gone}, got ${fell}`,
    );
  });
});
