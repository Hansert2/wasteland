/**
 * What is there to do when you load the page?
 *
 * The player's verdict on the game has twice been a feeling — "a bit dull", then
 * "still very thin" — and the plan's answer to the second one rested on a claim about
 * the code: that one survivor is the bottleneck on every verb, so a camp whose person
 * is out in the field "can do nothing at all". That claim was testable, and this was
 * the test. It did not survive. Every camp verb guards on *alive*, not *home*.
 *
 * The method is probing rather than reasoning. At every check-in each verb is
 * *actually attempted* inside a savepoint and then rolled back, so availability is
 * decided by the real service guards and the reason a verb is unavailable is the real
 * refusal the player would have read. Nothing about affordability, queue occupancy or
 * caravan windows is reimplemented here, which is the only way this measures what
 * shipped rather than what this file believes shipped.
 *
 * **It now runs the same ninety days twice, under two policies**, because Phase 8 gave
 * fuel a second thing to buy and the plan wrote down the fear that goes with it:
 * nobody ever fits an upgrade again. The road costs 2252 fuel and all three fittings
 * together cost 190, so the road is twelve times the size of everything else fuel can
 * buy — and it is the one with a counter that visibly moves. One camp here pours every
 * scrap of fuel into the road and never fits anything; the other fits all three first
 * and only then starts walking. If the fittings-first camp is *further along the road*
 * at the end, the two sinks feed each other and the pricing holds.
 */
import { pool } from '../src/db/pool.js';
import { loadWorld } from '../src/db/world.js';
import { advanceSettlement } from '../src/services/advance-settlement.js';
import { dispatchExpedition } from '../src/services/dispatch-expedition.js';
import { startBuild } from '../src/services/start-build.js';
import { startCraft } from '../src/services/start-craft.js';
import { startUpgrade } from '../src/services/start-upgrade.js';
import { tradeWithCaravan } from '../src/services/trade.js';
import { commitToRoad } from '../src/services/commit-to-road.js';
import { foundSettlement, raiseSuccessor } from '../src/services/settlement-lifecycle.js';
import { ensureWorldEvents } from '../src/db/world-events.js';
import { momentsFor, isOpen } from '../src/game/moments.js';
import { UPGRADES, upgradeCost } from '../src/game/structures.js';
import { FACTIONS } from '../src/game/factions.js';
import { LINKS, linkCost, roadCost } from '../src/game/road.js';
import { InputError } from '../src/errors.js';

const hours = (h) => h * 3600_000;
const days = (d) => hours(24 * d);
const T0 = Date.UTC(2026, 3, 1);
const CHECKINS = 180; // twice daily for ninety days, the soak's horizon

/** The verbs the camp page offers. A check-in is thin when few of these are live. */
const VERBS = ['dispatch', 'build', 'fit', 'craft', 'trade', 'moment', 'road'];

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

/**
 * The third randomness source, pinned.
 *
 * `dispatchExpedition` rolls a fresh Math.random seed per trip, which is right for the
 * game and fatal for a comparison: the two policies would face different weather, hauls
 * and moments, and the gap between them would be mostly dice. Overwriting the seed after
 * each dispatch — derived from the check-in number, exactly as the soak does — makes the
 * two runs face identical trips, so any difference at the end belongs to the policy.
 *
 * Caught by running the tool twice and getting different answers from the same code.
 */
