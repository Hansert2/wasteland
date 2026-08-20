import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { loadWorld } from '../../src/db/world.js';
import { advanceSettlement } from '../../src/services/advance-settlement.js';
import { dispatchExpedition } from '../../src/services/dispatch-expedition.js';
import { answerMoment } from '../../src/services/answer-moment.js';
import { momentsFor, isOpen } from '../../src/game/moments.js';
import { startBuild } from '../../src/services/start-build.js';
import { startCraft } from '../../src/services/start-craft.js';
import { startUpgrade } from '../../src/services/start-upgrade.js';
import { tradeWithCaravan } from '../../src/services/trade.js';
import { foundSettlement, raiseSuccessor } from '../../src/services/settlement-lifecycle.js';
import { UPGRADES, upgradeCost } from '../../src/game/structures.js';
import { commitToRoad } from '../../src/services/commit-to-road.js';
import { LINKS, linkCost } from '../../src/game/road.js';
import { ensureWorldEvents } from '../../src/db/world-events.js';
import { FACTIONS } from '../../src/game/factions.js';
import { InputError } from '../../src/errors.js';

const hours = (h) => h * 60 * 60 * 1000;
const days = (d) => hours(24 * d);
const uniq = () => Math.random().toString(36).slice(2, 10);

/**
 * The soak: months of real play through the real service layer.
 *
 * Every balance harness in tools/ measures one mechanic in isolation, and the
 * per-phase tests do the same. Nothing else exercises raids, caravans, weather,
 * crafting, expeditions, deaths and successions all interacting over a long horizon
 * — which is exactly the kind of gap the filtration bug lived in.
 *
 * Every service takes an explicit `now`, so a virtual clock can play ninety days in
 * a few seconds inside one rollback transaction. The player below is a simple
 * automaton — check in twice a day, spend what is affordable, keep somebody in the
 * field, take over when somebody dies — and the test is the invariants, checked at
 * every single check-in, not the player's score.
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

/**
 * The soak's clock. Fixed rather than derived from Date.now(): weather slots are
 * anchored to the world epoch, so a wall-clock T0 meant every run played under
 * different skies — code review caught the file promising exact replayability while
 * two of its three randomness sources still rolled with the clock. It also keeps the
 * soak's world_events slots (April–July) disjoint from every other suite's (which
 * generate near the real today), so no test queues on another's uncommitted inserts.
 */
const T0 = Date.UTC(2026, 3, 1);

