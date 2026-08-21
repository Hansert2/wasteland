import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage } from '../../src/web/render.js';
import { STRUCTURES } from '../../src/game/structures.js';
import { STEPS } from '../../src/game/direction.js';

const T0 = Date.UTC(2287, 0, 1);
const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);

/**
 * Every test runs inside a transaction that is always rolled back, so the suite
 * needs no teardown and leaves the development database exactly as it found it.
 * A fresh schema per run would be cleaner in a CI matrix; this is faster and the
 * database is already up.
 */
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

const uniq = () => Math.random().toString(36).slice(2, 10);

/** A region of a given length, for tests about what a trip's *duration* means. */
async function region(client, travelHours) {
  const { rows } = await client.query(
    `insert into regions (slug, name, danger, travel_hours)
     values ($1, 'Somewhere', 1, $2) returning id`,
    [`probe_${uniq()}`, travelHours],
  );
  return rows[0].id;
}

/** A camp that produces food, water and scrap — the default sustainable case. */
const SUSTAINABLE = [
  { kind: 'shelter', level: 1 },
  { kind: 'garden', level: 1 },
  { kind: 'water_purifier', level: 1 },
  { kind: 'workshop', level: 1 },
];

/** Stores only: nothing is being produced, so the camp is on borrowed time. */
const BARREN = [{ kind: 'workshop', level: 1 }];

async function seed(client, options = {}) {
  const {
    structures = SUSTAINABLE,
    amounts = { food: 50, water: 50, scrap: 0 },
    health = 100,
    radiation = 0,
    rations = 0,
    expedition = false,
  } = options;

  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );
  const playerId = players[0].id;

  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at) values ($1, 'Probe', $2) returning id`,
    [playerId, new Date(T0)],
  );
  const settlementId = settlements[0].id;

  for (const { kind, level } of structures) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, $3)',
      [settlementId, kind, level],
    );
  }

  for (const [kind, amount] of Object.entries(amounts)) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, $3, 100000)`,
      [settlementId, kind, amount],
    );
  }

  const { rows: characters } = await client.query(
    `insert into characters (settlement_id, name, born_at, health, radiation)
     values ($1, 'Vera', $2, $3, $4) returning id`,
    [settlementId, new Date(T0), health, radiation],
  );
  const characterId = characters[0].id;

  let inventoryRowId = null;
  if (rations > 0) {
    const { rows: items } = await client.query(
      `insert into items (slug, name, kind, potency) values ($1, 'Tinned Stew', 'ration', 80)
       returning id`,
      [`tinned_stew_${uniq()}`],
    );
    const { rows: inv } = await client.query(
      `insert into inventory_items (character_id, item_id, qty) values ($1, $2, $3) returning id`,
      [characterId, items[0].id, rations],
    );
    inventoryRowId = inv[0].id;
  }

  let expeditionId = null;
  if (expedition) {
    const { rows: regions } = await client.query(
      `insert into regions (slug, name, danger, travel_hours)
       values ($1, 'Ruined City', 2, 6) returning id`,
      [`ruined_city_${uniq()}`],
    );
    // Due back in a month: this fixture is about an expedition that is still in
    // flight when the survivor dies at home, so it must not resolve on its own first.
    const { rows: exps } = await client.query(
      `insert into expeditions (character_id, region_id, departed_at, returns_at, seed)
       values ($1, $2, $3, $4, $5) returning id`,
      [characterId, regions[0].id, new Date(T0), new Date(T0 + hours(24 * 30)), 1],
    );
    expeditionId = exps[0].id;
  }

  return { playerId, settlementId, characterId, inventoryRowId, expeditionId };
}

test('loadWorld translates schema vocabulary into simulation vocabulary', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);
    const state = await loadWorld(client, settlementId);

    assert.equal(state.lastTickAt, T0, 'timestamptz became epoch ms');
    // ratePerHour came from the garden's level, not from a column on this row.
    assert.deepEqual(state.settlement.resources.food, {
      amount: 50,
      ratePerHour: STRUCTURES.garden.perLevel,
      cap: 100000,
    });
    assert.equal(state.survivor.alive, true);
    assert.equal(state.survivor.bornAt, T0);

    // pg hands back numeric and int8 as strings by default, which would turn the
    // tick's arithmetic into string concatenation. pool.js overrides that.
    assert.equal(typeof state.settlement.resources.food.amount, 'number');
    assert.equal(typeof state.survivor.health, 'number');
  });
});

