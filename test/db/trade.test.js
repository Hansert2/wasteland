import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { tradeWithCaravan } from '../../src/services/trade.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { FACTIONS, caravanVisit } from '../../src/game/factions.js';
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
 * A camp with a caravan of a *chosen* faction at the gate right now.
 *
 * The visit's faction derives from the seed, so rather than fixing the seed and
 * hoping, walk the seed's own visit sequence until the wanted crew turns up and set
 * the count there. The tick would have arrived at the same place honestly.
 */
async function setup(client, { faction = 'junction_crews', stock = 200 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  await client.query(
    `update resources set amount = least($2, storage_cap) where settlement_id = $1`,
    [settlementId, stock],
  );

  const seed = 4242;
  let count = 0;
  while (caravanVisit(seed, count).faction !== faction) count += 1;

  const now = Date.now();
  await client.query(
    `update settlements
        set caravan_seed = $2, caravan_count = $3, next_caravan_at = $4
      where id = $1`,
    [settlementId, seed, count, new Date(now - hours(1))],
  );

  return { settlementId, now };
}

const standingsOf = async (client, settlementId) => {
  const { rows } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1 order by faction',
    [settlementId],
  );
  return Object.fromEntries(rows.map((r) => [r.faction, Number(r.standing)]));
};

test('a trade pays the stores, fills the pack, and moves both standings', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client, { faction: 'junction_crews' });

    // Offer 0: rad_x ×2 for 25 scrap at list price.
    const result = await tradeWithCaravan(
      client,
      settlementId,
      { faction: 'junction_crews', offer: 0 },
      now,
    );
    assert.equal(result.bought, 'rad_x');
    assert.deepEqual(result.paid, { scrap: 25 });

    const state = await loadWorld(client, settlementId);
    assert.equal(state.settlement.resources.scrap.amount, 175, 'paid on the spot');
    assert.deepEqual(
      state.survivor.inventory.filter((i) => i.id === 'rad_x').map((i) => i.qty),
      [2],
      'and carried in from the gate',
    );

    const standings = await standingsOf(client, settlementId);
    assert.equal(standings.junction_crews, 6, 'commerce is trust');
    assert.equal(standings.green_river, -3, 'and the rival heard about it');
  });
});

test('standing prices the next trade — friends pay less', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client);

    await client.query(
      `insert into faction_standing (settlement_id, faction, standing) values ($1, 'junction_crews', 100)`,
      [settlementId],
    );

    const result = await tradeWithCaravan(
      client,
      settlementId,
      { faction: 'junction_crews', offer: 0 },
      now,
    );
    assert.deepEqual(result.paid, { scrap: 15 }, '40% off at full trust');

    const view = await viewCamp(client, settlementId, now);
    assert.equal(view.caravan.visiting, true);
    assert.deepEqual(view.caravan.offers[0].costs, { scrap: 15 }, 'the shopfront agrees');
  });
});

test('an offer priced in fuel spends fuel and never mints it', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client);

    // Offer 2: scavenged parts ×2 for 15 fuel — danger money for materials.
    await tradeWithCaravan(client, settlementId, { faction: 'junction_crews', offer: 2 }, now);

    const state = await loadWorld(client, settlementId);
    assert.equal(state.settlement.resources.fuel.amount, 185, 'fuel went out');
    assert.deepEqual(
      state.survivor.inventory.filter((i) => i.id === 'scavenged_parts').map((i) => i.qty),
      [2],
    );
  });
});

test('a bulk-resource offer lands in the stores, clamped at the cap', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client, { faction: 'green_river' });

    await client.query(
      `update resources set amount = storage_cap - 10 where settlement_id = $1 and kind = 'food'`,
      [settlementId],
    );

    // Offer 2: 60 food for 18 scrap. Only ten fit; the rest is the caravan's tip.
    await tradeWithCaravan(client, settlementId, { faction: 'green_river', offer: 2 }, now);

    const { rows } = await client.query(
      `select amount, storage_cap from resources where settlement_id = $1 and kind = 'food'`,
      [settlementId],
    );
    assert.equal(Number(rows[0].amount), Number(rows[0].storage_cap), 'full, not overfull');
  });
});