/** Deterministic camp: the founding seeds are pinned so a failure replays exactly. */
async function foundPinned(client, now) {
  const { settlementId } = await foundSettlement(client, {
    email: `${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Soaktown',
    now,
  });
  await client.query(
    'update settlements set raid_seed = 1234567, caravan_seed = 7654321 where id = $1',
    [settlementId],
  );
  await raiseSuccessor(client, settlementId, { name: 'Sol', now });
  return settlementId;
}

/**
 * The third randomness source, pinned. `dispatchExpedition` rolls a fresh
 * `Math.random` seed per trip — right for the game, wrong for a test that promises
 * replayable failures — so after each dispatch the trip's seed is overwritten with
 * one derived from the check-in number. The outcome is still rolled by the real
 * resolution path; only the dice are loaded.
 */
async function pinExpeditionSeed(client, settlementId, checkin) {
  await client.query(
    `update expeditions e set seed = $2
       from characters c
      where c.id = e.character_id and c.settlement_id = $1 and e.status = 'active'`,
    [settlementId, 100_000 + checkin * 7919],
  );
}

/** Swallow refusals — a player clicking a button that says no — never real errors. */
async function attempt(fn) {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error instanceof InputError) return false;
    throw error;
  }
}

/** The invariants. Broken state, not bad luck, is what this test exists to catch. */
/**
 * Answer one open moment, if the trip in flight is offering one.
 *
 * Rotates through the options rather than always taking the default, because a soak
 * that only ever declines exercises the recording path and none of the consequences.
 *
 * Returns false when there is simply nothing to answer — nobody out, or no window open.
 * That is not a refusal and must not be treated as one: `attempt` swallows InputError
 * and nothing else, which is exactly right and was not worth weakening for this.
 */
async function answerOpenMoment(client, settlementId, now, checkin) {
  const { rows } = await client.query(
    `select e.seed, e.departed_at, e.choices, r.slug, r.travel_hours
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'`,
    [settlementId],
  );
  const trip = rows[0];
  if (!trip) return false;

  const travelHours = Number(trip.travel_hours);
  const elapsed = (now - trip.departed_at.getTime()) / 3600000;
  const answered = new Set((trip.choices ?? []).map((choice) => Number(choice.index)));

  const open = momentsFor({ slug: trip.slug, travelHours }, Number(trip.seed)).find(
    (moment) => !answered.has(moment.index) && isOpen(moment, elapsed),
  );
  if (!open) return false;

  // The refusal that does happen here is spending from an empty pack, which is a
  // player clicking a button that says no — the same thing `attempt` exists for.
  const option = open.options[checkin % open.options.length];
  return attempt(() =>
    answerMoment(client, settlementId, { index: open.index, option: option.key }, now),
  );
}

async function checkInvariants(client, settlementId, now, label) {
  const { rows: res } = await client.query(
    'select kind, amount, storage_cap from resources where settlement_id = $1',
    [settlementId],
  );
  for (const row of res) {
    assert.ok(
      Number(row.amount) >= 0 && Number(row.amount) <= Number(row.storage_cap),
      `${label}: ${row.kind} at ${row.amount} of cap ${row.storage_cap}`,
    );
  }

  const { rows: chars } = await client.query(
    `select id, health, hunger, radiation, died_at, cause_of_death
       from characters where settlement_id = $1`,
    [settlementId],
  );
  for (const c of chars) {
    for (const stat of ['health', 'hunger', 'radiation']) {
      assert.ok(c[stat] >= 0 && c[stat] <= 100, `${label}: ${stat} = ${c[stat]}`);
    }
    if (c.died_at) assert.ok(c.cause_of_death, `${label}: a corpse with no cause`);
  }
  const living = chars.filter((c) => !c.died_at);
  assert.ok(living.length <= 1, `${label}: ${living.length} survivors alive at once`);

  const { rows: standings } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1',
    [settlementId],
  );
  for (const s of standings) {
    assert.ok(FACTIONS[s.faction], `${label}: standing with unknown faction ${s.faction}`);
    assert.ok(
      Number(s.standing) >= -100 && Number(s.standing) <= 100,
      `${label}: standing ${s.standing}`,
    );
  }

  const { rows: st } = await client.query(
    'select last_tick_at, next_raid_at, next_caravan_at from settlements where id = $1',
    [settlementId],
  );
  assert.equal(st[0].last_tick_at.getTime(), now, `${label}: the clock is current`);
  assert.ok(st[0].next_raid_at.getTime() > now, `${label}: a raid is booked ahead`);
  assert.ok(st[0].next_caravan_at, `${label}: a caravan is on the books`);

  // An answer is recorded once per moment and the column stays a small array. The
  // schema enforces the bound; this catches a service that starts writing duplicates.
  const { rows: inFlight } = await client.query(
    `select e.choices from expeditions e
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and e.status = 'active'`,
    [settlementId],
  );
  for (const row of inFlight) {
    const choices = row.choices ?? [];
    assert.ok(Array.isArray(choices) && choices.length <= 8, `${label}: choices ${JSON.stringify(choices)}`);
    const indices = choices.map((choice) => Number(choice.index));
    assert.equal(new Set(indices).size, indices.length, `${label}: a moment answered twice`);
  }

  const { rows: active } = await client.query(
    `select
       (select count(*)::int from expeditions e join characters c on c.id = e.character_id
         where c.settlement_id = $1 and e.status = 'active') as expeditions,
       (select count(*)::int from craft_orders where settlement_id = $1 and status = 'active') as crafts,
       (select count(*)::int from structure_upgrades where settlement_id = $1 and installed_at is null) as fittings`,
    [settlementId],
  );
  assert.ok(active[0].expeditions <= 1 && active[0].crafts <= 1 && active[0].fittings <= 1,
    `${label}: queues over capacity`);

  /**
   * The road. Phase 8 shipped with unit tests and eleven database tests and was never
   * once run through ninety days of everything else happening around it — which is the
   * gap this file exists to close, and the gap the filtration bug lived in.
   *
   * Four things, all of which would fail silently: a link cannot be started before the
   * one ahead of it is done, so the indices are contiguous from one; only one link is
   * ever part-paid; a finished link holds at least what it cost; and nothing exists
   * past the end of the road.
   */
  const { rows: road } = await client.query(
    'select link_index, fuel, completed_at from road_links where settlement_id = $1 order by link_index',
    [settlementId],
  );

  const open = road.filter((row) => row.completed_at === null);
  assert.ok(open.length <= 1, `${label}: ${open.length} links part-paid at once`);

  for (const [i, row] of road.entries()) {
    const index = Number(row.link_index);
    assert.equal(index, i + 1, `${label}: the road skips to link ${index}`);
    assert.ok(index <= LINKS, `${label}: link ${index} is past the end of the road`);
    assert.ok(Number(row.fuel) >= 0, `${label}: link ${index} holds ${row.fuel} fuel`);

    if (row.completed_at !== null) {
      assert.ok(
        Number(row.fuel) >= linkCost(index),
        `${label}: link ${index} finished on ${row.fuel} of ${linkCost(index)}`,
      );
    }
  }

  return road.reduce((total, row) => total + Number(row.fuel), 0);
}

