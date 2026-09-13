/**
 * When raiders arrive, is there anybody in the camp to meet them?
 *
 * Reported from play on 2026-09-13, and it is the one thing in those notes that nothing
 * shipped since touches: *"with a single or two I think it may be just looking at them take
 * it, since they may be away in that duration."* A raid is a decision about who stands at the
 * fence. A camp whose whole roster is twenty hours down the road has no decision in it — the
 * block asks a question with no answers on it, and the drain runs for four hours whatever the
 * player does.
 *
 * Waking a sleeper does not touch this and neither does arming one, which is why it wanted
 * measuring rather than fixing: **the people are not asleep, they are away.**
 *
 * ## What is real here
 *
 * The camps are played through the real services for ninety days, and the raids are the
 * game's own: `nextRaidAt` schedules them and the tick opens them, so their number, their
 * spacing and whether a camp was even worth the walk are all the game's arithmetic. Nothing
 * about raiding is reimplemented.
 *
 * Who was home is then read off the record rather than counted as it happens. For every raid
 * that opened a window, the expeditions table says who was on the road across it — a trip
 * spans the raid's hour if it left before and came back after — so "home" is everybody alive
 * and not on one. That is exactly the set the raid block offers, because `answerRaid` refuses
 * `away` and nothing else.
 *
 * **Two figures per roster size, and the second is the one that matters.** Nobody home *at
 * the hour raiders arrive* is a snapshot. Nobody home *at any point in the four hours* is the
 * real spectator: the window is four hours precisely so somebody walking back through the
 * gate at hour three can still go out and stand.
 *
 * ## The itinerary, and why it is the aggressive one
 *
 * Everybody free is sent somewhere on every check-in, richest region their dose can stand.
 * That is not the only way to play, but it is the way the complaint came from: a player with
 * one or two survivors keeps them working, because an idle survivor earns nothing. A gentler
 * camp is measured beside it — short hops only — to bound the answer from the other side.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/raid-at-home.mjs
 */
import { pool } from '../src/db/pool.js';
import { advanceSettlement } from '../src/services/advance-settlement.js';
import { dispatchExpedition } from '../src/services/dispatch-expedition.js';
import { startBuild } from '../src/services/start-build.js';
import { commitToRoad } from '../src/services/commit-to-road.js';
import { foundSettlement, raiseSuccessor } from '../src/services/settlement-lifecycle.js';
import { ensureWorldEvents } from '../src/db/world-events.js';
import { loadWorld } from '../src/db/world.js';
import { upgradeCost } from '../src/game/structures.js';
import { LINKS, linkCost } from '../src/game/road.js';
import { startSleep } from '../src/services/start-sleep.js';
import { CONFIG } from '../src/game/constants.js';
import { InputError } from '../src/errors.js';

const hours = (h) => h * 3600_000;
const days = (d) => hours(24 * d);
const T0 = Date.UTC(2026, 3, 1);
const CHECKINS = 180; // twice daily for ninety days, the soak's horizon
const ROSTERS = [1, 2, 3, 4, 5];

/**
 * Three camps per cell, because one is not a sample.
 *
 * A camp meets nine or ten raids in ninety days, so a single run can only ever say "not in
 * nine tries". Three independent raid seeds is thirty, which is enough to tell a fifth from a
 * half — and not enough to tell a fifth from a quarter, which is worth saying out loud rather
 * than reading a two-digit percentage as though it were one.
 */
const SEEDS = [1234567, 2345678, 3456789];

/**
 * Where a survivor is sent, and it is a ladder rather than a choice.
 *
 * The far regions are the ones that make somebody unavailable for most of a day, so a
 * measurement that never sends anybody far would answer a question nobody asked. But they
 * are also **behind the road**, and the first draft of this tool asked for the Deep Zone on
 * day one, had every dispatch refused, and reported that nobody is ever away — a camp where
 * nothing ever leaves, measured with great precision.
 *
 * So: the furthest place this camp can currently send this survivor, tried in order and
 * stopping at the first that is allowed. Locked links, a dose too high for the place and a
 * gauge too low to walk it all come out as refusals, which is the honest way for each of
 * them to remove a destination.
 */
const FAR = [
  'harrow_end', 'the_waterworks', 'the_deep_zone', 'sixteen_wells', 'coastal_wreckage',
  'underground_bunkers', 'the_millrace', 'irradiated_farmland', 'ruined_city',
  'the_service_road', 'the_fence_line',
];
const NEAR = ['ruined_city', 'the_service_road', 'the_fence_line'];
/** Nothing under six hours: a survivor is not spent on an errand. */
const REAL = [
  'harrow_end', 'the_waterworks', 'the_deep_zone', 'sixteen_wells', 'coastal_wreckage',
  'underground_bunkers', 'the_millrace', 'irradiated_farmland',
];

async function withRollback(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const swallow = async (fn) => {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error instanceof InputError) return false;
    throw error;
  }
};

/**
 * A camp of `roster` people, with beds enough for them.
 *
 * The survivors are inserted rather than taken in at the gate, because `wandererFor` decides
 * when somebody turns up and this needs a camp of four on day one. The shelter is raised to
 * match so the camp is not a shape the game would refuse to build — a roster the beds cannot
 * hold would make the whole measurement a camp that cannot exist.
 */
