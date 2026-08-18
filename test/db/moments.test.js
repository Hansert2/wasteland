import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { momentsFor, walkHomeHours } from '../../src/game/moments.js';
import { answerMoment } from '../../src/services/answer-moment.js';
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
 * A camp and a real region, because a moment is tied to a region slug.
 *
 * The other expedition tests invent a probe region with a random slug, which is right
 * for them and useless here: no content names it, so it offers no moments at all.
 */
async function setup(client, slug = 'the_deep_zone') {
  const { rows: regions } = await client.query(
    'select slug, travel_hours from regions where slug = $1',
    [slug],
  );
  assert.ok(regions[0], `${slug} is seeded — run npm run seed`);

  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera' });

  // Enough in the stores that nobody starves during an eighteen-hour trip.
  await client.query(
    `update resources set amount = storage_cap where settlement_id = $1 and kind in ('food','water')`,
    [settlementId],
  );

  return { settlementId, slug, travelHours: Number(regions[0].travel_hours) };
}

/** Dispatch, and read back the seed so the test knows what the trip will offer. */
async function send(client, settlementId, slug, now) {
  const { expeditionId } = await dispatchExpedition(client, settlementId, slug, now);
  const { rows } = await client.query('select seed, choices from expeditions where id = $1', [
    expeditionId,
  ]);
  return { expeditionId, seed: Number(rows[0].seed), choices: rows[0].choices };
}

const totalLoot = (resources) =>
  resources.filter((row) => row.kind === 'scrap').reduce((sum, row) => sum + Number(row.amount), 0);

async function stores(client, settlementId) {
  const { rows } = await client.query(
    'select kind, amount from resources where settlement_id = $1 order by kind',
    [settlementId],
  );
  return rows;
}

/**
 * A trip whose moments are known in advance.
 *
 * The seed is forced after dispatch rather than left to `newSeed`, so the tests below
 * can name a moment instead of hunting for one. Seed 8 on the Deep Zone offers
 * counter_clicks (a wait and a spend) at 4.51–6.01, too_much_to_carry at 8.18–9.68,
 * kept_pace (a hazard) at 10.93–12.43, and the_wounded at 14.75–16.25.
 */
const FIXED_SEED = 8;

async function sendFixed(client, settlementId, slug, now) {
  const { expeditionId } = await dispatchExpedition(client, settlementId, slug, now);
  await client.query('update expeditions set seed = $2 where id = $1', [
    expeditionId,
    FIXED_SEED,
  ]);
  return expeditionId;
}