test('ninety days of attentive play holds every invariant at every check-in', async () => {
  // Committed outside the rollback, deliberately. The soak holds its transaction for
  // seconds, and world_events inserts left uncommitted hold speculative unique-index
  // locks that other suites' ensureWorldEvents calls would queue behind. The rows are
  // canonical — pure functions of the fixed world seed — so committing them writes
  // nothing that generation would not have written anyway.
  await ensureWorldEvents(pool, T0 - days(15), T0 + days(95));

  await withRollback(async (client) => {
    const settlementId = await foundPinned(client, T0);

    // The itinerary: safe and short while green, hot and long once equipped.
    const rotation = [
      'the_fence_line', 'the_service_road', 'the_fence_line', 'ruined_city',
      'the_service_road', 'underground_bunkers', 'the_fence_line', 'the_deep_zone',
    ];

    let deaths = 0;
    let roadSoFar = 0;
    const tallies = {
      raids: 0, caravans: 0, trades: 0, builds: 0, crafts: 0, fits: 0, expeditions: 0,
      moments: 0, links: 0,
    };

    for (let checkin = 0; checkin < 180; checkin++) {
      // Twice daily, jittered — and starting an hour after founding, because a
      // check-in at the exact founding millisecond is a zero-elapsed tick, which
      // early-returns before the raid and caravan bookkeeping runs. No human can
      // click that fast; the automaton could.
      const now = T0 + hours(1) + checkin * hours(12) + hours(checkin % 3);

      /**
       * One death, on purpose, because ninety days of careful play never produces one.
       *
       * This file said "death is part of the itinerary" and it was not: measured, the
       * attentive run buries nobody in ninety days, because the automaton retreats to
       * the fence line whenever it is hurt or hot. So the succession path below — and
       * every promise that hangs off a succession, including the one that says the road
       * survives it — had never executed inside this soak at all.
       *
       * Not killed with an UPDATE, which was the first attempt and was wrong: it left
       * the corpse holding an active expedition, and the queue invariant caught it. A
       * death has to go through the tick, because the tick is what resolves the trip
       * they were on. So the survivor is walked into a state the tick will not let them
       * out of, and the game does the killing.
       */
      if (checkin === 120) {
        await client.query(
          `update characters set health = 3, radiation = 95
            where settlement_id = $1 and died_at is null`,
          [settlementId],
        );
      }

      const { events } = await advanceSettlement(client, settlementId, now);
      tallies.raids += events.filter((e) => e.type === 'raid' || e.type === 'raid_repelled').length;
      tallies.caravans += events.filter((e) => e.type === 'caravan_arrived').length;
      tallies.expeditions += events.filter(
        (e) => e.type === 'expedition_returned' || e.type === 'expedition_lost',
      ).length;
      for (const event of events) {
        assert.ok(event.at <= now, `an event from the future: ${event.type}`);
      }

      let state = await loadWorld(client, settlementId);

      // Death is part of the itinerary. Take over and keep going.
      if (!state.survivor) {
        deaths += 1;
        await raiseSuccessor(client, settlementId, { name: `Heir${deaths}`, now });
        state = await loadWorld(client, settlementId);
      }

      // Trade with whoever is at the gate, most visits. Refusals are fine. The offer
      // index walks the whole catalogue: review caught the first version gating on
      // even check-ins and *also* indexing by `checkin % 4`, which together could
      // only ever reach offers 0 and 2.
      if (checkin % 2 === 0) {
        for (const faction of Object.keys(FACTIONS)) {
          if (await attempt(() =>
            tradeWithCaravan(client, settlementId, { faction, offer: (checkin / 2) % 4 }, now),
          )) tallies.trades += 1;
        }
      }

      // Build whatever is cheapest and affordable.
      const scrap = state.settlement.resources.scrap.amount;
      const affordable = state.settlement.structures
        .map((s) => ({ kind: s.kind, cost: upgradeCost(s.kind, s.level) }))
        .filter((o) => o.cost.scrap <= scrap)
        .sort((a, b) => a.cost.scrap - b.cost.scrap)[0];
      if (affordable && (await attempt(() => startBuild(client, settlementId, affordable.kind, now)))) {
        tallies.builds += 1;
      }

      // Fit fuel upgrades as they come into reach; craft when the bench is free.
      for (const slug of Object.keys(UPGRADES)) {
        if (await attempt(() => startUpgrade(client, settlementId, slug, now))) tallies.fits += 1;
      }
      if (await attempt(() => startCraft(client, settlementId, checkin % 5 ? 'scrap_spear' : 'preserved_meal', now))) {
        tallies.crafts += 1;
      }

      // Answer whatever the field is asking. Before dispatching, because a moment
      // only exists while somebody is already out there.
      if (await answerOpenMoment(client, settlementId, now, checkin)) tallies.moments += 1;

      /**
       * Whatever is spare goes up the road, once the fittings are on.
       *
       * The reserve is what keeps the two sinks from starving each other, and the order
       * is not arbitrary: `tools/check-in-density.mjs` played ninety days both ways and
       * the camp that fitted first put *more* fuel into the road than the camp that
       * poured everything in, because filtration buys back the waiting that would
       * otherwise have been spent too irradiated to travel.
       */
      const fuel = state.settlement.resources.fuel.amount;
      const spare = Math.floor(fuel - (tallies.fits < Object.keys(UPGRADES).length ? 80 : 0));
      if (spare >= 1) {
        await attempt(async () => {
          const out = await commitToRoad(client, settlementId, spare, now);
          if (out.completed) tallies.links += 1;
        });
      }

      // Keep somebody in the field: short trips while irradiated, the rotation otherwise.
      const region =
        state.survivor.radiation > 40 || state.survivor.health < 50
          ? 'the_fence_line'
          : rotation[checkin % rotation.length];
      if (await attempt(() => dispatchExpedition(client, settlementId, region, now))) {
        await pinExpeditionSeed(client, settlementId, checkin);
      }

      const onTheRoad = await checkInvariants(client, settlementId, now, `check-in ${checkin}`);
      // The road is the one thing a death may not touch. Deaths happen in this run,
      // and successions with them, so a regression that let raiseSuccessor reach this
      // table would show up here as progress going backwards.
      assert.ok(
        onTheRoad >= roadSoFar,
        `check-in ${checkin}: road progress fell from ${roadSoFar} to ${onTheRoad}`,
      );
      roadSoFar = onTheRoad;
    }

    // The soak is about invariants, but a run where nothing happened proves nothing.
    assert.ok(tallies.builds > 10, `only ${tallies.builds} builds in ninety days`);
    assert.ok(tallies.raids > 3, `only ${tallies.raids} raids`);
    assert.ok(tallies.caravans > 5, `only ${tallies.caravans} caravan visits`);
    assert.ok(tallies.trades > 3, `only ${tallies.trades} trades`);
    assert.ok(tallies.crafts > 3, `only ${tallies.crafts} crafts`);
    // The two floors the first version forgot — and they are the two systems this
    // soak exists for. Without them, a renamed region slug or an upgrade regression
    // could zero out expeditions or fittings for ninety days and stay green.
    assert.ok(tallies.expeditions > 20, `only ${tallies.expeditions} expeditions resolved`);
    assert.ok(tallies.fits > 0, `no fuel upgrade was ever fitted (${tallies.fits})`);
    // Same reasoning as the two above: without a floor, a regression that stopped
    // offering moments at all would run ninety days and stay green.
    //
    // The floor is low because the measured figure is low, and it went *down* when
    // the content tripled. Six moments in wide windows caught nine in ninety days;
    // eighteen moments in windows a third as wide catch about four. This automaton
    // checks in every twelve hours, so tightening the windows cost it more than the
    // extra content gained — the trade lands the other way for an attentive player,
    // who now meets moments on the service road and in the city as well.
    //
    // Which player the windows should serve is a design question, and the dial is the
    // divisor in windowHours(). This floor only guards against them vanishing.
    assert.ok(tallies.moments > 2, `only ${tallies.moments} moments answered`);
    // Same reasoning again: without a floor, a road that silently stopped accepting
    // fuel would run ninety days and stay green.
    assert.ok(tallies.links > 0, `ninety days reached ${tallies.links} links`);
    // The deliberate death above must actually have been taken over from, or half the
    // invariants below it are being checked against a camp that never lost anybody.
    assert.ok(deaths > 0, `nobody died, so succession went unexercised`);

    const final = await loadWorld(client, settlementId);
    const levels = final.settlement.structures.reduce((t, s) => t + s.level, 0);
    assert.ok(levels >= 15, `ninety attentive days built a camp of ${levels} levels`);
  });
});

test('ninety days of total neglect resolves in one tick and stays consistent', async () => {
  await ensureWorldEvents(pool, T0 - days(15), T0 + days(95));

  await withRollback(async (client) => {
    const settlementId = await foundPinned(client, T0);
    const now = T0 + days(90);

    const { events } = await advanceSettlement(client, settlementId, now);

    // A starting camp is food-positive, so the founder lives; raids and caravans
    // came and went without anyone home; nothing may be scheduled in the past.
    const deathEvents = events.filter((e) => e.type === 'survivor_died');
    assert.equal(deathEvents.length, 0, 'neglecting a sustainable camp is not fatal');
    assert.ok(events.some((e) => e.type === 'caravan_arrived'), 'the world kept calling');
    assert.ok(events.some((e) => e.type.startsWith('raid')), 'and kept taking');

    await checkInvariants(client, settlementId, now, 'after the long sleep');
  });
});

test.after(async () => {
  await pool.end();
});