async function campOf(client, roster, now, { roadOpen = false, seed = 1234567 } = {}) {
  const { settlementId } = await foundSettlement(client, {
    email: `athome-${Math.random().toString(36).slice(2, 10)}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Fencewatch',
    now,
  });
  await client.query('update settlements set raid_seed = $2 where id = $1', [settlementId, seed]);
  await raiseSuccessor(client, settlementId, { name: 'Sol', now });

  await client.query(
    `update camp_structures set level = greatest(level, $2)
      where settlement_id = $1 and kind = 'shelter'`,
    [settlementId, roster],
  );
  for (let n = 1; n < roster; n += 1) {
    await client.query(
      `insert into characters (settlement_id, name, born_at) values ($1, $2, $3)`,
      [settlementId, `Hand ${n}`, new Date(now)],
    );
  }

  /*
   * And, for the run that is about long trips, a road already built.
   *
   * Written straight into `road_links` rather than paid for. Ninety days of honest fuel does
   * not reach the far end — the road is 2252 fuel and the plan says months — so a camp made to
   * earn it spends the whole measurement on four-hour hops, which is precisely the case that
   * is *not* in question. These rows are what `commitToRoad` would have written.
   */
  if (roadOpen) {
    for (let link = 1; link <= LINKS; link += 1) {
      await client.query(
        `insert into road_links (settlement_id, link_index, fuel, completed_at)
         values ($1, $2, $3, $4)`,
        [settlementId, link, linkCost(link), new Date(now)],
      );
    }
  }
  return settlementId;
}

/** Ninety days of a camp that keeps everybody working. */
async function play(roster, { far, roadOpen = false, rests = false, seed = 1234567 }) {
  return withRollback(async (client) => {
    const settlementId = await campOf(client, roster, T0, { roadOpen, seed });
    let trips = 0;
    let refused = 0;

    for (let checkin = 0; checkin < CHECKINS; checkin += 1) {
      const now = T0 + hours(1) + checkin * hours(12) + hours(checkin % 3);
      await advanceSettlement(client, settlementId, now);

      const state = await loadWorld(client, settlementId);

      /*
       * A thinned camp is refilled, or a roster of one stops being a roster of one the first
       * time somebody starves and the rest of the run measures an empty camp.
       *
       * `raiseSuccessor` only for an empty one — it refuses a camp somebody is already
       * holding, which is correct and was the second fault in this tool's first run.
       */
      const living = (state.survivors ?? []).filter((one) => one.alive).length;
      if (living === 0) {
        await raiseSuccessor(client, settlementId, { name: `Heir ${checkin}`, now });
      }
      for (let n = Math.max(living, 1); n < roster; n += 1) {
        await client.query(
          `insert into characters (settlement_id, name, born_at) values ($1, $2, $3)`,
          [settlementId, `Hand ${checkin}-${n}`, new Date(now)],
        );
      }

      // Something to spend scrap on, so the camp keeps growing and stays worth raiding.
      const scrap = state.settlement.resources.scrap.amount;
      const cheapest = (state.settlement.structures ?? [])
        .map((one) => ({ kind: one.kind, cost: upgradeCost(one.kind, one.level) }))
        .filter((one) => one.cost.scrap <= scrap)
        .sort((a, b) => a.cost.scrap - b.cost.scrap)[0];
      if (cheapest) await swallow(() => startBuild(client, settlementId, cheapest.kind, now));

      /*
       * Fuel goes on the road, because the far regions are behind it. A camp that never
       * links anything can only ever send somebody four hours away, and four hours is not
       * the complaint — twenty is.
       */
      const fuel = (await loadWorld(client, settlementId)).settlement.resources.fuel.amount;
      if (fuel >= 1) await swallow(() => commitToRoad(client, settlementId, Math.floor(fuel), now));

      // And everybody who can go, goes as far as they are allowed.
      const fresh = await loadWorld(client, settlementId);
      for (const person of fresh.survivors ?? []) {
        if (!person.alive) continue;
        let sent = false;
        for (const slug of rests ? REAL : far ? FAR : NEAR) {
          if (await swallow(() => dispatchExpedition(client, settlementId, slug, now, person.id))) {
            sent = true;
            trips += 1;
            break;
          }
        }

        /*
         * And the player who will not spend a survivor on a ten-minute errand.
         *
         * This is the policy the complaint is really about. Stamina is what keeps somebody
         * home: a trip costs `staminaPerHourWorked` an hour, so Harrow End is 99 of a
         * hundred-point gauge and one long walk empties it. A camp that then sends them to
         * the Fence Line is a camp whose people are *at home*, which is why the first runs
         * of this tool found nobody ever away.
         *
         * So under `rests`, a survivor too spent for a real trip is put under instead. Sleep
         * pays back at `staminaSleepPerHour` against 1/h passive, which is the only way to
         * keep somebody on the road most of the time — and it is exactly what a player
         * chasing fuel does. A sleeper is still *home*: they can stand at the fence, and
         * since 2026-09-13 raiders wake them for good. So this policy maximises the time the
         * camp is genuinely empty without cheating to get there.
         */
        if (!sent) {
          refused += 1;
          if (rests) {
            const longest = CONFIG.sleepHours[CONFIG.sleepHours.length - 1];
            await swallow(() => startSleep(client, settlementId, person.id, longest, now));
          }
        }
      }
    }

    /*
     * And then the record is read.
     *
     * Only raids that opened a window: a camp under `NOT_WORTH_THE_WALK` is picked over and
     * settled at its own hour with `closes_at = at`, and a raid that was turned away at the
     * fence never writes a row at all. Neither asks the player anything, so neither belongs
     * in a measurement about whether the player could answer.
     *
     * `home` counts everybody alive at that hour who was not on the road. Sleep is not
     * consulted: a sleeper can stand — `answerRaid` refuses `away` and nothing else — and
     * since 2026-09-13 the raid wakes them for good rather than only in the walk.
     */
    const { rows } = await client.query(
      `with raid as (
         select id, at, closes_at from raids
          where settlement_id = $1 and closes_at > at
       )
       select r.at,
              (select count(*) from characters c
                where c.settlement_id = $1 and c.born_at <= r.at
                  and (c.died_at is null or c.died_at > r.at)) as alive,
              (select count(*) from expeditions e
                 join characters c on c.id = e.character_id
                where c.settlement_id = $1
                  and e.departed_at <= r.at
                  and coalesce(e.returns_at, e.resolved_at) > r.at) as away_at_open,
              (select count(*) from expeditions e
                 join characters c on c.id = e.character_id
                where c.settlement_id = $1
                  and e.departed_at <= r.at
                  and coalesce(e.returns_at, e.resolved_at) >= r.closes_at) as away_throughout
         from raid r order by r.at`,
      [settlementId],
    );

    const raids = rows.map((row) => ({
      alive: Number(row.alive),
      homeAtOpen: Number(row.alive) - Number(row.away_at_open),
      // Somebody whose trip did not span the whole window was home for part of it, and four
      // hours is long enough to walk out to the fence in.
      homeInWindow: Number(row.alive) - Number(row.away_throughout),
    }));

    const { rows: onRoad } = await client.query(
      `select coalesce(sum(extract(epoch from (e.returns_at - e.departed_at))) / 3600, 0) as h
         from expeditions e join characters c on c.id = e.character_id
        where c.settlement_id = $1`,
      [settlementId],
    );

    return {
      roster,
      trips,
      refused,
      roadHours: Number(onRoad[0].h),
      raids: raids.length,
      noneAtOpen: raids.filter((one) => one.homeAtOpen <= 0).length,
      noneInWindow: raids.filter((one) => one.homeInWindow <= 0).length,
      meanHome:
        raids.length === 0
          ? 0
          : raids.reduce((sum, one) => sum + one.homeInWindow, 0) / raids.length,
    };
  });
}

await ensureWorldEvents(pool, T0 - days(15), T0 + days(95));


const POLICIES = [
  {
    label: 'The road open, long trips only, sleeping to afford the next one',
    far: true,
    roadOpen: true,
    rests: true,
  },
  { label: 'The road open, the furthest place they can reach', far: true, roadOpen: true },
  { label: 'Short hops only', far: false, roadOpen: false },
];

const share = (n, of) => (of === 0 ? '  —  ' : `${((n / of) * 100).toFixed(0)}%`);

for (const policy of POLICIES) {
  console.log(
    `
${policy.label} — ${CHECKINS} check-ins over ninety days, ${SEEDS.length} camps each.
`,
  );
  console.log(
    '  roster   raids   trips   on the road   nobody at the hour   nobody in four hours   home, mean',
  );

  for (const roster of ROSTERS) {
    const runs = [];
    for (const seed of SEEDS) runs.push(await play(roster, { ...policy, seed }));

    const sum = (pick) => runs.reduce((total, one) => total + pick(one), 0);
    const raids = sum((one) => one.raids);
    const roadHours = sum((one) => one.roadHours);
    const meanHome =
      raids === 0 ? 0 : sum((one) => one.meanHome * one.raids) / raids;
    const outShare = `${((roadHours / (90 * 24 * roster * SEEDS.length)) * 100).toFixed(0)}%`;

    console.log(
      `  ${String(roster).padStart(6)}  ${String(raids).padStart(6)}  ` +
        `${String(sum((one) => one.trips)).padStart(6)}  ${outShare.padStart(12)}  ` +
        `${share(sum((one) => one.noneAtOpen), raids).padStart(18)}  ` +
        `${share(sum((one) => one.noneInWindow), raids).padStart(21)}  ` +
        `${meanHome.toFixed(2).padStart(11)}`,
    );
  }
}

console.log(
  `
Read the four-hour column. That is the share of raids whose window opened and shut with
` +
    `nobody the player could have sent to the fence — a block asking a question with no answers
` +
    `on it, for four hours, while the stores go out of the gate. "On the road" is the share of
` +
    `all survivor-hours spent away, and it is what the policy above is really varying.
`,
);

await pool.end();