test('no caravan, no trade — and the wrong crew is refused by name', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client, { faction: 'junction_crews' });

    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'green_river', offer: 0 }, now),
      (e) => e instanceof InputError && /Junction Crews at the gate/i.test(e.message),
    );

    // Push the clock past the window: nobody is at the gate at all.
    const { rows } = await client.query(
      'select caravan_seed, caravan_count, next_caravan_at from settlements where id = $1',
      [settlementId],
    );
    const stay = caravanVisit(Number(rows[0].caravan_seed), rows[0].caravan_count).stayHours;
    const afterwards = rows[0].next_caravan_at.getTime() + stay * 3600_000 + hours(1);

    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'junction_crews', offer: 0 }, afterwards),
      (e) => e instanceof InputError && /no caravan at the gate/i.test(e.message),
    );
  });
});

test('you cannot buy with money you do not have, and nothing half-happens', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client, { stock: 5 });

    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'junction_crews', offer: 0 }, now),
      (e) => e instanceof InputError && /not enough scrap/i.test(e.message),
    );

    const state = await loadWorld(client, settlementId);
    assert.equal(state.settlement.resources.scrap.amount, 5, 'nothing was deducted');
    assert.deepEqual(await standingsOf(client, settlementId), {}, 'and no trust was minted');
  });
});

test('an empty camp cannot trade, and unknown crews and goods are refused', async () => {
  await withRollback(async (client) => {
    const { settlementId, now } = await setup(client);

    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'the_invisible_hand', offer: 0 }, now),
      InputError,
    );
    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'junction_crews', offer: 99 }, now),
      InputError,
    );

    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );
    await assert.rejects(
      tradeWithCaravan(client, settlementId, { faction: 'junction_crews', offer: 0 }, now),
      (e) => e instanceof InputError && /nobody here to meet them/i.test(e.message),
    );
  });
});

test('a successor inherits half the standing — friendships and grudges alike', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);

    await client.query(
      `insert into faction_standing (settlement_id, faction, standing)
       values ($1, 'junction_crews', 80), ($1, 'green_river', -40)`,
      [settlementId],
    );

    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );
    await raiseSuccessor(client, settlementId, { name: 'Boris' });

    const standings = await standingsOf(client, settlementId);
    assert.equal(standings.junction_crews, 40, 'the trust halved');
    assert.equal(standings.green_river, -20, 'and so did the grudge — a chance to change sides');
  });
});

test('the tick books, announces and rotates visits against the real database', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    const now = Date.now();

    // The other tests park an arrival in the past so a caravan is "at the gate now" —
    // fine for trading, but an arrival before the tick window opens is one the tick
    // can never announce (in real play arrivals are always booked ahead of the
    // clock). This test is about the announcements, so book one properly.
    await client.query('update settlements set next_caravan_at = $2 where id = $1', [
      settlementId,
      new Date(now + hours(2)),
    ]);

    const { rows: before } = await client.query(
      'select caravan_count from settlements where id = $1',
      [settlementId],
    );

    const { events } = await advanceSettlement(client, settlementId, now + hours(24 * 6));
    const arrivals = events.filter((e) => e.type === 'caravan_arrived');
    const departures = events.filter((e) => e.type === 'caravan_departed');

    assert.ok(arrivals.length >= 1, 'six days brought at least one caravan');
    // One caravan may legitimately still be at the gate when the window closes, so
    // arrivals can lead departures by exactly one and no more.
    assert.ok(
      arrivals.length === departures.length || arrivals.length === departures.length + 1,
      `${arrivals.length} arrivals vs ${departures.length} departures`,
    );

    const { rows } = await client.query(
      'select caravan_count, next_caravan_at from settlements where id = $1',
      [settlementId],
    );
    // setup() walked the count forward to find its faction, so assert the delta.
    assert.equal(
      rows[0].caravan_count - before[0].caravan_count,
      departures.length,
      'the count advanced once per departure',
    );
    assert.ok(rows[0].next_caravan_at.getTime() > now, 'with the next visit booked');
  });
});

test.after(async () => {
  await pool.end();
});