async function pinTripSeed(client, settlementId, checkin) {
  await client.query(
    `update expeditions e set seed = $2
       from characters c
      where c.id = e.character_id and c.settlement_id = $1 and e.status = 'active'`,
    [settlementId, 100_000 + checkin * 7919],
  );
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

const { rows: regionRows } = await pool.query('select slug from regions order by danger');
const { rows: recipeRows } = await pool.query('select slug from recipes');
const regions = regionRows.map((row) => row.slug);
const recipes = recipeRows.map((row) => row.slug);
const structureKinds = [
  'shelter', 'garden', 'water_collector', 'workshop', 'fence_line', 'watchtower',
];

/**
 * Ninety days of one policy.
 *
 * `fitsUpgrades` is the whole difference between the two runs. Everything else — the
 * itinerary, the builds, the bench, the caravans — is identical, so any gap at the end
 * belongs to the choice about fuel and to nothing else.
 */
async function play({ name, fitsUpgrades }) {
  return withRollback(async (client) => {
    const settlementId = await settlementOf(client, T0);


    const available = Object.fromEntries(VERBS.map((v) => [v, 0]));
    const reasons = Object.fromEntries(VERBS.map((v) => [v, {}]));
    const histogram = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((n) => [n, 0]));

    let deaths = 0;
    let fitted = 0;
    let sentUpTheRoad = 0;
    let trips = 0;
    let waitedOut = 0;
    const linkedOnCheckin = [];

    for (let checkin = 0; checkin < CHECKINS; checkin += 1) {
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
          Object.keys(FACTIONS).flatMap((faction) =>
            [0, 1, 2, 3].map((offer) => ({ faction, offer }))),
          (candidate) => tradeWithCaravan(client, settlementId, candidate, now),
        ),
        moment: await openMoment(client, settlementId, now),
        // One unit is the honest question: is there anything at all I could put
        // toward the road right now.
        road: await probe(client, () => commitToRoad(client, settlementId, 1, now)),
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

      // Then play, so the next check-in inherits a camp that has been lived in.
      const scrap = state.settlement.resources.scrap.amount;
      const cheapest = state.settlement.structures
        .map((s) => ({ kind: s.kind, cost: upgradeCost(s.kind, s.level) }))
        .filter((o) => o.cost.scrap <= scrap)
        .sort((a, b) => a.cost.scrap - b.cost.scrap)[0];
      if (cheapest) await swallow(() => startBuild(client, settlementId, cheapest.kind, now));

      if (fitsUpgrades) {
        for (const slug of Object.keys(UPGRADES)) {
          if (await swallow(() => startUpgrade(client, settlementId, slug, now))) fitted += 1;
        }
      }

      await swallow(() =>
        startCraft(client, settlementId, checkin % 5 ? 'scrap_spear' : 'preserved_meal', now));

      if (checkin % 2 === 0) {
        for (const faction of Object.keys(FACTIONS)) {
          await swallow(() =>
            tradeWithCaravan(client, settlementId, { faction, offer: (checkin / 2) % 4 }, now));
        }
      }

      /**
       * The road policy. Both camps send everything they can spare; the difference is
       * what "spare" means. The fittings-first camp holds back until all three are on,
       * which is the strategy the plan hopes wins — filtration pays for itself in fuel,
       * so spending 60 to earn faster should reach 2252 sooner.
       */
      const fuel = (await loadWorld(client, settlementId)).settlement.resources.fuel.amount;
      const holdBack = fitsUpgrades && fitted < Object.keys(UPGRADES).length ? 80 : 0;
      const spare = Math.floor(fuel - holdBack);

      if (spare >= 1) {
        const before = linkedOnCheckin.length;
        const out = await swallow(async () => {
          const result = await commitToRoad(client, settlementId, spare, now);
          sentUpTheRoad += result.committed;
          if (result.completed) linkedOnCheckin.push(checkin);
        });
        void out;
        void before;
      }

      /**
       * Where to send them — and this is the part that took three attempts to get
       * honest, so it is written down.
       *
       * The first version dispatched off a fixed rotation regardless of the survivor.
       * That made the whole comparison meaningless: what filtration buys is radiation
       * cleared faster *in camp*, so a survivor can go somewhere dangerous again
       * sooner. An automaton that never waits on radiation never collects that, so
       * fitting it could only ever look like 190 fuel thrown away.
       *
       * The second version waited on radiation but kept the soak's gentle rotation,
       * which spends five slots in eight on places that barely dose at all. Radiation
       * reached the threshold three times in ninety days. Still nothing to clear.
       *
       * So the itinerary here is a **fuel-chaser**: always the richest fuel region the
       * survivor can currently stand. That is not the only way to play, and it is not
       * how the soak plays — but it is precisely the player the road-versus-fittings
       * question is about, because they are the one who needs 2252 fuel.
       */
      const rads = Number((await loadWorld(client, settlementId)).survivor?.radiation ?? 0);
      const going =
        rads <= 35 ? 'the_deep_zone' : rads <= 55 ? 'underground_bunkers' : 'the_service_road';

      if (await swallow(() => dispatchExpedition(client, settlementId, going, now))) {
        trips += 1;
        if (rads > 35) waitedOut += 1;
        await pinTripSeed(client, settlementId, checkin);
      }
    }


    return {
      name,
      available,
      reasons,
      histogram,
      deaths,
      fitted,
      sentUpTheRoad,
      trips,
      waitedOut,
      linkedOnCheckin,
    };
  });
}

const roadFirst = await play({ name: 'road first', fitsUpgrades: false });
const fittingsFirst = await play({ name: 'fittings first', fitsUpgrades: true });

const pct = (n) => `${((n / CHECKINS) * 100).toFixed(0)}%`;
const both = [roadFirst, fittingsFirst];

console.log(`\n${CHECKINS} check-ins, twice daily over ninety days, played twice.\n`);

console.log('                            road first   fittings first');
const line = (label, pick) =>
  console.log(`  ${label.padEnd(26)}${String(pick(roadFirst)).padStart(10)}${String(pick(fittingsFirst)).padStart(17)}`);

line('upgrades fitted', (r) => r.fitted);
line('fuel put into the road', (r) => Math.round(r.sentUpTheRoad));
line('links reached', (r) => r.linkedOnCheckin.length);
line('days to the first link', (r) =>
  r.linkedOnCheckin.length > 0 ? (r.linkedOnCheckin[0] / 2).toFixed(1) : 'never');
line('expeditions sent', (r) => r.trips);
line('trips spent too hot to go deep', (r) => r.waitedOut);
line('deaths', (r) => r.deaths);

console.log(`\n  The road is ${roadCost()} fuel end to end; the first link is ${linkCost(1)} and all`);
console.log(`  ${Object.keys(UPGRADES).length} fittings together are ${Object.values(UPGRADES).reduce((s, u) => s + u.fuel, 0)}.`);
console.log('  If fittings-first is no further along the road, the fear in the plan was real.\n');

for (const report of both) {
  console.log(`=== ${report.name} ===\n`);
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
  console.log('');
}

console.log('Why the road was not available, in the player\'s own words:');
for (const report of both) {
  const top = Object.entries(report.reasons.road).sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  ${report.name}:`);
  for (const [why, n] of top) console.log(`    ${String(n).padStart(3)}  ${why}`);
}

console.log(`\n(${LINKS} links exist in total.)`);

await pool.end();
