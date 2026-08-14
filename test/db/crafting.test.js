import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { startBuild } from '../../src/services/start-build.js';
import { startCraft } from '../../src/services/start-craft.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { InputError } from '../../src/errors.js';

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
 * A camp with a workshop, plus a recipe of the test's own making.
 *
 * The seeded recipes are content and get rebalanced; a test that asserts against them
 * fails the next time someone changes a price, which teaches nobody anything. These
 * probe rows are the fixture.
 */
async function setup(client, { scrap = 300, workshop = 1, ...recipe } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  await client.query(
    `update resources set amount = $2 where settlement_id = $1 and kind = 'scrap'`,
    [settlementId, scrap],
  );
  await client.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'workshop'`,
    [settlementId, workshop],
  );

  const suffix = uniq();
  const outputSlug = `probe_spear_${suffix}`;
  const materialSlug = `probe_parts_${suffix}`;
  await client.query(
    `insert into items (slug, name, kind, potency)
     values ($1, 'Probe Spear', 'weapon', 25), ($2, 'Probe Parts', 'material', 0)`,
    [outputSlug, materialSlug],
  );

  const recipeSlug = `probe_recipe_${suffix}`;
  await client.query(
    `insert into recipes
       (slug, name, output_item_id, output_qty, costs, inputs, requires_workshop, craft_hours)
     select $1, 'Probe Spear', i.id, $2, $3, $4, $5, $6 from items i where i.slug = $7`,
    [
      recipeSlug,
      recipe.outputQty ?? 1,
      JSON.stringify(recipe.costs ?? { scrap: 20 }),
      JSON.stringify(recipe.inputs ?? []),
      recipe.requiresWorkshop ?? 1,
      recipe.craftHours ?? 3,
      outputSlug,
    ],
  );

  return { settlementId, recipeSlug, outputSlug, materialSlug };
}

async function give(client, settlementId, slug, qty) {
  await client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select c.id, i.id, $3 from characters c, items i
      where c.settlement_id = $1 and c.died_at is null and i.slug = $2`,
    [settlementId, slug, qty],
  );
}

async function carried(client, settlementId, slug) {
  const { rows } = await client.query(
    `select ii.qty from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is null and i.slug = $2`,
    [settlementId, slug],
  );
  return rows[0]?.qty ?? 0;
}

const orderRow = async (client, settlementId) => {
  const { rows } = await client.query(
    'select status, completes_at, resolved_at from craft_orders where settlement_id = $1',
    [settlementId],
  );
  return rows[0];
};

test('a craft pays up front and lands in the pack later', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug, outputSlug } = await setup(client);
    const now = Date.now();

    const order = await startCraft(client, settlementId, recipeSlug, now);
    assert.equal(order.completesAt.getTime(), now + hours(3));

    const paid = await loadWorld(client, settlementId);
    assert.equal(paid.settlement.resources.scrap.amount, 280, 'paid up front');
    assert.equal(paid.craft.status, 'active');
    assert.equal(paid.craft.output.slug, outputSlug);
    assert.equal(await carried(client, settlementId, outputSlug), 0, 'not made yet');

    const { events } = await advanceSettlement(client, settlementId, now + hours(4));
    assert.equal(events.filter((e) => e.type === 'craft_delivered').length, 1);

    assert.equal(await carried(client, settlementId, outputSlug), 1);
    const row = await orderRow(client, settlementId);
    assert.equal(row.status, 'delivered');
    assert.ok(row.resolved_at, 'a resolved order records when');

    const after = await loadWorld(client, settlementId);
    assert.equal(after.craft, null, 'the bench is free again');
  });
});

test('the bench holds one order at a time', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client);
    await startCraft(client, settlementId, recipeSlug);

    await assert.rejects(
      startCraft(client, settlementId, recipeSlug),
      (error) => error instanceof InputError && /bench is already in use/i.test(error.message),
    );
  });
});

test('crafting a spear does not block upgrading the garden', async () => {
  await withRollback(async (client) => {
    // The whole reason the craft queue is separate from the build queue.
    const { settlementId, recipeSlug } = await setup(client);
    const now = Date.now();

    await startCraft(client, settlementId, recipeSlug, now);
    await startBuild(client, settlementId, 'garden', now);

    const state = await loadWorld(client, settlementId);
    assert.equal(state.craft.status, 'active');
    assert.ok(
      state.settlement.structures.find((s) => s.kind === 'garden').buildCompletesAt,
      'both benches are busy at once',
    );
  });
});

test('a recipe beyond the workshop is refused', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { workshop: 1, requiresWorkshop: 2 });

    await assert.rejects(
      startCraft(client, settlementId, recipeSlug),
      (error) => error instanceof InputError && /workshop at level 2/i.test(error.message),
    );

    await client.query(
      `update camp_structures set level = 2 where settlement_id = $1 and kind = 'workshop'`,
      [settlementId],
    );
    await startCraft(client, settlementId, recipeSlug);
  });
});

test('materials come off the survivor’s back, not out of the stores', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug, materialSlug } = await setup(client, {
      inputs: [{ slug: 'PLACEHOLDER', qty: 2 }],
    });
    // The material slug is only known after setup, so patch the recipe to name it.
    await client.query(`update recipes set inputs = $2 where slug = $1`, [
      recipeSlug,
      JSON.stringify([{ slug: materialSlug, qty: 2 }]),
    ]);

    await give(client, settlementId, materialSlug, 1);
    await assert.rejects(
      startCraft(client, settlementId, recipeSlug),
      (error) => error instanceof InputError && /not enough probe parts/i.test(error.message),
    );

    await client.query(
      `update inventory_items ii set qty = 3
         from items i, characters c
        where i.id = ii.item_id and c.id = ii.character_id
          and c.settlement_id = $1 and i.slug = $2`,
      [settlementId, materialSlug],
    );

    await startCraft(client, settlementId, recipeSlug);
    assert.equal(await carried(client, settlementId, materialSlug), 1, 'two were spent');
  });
});

test('you cannot spend stores you do not have', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { scrap: 3 });

    await assert.rejects(
      startCraft(client, settlementId, recipeSlug),
      (error) => error instanceof InputError && /not enough scrap/i.test(error.message),
    );

    const state = await loadWorld(client, settlementId);
    assert.equal(state.settlement.resources.scrap.amount, 3, 'nothing was deducted');
    assert.equal(state.craft, null, 'and no order was started');
  });
});

test('the bench keeps working in an empty camp, but the goods are forfeit', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug, outputSlug } = await setup(client);
    const now = Date.now();

    await startCraft(client, settlementId, recipeSlug, now);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    const { events } = await advanceSettlement(client, settlementId, now + hours(4));
    assert.equal(events.filter((e) => e.type === 'craft_lost').length, 1);

    const row = await orderRow(client, settlementId);
    assert.equal(row.status, 'lost');
    assert.ok(row.resolved_at, 'a lost order still records when it ended');

    const { rows } = await client.query(
      `select count(*)::int as n from inventory_items ii
         join items i on i.id = ii.item_id
        where i.slug = $1`,
      [outputSlug],
    );
    assert.equal(rows[0].n, 0, 'nothing was made for nobody');
  });
});

test('an empty camp cannot start work at the bench either', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(
      startCraft(client, settlementId, recipeSlug),
      (error) => error instanceof InputError && /nobody here to work the bench/i.test(error.message),
    );
  });
});

test('unknown recipes are refused', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    await assert.rejects(startCraft(client, settlementId, 'moonshine'), InputError);
    await assert.rejects(startCraft(client, settlementId, null), InputError);
  });
});

test.after(async () => {
  await pool.end();
});
