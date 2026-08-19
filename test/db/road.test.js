import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { commitToRoad } from '../../src/services/commit-to-road.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { LINKS, linkCost, roadCost } from '../../src/game/road.js';
import { InputError } from '../../src/errors.js';

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

/** A camp with fuel in the stores and room to hold it. */
async function setup(client, fuel = 2000) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Roadtown',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });
  await client.query(
    `update resources set storage_cap = greatest(storage_cap, $2), amount = $2
      where settlement_id = $1 and kind = 'fuel'`,
    [settlementId, fuel],
  );
  return settlementId;
}

const fuelOf = async (client, settlementId) => {
  const { rows } = await client.query(
    `select amount from resources where settlement_id = $1 and kind = 'fuel'`,
    [settlementId],
  );
  return Number(rows[0].amount);
};

test('fuel committed to the road leaves the stores and does not come back', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 500);

    const out = await commitToRoad(client, settlementId, 30);
    assert.equal(out.index, 1);
    assert.equal(out.committed, 30);
    assert.equal(out.fuel, 30);
    assert.equal(out.cost, linkCost(1));
    assert.equal(out.completed, false);

    assert.equal(await fuelOf(client, settlementId), 470);

    // There is no verb that takes it out again, and the row is the only record of it.
    const { rows } = await client.query(
      'select fuel, completed_at from road_links where settlement_id = $1',
      [settlementId],
    );
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].fuel), 30);
    assert.equal(rows[0].completed_at, null);
  });
});

test('a link completes when its cost is met and never before', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 500);
    const cost = linkCost(1);

    const short = await commitToRoad(client, settlementId, cost - 1);
    assert.equal(short.completed, false, 'one short of the cost is not a link');

    const last = await commitToRoad(client, settlementId, 1);
    assert.equal(last.completed, true);
    assert.equal(last.fuel, cost);

    // And the next commitment starts the next link rather than topping up a finished one.
    const next = await commitToRoad(client, settlementId, 5);
    assert.equal(next.index, 2);
    assert.equal(next.cost, linkCost(2));
  });
});

test('an overpayment is trimmed to what the link still wants', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 2000);
    const cost = linkCost(1);

    // Sending everything is the obvious thing a player does, and it must not overshoot
    // into a link they have not chosen or take fuel the road has no use for.
    const out = await commitToRoad(client, settlementId, 2000);
    assert.equal(out.committed, cost);
    assert.equal(out.completed, true);
    assert.equal(await fuelOf(client, settlementId), 2000 - cost);
  });
});

test('the road refuses what it cannot be paid', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 10);

    await assert.rejects(() => commitToRoad(client, settlementId, 40), InputError);
    assert.equal(await fuelOf(client, settlementId), 10, 'a refusal costs nothing');

    for (const bad of [0, -5, 'lots', null, undefined, NaN, Infinity]) {
      await assert.rejects(() => commitToRoad(client, settlementId, bad), InputError);
    }
  });
});

test('the road ends, and there is no eighth link', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, roadCost() + 100);

    for (let i = 1; i <= LINKS; i += 1) {
      const out = await commitToRoad(client, settlementId, linkCost(i));
      assert.equal(out.index, i);
      assert.equal(out.completed, true);
    }

    assert.equal(await fuelOf(client, settlementId), 100, 'the whole road costs what it says');
    await assert.rejects(() => commitToRoad(client, settlementId, 50), InputError);

    // And the seventh completing takes nothing away.
    const view = await viewCamp(client, settlementId);
    assert.equal(view.road.reached.length, LINKS);
    assert.equal(view.road.next, null);
    assert.equal(view.road.beyond, 0);
    assert.ok(view.survivor, 'finishing the road is not an ending');
  });
});

test('a succession leaves the road alone while halving what was not committed', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 400);
    await commitToRoad(client, settlementId, linkCost(1));
    await commitToRoad(client, settlementId, 40); // part-way into the second

    const before = await fuelOf(client, settlementId);

    await client.query(
      'update characters set died_at = now(), cause_of_death = $2 where settlement_id = $1 and died_at is null',
      [settlementId, 'starvation'],
    );
    await raiseSuccessor(client, settlementId, { name: 'Heir' });

    // Committed progress is untouched: the road is what the camp remembers, and it
    // outlives the people the way the camp itself does.
    const { rows } = await client.query(
      'select link_index, fuel, completed_at from road_links where settlement_id = $1 order by link_index',
      [settlementId],
    );
    assert.equal(rows.length, 2);
    assert.equal(Number(rows[0].fuel), linkCost(1));
    assert.ok(rows[0].completed_at, 'a finished link stays finished');
    assert.equal(Number(rows[1].fuel), 40);

    // What was still in the stores is halved as it always was, which is the whole
    // balance of this: hoarding is punished, pouring it in as it arrives is not.
    assert.ok(
      (await fuelOf(client, settlementId)) <= before / 2 + 0.01,
      'uncommitted fuel is not protected',
    );
  });
});

test('the view says where the road has got to and what the next link wants', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 500);

    const fresh = await viewCamp(client, settlementId);
    assert.deepEqual(fresh.road.reached, []);
    assert.equal(fresh.road.links, LINKS);
    assert.equal(fresh.road.next.index, 1);
    assert.equal(fresh.road.next.cost, linkCost(1));
    assert.equal(fresh.road.next.fuel, 0);
    assert.equal(fresh.road.next.destination, true, 'the first link pays in a place');
    assert.ok(fresh.road.next.neighbour.length > 0, 'the next one is named');
    assert.equal(fresh.road.beyond, LINKS - 1);

    await commitToRoad(client, settlementId, linkCost(1));
    const after = await viewCamp(client, settlementId);

    assert.equal(after.road.reached.length, 1);
    const [first] = after.road.reached;
    assert.equal(first.index, 1);
    assert.ok(first.name.length > 0);
    assert.ok(first.news.length > 0);
    assert.equal(typeof first.stillThere, 'boolean');
    assert.ok(first.completedAt, 'a reached link remembers when');

    assert.equal(after.road.next.index, 2);
    assert.equal(after.road.beyond, LINKS - 2);
  });
});

test('what a link bought is never repossessed', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, 500);
    await commitToRoad(client, settlementId, linkCost(1));

    // Years later, when whoever was there is certainly gone: the link is still reached
    // and still gives what it gave. A neighbour's fate is news, not a repossession.
    const later = new Date(Date.now() + 1000 * 24 * 3600 * 1000).getTime();
    const view = await viewCamp(client, settlementId, later);

    assert.equal(view.road.reached.length, 1);
    assert.equal(view.road.reached[0].destination, true);
  });
});
