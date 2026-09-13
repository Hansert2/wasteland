import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { startHunt, huntTurn } from '../../src/services/hunt.js';
import { startBuild } from '../../src/services/start-build.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { occupations } from '../../src/services/who-is-free.js';
import { viewCamp } from '../../src/services/view-camp.js';
import { campPage } from '../../src/web/render.js';
import { STAMINA, WITHIN_REACH } from '../../src/game/hunting.js';
import { InputError } from '../../src/errors.js';

const T0 = Date.UTC(2287, 0, 1);
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

async function seed(client, { stamina = 100, stores = 200 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Huntcamp',
    now: T0,
  });
  await raiseSuccessor(client, settlementId, { name: 'Vera', now: T0 });
  await client.query('update characters set stamina = $2 where settlement_id = $1', [
    settlementId,
    stamina,
  ]);
  await client.query(
    'update resources set amount = $2, storage_cap = 100000 where settlement_id = $1',
    [settlementId, stores],
  );

  const { rows } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  return { settlementId, characterId: Number(rows[0].id) };
}

const give = (client, characterId, slug, qty = 1) =>
  client.query(
    `insert into inventory_items (character_id, item_id, qty)
     select $1, id, $3 from items where slug = $2
     on conflict (character_id, item_id) do update set qty = inventory_items.qty + $3`,
    [characterId, slug, qty],
  );

const gaugeOf = async (client, characterId) => {
  const { rows } = await client.query('select stamina, health, died_at from characters where id = $1', [
    characterId,
  ]);
  return {
    stamina: Number(rows[0].stamina),
    health: Number(rows[0].health),
    alive: rows[0].died_at === null,
  };
};

const storedOf = async (client, settlementId, slug) => {
  const { rows } = await client.query(
    `select si.qty from store_items si join items i on i.id = si.item_id
      where si.settlement_id = $1 and i.slug = $2`,
    [settlementId, slug],
  );
  return Number(rows[0]?.qty ?? 0);
};

const foodOf = async (client, settlementId) => {
  const { rows } = await client.query(
    `select amount from resources where settlement_id = $1 and kind = 'food'`,
    [settlementId],
  );
  return Number(rows[0].amount);
};

/** Press until it ends, taking whichever of the wanted moves is on offer. */
async function playOut(client, settlementId, prefer, now = T0) {
  let last = null;
  for (let n = 0; n < 8; n += 1) {
    const view = await viewCamp(client, settlementId, now);
    if (!view.hunt || view.hunt.status !== 'active') return { view, last };
    const move =
      prefer.find((key) => view.hunt.moves.some((one) => one.key === key)) ?? 'leave';
    last = await huntTurn(client, settlementId, move, now);
  }
  throw new Error('the hunt never ended');
}

