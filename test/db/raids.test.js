import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { answerRaid } from '../../src/services/answer-raid.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { RAID_WINDOW_HOURS } from '../../src/game/raids.js';

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

/** A camp worth robbing, with a raid due four hours in. */
async function seed(client, { people = 1, health = 100, raidSeed = 4242 } = {}) {
  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );
  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at, next_raid_at, raid_seed, raid_count)
     values ($1, 'Probe', $2, $3, $4, 0) returning id`,
    [players[0].id, new Date(T0), new Date(T0 + 4 * HOUR), raidSeed],
  );
  const settlementId = settlements[0].id;

  for (const kind of ['shelter', 'garden', 'water_purifier', 'workshop']) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, 3)',
      [settlementId, kind],
    );
  }
  for (const kind of ['food', 'water', 'scrap', 'fuel']) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, 400, 100000)`,
      [settlementId, kind],
    );
  }

  const ids = [];
  for (let n = 0; n < people; n += 1) {
    const { rows } = await client.query(
      `insert into characters (settlement_id, name, born_at, health)
       values ($1, $2, $3, $4) returning id`,
      [settlementId, ['Vera', 'Wren'][n] ?? `Someone ${n}`, new Date(T0 + n), health],
    );
    ids.push(Number(rows[0].id));
  }

  return { settlementId, ids };
}

const give = (client, characterId, slug) =>
  client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select $1, id, 1 from items where slug = $2`,
    [characterId, slug],
  );

const stores = async (client, settlementId) => {
  const { rows } = await client.query(
    'select kind, amount from resources where settlement_id = $1',
    [settlementId],
  );
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.amount)]));
};

test('a raid stands open, and the page can be asked who holds the fence', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client);
    await give(client, ids[0], 'scrap_spear');

    // Two hours into the window: the raiders are in the yard and nothing has gone yet.
    const view = await viewCamp(client, settlementId, T0 + 6 * HOUR);
    assert.ok(view.underRaid, 'the page says the camp is being raided');
    assert.equal(
      view.underRaid.closesAt.getTime(),
      T0 + (4 + RAID_WINDOW_HOURS) * HOUR,
      'and says when they go',
    );
    /*
     * The raid has taken nothing, which is not the same as the stores being untouched —
     * a survivor eats through those six hours. Read it off the raid rather than off the
     * larder, or this asserts the appetite instead of the mechanic.
     */
    const { rows: standing } = await client.query(
      'select taken, resolved_at from raids where settlement_id = $1',
      [settlementId],
    );
    assert.deepEqual(standing[0].taken, {}, 'nothing carried off while the answer is open');
    assert.equal(standing[0].resolved_at, null, 'and the raid is still standing');
    assert.ok(view.roster[0].stands > 0.4, 'a survivor with a spear is worth putting out there');

    const before = await stores(client, settlementId);
    const out = await answerRaid(client, settlementId, ids[0], T0 + 6 * HOUR);
    const after = await stores(client, settlementId);

    assert.ok(out.damage > 0, 'standing costs the defender');
    assert.ok(after.food < before.food, 'and they still took something');

    const { rows } = await client.query(
      'select stood_by, resolved_at from raids where settlement_id = $1',
      [settlementId],
    );
    assert.equal(Number(rows[0].stood_by), ids[0], 'the raid records who stood');
    assert.ok(rows[0].resolved_at, 'and is settled');
  });
});

test('hiding costs more of the stores and none of anybody', async () => {
  /*
   * The two paths on the same seed and the same camp, which is the only honest way to compare
   * them: everything but the answer is identical.
   */
  const outcomeWhen = async (answer) => {
    let result = null;
    await withRollback(async (client) => {
      const { settlementId, ids } = await seed(client);
      await give(client, ids[0], 'scrap_spear');
      const before = await stores(client, settlementId);

      if (answer) {
        await advanceSettlement(client, settlementId, T0 + 6 * HOUR);
        await answerRaid(client, settlementId, ids[0], T0 + 6 * HOUR);
      } else {
        // Let the window shut on silence.
        await advanceSettlement(client, settlementId, T0 + 12 * HOUR);
      }

      const after = await stores(client, settlementId);
      const { rows } = await client.query(
        'select health from characters where settlement_id = $1',
        [settlementId],
      );
      result = { took: before.food - after.food, health: Number(rows[0].health) };
    });
    return result;
  };

  const stood = await outcomeWhen(true);
  const hid = await outcomeWhen(false);

  assert.ok(
    hid.took > stood.took,
    `hiding should cost more of the stores — hid ${hid.took}, stood ${stood.took}`,
  );
  assert.equal(hid.health, 100, 'and nobody is hurt by a raid they hid from');
  assert.ok(stood.health < 100, 'while the one who stood came off badly');
});

test('answering wounds but never kills, however badly it goes', async () => {
  /*
   * The settled rule, and this is the only place it can still be reached: the tick cannot
   * name a defender, so nothing there ever deals raid damage at all. The floor lives here now.
   */
  let answered = 0;
  for (const raidSeed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    await withRollback(async (client) => {
      const { settlementId, ids } = await seed(client, { health: 1, raidSeed });
      await advanceSettlement(client, settlementId, T0 + 5 * HOUR);

      const { rows: open } = await client.query(
        'select id from raids where settlement_id = $1 and resolved_at is null',
        [settlementId],
      );
      if (open.length === 0) return; // turned away at the fence on this seed, which is fine

      answered += 1;
      await answerRaid(client, settlementId, ids[0], T0 + 5 * HOUR);
      const { rows } = await client.query(
        'select health, died_at from characters where settlement_id = $1',
        [settlementId],
      );
      assert.equal(Number(rows[0].health), 1, `seed ${raidSeed} took them below 1`);
      assert.equal(rows[0].died_at, null, `seed ${raidSeed} killed them outright`);
    });
  }
  assert.ok(answered > 0, 'every seed was repelled, so the floor was never actually tested');
});

test('somebody on the road cannot stand at the fence', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { people: 2 });
    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);

    const { rows: region } = await client.query(
      `select id from regions where slug = 'the_fence_line'`,
    );
    // A trip hangs off the character, not the settlement — the camp is reached through them.
    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, seed)
       values ($1, $2, 'active', $3, $4, 1)`,
      [ids[0], region[0].id, new Date(T0 + 4.5 * HOUR), new Date(T0 + 20 * HOUR)],
    );

    await assert.rejects(
      () => answerRaid(client, settlementId, ids[0], T0 + 5 * HOUR),
      /out there/i,
      'a survivor twenty hours down the road is not at the fence',
    );

    /*
     * And the one who is home can — which is the half the old code got wrong. The damage used
     * to land on `state.survivor`, the founder, whether or not they were anywhere near it.
     */
    const out = await answerRaid(client, settlementId, ids[1], T0 + 5 * HOUR);
    assert.equal(out.name, 'Wren');
  });
});

test('a window that has shut cannot be answered', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client);
    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
    await assert.rejects(
      () => answerRaid(client, settlementId, ids[0], T0 + 20 * HOUR),
      /already gone/i,
    );
  });
});
