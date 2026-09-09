import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { startBuild } from '../../src/services/start-build.js';
import { startCraft } from '../../src/services/start-craft.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage } from '../../src/web/render.js';
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

test('the bench and the crew are two queues, and one person cannot be in both', async () => {
  /*
   * This asserted that crafting a spear did not block upgrading the garden — "the whole
   * reason the craft queue is separate from the build queue" — and it was right about the
   * queues and wrong, once a camp could hold more than one person, about who fills them.
   *
   * The queues are still separate: a craft and a build run together all day, provided there
   * are two people. What changed on 2026-08-31 is that occupation became a fact about a
   * person, so one survivor cannot be at the bench and on the roof at the same time. That is
   * the same rule that stops them dispatching while building, and it is what Phase 10 needs
   * before stamina can be charged for crafting at all.
   */
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client);
    const now = Date.now();

    await startCraft(client, settlementId, recipeSlug, now);

    // One person: the bench has them.
    await assert.rejects(
      () => startBuild(client, settlementId, 'garden', now),
      /at the bench and cannot build/i,
      'the one survivor is already working',
    );

    // A second pair of hands, and the two queues run at once as they always could.
    await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0)`,
      [settlementId],
    );
    await startBuild(client, settlementId, 'garden', now);

    const state = await loadWorld(client, settlementId);
    assert.equal(state.craft.status, 'active');
    assert.ok(
      state.settlement.structures.find((s) => s.kind === 'garden').buildCompletesAt,
      'both queues are busy at once, with a person in each',
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
      `update camp_structures set level = 4 where settlement_id = $1 and kind = 'workshop'`,
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

/*
 * ---------------------------------------------------------------------------------------
 * The bench as a block: a slot, four things that can go in it, and the material they want.
 * ---------------------------------------------------------------------------------------
 */

/** The workshop block's own markup, so a page assertion cannot be satisfied by another block. */
function benchOf(html) {
  const at = html.indexOf('id="s-workshop"');
  assert.ok(at > -1, 'the page has a workshop section');
  const end = html.indexOf('<section', at);
  return html.slice(at, end === -1 ? html.length : end);
}

test('the time on the row is the time the order will take', async () => {
  /*
   * The bug this block existed with for as long as the Machine Shop has.
   *
   * The view sent `craft_hours` straight off the row while `startCraft` multiplied it by
   * `craftHoursMultiplier`, so with powered tools fitted every figure on the block was a
   * third too long — and the reward of the most expensive fitting in the game was invisible
   * on the one block it improves.
   *
   * Asserted against the order the service actually creates rather than against a number,
   * so retuning the fitting cannot make this pass while the page lies.
   */
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { workshop: 4, craftHours: 3 });
    await client.query(
      `insert into structure_upgrades (settlement_id, kind, upgrade, completes_at, installed_at)
       values ($1, 'workshop', 'machine_shop', now(), now())`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);
    const probe = view.recipes.find((one) => one.slug === recipeSlug);
    assert.ok(probe, 'the probe recipe reaches the page');
    assert.ok(
      Number(probe.craftHours) < Number(probe.craft_hours),
      'the tools shorten it, and the page knows',
    );

    const now = Date.now();
    const { completesAt } = await startCraft(client, settlementId, recipeSlug, now);
    const willTake = (completesAt.getTime() - now) / 3_600_000;
    assert.ok(
      Math.abs(willTake - Number(probe.craftHours)) < 1e-9,
      `the block says ${probe.craftHours}h and the order takes ${willTake}h`,
    );
  });
});

test('an order in flight does not take the rest of the bench away with it', async () => {
  /*
   * The block used to replace itself with a one-line head while it worked, so the state a
   * player meets most often was the one where the block stopped being the block. The slot
   * holds its place; the four recipes stay where they were.
   */
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { workshop: 4 });

    const before = benchOf(campPage(await viewCamp(client, settlementId), { pane: 'camp' }));
    const names = (await viewCamp(client, settlementId)).recipes.map((one) => one.name);
    for (const name of names) assert.ok(before.includes(name), `${name} is on the idle bench`);

    await startCraft(client, settlementId, recipeSlug, Date.now());
    const after = benchOf(campPage(await viewCamp(client, settlementId), { pane: 'camp' }));

    for (const name of names) assert.ok(after.includes(name), `${name} is still there`);
    assert.match(after, /class="onbench live"/, 'and the slot is holding the order');
    assert.ok(!after.includes('action="/craft"'), 'with nothing else pressable');
    assert.match(after, /Bench in use/, 'which the cells say for themselves');
  });
});

test('the fill carries a window, and no container wears the countdown marker', async () => {
  /*
   * `data-until` is the clock loop's own marker: it walks every element wearing it and
   * **replaces the text**. On a container that means the whole thing is overwritten with
   * "11s" — markup right, script right, page wrong. The fill carries a start and a span
   * instead, exactly as a rung being raised does.
   */
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { workshop: 4 });
    await startCraft(client, settlementId, recipeSlug, Date.now());
    const bench = benchOf(campPage(await viewCamp(client, settlementId), { pane: 'camp' }));

    assert.match(bench, /class="worked" data-from="\d+" data-took="\d+"/);

    const marked = [...bench.matchAll(/<(\w+)[^>]*\sdata-until="\d+"/g)].map((m) => m[1]);
    assert.ok(marked.length > 0, 'something on the bench is counting down');
    assert.ok(
      !marked.includes('div') && !marked.includes('form'),
      `a container is wearing data-until: ${[...new Set(marked)].join(', ')}`,
    );
  });
});

test('a material is explained once, on its own counter, not once per recipe', async () => {
  /*
   * Everything about `scavenged_parts` used to be printed inside the hover panel of every
   * recipe that needed them — identically, twice, and attached to the wrong noun. It is a
   * fact about the material: where it is found, who wants it, and how much is in the camp.
   */
  await withRollback(async (client) => {
    const { settlementId } = await setup(client, { workshop: 4 });

    const view = await viewCamp(client, settlementId);
    const parts = (view.materials ?? []).find((one) => one.slug === 'scavenged_parts');
    assert.ok(parts, 'the seeded material has a counter of its own');

    // Every region whose find table names it, and nothing else.
    const { rows: regions } = await client.query(
      `select name from regions where finds @> '[{"slug": "scavenged_parts"}]'::jsonb`,
    );
    assert.equal(parts.roads.length, regions.length, 'every road that drops them is named');
    assert.deepStrictEqual(
      parts.roads.map((one) => one.name).sort(),
      regions.map((one) => one.name).sort(),
    );

    // Best first, so the list can be read as a ranking rather than a table.
    for (let i = 1; i < parts.roads.length; i += 1) {
      assert.ok(parts.roads[i - 1].chance >= parts.roads[i].chance, 'ordered by odds');
    }

    // A miss returns nothing rather than one, so the average is chance × the middle of
    // the range — which is the figure "how far is a vest" is derived from.
    for (const road of parts.roads) {
      assert.ok(road.perTrip > 0 && road.perTrip <= 3, `${road.name} averages ${road.perTrip}`);
    }

    assert.ok(parts.wantedBy.length > 0, 'and it says what wants it');
    for (const want of parts.wantedBy) assert.ok(want.qty > 0);
  });
});

test('the counter counts what is in the camp, and says where it is', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client, { workshop: 4 });

    const none = (await viewCamp(client, settlementId)).materials.find(
      (one) => one.slug === 'scavenged_parts',
    );
    assert.equal(none.held, 0, 'a camp that has never walked holds none');
    assert.deepStrictEqual(none.holders, []);

    await give(client, settlementId, 'scavenged_parts', 2);
    await client.query(
      `insert into store_items (settlement_id, item_id, qty)
       select $1, id, 1 from items where slug = 'scavenged_parts'`,
      [settlementId],
    );

    const some = (await viewCamp(client, settlementId)).materials.find(
      (one) => one.slug === 'scavenged_parts',
    );
    assert.equal(some.held, 3, 'packs and the box together');
    assert.equal(some.box, 1);
    assert.equal(some.holders.length, 1);
    assert.ok(some.holders[0].name, 'and whose pack they are in');

    // The counter is a readout in a label strip, so it is spelled off the slug rather than
    // off `items.name` — which is titled, and made the strip change case with the stock.
    assert.equal(some.name, 'scavenged parts');
  });
});

test('the bench remembers what last came off it', async () => {
  await withRollback(async (client) => {
    const { settlementId, recipeSlug } = await setup(client, { workshop: 4 });

    const fresh = campPage(await viewCamp(client, settlementId), { pane: 'camp' });
    assert.match(benchOf(fresh), /has not turned anything out/, 'and says so when it has not');

    await startCraft(client, settlementId, recipeSlug, Date.now());
    await client.query(
      `update craft_orders set status = 'delivered', resolved_at = now() - interval '41 minutes'
        where settlement_id = $1 and status = 'active'`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);
    assert.ok(view.lastCraft, 'the order row outlives the event');
    assert.equal(view.lastCraft.name, 'Probe Spear');
    assert.ok(view.lastCraft.hands, 'and whose hands made it');
    assert.ok(view.lastCraft.worth, 'and what it is worth, in the pack’s own words');

    const bench = benchOf(campPage(view, { pane: 'camp' }));
    assert.match(bench, /Last off the bench/);
    assert.match(bench, /41m ago/);
  });
});

test('what a recipe makes is said in the words the pack already uses', async () => {
  /*
   * `armour 30` is a column name, not a unit of anything. `worthOf` is the pack's own
   * phrasing, exported so the two blocks cannot drift into two vocabularies for one number.
   */
  await withRollback(async (client) => {
    const { settlementId } = await setup(client, { workshop: 4 });
    await give(client, settlementId, 'plate_vest', 1);

    const view = await viewCamp(client, settlementId);
    const recipe = view.recipes.find((one) => one.slug === 'plate_vest');
    const inPack = view.roster
      .flatMap((one) => one.inventory ?? [])
      .find((one) => one.slug === 'plate_vest');

    assert.ok(recipe.worth, 'the bench says what it does');
    assert.equal(recipe.worth, inPack.worth, 'and says it exactly as the pack does');
    assert.match(recipe.worth, /%/, 'gear reads as a percentage');
    assert.ok(recipe.weighs, 'and what it weighs, which decides where it lands');
  });
});

test.after(async () => {
  await pool.end();
});
