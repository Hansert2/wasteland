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
import { UPGRADES } from '../../src/game/structures.js';
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

test('the bench is a different crew, though — crafting is unaffected', async () => {
  await withRollback(async (client) => {
    // Fitting shares the build queue, not the craft queue. They are different work.
    const settlementId = await setup(client);
    await client.query(
      `update resources set amount = 300 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    await startUpgrade(client, settlementId, 'filtration');
    await startCraft(client, settlementId, 'scrap_spear');

    const state = await loadWorld(client, settlementId);
    assert.equal(state.fitting.upgrade, 'filtration');
    assert.equal(state.craft.status, 'active', 'both are in flight');
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

    // Deepen the shelter and the ceiling rises with it.
    await client.query(
      "update camp_structures set level = 4 where settlement_id = $1 and kind = 'shelter'",
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
