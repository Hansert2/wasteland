import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { grantItems } from '../../src/db/world.js';
import { moveItem } from '../../src/services/move-item.js';
import { startCraft } from '../../src/services/start-craft.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';

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

/** A camp with one person in it and everything built. */
async function seed(client, { stores = 200, lastTickAt = T0, producing = true } = {}) {
  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );
  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at) values ($1, 'Probe', $2) returning id`,
    [players[0].id, new Date(lastTickAt)],
  );
  const settlementId = settlements[0].id;

  const built = producing
    ? ['shelter', 'garden', 'water_purifier', 'workshop', 'watchtower']
    : ['shelter', 'workshop', 'watchtower'];
  for (const kind of built) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, 5)',
      [settlementId, kind],
    );
  }
  for (const kind of ['food', 'water', 'scrap', 'fuel']) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, $3, 100000)`,
      [settlementId, kind, stores],
    );
  }

  const { rows: characters } = await client.query(
    `insert into characters (settlement_id, name, born_at) values ($1, 'Vera', $2) returning id`,
    [settlementId, new Date(T0)],
  );

  return { settlementId, characterId: characters[0].id };
}

const give = (client, characterId, slug, qty = 1) =>
  client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select $1, id, $3 from items where slug = $2
     on conflict (character_id, item_id) do update set qty = inventory_items.qty + $3`,
    [characterId, slug, qty],
  );

const bank = (client, settlementId, slug, qty = 1) =>
  client.query(
    `insert into store_items (settlement_id, item_id, qty)
     select $1, id, $3 from items where slug = $2
     on conflict (settlement_id, item_id) do update set qty = store_items.qty + $3`,
    [settlementId, slug, qty],
  );

const carried = async (client, characterId, slug) => {
  const { rows } = await client.query(
    `select ii.qty from inventory_items ii join items i on i.id = ii.item_id
      where ii.character_id = $1 and i.slug = $2`,
    [characterId, slug],
  );
  return rows[0]?.qty ?? 0;
};

const banked = async (client, settlementId, slug) => {
  const { rows } = await client.query(
    `select si.qty from store_items si join items i on i.id = si.item_id
      where si.settlement_id = $1 and i.slug = $2`,
    [settlementId, slug],
  );
  return rows[0]?.qty ?? 0;
};

test('one verb carries things both ways', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await give(client, characterId, 'scavenged_parts', 3);

    await moveItem(client, settlementId, {
      from: characterId,
      to: 'box',
      slug: 'scavenged_parts',
      qty: 2,
    });
    assert.equal(await carried(client, characterId, 'scavenged_parts'), 1);
    assert.equal(await banked(client, settlementId, 'scavenged_parts'), 2);

    await moveItem(client, settlementId, {
      from: 'box',
      to: characterId,
      slug: 'scavenged_parts',
      qty: 2,
    });
    assert.equal(await carried(client, characterId, 'scavenged_parts'), 3);
    assert.equal(await banked(client, settlementId, 'scavenged_parts'), 0);
  });
});

test('the box outlives the person who filled it', async () => {
  /*
   * The whole reason the box is a table of its own. `inventory_items` cascades on the
   * character by design since migration 001, and this asserts the box stands outside that
   * cascade rather than merely happening to survive today.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await give(client, characterId, 'tinned_stew', 1);
    await bank(client, settlementId, 'tinned_stew', 2);

    await client.query('delete from characters where id = $1', [characterId]);

    assert.equal(await banked(client, settlementId, 'tinned_stew'), 2);
    const { rows } = await client.query(
      'select count(*)::int as n from inventory_items where character_id = $1',
      [characterId],
    );
    assert.equal(rows[0].n, 0);
  });
});

test('a pack that cannot take it says how short it is', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    // 9 kg of vest and 2 kg of spear leaves about 4 kg, and five coils of parts are 3.75 kg.
    await give(client, characterId, 'plate_vest', 1);
    await give(client, characterId, 'scrap_spear', 1);
    await bank(client, settlementId, 'scavenged_parts', 12);

    await assert.rejects(
      moveItem(client, settlementId, {
        from: 'box',
        to: characterId,
        slug: 'scavenged_parts',
        qty: 12,
      }),
      /cannot carry that/,
    );

    // And nothing moved: a refusal is not a partial transfer.
    assert.equal(await banked(client, settlementId, 'scavenged_parts'), 12);
    assert.equal(await carried(client, characterId, 'scavenged_parts'), 0);
  });
});

test('nothing changes hands while a raid is open', async () => {
  /*
   * The raid rests on `standFor` reading a carried weapon. Free transfers mid-raid would
   * turn "who stands" into "who can be handed the spear", which is the decision Phase 12 is
   * built on.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await give(client, characterId, 'scrap_spear', 1);

    await client.query(
      `insert into raids (settlement_id, at, closes_at, seed, faction, per_hour)
       values ($1, $2, $3, 1, 'junction_crews', $4::jsonb)`,
      [settlementId, new Date(T0), new Date(T0 + 4 * 3600000), JSON.stringify({ food: 2 })],
    );

    await assert.rejects(
      moveItem(client, settlementId, { from: characterId, to: 'box', slug: 'scrap_spear' }),
      /at the fence/,
    );
    assert.equal(await carried(client, characterId, 'scrap_spear'), 1);
  });
});

test('the bench reaches into the box', async () => {
  /*
   * The fault this phase opens on: finds land on whoever walked, so the parts for one vest
   * end up spread around. With the box reachable, banking them is enough.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await bank(client, settlementId, 'scavenged_parts', 2);

    await startCraft(client, settlementId, 'plate_vest', T0);

    assert.equal(await banked(client, settlementId, 'scavenged_parts'), 0);
    const { rows } = await client.query(
      `select status from craft_orders where settlement_id = $1`,
      [settlementId],
    );
    assert.equal(rows[0].status, 'active');
  });
});

test('the bench spends the pack before it spends the box', async () => {
  // A survivor's own materials are the ones that die with them, so spending those first is
  // the ordering that loses least.
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await give(client, characterId, 'scavenged_parts', 1);
    await bank(client, settlementId, 'scavenged_parts', 5);

    await startCraft(client, settlementId, 'plate_vest', T0);

    assert.equal(await carried(client, characterId, 'scavenged_parts'), 0);
    assert.equal(await banked(client, settlementId, 'scavenged_parts'), 4);
  });
});

test('a find that will not fit is left where it was found', async () => {
  await withRollback(async (client) => {
    const { characterId } = await seed(client);
    await give(client, characterId, 'plate_vest', 1);
    await give(client, characterId, 'scrap_spear', 1);

    // About 4 kg free, and six coils of parts are 4.5 kg.
    const leftBehind = await grantItems(client, characterId, [
      { slug: 'scavenged_parts', qty: 6 },
    ]);

    assert.deepEqual(leftBehind, [{ slug: 'scavenged_parts', qty: 1 }]);
    assert.equal(await carried(client, characterId, 'scavenged_parts'), 5);
  });
});

test('the safety valve eats the pack and never the box', async () => {
  /*
   * Banking your emergency rations is how you die with a full larder. The structural half of
   * this is that `loadWorld` never reads `store_items`, so the tick cannot spend what it
   * cannot see; this asserts the behaviour that follows from it.
   */
  await withRollback(async (client) => {
    const sixtyHours = 60 * 3600000;
    const { settlementId, characterId } = await seed(client, {
      stores: 0,
      lastTickAt: T0 - sixtyHours,
      producing: false,
    });
    await bank(client, settlementId, 'tinned_stew', 3);

    await advanceSettlement(client, settlementId, T0);

    assert.equal(await banked(client, settlementId, 'tinned_stew'), 3);
    const { rows } = await client.query('select health, died_at from characters where id = $1', [
      characterId,
    ]);
    assert.ok(
      rows[0].died_at !== null || Number(rows[0].health) < 100,
      'sixty hours with nothing in the stores should cost them, box or no box',
    );
  });
});
