import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { startBuild } from '../../src/services/start-build.js';
import { startCraft } from '../../src/services/start-craft.js';
import { startUpgrade } from '../../src/services/start-upgrade.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage } from '../../src/web/render.js';
import { takeInWanderer } from '../../src/services/take-in-wanderer.js';
import { UPGRADES } from '../../src/game/structures.js';
import { CONFIG } from '../../src/game/constants.js';
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

/** A camp with fuel in the tank and the structures the fuel track needs. */
async function setup(client, { fuel = 200, purifier = 4, workshop = 4 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  await client.query(
    `update resources set amount = $2 where settlement_id = $1 and kind = 'fuel'`,
    [settlementId, fuel],
  );
  await client.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'water_purifier'`,
    [settlementId, purifier],
  );
  await client.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'workshop'`,
    [settlementId, workshop],
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

test('fitting an upgrade pays fuel now and installs it later', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    const order = await startUpgrade(client, settlementId, 'filtration', now);
    assert.equal(order.completesAt.getTime(), now + UPGRADES.filtration.hours * 3600_000);
    assert.equal(await fuelOf(client, settlementId), 140, 'paid up front');

    const paid = await loadWorld(client, settlementId);
    assert.equal(paid.fitting.upgrade, 'filtration');
    assert.deepEqual(paid.settlement.upgrades, [], 'not a capability yet');

    const { events } = await advanceSettlement(client, settlementId, now + hours(9));
    assert.equal(events.filter((e) => e.type === 'upgrade_fitted').length, 1);

    const done = await loadWorld(client, settlementId);
    assert.deepEqual(done.settlement.upgrades, ['filtration']);
    assert.equal(done.fitting, null, 'the crew is free again');
  });
});

test('the crew does one job: a build and a fitting cannot run together', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startUpgrade(client, settlementId, 'filtration');
    await assert.rejects(
      startBuild(client, settlementId, 'garden'),
      (error) => error instanceof InputError && /fitting the filtration/i.test(error.message),
    );
  });
});

test('and the same the other way round', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startBuild(client, settlementId, 'garden');
    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) => error instanceof InputError && /already being worked on/i.test(error.message),
    );
  });
});

