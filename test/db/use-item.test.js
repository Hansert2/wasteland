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
    assert.equal(by.get('scrap_spear').idle, null, 'and is not idle either — it is worn');

    /*
     * And every row says what the thing is worth, which the pack has never done. A Plate
     * Vest sat here as a name and a count while `equipmentOf` read its potency on every
     * trip; both gear figures are capped, so what is shown is what would actually apply.
     */
    assert.equal(by.get('scrap_spear').worth, 'avoids 25% of hazards');
    assert.equal(by.get('preserved_meal').worth, '+35 health', 'what the ration is worth');
    assert.ok(by.get('preserved_meal').description, 'and every item has its own line');

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

test('a thing worth more than the moment says so', async () => {
  /*
   * A Rad-X is worth thirty rads. A survivor carrying one rad can still take it, and would
   * spend the whole tablet to scrub that one — which is their call to make and only a
   * decision if the page tells them. So the row carries both figures: what the thing is
   * worth, and what taking it here and now would actually do.
   *
   * Only when they differ. The ordinary case must not be two rows saying one number.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { health: 100, radiation: 1 });
    await give(client, characterId, 'rad_x');

    const trace = await viewCamp(client, settlementId, T0 + 60 * 60 * 1000);
    const tablet = trace.inventory.find((item) => item.slug === 'rad_x');

    // Read back rather than hardcoded: `viewCamp` advances the camp, and an hour of decay
    // takes 0.8 off the dose before the page is ever drawn.
    const { radiation } = await condition(client, settlementId);
    assert.ok(radiation > 0 && radiation < 1, `a trace of a dose, not ${radiation}`);

    assert.equal(tablet.worth, '−30 rads', 'what a Rad-X is worth');
    assert.equal(
      tablet.use.effect,
      `−${Math.round(radiation * 10) / 10} rads`,
      'and what it would do against the dose actually carried',
    );
    assert.notEqual(tablet.worth, tablet.use.effect, 'so the page has two things to say');

    await client.query('update characters set radiation = 80 where id = $1', [characterId]);
    const dosed = await viewCamp(client, settlementId, T0 + 60 * 60 * 1000);
    const full = dosed.inventory.find((item) => item.slug === 'rad_x');
    assert.equal(full.worth, full.use.effect, 'and only one when the whole tablet lands');
  });
});
