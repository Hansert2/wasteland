import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { useItem } from '../../src/services/use-item.js';
import { viewCamp } from '../../src/services/view-camp.js';

const T0 = Date.UTC(2287, 0, 1);
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

/** A camp with somebody in it, at whatever condition the test needs. */
async function seed(client, { health = 100, radiation = 0 } = {}) {
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
       values ($1, $2, 200, 100000)`,
      [settlementId, kind],
    );
  }

  const { rows: characters } = await client.query(
    `insert into characters (settlement_id, name, born_at, health, radiation)
     values ($1, 'Vera', $2, $3, $4) returning id`,
    [settlementId, new Date(T0), health, radiation],
  );

  return { settlementId, characterId: characters[0].id };
}

const give = (client, characterId, slug, qty = 1) =>
  client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select $1, id, $3 from items where slug = $2`,
    [characterId, slug, qty],
  );

async function condition(client, settlementId) {
  const { rows } = await client.query(
    'select health, radiation from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  return { health: Number(rows[0].health), radiation: Number(rows[0].radiation) };
}

async function pack(client, characterId) {
  const { rows } = await client.query(
    `select i.slug, ii.qty from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = $1 and ii.qty > 0`,
    [characterId],
  );
  return new Map(rows.map((row) => [row.slug, Number(row.qty)]));
}

test('a ration mends, and is gone', async () => {
  /*
   * Half of potency, which is anchored rather than invented: the ration moment heals a flat
   * 32 and the note beside it records that as measured against real trips. A Preserved Meal
   * at potency 70 lands on 35, either side of a number that was already tuned.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { health: 60 });
    await give(client, characterId, 'preserved_meal');

    const used = await useItem(client, settlementId, 'preserved_meal');
    assert.equal(used.health, 35, 'half of potency, in health');

    assert.deepEqual(await condition(client, settlementId), { health: 95, radiation: 0 });
    assert.equal((await pack(client, characterId)).get('preserved_meal'), undefined, 'eaten');
  });
});

test('an antirad scrubs, and cannot take more than is there', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { radiation: 10 });
    await give(client, characterId, 'rad_scrubber');

    // A scrubber is worth 22.5 rads and there are only 10 to take.
    const used = await useItem(client, settlementId, 'rad_scrubber');
    assert.equal(used.radiation, -10, 'it scrubs what is there and stops');

    const after = await condition(client, settlementId);
    assert.equal(after.radiation, 0, 'and never past zero');
    assert.equal(after.health, 100, 'a tablet is not a meal');
  });
});

test('what cannot be taken is refused rather than wasted', async () => {
  /*
   * Every one of these spends a crafted item — a scrubber is 10 fuel and 15 scrap — on
   * moving a gauge that is already at its best, or on nothing at all. The page declines to
   * offer them; this is the check behind that, because the page is a render of a moment ago.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { health: 100, radiation: 0 });
    await give(client, characterId, 'preserved_meal');
    await give(client, characterId, 'rad_scrubber');
    await give(client, characterId, 'scrap_spear');

    await assert.rejects(
      () => useItem(client, settlementId, 'preserved_meal'),
      /nothing to mend/,
      'a meal at full health',
    );
    await assert.rejects(
      () => useItem(client, settlementId, 'rad_scrubber'),
      /no dose to scrub/,
      'a tablet with no dose',
    );
    await assert.rejects(
      () => useItem(client, settlementId, 'scrap_spear'),
      /not something to take/,
      'a spear is worn, not taken',
    );
    await assert.rejects(
      () => useItem(client, settlementId, 'tinned_stew'),
      /nothing like that in the pack/,
      'and what is not carried cannot be used',
    );

    // Nothing was spent by any of them.
    const held = await pack(client, characterId);
    assert.equal(held.get('preserved_meal'), 1);
    assert.equal(held.get('rad_scrubber'), 1);
    assert.equal(held.get('scrap_spear'), 1);
  });
});

test('the pack says what each thing would do, and what it would not', async () => {
  /*
   * The row stays either way. A thing that cannot be used keeps its column empty; a thing
   * that could be used but would do nothing says why instead of offering a button — the
   * bench's rule and the moment's, because an option you cannot take must never look
   * identical to one you can.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { health: 60, radiation: 40 });
    await give(client, characterId, 'preserved_meal');
    await give(client, characterId, 'rad_scrubber');
    await give(client, characterId, 'scrap_spear');

    const offered = await viewCamp(client, settlementId, T0 + 60 * 60 * 1000);
    const by = new Map(offered.inventory.map((item) => [item.slug, item]));

    assert.equal(by.get('preserved_meal').use.effect, '+35 health');
    assert.equal(by.get('rad_scrubber').use.effect, '−22.5 rads');
    assert.equal(by.get('scrap_spear').use, null, 'a spear is carried, not taken');
    assert.equal(by.get('scrap_spear').idle, null, 'and says nothing about it');

    // Mended and clean, the same two things have nothing to offer and say so.
    await client.query(
      'update characters set health = 100, radiation = 0 where id = $1',
      [characterId],
    );
    const spent = await viewCamp(client, settlementId, T0 + 60 * 60 * 1000);
    const now = new Map(spent.inventory.map((item) => [item.slug, item]));

    assert.equal(now.get('preserved_meal').use, null);
    assert.equal(now.get('preserved_meal').idle, 'nothing to mend');
    assert.equal(now.get('rad_scrubber').idle, 'no dose to scrub');
  });
});