test('the bench is a different queue, but not a different pair of hands', async () => {
  /*
   * Fitting shares the build queue and not the craft queue: they are different work and
   * always were. What changed on 2026-08-31 is that a queue being free is no longer enough —
   * somebody has to be free to stand in it, and one survivor cannot be at the purifier with
   * a filter in pieces and at the bench with a spear at the same time.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startUpgrade(client, settlementId, 'filtration');

    await assert.rejects(
      () => startCraft(client, settlementId, 'scrap_spear'),
      /fitting something and cannot work the bench/i,
      'the only survivor is holding the filter',
    );

    // With somebody else in the camp, the two queues run at once as they always could.
    await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0)`,
      [settlementId],
    );
    await startCraft(client, settlementId, 'scrap_spear');

    const state = await loadWorld(client, settlementId);
    assert.equal(state.fitting.upgrade, 'filtration');
    assert.equal(state.craft.status, 'active', 'both are in flight, one person in each');
  });
});

test('an upgrade needs the structure it bolts onto', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, { purifier: 1 });

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) =>
        error instanceof InputError &&
        new RegExp(`water purifier at level ${UPGRADES.filtration.requiresLevel}`, 'i')
          .test(error.message),
    );

    await client.query(
      `update camp_structures set level = 4 where settlement_id = $1 and kind = 'water_purifier'`,
      [settlementId],
    );
    await startUpgrade(client, settlementId, 'filtration');
  });
});

test('an upgrade is fitted once, not levelled', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    await startUpgrade(client, settlementId, 'filtration', now);
    await advanceSettlement(client, settlementId, now + hours(9));

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration', now + hours(9)),
      (error) => error instanceof InputError && /already fitted/i.test(error.message),
    );
  });
});

test('fuel you do not have cannot be spent, and only trips bring it in', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client, { fuel: 10 });

    await assert.rejects(
      startUpgrade(client, settlementId, 'filtration'),
      (error) => error instanceof InputError && /not enough fuel/i.test(error.message),
    );

    assert.equal(await fuelOf(client, settlementId), 10, 'nothing was deducted');
  });
});

test('an empty camp cannot start a fitting, but one in flight still finishes', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const now = Date.now();

    await startUpgrade(client, settlementId, 'filtration', now);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
      [settlementId],
    );

    await assert.rejects(
      startUpgrade(client, settlementId, 'machine_shop'),
      (error) => error instanceof InputError && /nobody here to fit it/i.test(error.message),
    );

    // Fitting is building work: the crew finishes what was already on the bench.
    await advanceSettlement(client, settlementId, now + hours(9));
    const state = await loadWorld(client, settlementId);
    assert.deepEqual(state.settlement.upgrades, ['filtration']);
  });
});

test('a machine shop shortens every craft that starts after it', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );
    const now = Date.now();

    // Read the recipe rather than restate it: craft times moved from hours to
    // minutes with the pacing rescale, and this test is about the multiplier.
    const { rows: recipe } = await client.query(
      `select craft_hours from recipes where slug = 'scrap_spear'`,
    );
    const stated = Number(recipe[0].craft_hours);

    const before = await startCraft(client, settlementId, 'scrap_spear', now);
    assert.equal(before.completesAt.getTime(), now + Math.round(stated * 3600_000));

    await advanceSettlement(client, settlementId, now + hours(4));
    await startUpgrade(client, settlementId, 'machine_shop', now + hours(4));
    await advanceSettlement(client, settlementId, now + hours(15));

    const after = await startCraft(client, settlementId, 'scrap_spear', now + hours(15));
    assert.equal(
      after.completesAt.getTime(),
      now + hours(15) + Math.round(stated * (2 / 3) * 3600_000),
      'a third off',
    );
  });
});

/** Fit filtration for real, then bury the survivor who paid for it. */
async function fitThenKill(client, settlementId) {
  const now = Date.now();
  await startUpgrade(client, settlementId, 'filtration', now);
  await advanceSettlement(client, settlementId, now + hours(9));

  await client.query(
    `update characters set died_at = now(), cause_of_death = 'starvation' where settlement_id = $1`,
    [settlementId],
  );
  await raiseSuccessor(client, settlementId, { name: 'Wren' });
}

const levelOf = async (client, settlementId, kind) => {
  const { rows } = await client.query(
    'select level from camp_structures where settlement_id = $1 and kind = $2',
    [settlementId, kind],
  );
  return Number(rows[0].level);
};

test('a successor loses an upgrade the knocked-back camp can no longer hold up', async () => {
  await withRollback(async (client) => {
    // Fitted at exactly the level it needs, so the successor's knock takes it under.
    const needed = UPGRADES.filtration.requiresLevel;
    const settlementId = await setup(client, { purifier: needed });
    await fitThenKill(client, settlementId);

    const left = await levelOf(client, settlementId, 'water_purifier');
    assert.ok(left < needed, `knocked back from ${needed} to ${left}`);

    const state = await loadWorld(client, settlementId);
    assert.deepEqual(state.settlement.upgrades, [], 'filtration came off with the camp');

    // And it is genuinely gone, not merely hidden: it can be bought again.
    await client.query(
      `update camp_structures set level = 4 where settlement_id = $1 and kind = 'water_purifier'`,
      [settlementId],
    );
    await startUpgrade(client, settlementId, 'filtration');
  });
});

test('but a structure built past the requirement carries its upgrade through', async () => {
  await withRollback(async (client) => {
    // This is the decision the rule creates: overbuilding is insurance against death.
    // Built far enough past the requirement that the knock cannot take it under.
    const needed = UPGRADES.filtration.requiresLevel;
    const settlementId = await setup(client, { purifier: needed + 2 });
    await fitThenKill(client, settlementId);

    const left = await levelOf(client, settlementId, 'water_purifier');
    assert.ok(left >= needed, `survived the knock at ${left}, needing ${needed}`);

    const state = await loadWorld(client, settlementId);
    assert.deepEqual(state.settlement.upgrades, ['filtration'], 'the successor inherits it');
  });
});

test('the radio buys the hour of the next raid, and nothing else', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update camp_structures set level = 4 where settlement_id = $1 and kind = 'watchtower'`,
      [settlementId],
    );
    const now = Date.now();

    // The tick books a raid on its first run whether anyone can see it or not.
    await advanceSettlement(client, settlementId, now);
    const blind = await viewCamp(client, settlementId, now);
    assert.equal(blind.raidExpectedAt, null, 'without the radio the hour is not yours to know');

    const { rows: scheduled } = await client.query(
      'select next_raid_at from settlements where id = $1',
      [settlementId],
    );
    assert.ok(scheduled[0].next_raid_at, 'though it is certainly scheduled');

    await startUpgrade(client, settlementId, 'radio', now);
    await advanceSettlement(client, settlementId, now + hours(9));

    const warned = await viewCamp(client, settlementId, now + hours(9));
    assert.ok(warned.raidExpectedAt, 'fitted, and the hour is on the page');

    // Informational only: it must not move the raid it reports.
    const { rows: after } = await client.query(
      'select next_raid_at, raid_count from settlements where id = $1',
      [settlementId],
    );
    assert.equal(
      after[0].next_raid_at.getTime(),
      scheduled[0].next_raid_at.getTime(),
      'the radio reports the raid, it does not reschedule it',
    );
    assert.equal(after[0].raid_count, 0, 'and does not conjure one');
  });
});

test('unknown upgrades are refused', async () => {
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await assert.rejects(startUpgrade(client, settlementId, 'perpetual_motion'), InputError);
    await assert.rejects(startUpgrade(client, settlementId, null), InputError);
  });
});

test.after(async () => {
  await pool.end();
});

test('a bed is the one fitting there can be more than one of', async () => {
  /*
   * Every other fitting is an instrument and one is enough: a second clock tells the same
   * hour. A bed is capacity, so the shelter's level is a ceiling rather than a gate, and
   * three things that were true of every fitting stop being true of this one.
   *
   * It is also priced in scrap where they are priced in fuel — no region a new camp can
   * reach returns any fuel, so a fuel-priced bed could not be bought inside the first day
   * or two, which is the window the roster exists to hit.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const T0 = Date.now();

    // A founded camp starts at shelter 2, which is the level that holds the first bed.
    await client.query(
      "update resources set amount = 40 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );

    const scrapOf = async () => {
      const { rows } = await client.query(
        "select amount from resources where settlement_id = $1 and kind = 'scrap'",
        [settlementId],
      );
      return Number(rows[0].amount);
    };

    // Paid in scrap, not fuel, and read before the camp is advanced — the workshop makes
    // scrap, so any elapsed hour puts production between the price and the balance.
    const before = await scrapOf();
    await startUpgrade(client, settlementId, 'bed', T0);
    assert.equal(await scrapOf(), before - 12, 'twelve scrap for a bed, paid up front');

    const fuelBefore = await fuelOf(client, settlementId);
    await advanceSettlement(client, settlementId, T0 + hours(2));
    assert.equal(await fuelOf(client, settlementId), fuelBefore, 'and no fuel at all');

    // A shelter at 2 holds one, and says so rather than saying it is already fitted.
    await assert.rejects(
      () => startUpgrade(client, settlementId, 'bed', T0 + hours(2)),
      /holds 1 of those/,
      'the refusal names the ceiling',
    );

    /*
     * Deepen the shelter and its ceiling rises — but a second ceiling is behind it.
     *
     * A camp may be one bed ahead and never two, so with one survivor and one empty bed the
     * shelter's depth is no longer what is in the way, and the refusal has to say which of
     * the two it is: a deeper shelter fixes one and somebody arriving fixes the other.
     */
    await client.query(
      "update camp_structures set level = 4 where settlement_id = $1 and kind = 'shelter'",
      [settlementId],
    );
    await assert.rejects(
      () => startUpgrade(client, settlementId, 'bed', T0 + hours(2)),
      /spare bed is still empty/,
      'the shelter holds two now, and the camp still has use for one',
    );

    // Somebody sleeps in it, and the next one is bought at the moment it is about to matter.
    await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0)`,
      [settlementId],
    );
    await startUpgrade(client, settlementId, 'bed', T0 + hours(3));
    await advanceSettlement(client, settlementId, T0 + hours(5));

    const { rows: beds } = await client.query(
      `select ordinal from structure_upgrades
        where settlement_id = $1 and upgrade = 'bed' and installed_at is not null
        order by ordinal`,
      [settlementId],
    );
    assert.deepEqual(
      beds.map((row) => row.ordinal),
      [1, 2],
      'two beds, numbered — the unique key is on the ordinal, so a reused one is refused',
    );
  });
});

