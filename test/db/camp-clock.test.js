import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { setCampClock, cooldownLeft, CLOCK_COOLDOWN_MS } from '../../src/services/set-camp-clock.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2287, 0, 1);
const uniq = () => Math.random().toString(36).slice(2, 10);

/** Rolled back always, so the suite leaves the development database as it found it. */
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

/** A camp with somebody in it and enough of everything to send them somewhere. */
async function seed(client) {
  const { rows: players } = await client.query(
    `insert into players (email, password_hash) values ($1, 'x') returning id`,
    [`${uniq()}@example.test`],
  );

  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, last_tick_at) values ($1, 'Probe', $2) returning id`,
    [players[0].id, new Date(T0)],
  );
  const settlementId = settlements[0].id;

  for (const kind of ['shelter', 'garden', 'water_purifier', 'workshop', 'watchtower']) {
    await client.query(
      'insert into camp_structures (settlement_id, kind, level) values ($1, $2, 3)',
      [settlementId, kind],
    );
  }

  for (const kind of ['food', 'water', 'scrap', 'fuel']) {
    await client.query(
      `insert into resources (settlement_id, kind, amount, storage_cap)
       values ($1, $2, 200, 100000)`,
      [settlementId, kind],
    );
  }

  const { rows: characters } = await client.query(
    `insert into characters (settlement_id, name, born_at, health, radiation)
     values ($1, 'Vera', $2, 100, 0) returning id`,
    [settlementId, new Date(T0)],
  );

  return { settlementId, characterId: characters[0].id };
}

test('setting the camp clock moves the hour and the sun together', async () => {
  /*
   * The lesson of migrations 015 and 016 in one assertion. Moving the clock alone carries
   * the sun along with the face and leaves it in the wrong place against the sky, which is
   * the bug that put dawn at 05:24 in a city where it was 06:47. So the endpoint takes a
   * place and derives both, and neither can be set without the other.
   */
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    const result = await setCampClock(client, settlementId, {
      zone: 'Europe/Amsterdam',
      now: Date.UTC(2026, 7, 28, 12),
    });

    assert.equal(result.offsetMinutes, 120, 'CEST, derived rather than taken');
    assert.equal(result.solarNoonMinutes, 820, 'and the sun that goes with it');

    const { rows } = await client.query(
      'select clock_offset_minutes, solar_noon_minutes, clock_changed_at from settlements where id = $1',
      [settlementId],
    );
    assert.equal(rows[0].clock_offset_minutes, 120);
    assert.equal(rows[0].solar_noon_minutes, 820);
    assert.ok(rows[0].clock_changed_at, 'and the camp remembers when it moved');
  });
});

test('the offset is derived from the place, not accepted from the caller', async () => {
  /*
   * The two are not independent facts: a camp claiming Amsterdam on a Denver clock is not
   * a camp anywhere. Node ships the tz database, so the server works the offset out — which
   * also means the winter answer is the winter answer, without a table to keep in step.
   */
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);

    const summer = await setCampClock(client, settlementId, {
      zone: 'Europe/Amsterdam',
      now: Date.UTC(2026, 7, 28, 12),
    });
    assert.equal(summer.offsetMinutes, 120, 'August is CEST');

    // Past the cooldown, so the second move is allowed on its own merits.
    await client.query('update settlements set clock_changed_at = null where id = $1', [
      settlementId,
    ]);

    const winter = await setCampClock(client, settlementId, {
      zone: 'Europe/Amsterdam',
      now: Date.UTC(2026, 0, 15, 12),
    });
    assert.equal(winter.offsetMinutes, 60, 'January is CET');
    assert.equal(winter.solarNoonMinutes, 760, 'and the sun moves with it, not against it');
  });
});

test('a camp may not move its clock twice in a day', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);
    const now = Date.UTC(2026, 7, 28, 12);

    await setCampClock(client, settlementId, { zone: 'Europe/Amsterdam', now });

    await assert.rejects(
      () => setCampClock(client, settlementId, { zone: 'Asia/Tokyo', now: now + HOUR }),
      /only just set its clock/,
      'an hour later is too soon',
    );

    // And the refusal is a refusal, not a partial write.
    const { rows } = await client.query(
      'select clock_offset_minutes from settlements where id = $1',
      [settlementId],
    );
    assert.equal(rows[0].clock_offset_minutes, 120, 'still Amsterdam');

    const later = await setCampClock(client, settlementId, {
      zone: 'Asia/Tokyo',
      now: now + CLOCK_COOLDOWN_MS + 1000,
    });
    assert.equal(later.offsetMinutes, 540, 'a day later it moves');
  });
});

test('moving the clock cannot change a trip already out there', async () => {
  /*
   * The reason migration 017 exists, and the reason the daily limit is not the guard.
   *
   * Daylight multiplies finds and the trip's light is integrated between departure and
   * return. Before 017 that integral was computed against the camp's *current* clock, so a
   * player able to set their own timezone could send somebody out at dusk, roll the clock
   * twelve hours, and have the whole trip resolve as though it had gone at dawn. One change
   * a day would have rationed that exploit rather than closed it — trips are shorter than a
   * day.
   *
   * So the sky is frozen onto the trip at dispatch, like `departed_at` and `seed`. This
   * asserts the frozen values survive a clock change; the tick reads them in preference to
   * the settlement's.
   */
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);
    const now = Date.UTC(2026, 7, 28, 6);

    await setCampClock(client, settlementId, { zone: 'Europe/Amsterdam', now });

    const { rows: regions } = await client.query(
      "select slug from regions order by danger limit 1",
    );
    await dispatchExpedition(client, settlementId, regions[0].slug, now);

    const before = await loadWorld(client, settlementId);
    assert.equal(before.expedition.clockOffset, 120, 'the trip carries the sky it left under');
    assert.equal(before.expedition.solarNoon, 820 / 60);

    // The camp moves half a world away while the survivor is still walking.
    await client.query('update settlements set clock_changed_at = null where id = $1', [
      settlementId,
    ]);
    await setCampClock(client, settlementId, { zone: 'Pacific/Auckland', now: now + HOUR });

    const after = await loadWorld(client, settlementId);
    assert.equal(after.settlement.clockOffset, 720, 'the camp did move');
    assert.equal(
      after.expedition.clockOffset,
      120,
      'and the trip did not: it is still walking under the sky it left beneath',
    );
    assert.equal(after.expedition.solarNoon, 820 / 60);
  });
});

test('a place the camp cannot find the sun from is refused', async () => {
  await withRollback(async (client) => {
    const { settlementId } = await seed(client);
    const now = Date.UTC(2026, 7, 28, 12);

    for (const zone of ['Antarctica/Troll', '__proto__', '; drop table settlements', '']) {
      await assert.rejects(
        () => setCampClock(client, settlementId, { zone, now }),
        /not a place/,
        JSON.stringify(zone),
      );
    }

    // Refused without touching the camp, including its cooldown — a rejected attempt must
    // not spend the day's one move.
    const { rows } = await client.query(
      'select clock_offset_minutes, clock_changed_at from settlements where id = $1',
      [settlementId],
    );
    assert.equal(rows[0].clock_offset_minutes, 0);
    assert.equal(rows[0].clock_changed_at, null);
  });
});

test('the cooldown counts from when the clock moved', () => {
  const now = Date.UTC(2026, 7, 28, 12);
  assert.equal(cooldownLeft(null, now), 0, 'never moved, so free to move');
  assert.equal(cooldownLeft(new Date(now), now), CLOCK_COOLDOWN_MS, 'just moved');
  assert.equal(cooldownLeft(new Date(now - CLOCK_COOLDOWN_MS), now), 0, 'a full day ago');
  assert.equal(cooldownLeft(new Date(now - 2 * CLOCK_COOLDOWN_MS), now), 0, 'longer still');
});
