import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { ORDINARY } from '../../src/game/wanderers.js';
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
 * A camp, a survivor and a region, all three tuned so the outcome is not left to chance.
 *
 * The region always was. The survivor was not, and that is what made
 * `test/db/expeditions.test.js` fail roughly two runs in five for months.
 *
 * Whoever answers the gate is drawn from the camp's seed, and they are not the same
 * person twice: scavenging runs 1 to 7 across `WANDERERS`, and `rollLoot` multiplies the
 * haul by a tenth per level either side of `ORDINARY`. So a region declaring
 * `loot: { scrap: [10, 10] }` came home with 7, 8, 9, 10, 11, 12 or 13 scrap depending
 * on who took the trip — and three of the seven fail an assertion of "at least ten".
 *
 * Pinned to `ORDINARY` rather than to a number, so a rebalance of the skill curve moves
 * this with it. Medicine too: it sets the dose a survivor burns at, which is the same
 * kind of hidden variable one radiation test away from mattering.
 *
 * The alternative — pinning the expedition's seed — would have fixed nothing. Every seed
 * returns the same haul here; the region's loot range is a single value on purpose.
 */
async function setup(client, region = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  await client.query(
    `update characters set skill_scavenging = $2, skill_medicine = $2
       where settlement_id = $1 and died_at is null`,
    [settlementId, ORDINARY],
  );

  const slug = `probe_region_${uniq()}`;
  await client.query(
    `insert into regions (slug, name, danger, travel_hours, loot, finds, radiation_per_trip)
     values ($1, 'Probe Region', $2, $3, $4, $5, $6)`,
    [
      slug,
      region.danger ?? 1,
      region.travelHours ?? 4,
      JSON.stringify(region.loot ?? { scrap: [10, 10] }),
      JSON.stringify(region.finds ?? []),
      region.radiation ?? 0,
    ],
  );

  return { settlementId, slug };
}

test('dispatching records a return time and a seed, and nothing else yet', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();

    const { expeditionId } = await dispatchExpedition(client, settlementId, slug, now);

    const { rows } = await client.query(
      'select status, returns_at, seed, resolved_at, log from expeditions where id = $1',
      [expeditionId],
    );
    assert.equal(rows[0].status, 'active');
    assert.equal(rows[0].resolved_at, null, 'the outcome is not decided at dispatch');
    assert.equal(rows[0].log, null);
    assert.ok(Number.isFinite(rows[0].seed));
    assert.equal(rows[0].returns_at.getTime(), now + hours(4));
  });
});

test('the survivor cannot be in two places at once', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    await dispatchExpedition(client, settlementId, slug);

    await assert.rejects(
      dispatchExpedition(client, settlementId, slug),
      (error) => error instanceof InputError && /already out there/i.test(error.message),
    );
  });
});

test('an unknown region is refused', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    await assert.rejects(
      dispatchExpedition(client, settlementId, 'nowhere_at_all'),
      InputError,
    );
  });
});

test('nobody can be sent from an empty camp', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(dispatchExpedition(client, settlementId, slug), InputError);
  });
});

test('the haul arrives in the settlement stores when the trip ends', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();

    const before = await loadWorld(client, settlementId);
    await dispatchExpedition(client, settlementId, slug, now);

    const { events } = await advanceSettlement(client, settlementId, now + hours(5));
    assert.equal(events.filter((e) => e.type === 'expedition_returned').length, 1);

    const after = await loadWorld(client, settlementId);
    assert.ok(
      after.settlement.resources.scrap.amount >= before.settlement.resources.scrap.amount + 10,
      'ten scrap, plus whatever the workshop made',
    );

    const { rows } = await client.query(
      `select status, log from expeditions where character_id in
         (select id from characters where settlement_id = $1)`,
      [settlementId],
    );
    assert.equal(rows[0].status, 'returned');
    assert.ok(Array.isArray(rows[0].log), 'the readable log was persisted');
  });
});

test('a found item ends up in the pack', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client, {
      finds: [{ slug: 'tinned_stew', chance: 1, qty: [2, 2] }],
    });
    await client.query(
      `insert into items (slug, name, kind, potency) values ('tinned_stew', 'Tinned Stew', 'ration', 80)
       on conflict (slug) do nothing`,
    );

    const now = Date.now();
    await dispatchExpedition(client, settlementId, slug, now);
    await advanceSettlement(client, settlementId, now + hours(5));

    const { rows } = await client.query(
      `select ii.qty from inventory_items ii
         join items i on i.id = ii.item_id
         join characters c on c.id = ii.character_id
        where c.settlement_id = $1 and i.slug = 'tinned_stew'`,
      [settlementId],
    );
    assert.equal(rows[0].qty, 2);
  });
});

test('resolving the same trip twice does not pay out twice', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const now = Date.now();
    await dispatchExpedition(client, settlementId, slug, now);

    await advanceSettlement(client, settlementId, now + hours(5));
    const once = await loadWorld(client, settlementId);

    // The expedition is no longer active, so a later tick must not find it again.
    await advanceSettlement(client, settlementId, now + hours(9));
    const twice = await loadWorld(client, settlementId);

    // Derived from the camp's actual rate rather than assumed: a starting settlement
    // has no workshop, so hardcoding a number here would test the fixture, not the code.
    const produced = once.settlement.resources.scrap.ratePerHour * 4;
    assert.equal(
      twice.settlement.resources.scrap.amount,
      once.settlement.resources.scrap.amount + produced,
      'the difference is production alone, not a second haul',
    );
  });
});

test('a survivor who starves while away is not brought home by the tick', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client, { travelHours: 200 });
    const now = Date.now();

    // Strip the camp so the founder starves long before the trip would end.
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0 where settlement_id = $1 and kind in ('garden','water_purifier')`,
      [settlementId],
    );
    await dispatchExpedition(client, settlementId, slug, now);

    const { events } = await advanceSettlement(client, settlementId, now + hours(24 * 10));

    assert.equal(events.filter((e) => e.type === 'survivor_died').length, 1);
    const { rows } = await client.query(
      `select status, resolved_at from expeditions where character_id in
         (select id from characters where settlement_id = $1)`,
      [settlementId],
    );
    assert.equal(rows[0].status, 'lost');
    assert.ok(rows[0].resolved_at, 'a lost expedition still records when it ended');
  });
});

test.after(async () => {
  await pool.end();
});