test('a bed makes room, and somebody is at the gate the next morning', async () => {
  /*
   * The arrival beat. A bed is what makes room and the hour is what makes it a moment: the
   * first eight in the morning after the bed was ready, on the camp's own clock. You build
   * it in the evening and meet them over breakfast, which is the rhythm the per-camp clock
   * was added for and the first thing to use it.
   *
   * Derived rather than stored, so this also pins the derivation: a column would have to be
   * written by whatever made the bed free — a build finishing, a death, a shelter knocked
   * down by a succession — and every one of those is a place it could be forgotten.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update settlements set clock_offset_minutes = 0, last_tick_at = $2 where id = $1`,
      [settlementId, new Date(Date.UTC(2287, 2, 4, 19))],
    );
    await client.query(
      "update resources set amount = 60 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );

    const evening = Date.UTC(2287, 2, 4, 19);
    const gateOf = async (when) => (await viewCamp(client, settlementId, when)).atTheGate;

    assert.equal(await gateOf(evening), null, 'no bed, no gate');

    await startUpgrade(client, settlementId, 'bed', evening);
    await advanceSettlement(client, settlementId, evening + hours(1));

    // Built at seven in the evening, and nobody comes that night.
    const waiting = await gateOf(evening + hours(1));
    assert.ok(waiting, 'the bed is made');
    assert.equal(waiting.wanderer, null, 'and nobody is there yet');
    assert.equal(
      waiting.dueAt.getTime(),
      Date.UTC(2287, 2, 5, 8),
      'they come at eight, on the camp clock',
    );
    assert.equal((await gateOf(Date.UTC(2287, 2, 5, 7))).wanderer, null, 'not at seven');

    // Eight, and they wait rather than passing through: a player who checks in at noon
    // must not have missed them, which is what the whole check-in design is arranged for.
    const morning = await gateOf(Date.UTC(2287, 2, 5, 8));
    assert.ok(morning.wanderer, 'somebody is at the gate');
    assert.ok(morning.wanderer.skills?.length, 'and the page says what they are worth');
    const noon = await gateOf(Date.UTC(2287, 2, 5, 12));
    assert.equal(noon.wanderer.name, morning.wanderer.name, 'still the same person at noon');

    // Taken in, the camp holds two and the gate closes behind them.
    const { wanderer } = await takeInWanderer(client, settlementId, {
      now: Date.UTC(2287, 2, 5, 9),
    });
    assert.equal(wanderer.name, morning.wanderer.name, 'the page named who actually walked in');

    const world = await loadWorld(client, settlementId);
    assert.equal(world.survivors.length, 2, 'two people, both loaded');
    assert.equal(await gateOf(Date.UTC(2287, 2, 5, 10)), null, 'and the bed is taken');

    await assert.rejects(
      () => takeInWanderer(client, settlementId, { now: Date.UTC(2287, 2, 5, 11) }),
      /Every bed in this camp is taken/,
    );
  });
});

test('every block that occupies somebody says who, and keeps its own answer', async () => {
  /*
   * Three verbs occupy a person — going, building or fitting, and the bench — and each keeps
   * its own answer: the bench's is not the structures table's, and a page where changing one
   * changed all three would be one decision wearing three labels.
   *
   * **All three ask on the row now**, as of 2026-09-02: Send on a road, Build and Fit on a
   * structure. The names hang off the control you were already reaching for, so no block
   * carries a selector in its strip except the bench, which still has one.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );
    await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0)`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);
    const html = campPage(view, { pane: 'camp' }) + campPage(view, { pane: 'survivor' });

    assert.doesNotMatch(html, /data-whopicks=/, 'no block asks in its strip any more');
    assert.doesNotMatch(html, /data-whofield=/, 'and no row carries an answer set somewhere else');

    /*
     * Each asks on its own row, with every name a submit button of its own. No hidden field
     * and no script: the browser posts the `who` belonging to whichever name was pressed.
     */
    for (const verb of ['Send', 'Build', 'Fit', 'Make']) {
      assert.ok(
        html.includes(`class="lead">${verb}`),
        `${verb} is not offered on the row that needs it`,
      );
    }
    assert.match(
      html,
      /<button type="submit" name="who" value="\d+">/,
      'and a name to press is a submit button carrying that person',
    );

    // Both survivors can be pressed somewhere, since neither is busy.
    const offered = [
      ...new Set(
        [...html.matchAll(/<button type="submit" name="who" value="(\d+)">/g)].map((m) => m[1]),
      ),
    ];
    assert.equal(offered.length, 2, 'both free survivors can be pressed');
  });
});