test('advancing a supplied settlement accrues resources and persists them', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    await advanceSettlement(client, settlementId, T0 + hours(10));

    const reloaded = await loadWorld(client, settlementId);
    assert.equal(reloaded.lastTickAt, T0 + hours(10));
    assert.equal(
      reloaded.settlement.resources.scrap.amount,
      STRUCTURES.workshop.perLevel * 10,
      'ten hours of one workshop level',
    );
    assert.equal(reloaded.survivor.alive, true);
  });
});

test('advancing twice to the same instant does nothing the second time', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    await advanceSettlement(client, settlementId, T0 + hours(10));
    const once = await loadWorld(client, settlementId);
    await advanceSettlement(client, settlementId, T0 + hours(10));
    const twice = await loadWorld(client, settlementId);

    assert.deepStrictEqual(twice, once, 'no elapsed time, no production');
  });
});

test('loadWorld orders its arrays, so two loads of one world always match', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    // The test above compares two loaded states directly, and Postgres is free to
    // return rows in whatever order the heap holds them — which changes when
    // saveWorld rewrites them. Ordering here is what makes that comparison honest
    // rather than usually-true; asserting it directly fails every time rather than
    // one run in twenty.
    const state = await loadWorld(client, settlementId);
    const kinds = state.settlement.structures.map((s) => s.kind);

    assert.deepEqual(kinds, [...kinds].sort(), 'structures come back in a defined order');
    assert.ok(kinds.length > 1, 'and there are enough of them for order to mean anything');
  });
});

test('the rate the camp page shows is the rate the stores actually move at', async () => {
  await withRollback(async (client) => {
    // The page used to report gross production: it ignored the survivor eating and
    // ignored the weather, so during a blight it promised food climbing while the
    // stores fell. A rate is only useful if it predicts the next hour.
    const { settlementId } = await seed(client);
    const now = Date.now();

    await client.query('update settlements set last_tick_at = $2 where id = $1', [
      settlementId,
      new Date(now),
    ]);

    const view = await viewCamp(client, settlementId, now);
    const before = await loadWorld(client, settlementId);

    await advanceSettlement(client, settlementId, now + hours(1));
    const after = await loadWorld(client, settlementId);

    for (const shown of view.resources) {
      const moved =
        after.settlement.resources[shown.kind].amount -
        before.settlement.resources[shown.kind].amount;

      // An hour of the shown rate should be an hour of real movement. Tolerance is
      // for the slice walk's floating point, not for the rate being approximate.
      assert.ok(
        Math.abs(moved - shown.ratePerHour) < 0.01,
        `${shown.kind}: page said ${shown.ratePerHour}/h, stores moved ${moved.toFixed(3)}`,
      );
    }
  });
});

test('a starved survivor is retired, and the camp keeps producing without them', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
    });

    const { events } = await advanceSettlement(client, settlementId, T0 + days(10));
    assert.equal(events.filter((e) => e.type === 'survivor_died').length, 1);

    const { rows } = await client.query(
      'select died_at, cause_of_death from characters where id = $1',
      [characterId],
    );
    assert.equal(rows[0].cause_of_death, 'starvation');
    assert.ok(rows[0].died_at, 'died_at persisted');

    // The partial unique index stops matching a dead character, so the camp loads
    // with no survivor at all — and its production is unaffected by that.
    const reloaded = await loadWorld(client, settlementId);
    assert.equal(reloaded.survivor, null);
    assert.equal(
      reloaded.settlement.resources.scrap.amount,
      STRUCTURES.workshop.perLevel * 24 * 10,
      'ten full days of one workshop level',
    );
  });
});

test('the roster view lists the fallen with a cause and a lifespan', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
    });

    await advanceSettlement(client, settlementId, T0 + days(10));

    const { rows } = await client.query(
      'select name, cause_of_death, days_survived from character_history where settlement_id = $1',
      [settlementId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Vera');
    assert.ok(rows[0].days_survived > 2 && rows[0].days_survived < 3);
  });
});