test('going out costs a quarter of a day up front, and the row carries no deadline', async () => {
  /*
   * The two halves of what makes this a mode rather than a block. The stamina is spent before
   * anybody knows what is out there — that is the decision — and the row has no timestamp
   * anything counts down to, which is the entire request this phase answers.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);

    const before = await gaugeOf(client, characterId);
    const { state } = await startHunt(client, settlementId, characterId, T0);
    const after = await gaugeOf(client, characterId);

    assert.equal(before.stamina - after.stamina, STAMINA, 'a quarter of the gauge, at once');
    assert.equal(state.status, 'active');
    assert.ok(['hare', 'deer', 'boar'].includes(state.quarry));

    const { rows } = await client.query(
      'select resolved_at, started_at, state from hunts where settlement_id = $1',
      [settlementId],
    );
    assert.equal(rows[0].resolved_at, null);
    assert.equal(rows[0].state.turn, 0);

    // Nothing on the row is a deadline. `started_at` records when, and nothing reads it as a
    // clock — the contrast with expeditions, builds, raids and sleep is the phase.
    const { rows: columns } = await client.query(
      `select column_name from information_schema.columns
        where table_name = 'hunts' and data_type = 'timestamp with time zone'`,
    );
    assert.deepStrictEqual(
      columns.map((one) => one.column_name).sort(),
      ['resolved_at', 'started_at'],
      'a hunt has no returns_at, completes_at or closes_at, and must not grow one',
    );
  });
});

test('a hunt holds the survivor, and lets them go the moment it ends', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await startHunt(client, settlementId, characterId, T0);

    const busy = await occupations(client, settlementId, T0);
    assert.equal(busy.get(characterId)?.kind, 'hunting');
    assert.equal(busy.get(characterId)?.until, null, 'and with no hour it ends at');

    await assert.rejects(
      () => startBuild(client, settlementId, 'garden', T0, characterId),
      /out after something/i,
      'the yard refuses them in the words the refusals use',
    );
    await assert.rejects(
      () => dispatchExpedition(client, settlementId, 'the_fence_line', T0, characterId),
      /out after something/i,
    );

    await huntTurn(client, settlementId, 'leave', T0);
    const free = await occupations(client, settlementId, T0);
    assert.equal(free.get(characterId), undefined, 'and backing off hands them back');
  });
});

test('taking it puts meat in the stores and the materials on the shelf', async () => {
  /*
   * The split is Phase 13's, applied to a thing that happens at home: a find is out there and
   * the box is at home, and **a hunt is at home**. Nothing goes into a pack that could be too
   * full to take it — there is no reason for a pack to be involved at all.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await give(client, characterId, 'hunting_bow');

    /*
     * Hunt until one of them comes off, which is what a player does. Every hunt is a fresh
     * seed, so this terminates for the same reason a coin lands — a bow takes about three in
     * five.
     *
     * **Health is put back as well as stamina, and that is not tidying.** The first version
     * reset only the gauge, so forty greedy hunts in a row accumulated boar damage until the
     * hunter died and the loop failed on `startHunt` with nobody to send: a test that failed
     * for a reason that had nothing to do with what it was asserting.
     */
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await client.query(
        'update characters set stamina = 100, health = 100 where id = $1',
        [characterId],
      );
      await startHunt(client, settlementId, characterId, T0);
      const foodBefore = await foodOf(client, settlementId);
      const { view } = await playOut(client, settlementId, ['strike', 'close'], T0);

      if (view.hunt.status !== 'taken') continue;

      assert.ok(await foodOf(client, settlementId) > foodBefore, 'the larder is better off');
      assert.ok(
        (await storedOf(client, settlementId, 'raw_hide')) +
          (await storedOf(client, settlementId, 'sinew')) >
          0,
        'and something came off it that only a hunt produces',
      );

      // Never into the pack: the bow is all they are carrying.
      const { rows } = await client.query(
        `select i.slug from inventory_items ii join items i on i.id = ii.item_id
          where ii.character_id = $1 and ii.qty > 0`,
        [characterId],
      );
      assert.deepStrictEqual(rows.map((one) => one.slug), ['hunting_bow']);
      return;
    }
    throw new Error('forty hunts with a bow and nothing was ever taken');
  });
});

test('nothing can be started on an empty gauge, and the refusal says how short they are', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client, { stamina: STAMINA - 1 });

    await assert.rejects(
      () => startHunt(client, settlementId, characterId, T0),
      (error) => error instanceof InputError && new RegExp(String(STAMINA)).test(error.message),
      'and it names the number rather than saying no',
    );

    const { rows } = await client.query('select count(*)::int as n from hunts');
    assert.equal(rows[0].n, 0, 'and no row was written');
  });
});