test('somebody already working is shown as working, and cannot be chosen', async () => {
  /*
   * Reported from a live camp: Wren was set to fit a bed and stayed selectable for a trip
   * and for the bench. `whoSelector` filtered on a `busy` field the view never set, so every
   * dropdown offered somebody the service would refuse after the click — the exact fault the
   * bench rows and the moment options exist to avoid.
   *
   * The view reads `occupations`, the same source the refusals read, so the page and the
   * refusal cannot disagree about who is free. And the busy are listed rather than dropped:
   * a name that vanishes reads as a bug, where a name that says what it is doing reads as a
   * person who is occupied.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );
    const { rows } = await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0) returning id`,
      [settlementId],
    );
    const odd = rows[0].id;

    await startUpgrade(client, settlementId, 'filtration', Date.now(), odd);

    const view = await viewCamp(client, settlementId);
    const busy = view.roster.find((one) => one.id === odd);
    assert.equal(busy.busy, 'fitting', 'the view knows what they are doing');

    const html = campPage(view, { pane: 'camp' }) + campPage(view, { pane: 'survivor' });

    /*
     * Going is asked on the road now, so the refusal is a name in the Send menu rather than
     * a radio on a card — under the same rule either way: the control keeps its place and
     * refuses, because a name that vanishes reads as a bug where one that is there and will
     * not be pressed reads as a person who is occupied.
     *
     * `[^]` rather than the usual any-character class: this pattern is built in a template
     * literal, where a lone backslash-s collapses to a bare s before RegExp ever sees it.
     */
    const inMenu = new RegExp(
      `<ul class="names">[^]*?<button type="button" disabled>Odd<span class="why">([^<]*)</span>`,
    ).exec(html);
    assert.ok(inMenu, 'the Send menu still lists them');
    assert.equal(inMenu[1], 'fitting', 'and says what has them, where no card is beside it');
    assert.doesNotMatch(
      html,
      new RegExp(`<button type="submit" name="who" value="${odd}">`),
      'and offers no way to send them',
    );

    /*
     * And every other verb refuses them the same way, in its own menu. [^] rather than the
     * usual any-character class: this pattern is built in a template literal, where a lone
     * backslash-s collapses to a bare s before RegExp ever sees it.
     */
    const refusals = [...html.matchAll(/<button type="button" disabled>Odd<span class="why">([^<]*)</g)];
    assert.ok(refusals.length >= 4, `only ${refusals.length} menus refuse them`);
    for (const [, why] of refusals) assert.equal(why, 'fitting', 'and each says what has them');

    /*
     * And the block says it first.
     *
     * The strip used to name everybody and their job — "Hansert is away, Wren is fitting" —
     * on all three blocks that ask who, so one screen carried the same roster three times in
     * captions. Occupation is a fact about a person, so it is stated under that person's own
     * name, once; the strip only reports that the choice is closed.
     */
    assert.equal(busy.busyWith, 'filtration', 'and which job it is');

    /*
     * The chip says the verb, and the view still knows the job.
     *
     * It said both — "fitting · filtration" — until the name line proved too narrow for it:
     * the pair wrapped under the name in a 190px column. What the chip answers is *is this
     * person free, and when*; which fitting they are raising is on the structures table
     * under a heading that says so. The view keeps `busyWith` because the refusals read it.
     */
    assert.match(
      html,
      /<div class="who-name">Odd<span class="doing">fitting/,
      "the survivor's own block says what has them",
    );

    /*
     * And says when it ends. Sleep was the only occupation whose clock this card could
     * reach, because the hour sat on the survivor's own row; every other job was named and
     * left open-ended, which is a state a player cannot plan around.
     */
    assert.ok(busy.busyUntil, 'the view carries the hour the job ends');
    assert.match(
      html,
      /<div class="who-name">Odd<span class="doing">[^]*?<span class="clock"/,
      'a timed job shows its countdown beside the name',
    );
  });
});

