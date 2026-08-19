/**
 * What is there to do when you load the page?
 *
 * The player's verdict on the game has twice been a feeling — "a bit dull", then
 * "still very thin" — and the plan's answer to the second one rests on a claim about
 * the code: that one survivor is the bottleneck on every verb, so a camp whose person
 * is out in the field "can do nothing at all". That claim is testable, and this is the
 * test. It is also the baseline any fix has to beat, measured before the fix exists.
 *
 * The method is probing rather than reasoning. At every check-in each verb is
 * *actually attempted* inside a savepoint and then rolled back, so availability is
 * decided by the real service guards and the reason a verb is unavailable is the real
 * refusal the player would have read. Nothing about affordability, queue occupancy or
 * caravan windows is reimplemented here, which is the only way this measures what
 * shipped rather than what this file believes shipped.
 */
import { pool } from '../src/db/pool.js';
import { loadWorld } from '../src/db/world.js';
import { advanceSettlement } from '../src/services/advance-settlement.js';
import { dispatchExpedition } from '../src/services/dispatch-expedition.js';
import { startBuild } from '../src/services/start-build.js';
import { startCraft } from '../src/services/start-craft.js';
import { startUpgrade } from '../src/services/start-upgrade.js';
import { tradeWithCaravan } from '../src/services/trade.js';
import { foundSettlement, raiseSuccessor } from '../src/services/settlement-lifecycle.js';
import { ensureWorldEvents } from '../src/db/world-events.js';
import { momentsFor, isOpen } from '../src/game/moments.js';
import { UPGRADES, upgradeCost } from '../src/game/structures.js';
import { FACTIONS } from '../src/game/factions.js';
import { InputError } from '../src/errors.js';

const hours = (h) => h * 3600_000;
const days = (d) => hours(24 * d);
const T0 = Date.UTC(2026, 3, 1);
const CHECKINS = 180; // twice daily for ninety days, the soak's horizon

/** The verbs the camp page offers. A check-in is thin when few of these are live. */
const VERBS = ['dispatch', 'build', 'fit', 'craft', 'trade', 'moment'];

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

/**
 * Try a verb and undo it.
 *
 * Returns `true` when it would have worked, or the refusal the player would have seen.
 * A savepoint per probe because a failed statement poisons the transaction otherwise,
 * and because a probe that succeeded must leave no trace — the point is to ask what
 * the player *could* do, not to do it for them.
 */
async function probe(client, fn) {
  await client.query('savepoint probe');
  try {
    await fn();
    return true;
  } catch (error) {
    if (!(error instanceof InputError)) throw error;
    return error.message;
  } finally {
    await client.query('rollback to savepoint probe');
  }
}

/** Whichever of the candidates is available, or the refusal the last one gave. */
async function anyOf(client, candidates, run) {
  let last = 'nothing to try';
  for (const candidate of candidates) {
    const result = await probe(client, () => run(candidate));
    if (result === true) return true;
    last = result;
  }
  return last;
}

/** Is the field asking something right now? Read-only, so no probe is needed. */
async function openMoment(client, settlementId, now) {
  const { rows } = await client.query(
    `select e.seed, e.departed_at, e.choices, r.slug, r.travel_hours
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'`,
    [settlementId],
  );
  const trip = rows[0];
  if (!trip) return 'Nobody is out there.';

  const elapsed = (now - trip.departed_at.getTime()) / 3600_000;
  const answered = new Set((trip.choices ?? []).map((choice) => Number(choice.index)));
  const open = momentsFor(
    { slug: trip.slug, travelHours: Number(trip.travel_hours) },
    Number(trip.seed),
  ).find((moment) => !answered.has(moment.index) && isOpen(moment, elapsed));

  return open ? true : 'No window is open.';
}

