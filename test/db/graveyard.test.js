import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { viewGraveyard } from '../../src/services/view-graveyard.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage, graveyardPage } from '../../src/web/render.js';
import { shareLeft, survives } from '../../src/game/recovery.js';

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

async function setup(client) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  return settlementId;
}

/**
 * Deaths are given an explicit hour rather than `now()`.
 *
 * Postgres `now()` is the *transaction* timestamp, and these tests run inside one
 * transaction that began before any of these survivors existed — so `now()` would
 * bury them before they were born, and bury all of them at the same instant, leaving
 * "most recent first" with nothing to sort by.
 */
const bury = async (client, settlementId, at, cause = 'starvation') => {
  await client.query(
    `update characters set died_at = $3, cause_of_death = $2
      where settlement_id = $1 and died_at is null`,
    [settlementId, cause, new Date(at)],
  );
};

/** A fixed clock, well in the past, so every lifespan is positive and known. */
const T0 = Date.now() - hours(500);

/*
 * The graveyard advances the camp now, which it did not used to.
 *
 * Records was the one page rendered from a plain read, on the grounds that the dead do
 * not change — true of the graves, and quietly wrong about the rail beside them. It runs
 * the tick like every other view, so these fixtures have to name the instant they are
 * asking about instead of letting it default to the wall clock: `T0` is five hundred
 * hours ago, and a camp advanced five hundred hours starves whoever is holding it.
 */

test('a camp nobody has died in has an empty graveyard', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    // The name is no longer the player's to give: a wanderer walks in and the camp
    // gets whoever that is. See src/game/wanderers.js.
    const { wanderer } = await raiseSuccessor(client, settlementId);

    const view = await viewGraveyard(client, settlementId, Date.now());
    assert.deepEqual(view.fallen, []);
    assert.equal(view.holding.name, wanderer.name, 'and says who is holding it');
  });
});

test('the fallen are remembered with what it cost them', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const { wanderer: first } = await raiseSuccessor(client, settlementId, { now: T0 });
    await bury(client, settlementId, T0 + hours(48), 'radiation');
    const { wanderer: second } = await raiseSuccessor(client, settlementId, {
      now: T0 + hours(49),
    });

    const view = await viewGraveyard(client, settlementId, T0 + hours(50));
    assert.equal(view.fallen.length, 1);

    const dead = view.fallen[0];
    assert.equal(dead.name, first.name);
    assert.equal(dead.cause, 'radiation');
    assert.equal(dead.daysSurvived, 2, 'held the camp two days');
    assert.equal(view.holding.name, second.name, 'someone else holds it now');
    assert.notEqual(second.name, first.name, 'and it is not the same person again');
  });
});

test('the dead are listed most recent first', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);

    let clock = T0;
    const held = [];
    for (let i = 0; i < 3; i += 1) {
      const { wanderer } = await raiseSuccessor(client, settlementId, { now: clock });
      held.push(wanderer.name);
      clock += hours(24);
      await bury(client, settlementId, clock);
      clock += hours(1);
    }

    // Three different people, because a camp meets all seven wanderers before it meets
    // anyone twice — which is what the prime count in WANDERERS buys.
    assert.equal(new Set(held).size, 3, `three arrivals, three people: ${held}`);

    const view = await viewGraveyard(client, settlementId, clock);
    assert.deepEqual(
      view.fallen.map((f) => f.name),
      [...held].reverse(),
    );
    assert.equal(view.holding, null, 'and nobody is holding the camp');
  });
});

test('a memorial records the trips they made and where they went last', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);

    // One clock for the whole test: born, sent out, home, buried. Mixing a real-time
    // birth with a past-dated death would advance the tick across the difference and
    // starve them before the assertion.
    const now = Date.now();
    await raiseSuccessor(client, settlementId, { name: 'Vera', now });

    const slug = `probe_region_${uniq()}`;
    await client.query(
      `insert into regions (slug, name, danger, travel_hours, loot, finds, radiation_per_trip)
       values ($1, 'The Long Walk', 1, 4, '{"scrap":[1,1]}'::jsonb, '[]'::jsonb, 0)`,
      [slug],
    );

    await dispatchExpedition(client, settlementId, slug, now);
    await advanceSettlement(client, settlementId, now + hours(5));
    await bury(client, settlementId, now + hours(6));

    const view = await viewGraveyard(client, settlementId, now + hours(7));
    assert.equal(view.fallen[0].trips, 1);
    assert.equal(view.fallen[0].lastRegion, 'The Long Walk');
  });
});