test('an expedition in flight is written back as lost, satisfying the schema', async () => {
  await withRollback(async (client) => {
    const { settlementId, expeditionId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
      expedition: true,
    });

    // The check constraint refuses a non-active expedition without resolved_at, so
    // this failing would mean the tick and the schema disagree.
    await advanceSettlement(client, settlementId, T0 + days(10));

    const { rows } = await client.query(
      'select status, resolved_at from expeditions where id = $1',
      [expeditionId],
    );
    assert.equal(rows[0].status, 'lost');
    assert.ok(rows[0].resolved_at, 'resolved_at persisted');
  });
});

test('an auto-consumed ration is decremented in the database', async () => {
  await withRollback(async (client) => {
    const { settlementId, inventoryRowId } = await seed(client, {
      structures: BARREN,
      amounts: { food: 0, water: 0, scrap: 0 },
      rations: 1,
    });

    const { events } = await advanceSettlement(client, settlementId, T0 + hours(60));
    assert.equal(events.filter((e) => e.type === 'auto_consumed').length, 1);

    const { rows } = await client.query('select qty from inventory_items where id = $1', [
      inventoryRowId,
    ]);
    assert.equal(rows[0].qty, 0, 'the ration was spent, not just simulated');
  });
});

test('advancing takes a row lock, so concurrent requests cannot double-apply', async () => {
  // The only test here that cannot use rollback isolation. A second connection cannot
  // see rows an uncommitted transaction created, so there would be nothing to contend
  // over and the lock would appear to work while proving nothing. Commit the fixture,
  // contend for real, then delete it.
  const { playerId, settlementId } = await commitFixture();

  const holder = await pool.connect();
  const rival = await pool.connect();
  try {
    await holder.query('begin');
    await advanceSettlement(holder, settlementId, T0 + hours(10));

    // `nowait` turns the wait into an immediate error, so this asserts the lock
    // rather than hanging on it.
    await rival.query('begin');
    await assert.rejects(
      rival.query('select id from settlements where id = $1 for update nowait', [settlementId]),
      (error) => error.code === '55P03',
      'expected lock_not_available',
    );
    await rival.query('rollback');
    await holder.query('rollback');
  } finally {
    holder.release();
    rival.release();
    await deleteFixture(playerId);
  }
});

/** Seed and commit, for the one test that needs data visible to another connection. */
async function commitFixture() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ids = await seed(client);
    await client.query('commit');
    return ids;
  } finally {
    client.release();
  }
}

/** Deleting the player cascades to the settlement and everything hanging off it. */
async function deleteFixture(playerId) {
  const client = await pool.connect();
  try {
    await client.query('delete from players where id = $1', [playerId]);
  } finally {
    client.release();
  }
}

test.after(async () => {
  await pool.end();
});

test('the page says what a radiation figure is costing, not only what it is', async () => {
  await withRollback(async (client) => {
    // Played on 2026-08-20: the page said "Radiation 62.2" and nothing else. That number
    // sits just past radThreshold, where a survivor stops healing and starts losing
    // health — and nothing said so, which line it had crossed, or what it cost. The
    // figure was right and the tick was right; the page was the part that was silent.
    const { settlementId } = await seed(client);
    const now = Date.now();

    const at = async (radiation) => {
      await client.query(
        'update characters set radiation = $2 where settlement_id = $1 and died_at is null',
        [settlementId, radiation],
      );
      return (await viewCamp(client, settlementId, now)).strain;
    };

    // Burning: past the threshold, and the bleed ramps rather than being a flat rate,
    // so "past 60" and "at 87" have to be different news.
    const mild = await at(62);
    const bad = await at(87);
    assert.equal(mild.state, 'burning');
    assert.equal(bad.state, 'burning');
    assert.ok(
      bad.damagePerHour > mild.damagePerHour * 5,
      `62 rads costs ${mild.damagePerHour}/h and 87 costs ${bad.damagePerHour}/h`,
    );
    assert.ok(mild.hoursToSafe > 0 && bad.hoursToSafe > mild.hoursToSafe);

    // Stalled: nothing lost, nothing regained. The state a Deep Zone run leaves behind
    // for the better part of two days, and the one the page said least about.
    const stalled = await at(45);
    assert.equal(stalled.state, 'stalled');
    assert.equal(stalled.damagePerHour, 0);
    assert.ok(stalled.hoursToMending > 0, 'stalled means waiting for something');

    // Mending: the only state in which waiting works, and the only one that says nothing.
    const clear = await at(12);
    assert.equal(clear.state, 'mending');
    assert.equal(clear.hoursToMending, 0);

    // And filtration, which is the upgrade this number exists to sell, actually shows
    // up in the hours — a player weighing 60 fuel against it should see what it buys.
    const unfiltered = await at(62);
    await client.query(
      `insert into structure_upgrades (settlement_id, kind, upgrade, completes_at, installed_at)
       values ($1, 'water_purifier', 'filtration', $2, $2)`,
      [settlementId, new Date(now)],
    );
    const filtered = await at(62);

    assert.ok(
      filtered.hoursToMending < unfiltered.hoursToMending / 2,
      `filtration should more than halve the wait: ${unfiltered.hoursToMending} -> ${filtered.hoursToMending}`,
    );
  });
});

