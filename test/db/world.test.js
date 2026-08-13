import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';

const T0 = Date.UTC(2287, 0, 1);
const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);

/**
 * Every test runs inside a transaction that is always rolled back, so the suite
 * needs no teardown and leaves the development database exactly as it found it.
 * A fresh schema per run would be cleaner in a CI matrix; this is faster and the
 * database is already up.
 */
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

const uniq = () => Math.random().toString(36).slice(2, 10);

/** A camp that produces food, water and scrap — the default sustainable case. */
const SUSTAINABLE = [
  { kind: 'shelter', level: 1 },
  { kind: 'garden', level: 1 },
  { kind: 'water_purifier', level: 1 },
  { kind: 'workshop', level: 1 },
];

/** Stores only: nothing is being produced, so the camp is on borrowed time. */
const BARREN = [{ kind: 'workshop', level: 1 }];

async function seed(client, options = {}) {
  const {
    structures = SUSTAINABLE,
    amounts = { food: 50, water: 50, scrap: 0 },
    health = 100,
    radiation = 0,
    rations = 0,
    expedition = false,
  } = options;

  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );
  const playerId = players[0].id;

  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at) values ($1, 'Probe', $2) returning id`,
    [playerId, new Date(T0)],
  );
  const settlementId = settlements[0].id;

  for (const { kind, level } of structures) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, $3)',
      [settlementId, kind, level],
    );
  }

  for (const [kind, amount] of Object.entries(amounts)) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, $3, 100000)`,
      [settlementId, kind, amount],
    );
  }

  const { rows: characters } = await client.query(
    `insert into characters (settlement_id, name, born_at, health, radiation)
     values ($1, 'Vera', $2, $3, $4) returning id`,
    [settlementId, new Date(T0), health, radiation],
  );
  const characterId = characters[0].id;

  let inventoryRowId = null;
  if (rations > 0) {
    const { rows: items } = await client.query(
      `insert into items (slug, name, kind, potency) values ($1, 'Tinned Stew', 'ration', 80)
       returning id`,
      [`tinned_stew_${uniq()}`],
    );
    const { rows: inv } = await client.query(
      `insert into inventory_items (character_id, item_id, qty) values ($1, $2, $3) returning id`,
      [characterId, items[0].id, rations],
    );
    inventoryRowId = inv[0].id;
  }

  let expeditionId = null;
  if (expedition) {
    const { rows: regions } = await client.query(
      `insert into regions (slug, name, danger, travel_hours)
       values ($1, 'Ruined City', 2, 6) returning id`,
      [`ruined_city_${uniq()}`],
    );
    // Due back in a month: this fixture is about an expedition that is still in
    // flight when the survivor dies at home, so it must not resolve on its own first.
    const { rows: exps } = await client.query(
      `insert into expeditions (character_id, region_id, departed_at, returns_at, seed)
       values ($1, $2, $3, $4, $5) returning id`,
      [characterId, regions[0].id, new Date(T0), new Date(T0 + hours(24 * 30)), 1],
    );
    expeditionId = exps[0].id;
  }

  return { playerId, settlementId, characterId, inventoryRowId, expeditionId };
}

test('loadWorld translates schema vocabulary into simulation vocabulary', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);
    const state = await loadWorld(client, settlementId);

    assert.equal(state.lastTickAt, T0, 'timestamptz became epoch ms');
    // ratePerHour came from the garden's level, not from a column on this row.
    assert.deepEqual(state.settlement.resources.food, {
      amount: 50,
      ratePerHour: 1.2,
      cap: 100000,
    });
    assert.equal(state.survivor.alive, true);
    assert.equal(state.survivor.bornAt, T0);

    // pg hands back numeric and int8 as strings by default, which would turn the
    // tick's arithmetic into string concatenation. pool.js overrides that.
    assert.equal(typeof state.settlement.resources.food.amount, 'number');
    assert.equal(typeof state.survivor.health, 'number');
  });
});

test('advancing a supplied settlement accrues resources and persists them', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    await advanceSettlement(client, settlementId, T0 + hours(10));

    const reloaded = await loadWorld(client, settlementId);
    assert.equal(reloaded.lastTickAt, T0 + hours(10));
    assert.equal(reloaded.settlement.resources.scrap.amount, 10, '1/hr for 10 hours');
    assert.equal(reloaded.survivor.alive, true);
  });
});

