import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { answerRaid } from '../../src/services/answer-raid.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { RAID_DAMAGE_PER_HOUR, RAID_WINDOW_HOURS } from '../../src/game/raids.js';
import { CONFIG } from '../../src/game/constants.js';

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

/** A camp worth robbing, with raiders due four hours in. */
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
       values ($1, $2, 600, 100000)`,
      [settlementId, kind],
    );
  }

  const ids = [];
  for (let n = 0; n < people; n += 1) {
    const { rows } = await client.query(
      `insert into characters (settlement_id, name, born_at, health, stamina)
       values ($1, $2, $3, $4, 100) returning id`,
      [settlementId, ['Vera', 'Wren', 'Hansert'][n] ?? `Someone ${n}`, new Date(T0 + n), health],
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

/**
 * What the raid itself says it has taken, rather than what the stores have done.
 *
 * The stores move for three reasons at once — the garden fills them, a survivor eats from
 * them, and raiders carry them off — so a delta across an hour measures all three. The first
 * version of these tests read the larder and compared two "hours" that were five hours and one
 * hour of production apart. The raid keeps its own books; this reads those.
 */
const raidBooks = async (client, settlementId) => {
  const { rows } = await client.query(
    `select taken, damage, resolved_at from raids where settlement_id = $1 order by at desc limit 1`,
    [settlementId],
  );
  return rows[0] ?? null;
};

const stoodFor = async (client, settlementId) => {
  const { rows } = await client.query(
    `select s.hours, s.damage, s.prevented, s.since from raid_stands s
       join raids r on r.id = s.raid_id where r.settlement_id = $1`,
    [settlementId],
  );
  return rows;
};

const survivor = async (client, id) => {
  const { rows } = await client.query('select health, stamina from characters where id = $1', [id]);
  return { health: Number(rows[0].health), stamina: Number(rows[0].stamina) };
};

test('raiders take by the hour, and the page can watch them do it', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    // One hour into a four-hour raid, with nobody at the fence.
    const view = await viewCamp(client, settlementId, T0 + 5 * HOUR);
    assert.ok(view.underRaid, 'the page says the camp is being raided');
    assert.equal(
      view.underRaid.closesAt.getTime(),
      T0 + (4 + RAID_WINDOW_HOURS) * HOUR,
      'and says when they go',
    );

    const oneHour = await raidBooks(client, settlementId);
    assert.ok(Number(oneHour.taken.food) > 0, 'an hour in, an hour of the larder is gone');

    /*
     * A second hour at the same rate. The drain is fixed when they arrive and never recomputed
     * against the falling stores, which is what lets a counter on the page extrapolate it
     * honestly — and is why these two hours have to cost the same.
     */
    await advanceSettlement(client, settlementId, T0 + 6 * HOUR);
    const twoHours = await raidBooks(client, settlementId);

    const first = Number(oneHour.taken.food);
    const second = Number(twoHours.taken.food) - first;
    assert.ok(
      Math.abs(first - second) < 0.01,
      `a fixed rate means equal hours — first ${first}, second ${second}`,
    );
  });
});

test('somebody at the fence slows the drain, and pays for every hour of it', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client);
    await give(client, ids[0], 'scrap_spear');

    // Hour one, undefended.
    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
    const before = await raidBooks(client, settlementId);
    const undefended = Number(before.taken.food);

    // Hour two, with Vera out there.
    await answerRaid(client, settlementId, [ids[0]], T0 + 5 * HOUR);
    await advanceSettlement(client, settlementId, T0 + 6 * HOUR);
    const after = await raidBooks(client, settlementId);
    const defended = Number(after.taken.food) - undefended;

    assert.ok(
      defended < undefended,
      `a defended hour should cost less — undefended ${undefended}, defended ${defended}`,
    );
    // A spear holds back 45%, so a defended hour costs the remaining 55% of an empty one.
    assert.ok(
      Math.abs(defended / undefended - 0.55) < 0.02,
      `and by the share the spear is worth — ${(defended / undefended).toFixed(2)}`,
    );

    /*
     * Read off the raid rather than off the gauge: a survivor heals two an hour while they
     * stand there, so health is the injury and the mending together and proves neither.
     */
    const [stand] = await stoodFor(client, settlementId);
    assert.ok(
      Math.abs(Number(stand.damage) - RAID_DAMAGE_PER_HOUR) < 0.6,
      `an hour at the fence costs an hour of damage — took ${stand.damage}`,
    );
    /*
     * And an hour of their day. Standing is an occupation, decided with the user, so the tick
     * charges stamina for it exactly as it does for building or the bench — nothing inside the
     * raid had to be taught about stamina at all.
     */
    const vera = await survivor(client, ids[0]);
    assert.ok(
      Math.abs(100 - vera.stamina - CONFIG.staminaPerHourWorked) < 0.1,
      `and an hour of stamina — spent ${(100 - vera.stamina).toFixed(1)}`,
    );
  });
});

test('pulling somebody back stops the bleeding, and keeps what they held', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client);
    await give(client, ids[0], 'scrap_spear');

    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
    await answerRaid(client, settlementId, [ids[0]], T0 + 5 * HOUR);
    await advanceSettlement(client, settlementId, T0 + 6 * HOUR);
    const [standing] = await stoodFor(client, settlementId);

    // Back inside, with two hours of the raid still to run.
    await answerRaid(client, settlementId, [], T0 + 6 * HOUR);
    await advanceSettlement(client, settlementId, T0 + 8 * HOUR);
    const [withdrawn] = await stoodFor(client, settlementId);

    assert.equal(
      Number(withdrawn.damage),
      Number(standing.damage),
      'no more damage once they are back inside',
    );
    assert.equal(withdrawn.since, null, 'and they are recorded as back');
    assert.ok(Math.abs(Number(withdrawn.hours) - 1) < 0.01, 'having stood for the one hour');
    assert.ok(Number(withdrawn.prevented.food) > 0, 'and keeping what they held back');
  });
});

test('a raid never kills anybody, however long they stand in it', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { health: 1 });

    await advanceSettlement(client, settlementId, T0 + 4 * HOUR);
    await answerRaid(client, settlementId, [ids[0]], T0 + 4 * HOUR);
    // The whole raid, at the fence for every hour of it.
    await advanceSettlement(client, settlementId, T0 + 9 * HOUR);

    const { rows } = await client.query('select health, died_at from characters where id = $1', [
      ids[0],
    ]);
    assert.ok(Number(rows[0].health) >= 1, `never below one — ${rows[0].health}`);
    assert.equal(rows[0].died_at, null, 'and alive');
  });
});

test('a crew holds back more than one person, and each pays their own hour', async () => {
  const held = async (howMany) => {
    let result = null;
    await withRollback(async (client) => {
      const { settlementId, ids } = await seed(client, { people: 3 });
      await give(client, ids[0], 'scrap_spear');
      await give(client, ids[1], 'scrap_spear');

      await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
      const before = await stores(client, settlementId);
      await answerRaid(client, settlementId, ids.slice(0, howMany), T0 + 5 * HOUR);
      await advanceSettlement(client, settlementId, T0 + 6 * HOUR);
      const after = await stores(client, settlementId);

      const { rows } = await client.query(
        `select count(*)::int as n from raid_stands s join raids r on r.id = s.raid_id
          where r.settlement_id = $1 and s.damage > 0`,
        [settlementId],
      );
      result = { took: before.food - after.food, hurt: rows[0].n };
    });
    return result;
  };

  const one = await held(1);
  const three = await held(3);

  assert.ok(three.took < one.took, `three hold back more — one ${one.took}, three ${three.took}`);
  assert.equal(one.hurt, 1, 'one stood, one hurt');
  assert.equal(three.hurt, 3, 'three stood, three hurt');
});

test('somebody on the road cannot stand at the fence', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client, { people: 2 });
    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
    await dispatchExpedition(client, settlementId, 'the_deep_zone', T0 + 5 * HOUR, ids[0]);

    await assert.rejects(
      () => answerRaid(client, settlementId, [ids[0]], T0 + 5 * HOUR),
      /out there/i,
      'a survivor eighteen hours down the road is not at the fence',
    );

    const out = await answerRaid(client, settlementId, [ids[1]], T0 + 5 * HOUR);
    assert.deepEqual(out.standing, ['Wren'], 'the one who is home can');
  });
});

test('a raid that has gone cannot be answered', async () => {
  await withRollback(async (client) => {
    const { settlementId, ids } = await seed(client);
    await advanceSettlement(client, settlementId, T0 + 5 * HOUR);
    await assert.rejects(
      () => answerRaid(client, settlementId, [ids[0]], T0 + 20 * HOUR),
      /already gone/i,
    );
  });
});