test('the bed row says what it costs, and which ceiling is holding it', async () => {
  /*
   * Two things the page got wrong about the one fitting that is not an instrument.
   *
   * It priced every fitting in fuel — `${upgrade.fuel} fuel` — so the bed, the only one
   * bought with scrap, advertised "undefined fuel, 30m" and then took twelve scrap. The
   * view had already had to learn the distinction to report a shortfall honestly; the
   * label never did.
   *
   * And a bed the camp has nobody for is not "fitted". The room is there and the scrap is
   * there — what is missing is a person — so saying "fitted" sends the player to the
   * shelter's level track to fix something the level track has nothing to do with.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update resources set amount = 200 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );
    await client.query(
      "update camp_structures set level = 8 where settlement_id = $1 and kind = 'shelter'",
      [settlementId],
    );

    /*
     * The bed's card off the workbench, read as text.
     *
     * It was an inset row on the shelter's line until the structures block became a ladder
     * and a bench; the two facts below are the same two, asked of the card that replaced it.
     */
    const bedRow = async () => {
      const view = await viewCamp(client, settlementId);
      const html = campPage(view, { pane: 'camp' });
      const card = /<div class="fitcard [^"]*">[^]*?<span class="nm">A Bed<\/span>([^]*?)<\/div>/.exec(html);
      assert.ok(card, 'the workbench carries a bed');
      return card[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    };

    assert.match(await bedRow(), /12 scrap, 30m/, 'priced in the currency it actually takes');
    assert.doesNotMatch(await bedRow(), /fuel/, 'and never in the one it does not');

    await startUpgrade(client, settlementId, 'bed', Date.now());
    await client.query(
      `update structure_upgrades
          set completes_at = now() - interval '1 hour', installed_at = now() - interval '1 hour'
        where settlement_id = $1 and upgrade = 'bed'`,
      [settlementId],
    );

    // A shelter at 8 holds four. What is in the way is that nobody has come to sleep in the
    // first, so the row says that rather than claiming the shelter is full.
    const held = await bedRow();
    assert.match(held, /the spare is empty/, 'the page names the ceiling that is actually binding');
    assert.doesNotMatch(held, /[Ff]itted/, 'and does not claim the shelter has no room');
    assert.doesNotMatch(held, /another at/, 'nor points at a level that would not help');
  });
});