test('the advice for a new camp is derived from what the camp has actually done', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, {
      structures: [{ kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 10, fuel: 0 },
    });

    const fresh = await viewCamp(client, settlementId, T0);
    assert.equal(fresh.direction.key, 'workshop', 'no workshop, so nothing here makes scrap');

    // A finished trip somewhere under two hours. This is the join the whole thing
    // rests on — expeditions hang off the character and the advice is about the camp,
    // so a survivor who dies must not take the lesson with them.
    const short = await region(client, 0.17);
    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, resolved_at, seed)
       values ($1, $2, 'returned', $3, $3, $3, 1)`,
      [characterId, short, new Date(T0)],
    );
    await client.query(
      `insert into camp_structures (settlement_id, kind, level) values ($1, 'workshop', 1)`,
      [settlementId],
    );

    const walked = await viewCamp(client, settlementId, T0);
    assert.equal(walked.direction.key, 'bench', 'the short walk is done, the bench is not');

    // A long one does not count as a short one, which is the threshold this is built
    // around: under two hours is a walk you wait out, four and over is one you leave.
    const long = await region(client, 12);
    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, resolved_at, seed)
       values ($1, $2, 'returned', $3, $3, $3, 2)`,
      [characterId, long, new Date(T0)],
    );
    const both = await viewCamp(client, settlementId, T0);
    assert.equal(both.direction.key, 'bench', 'a long trip answers a different question');
  });
});