test('advancing twice to the same instant does nothing the second time', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    await advanceSettlement(client, settlementId, T0 + hours(10));
    const once = await loadWorld(client, settlementId);
    await advanceSettlement(client, settlementId, T0 + hours(10));
    const twice = await loadWorld(client, settlementId);

    assert.deepStrictEqual(twice, once, 'no elapsed time, no production');
  });
});

test('a starved survivor is retired, and the camp keeps producing without them', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
    });

    const { events } = await advanceSettlement(client, settlementId, T0 + days(10));
    assert.equal(events.filter((e) => e.type === 'survivor_died').length, 1);

    const { rows } = await client.query(
      'select died_at, cause_of_death from characters where id = $1',
      [characterId],
    );
    assert.equal(rows[0].cause_of_death, 'starvation');
    assert.ok(rows[0].died_at, 'died_at persisted');

    // The partial unique index stops matching a dead character, so the camp loads
    // with no survivor at all — and its production is unaffected by that.
    const reloaded = await loadWorld(client, settlementId);
    assert.equal(reloaded.survivor, null);
    assert.equal(reloaded.settlement.resources.scrap.amount, 240, '1/hr for the full 10 days');
  });
});

test('the roster view lists the fallen with a cause and a lifespan', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
    });

    await advanceSettlement(client, settlementId, T0 + days(10));

    const { rows } = await client.query(
      'select name, cause_of_death, days_survived from character_history where settlement_id = $1',
      [settlementId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Vera');
    assert.ok(rows[0].days_survived > 2 && rows[0].days_survived < 3);
  });
});

test('an expedition in flight is written back as lost, satisfying the schema', async () => {
  await withRollback(async (client) => {
    const { settlementId, expeditionId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
      expedition: true,
    });

    // The check constraint refuses a non-active expedition without resolved_at, so
    // this failing would mean the tick and the schema disagree.
    await advanceSettlement(client, settlementId, T0 + days(10));

    const { rows } = await client.query(
      'select status, resolved_at from expeditions where id = $1',
      [expeditionId],
    );
    assert.equal(rows[0].status, 'lost');
    assert.ok(rows[0].resolved_at, 'resolved_at persisted');
  });
});

test('an auto-consumed ration is decremented in the database', async () => {
  await withRollback(async (client) => {
    const { settlementId, inventoryRowId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
      rations: 1,
    });

    const { events } = await advanceSettlement(client, settlementId, T0 + hours(60));
    assert.equal(events.filter((e) => e.type === 'auto_consumed').length, 1);

    const { rows } = await client.query('select qty from inventory_items where id = $1', [
      inventoryRowId,
    ]);
    assert.equal(rows[0].qty, 0, 'the ration was spent, not just simulated');
  });
});

test('advancing takes a row lock, so concurrent requests cannot double-apply', async () => {
  // The only test here that cannot use rollback isolation. A second connection cannot
  // see rows an uncommitted transaction created, so there would be nothing to contend
  // over and the lock would appear to work while proving nothing. Commit the fixture,
  // contend for real, then delete it.
  const { playerId, settlementId } = await commitFixture();

  const holder = await pool.connect();
  const rival = await pool.connect();
  try {
    await holder.query('begin');
    await advanceSettlement(holder, settlementId, T0 + hours(10));

    // `nowait` turns the wait into an immediate error, so this asserts the lock
    // rather than hanging on it.
    await rival.query('begin');
    await assert.rejects(
      rival.query('select id from settlements where id = $1 for update nowait', [settlementId]),
      (error) => error.code === '55P03',
      'expected lock_not_available',
    );
    await rival.query('rollback');
    await holder.query('rollback');
  } finally {
    holder.release();
    rival.release();
    await deleteFixture(playerId);
  }
});

/** Seed and commit, for the one test that needs data visible to another connection. */
async function commitFixture() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ids = await seed(client);
    await client.query('commit');
    return ids;
  } finally {
    client.release();
  }
}

/** Deleting the player cascades to the settlement and everything hanging off it. */
async function deleteFixture(playerId) {
  const client = await pool.connect();
  try {
    await client.query('delete from players where id = $1', [playerId]);
  } finally {
    client.release();
  }
}

test.after(async () => {
  await pool.end();
});