test('a full bed row names the level that buys the next one', async () => {
  /*
   * Reported from play on 2026-09-03: a camp took in a survivor, went to build the bed for
   * them, and found the row saying "fitted" with the shelter beside it offering level 5.
   *
   * Both statements were true and the pair was useless. Beds step every second level, so a
   * shelter at 4 and a shelter at 5 hold the same two — the level on offer buys 125 storage
   * and no bed — and "fitted" pointed at a level track that would not have helped for two
   * more levels. The row now says which level, which is the only part of it a player cannot
   * work out from the page.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update camp_structures set level = 4 where settlement_id = $1 and kind = 'shelter'",
      [settlementId],
    );
    // Two beds standing, and three people to fill them: the roster ceiling has to be clear
    // of the way, or the row would be answering `waiting` instead.
    await client.query(
      `insert into structure_upgrades (settlement_id, kind, upgrade, ordinal, completes_at, installed_at)
       values ($1, 'shelter', 'bed', 1, now() - interval '1 hour', now() - interval '1 hour'),
              ($1, 'shelter', 'bed', 2, now() - interval '1 hour', now() - interval '1 hour')`,
      [settlementId],
    );
    await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0), ($1, 'Wren', now(), 100, 0)`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);
    const shelter = view.structures.find((one) => one.kind === 'shelter');
    const bed = shelter.upgrades.find((one) => one.slug === 'bed');
    assert.equal(bed.fitted, true, 'the shelter has no room for another');
    assert.equal(bed.waiting, false, 'and the thing in the way is the shelter, not the roster');
    assert.equal(bed.nextAt, 6, 'the third bed wants a shelter at 6');

    const html = campPage(view, { pane: 'camp' });
    const card = /<div class="fitcard [^"]*">[^]*?<span class="nm">A Bed<\/span>([^]*?)<\/div>/.exec(html);
    assert.ok(card, 'the workbench still carries the bed');
    const said = card[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    assert.match(said, /2 fitted/, 'the card still says there is no room, and how many stand');
    assert.match(said, /another at shelter 6/, 'and says what buys the room');
  });
});

test('the road offers every name, and only the free ones can be pressed', async () => {
  /*
   * The invariant that lets who-goes live on the road.
   *
   * It used to live on the person: a radio outside every form, and eleven hidden fields the
   * client kept in step with it, so the card drawn as picked and the id in those fields had
   * to agree before a line of script ran or somebody with JavaScript off sent a person they
   * did not pick. **That whole class of disagreement is gone**: a name is a submit button
   * carrying its own id, and the browser posts the one that was pressed.
   *
   * What has to hold now is smaller and stronger — every free survivor is offered on every
   * road, and nobody occupied can be pressed anywhere.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'",
      [settlementId],
    );
    const { rows } = await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation)
       values ($1, 'Odd', now(), 100, 0) returning id`,
      [settlementId],
    );

    // Occupy the founder, so the free one is not simply the first in the roster.
    const view0 = await viewCamp(client, settlementId);
    const founder = view0.roster.find((one) => one.id !== rows[0].id);
    await startUpgrade(client, settlementId, 'filtration', Date.now(), founder.id);

    const view = await viewCamp(client, settlementId);
    const html = campPage(view, { pane: 'survivor' });

    const sendable = [
      ...new Set(
        [...html.matchAll(/<button type="submit" name="who" value="(\d+)">/g)].map((m) => m[1]),
      ),
    ];
    assert.deepEqual(sendable, [String(rows[0].id)], 'only the free one can be sent');

    const menus = (html.match(/<button type="button" class="lead">Send/g) ?? []).length;
    const roads = (html.match(/action="\/expedition"/g) ?? []).length;
    assert.equal(menus, roads, 'every road asks, and asks the same way');

    // The occupied are listed and refused rather than dropped.
    assert.match(html, new RegExp(`<button type="button" disabled>${founder.name}`));

    assert.doesNotMatch(html, /data-whopicks="send"/, 'the dropdown is gone');
    assert.doesNotMatch(html, /name="sending"/, 'and so is the radio on the card');
    assert.match(html, /<h2>The roads out/, 'and the block is named for what is left in it');
  });
});

test('nothing with nothing standing is ever reported as fitted', async () => {
  /*
   * Reported from play on 2026-09-01: a brand new camp said the Glass, the Radio,
   * filtration and the machine shop were all fitted. Every one is a fuel instrument behind
   * a level-4 structure, on a camp whose watchtower and workshop were at nought.
   *
   * `fitted` was `standing >= allowed`, and `fittingsAllowed` answers **0** for a structure
   * below the fitting's required level — so nought of nought read as "no room for another"
   * and the page called it done. The worst thing to be wrong about in that direction: it
   * tells a new player they have already got the thing they are supposed to be working
   * towards, and the row stops offering the level track that would get them there.
   *
   * The invariant is the one sentence that cannot be got wrong by arithmetic: **a fitting
   * with none standing is not fitted.** Asserted across every structure and every branch of
   * a fresh camp rather than against the four that were reported, because the fault was in
   * a comparison and comparisons are wrong for whole classes at a time.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const view = await viewCamp(client, settlementId);

    let checked = 0;
    for (const structure of view.structures) {
      for (const upgrade of structure.upgrades ?? []) {
        checked += 1;
        if (upgrade.standing === 0) {
          assert.equal(
            upgrade.fitted,
            false,
            `${upgrade.name}: none standing, and the page says fitted`,
          );
          assert.equal(
            upgrade.waiting,
            false,
            `${upgrade.name}: none standing, and the page says a spare is empty`,
          );
        }
        if (structure.level < upgrade.requiresLevel) {
          assert.equal(
            upgrade.fitted,
            false,
            `${upgrade.name}: needs ${structure.kind} ${upgrade.requiresLevel}, ` +
              `the camp has ${structure.level}, and the page says fitted`,
          );
        }
      }
    }
    assert.ok(checked >= 4, `only ${checked} fittings on the page, so this checked nothing`);
  });
});

test('the stores line counts every mouth in the camp, and what recovery draws', async () => {
  /*
   * The page priced one survivor however many were standing there.
   *
   * `eats` was `state.survivor ? one mouth : {}` — truthy the moment anybody was alive, and
   * then a single draw for the whole camp. A camp of four was told its water climbed 6.75 an
   * hour when it climbed 6.0, and `planFor`, which prices every door in hours-until-you-can-
   * afford-it, read the same wrong number. The simulation was never wrong: `simulateSurvivor`
   * draws per person and the walk covers the roster. Only the page counted one.
   *
   * Recovery is the other half and the larger one. A survivor paying back stamina drinks six
   * times a mouth, so a camp that has just come home draws several times what an idle one
   * does — which is exactly when a player is looking at the stores line.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const one = await viewCamp(client, settlementId);
    const drawOf = (view, kind) =>
      view.resources.find((row) => row.kind === kind).breakdown.eaten;

    const solo = drawOf(one, 'water');
    assert.ok(solo > 0, 'a camp of one draws something');

    /*
     * Held by id, not by name.
     *
     * The first version updated `where name = 'Odd'`, and the camp's founder is named from
     * the wanderer pool — which on this seed is also Odd. Both rows were set resting and the
     * draw came back at twice what the assertion expected. A game that picks the names is a
     * game where a name is not a key.
     */
    const { rows: added } = await client.query(
      `insert into characters (settlement_id, name, born_at, health, radiation, stamina)
       values ($1, 'Odd', now(), 100, 0, 100) returning id`,
      [settlementId],
    );
    const odd = added[0].id;
    const two = await viewCamp(client, settlementId);
    assert.equal(drawOf(two, 'water'), solo * 2, 'two mouths draw twice as much water');
    assert.equal(
      drawOf(two, 'food'),
      drawOf(one, 'food') * 2,
      'and twice as much food',
    );

    /*
     * And paying back stamina changes the draw by nothing at all.
     *
     * It used to multiply it by six, which was how food came to limit labour. **The rule from
     * the user on 2026-08-31 is that only hunger may draw on the stores**: recovery is charged
     * in hunger, hunger sends somebody to eat, and eating is the one thing that takes food. So
     * a recovering survivor is a mouth like any other, and the line this test guards should
     * not move when one of them starts paying stamina back.
     */
    await client.query('update characters set stamina = 40 where id = $1', [odd]);
    const resting = await viewCamp(client, settlementId);

    assert.equal(
      drawOf(resting, 'food'),
      drawOf(two, 'food'),
      'recovering is not eating; it is what makes somebody eat',
    );
    assert.equal(
      drawOf(resting, 'water'),
      drawOf(two, 'water'),
      'and the same for water',
    );

    /*
     * Asleep is the one state that does move it, and downwards: nobody eats in their sleep.
     */
    await client.query(
      "update characters set sleep_until = now() + interval '8 hours' where id = $1",
      [odd],
    );
    const sleeping = await viewCamp(client, settlementId);
    assert.equal(
      drawOf(sleeping, 'food'),
      drawOf(two, 'food') - CONFIG.foodPerHour,
      'a sleeper leaves the stores line entirely',
    );
  });
});