test('the lesson stops for good once the camp has been round the loop', async () => {
  await withRollback(async (client) => {
    // And stays stopped through a successor knock. Two of the five steps can only be
    // asked of the camp as it stands, and a successor takes two levels off everything
    // — so this camp reads as workshop zero and must still be told nothing.
    const { settlementId, characterId } = await seed(client, {
      structures: [{ kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 10, fuel: 0 },
    });

    for (const [hours, s] of [[0.17, 1], [12, 2]]) {
      const id = await region(client, hours);
      await client.query(
        `insert into expeditions (character_id, region_id, status, departed_at, returns_at, resolved_at, seed)
         values ($1, $2, 'returned', $3, $3, $3, $4)`,
        [characterId, id, new Date(T0), s],
      );
    }
    await client.query(
      `insert into craft_orders (settlement_id, recipe_id, status, completes_at, resolved_at)
       select $1, id, 'delivered', $2, $2 from recipes limit 1`,
      [settlementId, new Date(T0)],
    );

    const view = await viewCamp(client, settlementId, T0);

    // The block itself does not stop — it goes on reading the camp's numbers for as
    // long as there is something worth saying. What stops is being taught the game.
    assert.ok(
      view.direction === null || !STEPS.some((step) => step.key === view.direction.key),
      `still being taught: ${JSON.stringify(view.direction)}`,
    );
  });
});

test('a first dispatch straight to the deep end does not switch the advice off', async () => {
  await withRollback(async (client) => {
    // The player this exists for. Founding a camp and sending someone out for eighteen
    // hours sets one of the three history facts and none of the understanding.
    const { settlementId, characterId } = await seed(client, {
      structures: [{ kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 10, fuel: 0 },
    });

    const deep = await region(client, 18);
    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, seed)
       values ($1, $2, 'active', $3, $4, 1)`,
      [characterId, deep, new Date(T0), new Date(T0 + hours(18))],
    );

    const view = await viewCamp(client, settlementId, T0 + hours(1));
    assert.equal(view.direction.key, 'workshop', 'still at the beginning, and told so');
    assert.match(campPage(view), /<h2>Next<\/h2>/);
  });
});

test('the dispatch table says what the camp can do while the survivor is gone', async () => {
  await withRollback(async (client) => {
    // Played on 2026-08-21: found a new camp, spend the opening scrap, send someone to
    // Coastal Wreckage for twelve hours, and the page has nothing on it that can change
    // for twelve hours. Every number needed to know that in advance was already
    // rendered — a price here, a rate there — and the subtraction was the player's.
    const { settlementId } = await seed(client, {
      structures: [{ kind: 'shelter', level: 2 }, { kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 0, fuel: 0 },
    });

    const broke = await viewCamp(client, settlementId, T0);
    assert.ok(broke.regions.length > 1, 'there is somewhere to send them');
    assert.ok(
      broke.regions.every((region) => region.openWhileAway === 0),
      'a camp with no workshop makes no scrap, so no wait of any length opens a door',
    );

    // The same camp with a workshop earning half a scrap an hour. Now the hours buy
    // something, and how much depends entirely on how many of them there are.
    await client.query(
      `insert into camp_structures (settlement_id, kind, level) values ($1, 'workshop', 1)`,
      [settlementId],
    );
    // Six, deliberately: enough that the hours buy something and not enough that the
    // stores already cover everything on the page. A camp rich enough to buy every
    // door outright has no waits to compare, so the column is flat for the opposite
    // reason and the test would pass on a broken implementation.
    await client.query(
      `update resources set amount = 6 where settlement_id = $1 and kind = 'scrap'`,
      [settlementId],
    );

    const earning = await viewCamp(client, settlementId, T0);
    const by = (slug) => earning.regions.find((region) => region.slug.startsWith(slug));
    const fence = by('the_fence_line');
    const deep = by('the_deep_zone');

    assert.ok(fence && deep, 'the shortest and the longest are both on the table');
    assert.ok(
      deep.openWhileAway > fence.openWhileAway,
      `eighteen hours must buy more than ten minutes: ${deep.openWhileAway} vs ${fence.openWhileAway}`,
    );
  });
});

test('a plan spends the purse as it walks it', async () => {
  await withRollback(async (client) => {
    // The failure the first version shipped: pricing every door against the same
    // stores told a camp holding ten scrap that it could do five things costing five
    // to ten each. Every region read the same number and the column said nothing.
    const { settlementId } = await seed(client, {
      structures: [{ kind: 'shelter', level: 2 }, { kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 10, fuel: 0 },
    });

    const view = await viewCamp(client, settlementId, T0);
    const now = view.plans.filter((plan) => plan.inHours === 0);

    assert.equal(now.length, 1, `ten scrap buys one thing, not ${now.length}`);
    assert.ok(
      view.plans.every((plan, i) => i === 0 || plan.inHours >= view.plans[i - 1].inHours),
      'a plan reads soonest first',
    );
  });
});

test('a camp that can do nothing before the return is told so, in the Next block', async () => {
  await withRollback(async (client) => {
    // This used to be its own block in the Away report, listing four doors and the hour
    // each opened. It was removed once it could be read beside the Next block, which
    // contradicted it out loud — see the note on `meanwhile` in render.js. One sentence
    // was worth keeping and this is where it lives now.
    const { settlementId } = await seed(client, {
      structures: [{ kind: 'garden', level: 2 }],
      amounts: { food: 50, water: 50, scrap: 0, fuel: 0 },
      expedition: true,
    });

    // Past the chain, so the standing conditions are what speaks.
    const { rows: regions } = await client.query(
      `select id from regions where travel_hours < 2 limit 1`,
    );
    const { rows: chars } = await client.query(
      `select id from characters where settlement_id = $1`,
      [settlementId],
    );
    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, resolved_at, seed)
       values ($1, $2, 'returned', $3, $3, $3, 9)`,
      [chars[0].id, regions[0].id, new Date(T0)],
    );
    await client.query(
      `insert into craft_orders (settlement_id, recipe_id, status, completes_at, resolved_at)
       select $1, id, 'delivered', $2, $2 from recipes limit 1`,
      [settlementId, new Date(T0)],
    );

    const view = await viewCamp(client, settlementId, T0 + hours(1));
    assert.ok(view.expedition, 'somebody is out');
    assert.equal(view.direction.key, 'idle', JSON.stringify(view.direction));
    assert.match(campPage(view), /before they are back/);

    // And the block it replaced is gone rather than merely emptied.
    assert.doesNotMatch(campPage(view), /Meanwhile, at camp/);
  });
});