test('one hunt at a time, and a move nobody was offered is refused', async () => {
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await startHunt(client, settlementId, characterId, T0);

    await assert.rejects(
      () => startHunt(client, settlementId, characterId, T0),
      /already out after something/i,
    );

    // Striking from a field away is not on the menu, and the service reads the same function
    // the page does rather than a list of its own.
    const view = await viewCamp(client, settlementId, T0);
    if (!view.hunt.moves.some((one) => one.key === 'strike')) {
      await assert.rejects(() => huntTurn(client, settlementId, 'strike', T0), /not one of/i);
    }
    await assert.rejects(() => huntTurn(client, settlementId, 'run away', T0), /not one of/i);
  });
});

test('the block says where it stands, offers every move, and keeps the outcome afterwards', async () => {
  /*
   * A block that vanished when the hunt ended would take the answer with it: the player would
   * press "Take it" and the page would come back with a hole where the result should be.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);
    await startHunt(client, settlementId, characterId, T0);

    const view = await viewCamp(client, settlementId, T0);
    const page = campPage(view, { pane: 'camp' });

    assert.ok(view.hunt.said, 'it says what is out there');
    assert.match(page, /action="\/hunt\/turn"/, 'and offers the presses');
    assert.match(page, /name="move" value="leave"/, 'backing off included, on every turn');
    /*
     * And nothing in the block is a countdown, which is the phase in one assertion.
     *
     * The section is cut out first rather than matched across the page: the first version of
     * this looked for the id and a `data-until` with a wildcard between them, and a wildcard
     * between two points in a three-hundred-kilobyte document will find anything you ask it
     * for. It passed against a page that was fine and would have passed against one that was
     * not.
     */
    const hunted = page.slice(page.indexOf('id="s-hunt"'));
    const only = hunted.slice(0, hunted.indexOf('</section>'));
    assert.ok(only.length > 0, 'the block is on the page');
    assert.doesNotMatch(only, /data-until|data-done|data-drift/, 'and carries no clock at all');

    await huntTurn(client, settlementId, 'leave', T0);

    const after = campPage(await viewCamp(client, settlementId, T0), { pane: 'camp' });
    assert.match(after, /came away with nothing/, 'the outcome survives the press that made it');
    assert.match(after, /action="\/hunt"/, 'and the verb is offered again');
  });
});

test('a boar that has turned can kill, and only ever after the screen that said so', async () => {
  /*
   * The stake settled with the user on 2026-09-13, and the fairness rule that comes with it.
   * Driven through the real service rather than the pure module, because what this is really
   * asserting is that `hunt.js` writes the death the same way the trip does — cause and all —
   * rather than leaving a survivor at zero for the tick to find.
   */
  await withRollback(async (client) => {
    const { settlementId, characterId } = await seed(client);

    for (let attempt = 0; attempt < 60; attempt += 1) {
      await client.query(
        'update characters set stamina = 100, health = 12, died_at = null, cause_of_death = null where id = $1',
        [characterId],
      );
      await client.query('delete from hunts where settlement_id = $1', [settlementId]);
      await startHunt(client, settlementId, characterId, T0);

      // Press on regardless, which is the one way to get hurt.
      let warned = false;
      for (let n = 0; n < 8; n += 1) {
        const view = await viewCamp(client, settlementId, T0);
        if (!view.hunt || view.hunt.status !== 'active') break;
        if (view.hunt.turning) warned = true;
        const move = view.hunt.moves.some((one) => one.key === 'strike') ? 'strike' : 'close';
        await huntTurn(client, settlementId, move, T0);
      }

      const gauge = await gaugeOf(client, characterId);
      if (gauge.alive && gauge.health === 12) continue;

      assert.ok(warned, 'blood was drawn with no screen having said it was coming');
      if (!gauge.alive) {
        const { rows } = await client.query(
          'select cause_of_death from characters where id = $1',
          [characterId],
        );
        assert.match(rows[0].cause_of_death, /hunting/, 'and they died of what happened to them');
      }
      return;
    }
    throw new Error('sixty reckless hunts at 12 health and nobody was ever touched');
  });
});

test.after(async () => {
  await pool.end();
});