/*
 * ---------------------------------------------------------------------------------------
 * The structures block as a ladder and a bench.
 * ---------------------------------------------------------------------------------------
 */

test('every structure is drawn on the same scale, so the gates line up', async () => {
  /*
   * The reason the table went. **Level 4 is the only reward level in the game** — after the
   * shelter's clock at 1 and its bed at 2, all four remaining fittings sit at 4, on four
   * different structures — and a table could not say it, because rows are read one at a time
   * and that is a fact about the column.
   *
   * Which means the thing to pin is not that a ladder exists but that every ladder covers the
   * *same* levels. The moment two rows disagree, the header above them is a lie and the wall
   * stops being a column.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      `update camp_structures set level = case kind
         when 'shelter' then 3 when 'watchtower' then 1 else 2 end
       where settlement_id = $1`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);
    const scales = view.structures.map((one) => one.ladder.map((stop) => stop.level).join(','));
    assert.equal(new Set(scales).size, 1, `the ladders disagree: ${[...new Set(scales)].join(' | ')}`);
    assert.equal(view.structures[0].ladder.length, 7, 'seven stops');

    // And the gates really are all at 4, which is the finding the layout exists to show.
    const gates = view.structures.flatMap((one) =>
      one.ladder.filter((stop) => stop.opens.length > 0).map((stop) => stop.level),
    );
    assert.deepStrictEqual(gates.filter((at) => at > 2).sort(), [4, 4, 4], 'four is the wall');
  });
});

test('a ladder reaches far enough to show the gate it is working toward', async () => {
  // The one judgement in `ladderFor`: the window ends three past where the camp stands, and
  // never before the furthest gate still ahead. A watchtower at 1 has to be able to see 4 or
  // the block cannot say what the levels are for — which was the whole complaint.
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update camp_structures set level = 1 where settlement_id = $1 and kind = 'watchtower'",
      [settlementId],
    );

    const low = (await viewCamp(client, settlementId)).structures
      .find((one) => one.kind === 'watchtower');
    assert.ok(low.ladder.some((stop) => stop.level === 4 && stop.opens.length === 2),
      'the Glass and the Radio are visible from level 1');

    // And past every gate the window follows the camp rather than staying at the bottom:
    // six levels of history would be six stops of nothing to buy.
    await client.query(
      "update camp_structures set level = 9 where settlement_id = $1 and kind = 'watchtower'",
      [settlementId],
    );
    const high = (await viewCamp(client, settlementId)).structures
      .find((one) => one.kind === 'watchtower');
    assert.equal(high.ladder.at(-1).level, 12, 'three past where it stands');
    assert.equal(high.ladder[0].level, 6, 'and seven stops back from there');
  });
});

test('a stop carries the whole walk to it, not just its own step', async () => {
  // "How far is the wall" is the question the block was never able to answer. The stop knows
  // it: builds, scrap and hours from where the camp stands, added up in the view so the page
  // never sums a column itself.
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await client.query(
      "update camp_structures set level = 1 where settlement_id = $1 and kind = 'watchtower'",
      [settlementId],
    );

    const tower = (await viewCamp(client, settlementId)).structures
      .find((one) => one.kind === 'watchtower');
    const gate = tower.ladder.find((stop) => stop.level === 4);

    assert.equal(gate.run.builds, 3, 'three levels from 1 to 4');
    // 10 + 14 + 18 on the watchtower's curve — the same figures the cost column used to show
    // one at a time and nothing ever added together.
    assert.equal(gate.run.scrap, 42);
    assert.ok(gate.run.hours > 0, 'and the time it takes');

    // A level already standing has no walk to it, and says so rather than reporting zero.
    assert.equal(tower.ladder.find((stop) => stop.level === 1).run, null);
    assert.equal(tower.ladder.find((stop) => stop.level === 1).cost, null);
  });
});

test('a build in flight names the level, the hands and both ends of the window', async () => {
  /*
   * Three facts the page has stored and never shown. `built_by` has been on the row since
   * builds could be assigned; the start is derived from the cost curve rather than stored,
   * so the fill costs no migration.
   *
   * The window matters as much as the name: without both ends the bar can only be a spinner,
   * and the whole argument for a fill over a pulse is that it says *how far along*.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const { rows: who } = await client.query(
      'select id, name from characters where settlement_id = $1 and died_at is null limit 1',
      [settlementId],
    );
    await startBuild(client, settlementId, 'watchtower', Date.now(), who[0].id);

    const tower = (await viewCamp(client, settlementId)).structures
      .find((one) => one.kind === 'watchtower');

    assert.ok(tower.building, 'the view reports the build');
    assert.equal(tower.building.who, who[0].name, 'and whose hands it is in');
    assert.equal(tower.building.toLevel, Number(tower.level) + 1);
    assert.ok(tower.building.from < tower.building.until, 'a window, not an instant');

    const html = campPage(await viewCamp(client, settlementId), { pane: 'camp' });
    assert.match(html, new RegExp(`class="whose">${who[0].name}<`), 'the row says who');
    assert.match(html, new RegExp(`${who[0].name} is raising the watchtower`), 'and so does the block');
    assert.match(html, /class="rung [^"]*building[^"]*"[^>]*data-from="\d+" data-took="\d+"/,
      'and the stop being raised carries the window the fill is computed from');
  });
});

test('the fill is never marked with the attribute that drives the countdown', async () => {
  /*
   * `data-until` is the clock loop's own marker: it walks every element wearing it and
   * **replaces the text**. Putting it on the stop meant the loop overwrote the whole button —
   * dot, number, label and panel — with "11s", which is a bug you can only see by rendering
   * the page and looking at what the script did to it.
   *
   * So the fill carries a start and a span, and nothing that is a container may wear
   * `data-until`. Asserted here because the failure is silent: the markup is right, the
   * script is right, and the page is wrong.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    await startBuild(client, settlementId, 'watchtower', Date.now());
    const html = campPage(await viewCamp(client, settlementId), { pane: 'camp' });

    const marked = [...html.matchAll(/<(\w+)[^>]*\sdata-until="\d+"[^>]*>/g)].map((m) => m[1]);
    assert.ok(marked.length > 0, 'something on this page is counting down');
    assert.ok(
      !marked.includes('button') && !marked.includes('div'),
      `a container is wearing data-until: ${[...new Set(marked)].join(', ')}`,
    );

    // The fill's own pair, on the element that draws it.
    assert.match(html, /data-from="\d+" data-took="\d+"/);
  });
});

test('the workbench carries every fitting in the camp, with what it is for', async () => {
  /*
   * The summaries were a hover popup — `.note` flips to one under `(hover: hover)` — so the
   * block never said what a Glass was at rest. The card is the first place it is readable
   * without a pointer, and that is most of why the fittings came off the rows.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    const html = campPage(await viewCamp(client, settlementId), { pane: 'camp' });

    const cards = [...html.matchAll(/<div class="fitcard ([a-z]+)">([^]*?)<\/div>/g)];
    assert.equal(cards.length, Object.keys(UPGRADES).length, 'one card per fitting');

    for (const [, , body] of cards) {
      assert.match(body, /class="on">on the /, 'each says which structure it goes on');
      assert.match(body, /class="sm">[^<]{20,}/, 'and what it is for, at rest');
    }
  });
});

test('one crew, said on the page rather than after the click', async () => {
  /*
   * `start-upgrade` refuses with "the watchtower is already being worked on" and
   * `buildInFlight` has always known — `some(build_completes_at) || beingFitted` — but the
   * only way to find out was to press something and read an error. Every other control now
   * says so before it is pressed.
   */
  await withRollback(async (client) => {
    const settlementId = await setup(client);
    // Filled to the cap rather than to a number: `resources_within_cap` is a real constraint
    // and the shelter decides what it is.
    await client.query(
      `update resources set amount = storage_cap
        where settlement_id = $1 and kind in ('scrap', 'fuel')`,
      [settlementId],
    );

    const before = campPage(await viewCamp(client, settlementId), { pane: 'camp' });
    assert.ok(before.includes('action="/build"'), 'a free crew can be sent to build');

    await startBuild(client, settlementId, 'watchtower', Date.now());
    const after = campPage(await viewCamp(client, settlementId), { pane: 'camp' });

    assert.ok(!after.includes('action="/build"'), 'and a busy one is offered nothing to press');
    assert.ok(!after.includes('action="/upgrade"'), 'on either bench');
    assert.match(after, /Crew busy/, 'the rows say why');
    assert.match(after, /raises and fits one thing at a time/, 'and the block says it once, properly');
    // And says it about itself. `startCraft` asks only for free hands and never looks at
    // `buildInFlight`, so a camp of two can craft while it builds -- claiming otherwise here
    // would be the page inventing a rule the services do not have.
    // Whitespace-tolerant: the template wraps mid-sentence, which HTML collapses and a
    // literal regex does not.
    assert.match(after, /the workshop keeps its own\s+bench/, 'without claiming the bench is blocked');
  });
});
