import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { MOMENTS, momentCount, momentsFor, walkHomeHours } from '../../src/game/moments.js';
import { viewCamp } from '../../src/services/view-camp.js';
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

test('the region list says how much contact a trip holds', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    const view = await viewCamp(client, settlementId);

    // Every region carries the count, and it is the generator's own answer rather
    // than a second table that can drift away from it.
    for (const region of view.regions) {
      assert.equal(
        region.moments,
        momentCount(Number(region.travel_hours)),
        `${region.slug} promises a count the generator does not agree with`,
      );
    }

    // The two ends of the range, named rather than derived, because these are the
    // rows the choice actually turns on: the faucet that can never offer anything,
    // and the long trip that is the reason to go.
    const fence = view.regions.find((r) => r.slug === 'the_fence_line');
    assert.equal(fence.moments, 0, 'the fence line has no interior and must say so');

    const deep = view.regions.find((r) => r.slug === 'the_deep_zone');
    assert.ok(deep.moments > 0, 'the deep zone is the trip Phase 6 was written for');
  });
});

test('an option the pack cannot pay for says so instead of offering a button', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await setup(client);
    const departed = Date.now();
    await sendFixed(client, settlementId, 'the_deep_zone', departed);

    // Seed 8 opens counter_clicks at 4.51–6.01 hours in, whose third option spends a
    // dose out of the pack. The survivor is carrying none.
    const inside = departed + hours(5);
    const empty = await viewCamp(client, settlementId, inside);
    const dose = empty.expedition.moment.options.find((o) => o.consumes);

    assert.ok(dose, 'seed 8 offers a moment with something to spend');
    assert.equal(dose.missing, true, 'an empty pack cannot pay for it');
    assert.equal(dose.needs, 'Rad Scrubber or Rad-X', 'and the page says what it wants');

    // The options that cost nothing out of the pack are unaffected — this must not
    // become a page where every option needs something.
    for (const option of empty.expedition.moment.options) {
      if (option.consumes) continue;
      assert.equal(option.missing, undefined, `${option.key} costs nothing and must say nothing`);
    }

    // One of the two is enough: the list is a preference order, not a shopping list.
    await give(client, settlementId, 'rad_x');
    const stocked = await viewCamp(client, settlementId, inside);
    const paid = stocked.expedition.moment.options.find((o) => o.consumes);
    assert.equal(paid.missing, false, 'the second-choice item pays for it too');

    // Naming the price must not cost the option everything else it does. The dose is
    // the whole reason that option exists, and the first version of this rebuilt the
    // figures here from a view object that no longer had a `radiationFactor` on it —
    // so the page offered a dose priced at one Rad Scrubber and promising nothing.
    const labels = paid.effects.map((effect) => effect.label);
    assert.ok(labels.includes('−1 Rad Scrubber or Rad-X'), labels.join(' / '));
    assert.ok(
      labels.some((label) => label.includes('rads')),
      `the dose still says what it does: ${labels.join(' / ')}`,
    );
  });
});

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
    assert.deepStrictEqual(rows[0].choices, [{ index: 0, key: 'counter_clicks', option: 'trust' }]);
  });
});

test('an answered moment stays on the page instead of vanishing', async () => {
  // The moment box is filtered out of the view the instant it is answered, and for a
  // while nothing took its place: the player pressed a button, the situation disappeared,
  // and the game said nothing more until the survivor walked back through the gate hours
  // later. The answer is recorded here; the consequence is still rolled at the return.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    await sendFixed(client, settlementId, slug, now);

    const before = await viewCamp(client, settlementId, now + hours(5));
    assert.ok(before.expedition.moment, 'a window is open');
    assert.deepStrictEqual(before.expedition.settled, []);

    await answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(5));

    const after = await viewCamp(client, settlementId, now + hours(5));
    assert.equal(after.expedition.moment, null, 'the window is spent');
    assert.equal(after.expedition.settled.length, 1);

    const [settled] = after.expedition.settled;
    assert.equal(settled.title, MOMENTS.counter_clicks.title);
    assert.equal(settled.label, 'Trust it');
    assert.ok(settled.atHour > 0, 'and when it happened');

    // Still reported a good deal later, because the outcome has not landed yet: the
    // whole gap this closes is the stretch between answering and coming home.
    const later = await viewCamp(client, settlementId, now + hours(12));
    assert.equal(later.expedition.settled.length, 1);
  });
});

test('an answer whose moment has moved under it is not reported either', async () => {
  // `applyChoices` drops an answer whose name no longer matches the content at that
  // index, so the page must drop it too. A view that kept claiming a decision the trip
  // will silently ignore is worse than one that never mentioned it.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    await client.query('update expeditions set choices = $2 where id = $1', [
      id,
      JSON.stringify([{ index: 0, key: 'a_moment_that_was_rewritten', option: 'trust' }]),
    ]);

    const view = await viewCamp(client, settlementId, now + hours(12));
    assert.deepStrictEqual(view.expedition.settled, []);
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

test('an answer names the moment it answered, and is dropped if that moves', async () => {
  // Found in play. Moment content is not frozen — it gets written, retuned and
  // reordered — and a trip in flight recomputes its schedule from the seed on every
  // read. An answer recorded by position alone lands on whatever now occupies that
  // position, and turn_back is a key on every moment, so a stale index would still
  // match and bank the trip at the wrong hour with nothing flagging it.
  await withRollback(async (client) => {
    const now = Date.now();
    const { settlementId, slug } = await setup(client);
    const id = await sendFixed(client, settlementId, slug, now);

    await answerMoment(client, settlementId, { index: 0, option: 'trust' }, now + hours(5));

    const { rows } = await client.query('select choices from expeditions where id = $1', [id]);
    assert.deepStrictEqual(rows[0].choices, [
      { index: 0, key: 'counter_clicks', option: 'trust' },
    ], 'the moment is named, not just numbered');

    // Rewrite it as if the content had shifted under the trip, then resolve.
    await client.query('update expeditions set choices = $2 where id = $1', [
      id,
      JSON.stringify([{ index: 0, key: 'a_moment_that_moved', option: 'turn_back' }]),
    ]);
    await advanceSettlement(client, settlementId, now + hours(18) + 1000);

    const { rows: done } = await client.query('select log from expeditions where id = $1', [id]);
    assert.ok(
      !done[0].log.some((line) => /turned back/i.test(line)),
      `a stale answer is dropped rather than applied: ${JSON.stringify(done[0].log)}`,
    );
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