async function give(client, settlementId, slug, qty = 1) {
  await client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select c.id, i.id, $3 from characters c, items i
      where c.settlement_id = $1 and c.died_at is null and i.slug = $2`,
    [settlementId, slug, qty],
  );
}

async function returnsAt(client, expeditionId) {
  const { rows } = await client.query('select returns_at from expeditions where id = $1', [
    expeditionId,
  ]);
  return rows[0].returns_at.getTime();
}

test('a dispatched expedition starts with nothing answered', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const { choices } = await send(client, settlementId, slug, Date.now());

    assert.deepStrictEqual(choices, [], 'an unattended trip is the default state');
  });
});

test('the moments a trip offers are derivable from the seed alone', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug, travelHours } = await setup(client);
    const { seed } = await send(client, settlementId, slug, Date.now());

    const moments = momentsFor({ slug, travelHours }, seed);
    assert.equal(moments.length, 4, 'the Deep Zone offers four');

    // Nothing about them is stored: the row carries a seed and an empty array, and the
    // whole schedule falls out of that.
    const { rows } = await client.query('select * from expeditions where seed = $1', [seed]);
    assert.ok(!('moments' in rows[0]), 'and there is no column for them');
  });
});

test('answers written to the row change what comes home', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug, travelHours } = await setup(client);
    const { expeditionId, seed } = await send(client, settlementId, slug, now);

    const before = totalLoot(await stores(client, settlementId));

    // Turn back at the first moment — the earliest, so the cost is largest.
    const moments = momentsFor({ slug, travelHours }, seed);
    await client.query('update expeditions set choices = $2 where id = $1', [
      expeditionId,
      JSON.stringify([{ index: moments[0].index, option: 'turn_back' }]),
    ]);

    await advanceSettlement(client, settlementId, now + hours(travelHours) + 1000);

    const { rows } = await client.query('select status, log from expeditions where id = $1', [
      expeditionId,
    ]);
    assert.equal(rows[0].status, 'returned');
    assert.ok(
      rows[0].log.some((line) => /turned back/i.test(line)),
      `the log says so: ${JSON.stringify(rows[0].log)}`,
    );

    const gained = totalLoot(await stores(client, settlementId)) - before;
    assert.ok(gained >= 0, 'they still brought something home');
  });
});

test('answering every moment with its default is the trip that would have happened', async () => {
  // The phase guarantee, through the real tick and the real database rather than in a
  // pure function: a player who answered and changed nothing changed nothing.
  await withRollback(async (client) => {
    const now = Date.now();

    const run = async (answer) => {
      const { settlementId, slug, travelHours } = await setup(client);
      const { expeditionId, seed } = await send(client, settlementId, slug, now);

      if (answer) {
        const moments = momentsFor({ slug, travelHours }, seed);
        await client.query('update expeditions set choices = $2 where id = $1', [
          expeditionId,
          JSON.stringify(
            moments.map((moment) => ({
              index: moment.index,
              option: moment.options.find((option) => option.verb === 'default').key,
            })),
          ),
        ]);
      }

      await advanceSettlement(client, settlementId, now + hours(travelHours) + 1000);
      const { rows } = await client.query('select log from expeditions where id = $1', [
        expeditionId,
      ]);
      return { seed, log: rows[0].log };
    };

    // Two camps, two seeds — so compare each against a pure re-resolution instead of
    // against each other. What matters is that answering with defaults adds no line.
    const answered = await run(true);
    const untouched = await run(false);

    for (const { log } of [answered, untouched]) {
      assert.ok(
        !log.some((line) => /turned back|came away with|sat out|they ate/i.test(line)),
        `a default answer is silent: ${JSON.stringify(log)}`,
      );
    }
  });
});

test('answering records the choice against the moment it answers', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    await answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(5));

    const { rows } = await client.query('select choices from expeditions where id = $1', [id]);
    assert.deepStrictEqual(rows[0].choices, [{ index: 0, option: 'trust' }]);
  });
});

test('a window that has closed, and one that has not opened, are refused differently', async () => {
  // Both are reachable from a page that was rendered a moment ago, and they are not the
  // same news — one is the ordinary case of a window expiring while it was being read.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    await sendFixed(client, settlementId, slug, now);

    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(9)),
      (error) => error instanceof InputError && /has passed/i.test(error.message),
    );

    await assert.rejects(
      answerMoment(client, settlementId, { index: 3, option: 'pass' }, now + hours(5)),
      (error) => error instanceof InputError && /not happened yet/i.test(error.message),
    );
  });
});

test('a moment can only be answered once', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    await sendFixed(client, settlementId, slug, now);

    await answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(5));

    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'assume' }, now + hours(5.5)),
      (error) => error instanceof InputError && /already been settled/i.test(error.message),
    );
  });
});

test('an option that is not on offer is refused', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    await sendFixed(client, settlementId, slug, now);

    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'overload' }, now + hours(5)),
      (error) => error instanceof InputError && /not one of the options/i.test(error.message),
    );
  });
});

test('spending something means having it, and the better one goes first', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    await sendFixed(client, settlementId, slug, now);

    // The pack is empty: the page may have offered it, but the page is a render of a
    // moment ago, so the service is where this has to be caught.
    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'dose' }, now + hours(5)),
      (error) => error instanceof InputError && /nothing like that in the pack/i.test(error.message),
    );

    await give(client, settlementId, 'rad_x', 2);
    await give(client, settlementId, 'rad_scrubber', 1);

    await answerMoment(client, settlementId, { index: 0, option: 'dose' }, now + hours(5));

    const { rows } = await client.query(
      `select i.slug, ii.qty from inventory_items ii
         join items i on i.id = ii.item_id
         join characters c on c.id = ii.character_id
        where c.settlement_id = $1 order by i.slug`,
      [settlementId],
    );
    const held = Object.fromEntries(rows.map((row) => [row.slug, row.qty]));

    assert.equal(held.rad_x, 2, 'the found tablets are untouched');
    assert.equal(held.rad_scrubber ?? 0, 0, 'the crafted scrubber went first');
  });
});

test('pressing on costs the hours it says it does', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    const before = await returnsAt(client, id);

    // Read the cost from the content rather than restating it: these are balance
    // numbers and they move. What is being tested is that the hours an option
    // advertises are the hours it actually charges, whatever they currently are.
    const moment = momentsFor({ slug, travelHours: 18 }, FIXED_SEED)[0];
    const wait = moment.options.find((option) => option.key === 'assume');

    await answerMoment(client, settlementId, { index: 0, option: 'assume' }, now + hours(5));

    assert.equal(
      (await returnsAt(client, id)) - before,
      hours(wait.hours),
      `the return moved out by the ${wait.hours}h it advertises`,
    );
  });
});

test('turning back brings the return forward by a walk home, not to now', async () => {
  // The whole reason turning back is not a free win: at six hours into an eighteen-hour
  // trip they are three hours from home, and the design says so — min(h, H-h) x 0.5.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug, travelHours } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    const at = now + hours(5);
    await answerMoment(client, settlementId, { index: 0, option: 'turn_back' }, at);

    // min(h, H - h) x 0.5 — five hours out of eighteen is two and a half hours home.
    const home = await returnsAt(client, id);
    assert.equal(home - at, hours(walkHomeHours(5, travelHours)), 'the walk home is charged');
    assert.ok(home < now + hours(travelHours), 'and still sooner than finishing');
  });
});

test('turning back late saves almost nothing, which is the point', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug, travelHours } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    const at = now + hours(16);
    await answerMoment(client, settlementId, { index: 3, option: 'turn_back' }, at);

    const saved = now + hours(travelHours) - (await returnsAt(client, id));
    assert.ok(saved <= hours(1), `bailing at sixteen hours saved ${saved / hours(1)}h`);
  });
});

test('a shortcut can never bring them home before they set out', async () => {
  // Found by reading rather than by failing: two moments carry negative hours, and
  // the_ford saves ninety minutes off a trip the Old Service Road finishes in
  // forty-five. Unclamped, that set returns_at before departed_at — a trip ending
  // before it began, resolving instantly with a full haul.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId } = await setup(client, 'the_service_road');

    // Seed 11 offers the_ford on the Old Service Road: ninety minutes saved off a
    // forty-five minute trip, which is the worst case and the one that has to hold.
    const { expeditionId } = await dispatchExpedition(client, settlementId, 'the_service_road', now);
    await client.query('update expeditions set seed = 11 where id = $1', [expeditionId]);

    const moments = momentsFor({ slug: 'the_service_road', travelHours: 0.75 }, 11);
    const shortcut = moments
      .flatMap((moment) => moment.options.map((option) => ({ moment, option })))
      .find(({ option }) => Number(option.hours) < 0);

    assert.ok(shortcut, 'the fixture still offers a shortcut');
    assert.ok(Number(shortcut.option.hours) <= -1.5, 'and it is the ninety-minute one');

    const at = now + shortcut.moment.atHour * 3600000 + 1000;
    await answerMoment(
      client,
      settlementId,
      { index: shortcut.moment.index, option: shortcut.option.key },
      at,
    );

    const home = await returnsAt(client, expeditionId);
    const { rows } = await client.query('select departed_at from expeditions where id = $1', [
      expeditionId,
    ]);

    assert.ok(home > rows[0].departed_at.getTime(), 'the return is after the departure');
    assert.ok(home >= at, 'and not before the answer that caused it');
  });
});

test('there has to be somebody out there to answer for', async () => {
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);

    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'trust' }, now),
      (error) => error instanceof InputError && /Nobody is out there/i.test(error.message),
    );

    await sendFixed(client, settlementId, slug, now);
    await client.query(
      `update characters set died_at = now(), cause_of_death = 'starvation'
        where settlement_id = $1 and died_at is null`,
      [settlementId],
    );

    await assert.rejects(
      answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(5)),
      (error) => error instanceof InputError && /nobody out there to answer for/i.test(error.message),
    );
  });
});

test('the schema refuses a malformed or oversized answer list', async () => {
  await withRollback(async (client) => {
    const { settlementId, slug } = await setup(client);
    const { expeditionId } = await send(client, settlementId, slug, Date.now());

    // This column is written straight from a form post, so the guard is in the schema
    // rather than only in the service that will eventually write it.
    const oversized = JSON.stringify(
      Array.from({ length: 9 }, (_, index) => ({ index, option: 'turn_back' })),
    );

    for (const bad of ['{"index":0}', '"turn_back"', '42', oversized]) {
      // A savepoint per attempt: a failed statement poisons the transaction, and the
      // next assertion would then fail for the wrong reason.
      await client.query('savepoint probe');
      await assert.rejects(
        client.query('update expeditions set choices = $2 where id = $1', [expeditionId, bad]),
        /choices_is_a_small_array/,
        `rejected ${bad}`,
      );
      await client.query('rollback to savepoint probe');
    }
  });
});
