import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage } from '../../src/web/render.js';
import { ERA_HOURS, PAIRS, RELATIONS, changesBetween, relationAt } from '../../src/game/relations.js';
import { WORLD_SEED, WORLD_EPOCH } from '../../src/game/world-events.js';

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

async function camp(client, at) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Testcamp',
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera', now: at });
  await client.query('update settlements set last_tick_at = $2 where id = $1', [
    settlementId,
    new Date(at),
  ]);
  await client.query(
    'update resources set amount = least(400, storage_cap) where settlement_id = $1',
    [settlementId],
  );
  return settlementId;
}

/** The first season boundary after `from` at which some pair changes state. */
function nextNews(from) {
  for (let step = 0; step < 60; step += 1) {
    const window = [from + step * hours(ERA_HOURS), from + (step + 1) * hours(ERA_HOURS)];
    const changes = changesBetween(WORLD_SEED, window[0], window[1]);
    if (changes.length > 0) return { changes, from: window[0], to: window[1] };
  }
  throw new Error('the world never has any news, which is itself the bug');
}

test('a camp that comes back after a season is told what the crews did, and why', async () => {
  await withRollback(async (client) => {
    /*
     * Far from today on purpose. The crews' politics are global — the same fact for every camp
     * — so a window near `now` is a window some other test in this suite has an opinion about.
     * A stretch nobody else's clock reaches measures this mechanic rather than leftovers.
     */
    const far = WORLD_EPOCH + hours(ERA_HOURS * 900);
    const news = nextNews(far);

    /*
     * Through `viewCamp` rather than `advanceSettlement`, because the view runs the tick
     * itself — advancing first and then rendering would hand the page a camp whose news had
     * already been consumed, which is a test that can only ever pass by accident.
     */
    const settlementId = await camp(client, news.from);
    const view = await viewCamp(client, settlementId, news.to);

    const told = (view.events ?? []).filter((event) => event.type === 'crews_changed');
    assert.equal(told.length, news.changes.length, 'the tick reported every change and no more');

    for (const one of told) {
      assert.ok(one.a && one.b && one.a !== one.b, 'a change between a crew and itself');
      assert.ok(one.cause.length > 0, 'the world changed and nothing said why');
      assert.ok(RELATIONS[one.state], `${one.state} is not a state`);
      assert.equal(one.says, RELATIONS[one.state].says);
    }

    /*
     * And it reaches a page, which is the half a service test cannot see. The log is where a
     * player who was away reads what happened, and a diplomatic change that only ever appears
     * on a view they might not open is the hidden slider this phase exists not to be.
     */
    const page = campPage(view);
    assert.ok(page.includes(told[0].cause), 'the reason never reached the log');
    assert.ok(page.includes(told[0].says), 'nor did what it changed to');
  });
});

test('the same news is never told twice', async () => {
  await withRollback(async (client) => {
    const far = WORLD_EPOCH + hours(ERA_HOURS * 1100);
    const news = nextNews(far);

    const settlementId = await camp(client, news.from);
    const first = await advanceSettlement(client, settlementId, news.to);
    assert.ok(
      first.events.some((event) => event.type === 'crews_changed'),
      'the setup found no news to repeat',
    );

    // A second load a minute later covers a window with no season boundary in it at all.
    const again = await advanceSettlement(client, settlementId, news.to + hours(1));
    assert.equal(
      again.events.filter((event) => event.type === 'crews_changed').length,
      0,
      'the log repeated itself on the next page load',
    );
  });
});

test('every camp in the world reads the same politics', async () => {
  await withRollback(async (client) => {
    /*
     * The claim that makes this weather rather than a camp's own state, and it is worth a
     * database test rather than a pure one: two settlements, two rows, one derivation. If the
     * seed ever became per-camp this is what would catch it.
     */
    const at = WORLD_EPOCH + hours(ERA_HOURS * 700 + 12);
    const one = await camp(client, at);
    const two = await camp(client, at);

    const a = await viewCamp(client, one, at);
    const b = await viewCamp(client, two, at);
    assert.deepEqual(a.relations, b.relations);
    assert.equal(a.relations.length, PAIRS.length);

    for (const [x, y] of PAIRS) {
      assert.ok(
        a.relations.some((row) => row.state === relationAt(WORLD_SEED, x, y, at)),
        'the view and the rules disagree about the world',
      );
    }
  });
});