const settlementOf = async (client, now) => {
  const { settlementId } = await foundSettlement(client, {
    email: `density-${Math.random().toString(36).slice(2, 10)}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Densitytown',
    now,
  });
  await client.query(
    'update settlements set raid_seed = 1234567, caravan_seed = 7654321 where id = $1',
    [settlementId],
  );
  await raiseSuccessor(client, settlementId, { name: 'Sol', now });
  return settlementId;
};

const swallow = async (fn) => {
  try {
    await fn();
    return true;
  } catch (error) {
    if (error instanceof InputError) return false;
    throw error;
  }
};

await ensureWorldEvents(pool, T0 - days(15), T0 + days(95));

const report = await withRollback(async (client) => {
  const settlementId = await settlementOf(client, T0);

  const { rows: regionRows } = await pool.query('select slug from regions order by danger');
  const { rows: recipeRows } = await pool.query('select slug from recipes');
  const regions = regionRows.map((row) => row.slug);
  const recipes = recipeRows.map((row) => row.slug);
  const structureKinds = ['shelter', 'garden', 'water_collector', 'workshop', 'fence_line', 'watchtower'];

  const rotation = [
    'the_fence_line', 'the_service_road', 'the_fence_line', 'ruined_city',
    'the_service_road', 'underground_bunkers', 'the_fence_line', 'the_deep_zone',
  ];

  const available = Object.fromEntries(VERBS.map((v) => [v, 0]));
  const reasons = Object.fromEntries(VERBS.map((v) => [v, {}]));
  const histogram = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((n) => [n, 0]));
  /** Verbs available if the survivor being away stopped blocking anything. */
  const ifHandsWereFree = { ...histogram };
  let deaths = 0;

  for (let checkin = 0; checkin < CHECKINS; checkin++) {
    const now = T0 + hours(1) + checkin * hours(12) + hours(checkin % 3);
    await advanceSettlement(client, settlementId, now);

    let state = await loadWorld(client, settlementId);
    if (!state.survivor) {
      deaths += 1;
      await raiseSuccessor(client, settlementId, { name: `Heir${deaths}`, now });
      state = await loadWorld(client, settlementId);
    }

    // Probe every verb before touching anything, so this measures the page as loaded.
    const live = {
      dispatch: await anyOf(client, regions, (slug) =>
        dispatchExpedition(client, settlementId, slug, now)),
      build: await anyOf(client, structureKinds, (kind) =>
        startBuild(client, settlementId, kind, now)),
      fit: await anyOf(client, Object.keys(UPGRADES), (slug) =>
        startUpgrade(client, settlementId, slug, now)),
      craft: await anyOf(client, recipes, (slug) =>
        startCraft(client, settlementId, slug, now)),
      trade: await anyOf(
        client,
        Object.keys(FACTIONS).flatMap((faction) => [0, 1, 2, 3].map((offer) => ({ faction, offer }))),
        (candidate) => tradeWithCaravan(client, settlementId, candidate, now),
      ),
      moment: await openMoment(client, settlementId, now),
    };

    let n = 0;
    for (const verb of VERBS) {
      if (live[verb] === true) {
        available[verb] += 1;
        n += 1;
      } else {
        reasons[verb][live[verb]] = (reasons[verb][live[verb]] ?? 0) + 1;
      }
    }
    histogram[n] += 1;

    // The counterfactual Phase 7 is priced against: the same check-in, if a second
    // pair of hands meant the trip slot were never the thing standing in the way.
    const freed = n + (live.dispatch === true ? 0 : 1);
    ifHandsWereFree[Math.min(freed, 6)] += 1;

    // Then play, so the next check-in inherits a camp that has been lived in.
    const scrap = state.settlement.resources.scrap.amount;
    const cheapest = state.settlement.structures
      .map((s) => ({ kind: s.kind, cost: upgradeCost(s.kind, s.level) }))
      .filter((o) => o.cost.scrap <= scrap)
      .sort((a, b) => a.cost.scrap - b.cost.scrap)[0];
    if (cheapest) await swallow(() => startBuild(client, settlementId, cheapest.kind, now));
    for (const slug of Object.keys(UPGRADES)) {
      await swallow(() => startUpgrade(client, settlementId, slug, now));
    }
    await swallow(() =>
      startCraft(client, settlementId, checkin % 5 ? 'scrap_spear' : 'preserved_meal', now));
    if (checkin % 2 === 0) {
      for (const faction of Object.keys(FACTIONS)) {
        await swallow(() =>
          tradeWithCaravan(client, settlementId, { faction, offer: (checkin / 2) % 4 }, now));
      }
    }
    await swallow(() =>
      dispatchExpedition(client, settlementId, rotation[checkin % rotation.length], now));
  }

  return { available, reasons, histogram, ifHandsWereFree, deaths };
});

const pct = (n) => `${((n / CHECKINS) * 100).toFixed(0)}%`;

console.log(`\n${CHECKINS} check-ins, twice daily over ninety days. ${report.deaths} deaths.\n`);

console.log('How often each verb was available to click:');
for (const verb of VERBS) {
  const n = report.available[verb];
  console.log(`  ${verb.padEnd(9)} ${String(n).padStart(3)} / ${CHECKINS}  ${pct(n).padStart(4)}`);
}

console.log('\nVerbs available at a single check-in:');
for (const [n, count] of Object.entries(report.histogram)) {
  if (!count) continue;
  const bar = '#'.repeat(Math.round((count / CHECKINS) * 50));
  console.log(`  ${n} verb${n === '1' ? ' ' : 's'}  ${String(count).padStart(3)}  ${pct(count).padStart(4)}  ${bar}`);
}

console.log('\nThe same check-ins if a second pair of hands freed the trip slot:');
for (const [n, count] of Object.entries(report.ifHandsWereFree)) {
  if (!count) continue;
  const bar = '#'.repeat(Math.round((count / CHECKINS) * 50));
  console.log(`  ${n} verb${n === '1' ? ' ' : 's'}  ${String(count).padStart(3)}  ${pct(count).padStart(4)}  ${bar}`);
}

console.log('\nWhy a verb was not available, in the player\'s own words:');
for (const verb of VERBS) {
  const top = Object.entries(report.reasons[verb]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!top.length) continue;
  console.log(`  ${verb}:`);
  for (const [why, n] of top) console.log(`    ${String(n).padStart(3)}  ${why}`);
}

await pool.end();