test('a trip with a window ahead of it arms a timer, radio or no radio', async () => {
  await withRollback(async (client) => {
    // Every other deadline on this page updates itself. A moment opening did not,
    // except by accident: the radio's line is built with countdown(), which emits the
    // data-until the client script arms — so a fitted camp has always had its box
    // appear on its own and an unfitted one has sat on a page that quietly refused to.
    const { settlementId, characterId } = await seed(client, {
      structures: [{ kind: 'garden', level: 2 }, { kind: 'workshop', level: 1 }],
      amounts: { food: 50, water: 50, scrap: 10, fuel: 0 },
    });

    // A real region, because moments are drawn from a region slug and a seed.
    const { rows: regions } = await client.query(
      `select id, travel_hours from regions where slug = 'coastal_wreckage'`,
    );
    assert.ok(regions[0], 'the seeded world has the wreckage in it');

    await client.query(
      `insert into expeditions (character_id, region_id, status, departed_at, returns_at, seed)
       values ($1, $2, 'active', $3, $4, 7)`,
      [characterId, regions[0].id, new Date(T0), new Date(T0 + hours(12))],
    );

    // One minute in: the first window is hours away, so there is something to arm for.
    const view = await viewCamp(client, settlementId, T0 + hours(1 / 60));
    assert.ok(view.expedition.upcoming.length > 0, 'a window is still ahead');
    assert.equal(view.expedition.nextMomentAt, null, 'and no radio to announce it');

    const html = campPage(view);
    const armed = [...html.matchAll(/data-until="(\d+)"/g)].map((m) => Number(m[1]));
    const opensAt = view.expedition.upcoming[0].getTime();

    assert.ok(
      armed.includes(opensAt),
      'the instant the window opens is armed, so the box arrives without a reload',
    );
    assert.doesNotMatch(html, /next contact/i, 'and silently — announcing it is the radio');
  });
});

test('a price the camp cannot meet says what it is short by, and offers no button', async () => {
  await withRollback(async (client) => {
    // Every priced row rendered its button whether or not the camp could pay: Fit
    // beside a 60-fuel filtration on 51 fuel, Make beside a vest wanting two parts on a
    // pack holding one. Both refusals were correct and both arrived after the click,
    // which is the same fault the moment options had.
    const { settlementId } = await seed(client);

    await client.query(
      `update resources set amount = case kind when 'fuel' then 10 else 400 end
        where settlement_id = $1`,
      [settlementId],
    );
    // A bench good enough that the recipes are gated by materials rather than by
    // level, which is the guard this test is about.
    await client.query(
      `insert into camp_structures (settlement_id, kind, level) values ($1, 'workshop', 5)
       on conflict (settlement_id, kind) do update set level = 5`,
      [settlementId],
    );

    const view = await viewCamp(client, settlementId);

    // A fitting priced in fuel, against a camp that has ten.
    const withUpgrade = view.structures.find((s) => s.upgrade && !s.upgrade.fitted);
    assert.ok(withUpgrade, 'some structure has an unfitted branch');
    assert.match(
      withUpgrade.upgrade.shortBy,
      /needs \d+ more fuel/,
      `expected a shortfall, got ${withUpgrade.upgrade.shortBy}`,
    );

    // Scrap is plentiful, so the builds themselves are affordable — the guard has to
    // discriminate rather than simply refusing everything.
    assert.ok(
      view.structures.some((s) => s.shortBy === null),
      'a camp with 400 scrap can afford to build something',
    );

    // A recipe wanting an item the pack does not hold. Nothing has been granted to
    // this survivor, so every recipe with an input is short of it.
    const needsItem = view.recipes.find((r) => (r.inputs ?? []).length > 0);
    assert.ok(needsItem, 'some recipe is priced in items');
    assert.match(needsItem.shortBy, /needs .* more /, `got ${needsItem.shortBy}`);

    // And the page follows the bench's rule: keep the row, drop the button, say why.
    const html = campPage(view);
    assert.ok(html.includes(needsItem.shortBy), 'the shortfall reaches the page');
    assert.ok(
      !html.includes(`name="upgrade" value="${withUpgrade.upgrade.slug}"`),
      'an unaffordable fitting must not carry a submit button',
    );
  });
});