test('and what they were still carrying', async () => {
  await withRollback(async (client) => {
    // Nothing in the game cleans up after the dead, which is what makes this
    // possible: their pack is still sitting there to be read.
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });

    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 2 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null and i.slug = 'rad_x'`,
      [settlementId],
    );
    await bury(client, settlementId, T0 + hours(30), 'radiation');

    const view = await viewGraveyard(client, settlementId, T0 + hours(31));
    assert.deepEqual(view.fallen[0].carrying, [{ name: 'Rad-X', qty: 2 }]);
  });
});

test('an empty pack is remembered as an empty pack, not as missing data', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
    await bury(client, settlementId, T0 + hours(30));

    const view = await viewGraveyard(client, settlementId, T0 + hours(31));
    assert.deepEqual(view.fallen[0].carrying, []);
    assert.equal(view.fallen[0].trips, 0);
    assert.equal(view.fallen[0].lastRegion, null);
  });
});

test.after(async () => {
  await pool.end();
});

test('a death in the camp leaves part of the pack on the shelf, and records no place', async () => {
  /*
   * Phase 16, and the half of it that needs no trip. **Only a death out on the road leaves
   * anything to go and fetch**: somebody who starved fell in a camp that can see them, so what
   * they were carrying is settled at once rather than by sending a survivor to the fence line
   * to collect it.
   *
   * And not all of it — death still costs something at home. The share is `shareLeft` read at
   * zero hours, the same curve a recovery trip reads at however long they lay out there, so
   * the two cases cannot drift apart: they are one function.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });

    const { rows: living } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [settlementId],
    );
    const characterId = living[0].id;

    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, id, 4 from items where slug = 'scavenged_parts'`,
      [characterId],
    );

    // An empty larder and nothing growing: starvation, at home, on a clock the test owns.
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0
        where settlement_id = $1 and kind in ('garden', 'water_purifier')`,
      [settlementId],
    );

    const { events } = await advanceSettlement(client, settlementId, T0 + hours(400));

    const died = events.filter((one) => one.type === 'survivor_died');
    assert.equal(died.length, 1, 'they starved');
    assert.equal(died[0].inTheWire, true, 'inside the wire, which is the whole rule');

    const { rows: person } = await client.query(
      'select died_at_region_id, recovered_at from characters where id = $1',
      [characterId],
    );
    assert.equal(person[0].died_at_region_id, null, 'a death at home records no place');
    assert.equal(person[0].recovered_at, null, 'and nobody went and got them');

    // Four parts at seventy percent: three onto the shelf and one gone with them.
    const { rows: shelf } = await client.query(
      `select si.qty from store_items si join items i on i.id = si.item_id
        where si.settlement_id = $1 and i.slug = 'scavenged_parts'`,
      [settlementId],
    );
    assert.equal(Number(shelf[0]?.qty ?? 0), survives(4, shareLeft(0)), 'the share came in');

    const { rows: left } = await client.query(
      'select count(*)::int as n from inventory_items where character_id = $1',
      [characterId],
    );
    assert.equal(left[0].n, 0, 'and the rest is gone rather than left on a headstone');

    const came = events.filter((one) => one.type === 'pack_came_in');
    assert.equal(came.length, 1, 'the log says what came in');
    assert.equal(came[0].kept + came[0].lost, 4, 'and all four are accounted for');
  });
});

test('a death on the road records the place, and a later trip brings them home', async () => {
  /*
   * The other half of Phase 16, end to end. A survivor dies out there; the place is on the row
   * rather than inferred from their last trip; a second trip is sent to the same region to look
   * for them, pays hours for the search, and comes home with a share of what they were carrying
   * — thinned by however long they had lain out by the time anybody arrived.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
    await client.query(
      `update resources set amount = storage_cap where settlement_id = $1 and kind in ('food','water')`,
      [settlementId],
    );

    const { rows: first } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [settlementId],
    );
    const walker = first[0].id;
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, id, 4 from items where slug = 'scavenged_parts'`,
      [walker],
    );

    /*
     * Starved on the road rather than killed by its hazard, and that is the second attempt.
     *
     * The first pinned a seed the pure module said was fatal at one health — and it was not,
     * through the database: `resolveExpedition` is handed the frozen sky and the camp's clock
     * there and neither in a bare call, so the roll is a different roll. A seed pinned against
     * one path does not transfer to the other.
     *
     * Hunger does transfer. An empty larder, a survivor at one health and a full stomach-gauge
     * kills them within the hour, and eighteen hours from home means it happens out there —
     * which is all this test needs the road to do.
     */
    const { expeditionId } = await dispatchExpedition(
      client,
      settlementId,
      'the_deep_zone',
      T0,
      walker,
    );
    void expeditionId;
    await client.query(
      'update characters set health = 1, hunger = 100 where id = $1',
      [walker],
    );
    await client.query('update resources set amount = 0 where settlement_id = $1', [settlementId]);
    await client.query(
      `update camp_structures set level = 0
        where settlement_id = $1 and kind in ('garden', 'water_purifier')`,
      [settlementId],
    );
    await advanceSettlement(client, settlementId, T0 + hours(6));

    const { rows: dead } = await client.query(
      `select c.died_at, c.recovered_at, r.slug
         from characters c left join regions r on r.id = c.died_at_region_id
        where c.id = $1`,
      [walker],
    );
    /*
     * Asserted rather than skipped past. The first draft returned early if the trip turned out
     * survivable, which is a test that passes by not running — and it would have: the hazard it
     * was relying on fires on three seeds in ten, so most trips came home and the whole body of
     * this test was skipped in silence.
     */
    assert.ok(dead[0].died_at, 'an empty larder at one health kills within the hour');
    assert.equal(dead[0].slug, 'the_deep_zone', 'the place is on the row, not inferred');
    assert.equal(dead[0].recovered_at, null, 'and nobody has been yet');

    // Somebody else takes it on, and goes to look.
    await raiseSuccessor(client, settlementId, { name: 'Odd', now: T0 + hours(6) });
    const { rows: heir } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [settlementId],
    );
    await client.query('update characters set stamina = 100 where id = $1', [heir[0].id]);

    const plain = await dispatchExpedition(
      client,
      settlementId,
      'the_deep_zone',
      T0 + hours(8),
      heir[0].id,
    );
    const plainHours = (plain.returnsAt.getTime() - (T0 + hours(8))) / 3600_000;
    await client.query('delete from expeditions where id = $1', [plain.expeditionId]);

    const errand = await dispatchExpedition(
      client,
      settlementId,
      'the_deep_zone',
      T0 + hours(8),
      heir[0].id,
      walker,
    );
    const errandHours = (errand.returnsAt.getTime() - (T0 + hours(8))) / 3600_000;
    assert.ok(errandHours > plainHours, 'looking for somebody costs hours the walk does not');

    // Fed again, or the heir starves on the way and brings nobody home.
    await client.query(
      `update resources set amount = storage_cap
        where settlement_id = $1 and kind in ('food', 'water')`,
      [settlementId],
    );
    const { events } = await advanceSettlement(client, settlementId, T0 + hours(8) + hours(30));

    const home = events.filter((one) => one.type === 'brought_home');
    assert.equal(home.length, 1, 'they were brought home');
    assert.ok(home[0].kept > 0 && home[0].kept < 4, 'with some of the pack, and not all of it');

    const { rows: after } = await client.query(
      'select recovered_at from characters where id = $1',
      [walker],
    );
    assert.ok(after[0].recovered_at, 'and the stone knows it');

    const { rows: theirs } = await client.query(
      'select count(*)::int as n from inventory_items where character_id = $1',
      [walker],
    );
    assert.equal(theirs[0].n, 0, 'nothing of theirs is left out there');

    /*
     * And both halves of it reached a page, which is the part a service test cannot see.
     *
     * The stone says where they lie, and the road that holds them offers the errand with what
     * it costs — the figures on the control are the ones the service charges, computed off the
     * same walk, so the page cannot promise a shorter errand than the trip will book.
     */
    const stones = graveyardPage(await viewGraveyard(client, settlementId));
    assert.match(stones, /Brought home from The Deep Zone/, 'the stone knows they came back');

    // And a stone nobody has been for says so instead.
    await client.query('update characters set recovered_at = null where id = $1', [walker]);
    const waiting = graveyardPage(await viewGraveyard(client, settlementId));
    assert.match(waiting, /Still out at The Deep Zone/);

    /*
     * Somebody alive first, and that is not scaffolding — it is the rule the control obeys.
     *
     * The heir does not survive this test: an emptied larder, a dead garden and forty-five
     * hours of walking is what the death on the road needed, and it kills whoever goes back
     * for them too. A camp with nobody standing in it has no dispatch table at all, so the
     * errand had nowhere to render and the assertion below was reading a page that correctly
     * had no roads on it.
     */
    await raiseSuccessor(client, settlementId, { name: 'Wren', now: T0 + hours(59) });
    const { rows: standing } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [settlementId],
    );
    const roads = campPage(await viewCamp(client, settlementId, T0 + hours(60)), {
      pane: 'survivor',
      place: 'the_deep_zone',
    });
    assert.match(roads, /still out here/, 'the road that holds them offers the errand');
    assert.match(roads, new RegExp(`name="recover" value="${walker}"`));
    assert.match(roads, /of what they carried is still there, and falling/);

    await client.query('update characters set recovered_at = now() where id = $1', [walker]);

    /*
     * And a second errand for the same person is refused before anybody walks.
     *
     * Rested first, deliberately: a survivor short of stamina is refused for stamina, and a
     * test that accepts *any* refusal is a test that would pass with the recovery check
     * deleted. Asked of whoever is standing rather than of the heir, who is in the ground.
     */
    await client.query('update characters set stamina = 100 where id = $1', [standing[0].id]);
    await assert.rejects(
      () =>
        dispatchExpedition(
          client,
          settlementId,
          'the_deep_zone',
          T0 + hours(80),
          standing[0].id,
          walker,
        ),
      /Nobody of theirs is lying in/,
    );
  });
});
