/**
 * A test camp parked inside an open Contact window, for looking at the moment box.
 *
 * `tools/page-states.mjs` renders that box to a file and rolls the transaction back,
 * which is the right instrument for a redesign and no use at all for playing with one.
 * This is the other half: the same fixture, committed, in a camp you can log into.
 *
 * Nothing here is invented. The camp is founded through the real services and the trip
 * is a real dispatch; only the clock is moved, the way `tools/wl.mjs skip` moves it —
 * every pending timestamp by the same interval, so the tick does the rest honestly.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/demo-contact.mjs
 *   node scripts/with-db.mjs node --env-file=.env tools/demo-contact.mjs --moment the_ford
 *   node scripts/with-db.mjs node --env-file=.env tools/demo-contact.mjs --region ruined_city
 *   node scripts/with-db.mjs node --env-file=.env tools/demo-contact.mjs --empty-pack
 *   node scripts/with-db.mjs node --env-file=.env tools/demo-contact.mjs --list
 *
 * **The moment is drawn, not searched for.** The first version of this asked for the
 * earliest window that had a price in it, which is a question with one answer: it
 * returned the same seed every run, and eighteen moments were written to be looked at
 * while exactly one of them ever was. Wanting an early window was the mistake behind
 * it — the clock is rewound to wherever the window is, so a window four fifths of the
 * way into a twenty-hour walk costs nothing more to stand in than one at two hours.
 * With that gone, every (region, seed, position) that produces a moment is a candidate,
 * and the pick is uniform over *moments* rather than over candidates, so the rare ones
 * come up as often as `the_tin` instead of being drowned by it.
 */
import { pool } from '../src/db/pool.js';
import { foundSettlement, raiseSuccessor } from '../src/services/settlement-lifecycle.js';
import { dispatchExpedition } from '../src/services/dispatch-expedition.js';
import { MOMENTS, momentsFor, optionEffects } from '../src/game/moments.js';

const PASSWORD = 'correct horse battery staple';

/** How far into its window to stand: far enough in to be open, near enough to read it. */
const INTO_WINDOW = 0.1;

/**
 * Seeds to walk per region.
 *
 * A trip's moments are a shuffle of what the region holds, so coverage is a coupon
 * collector's problem and not a search: four hundred seeds is far more than enough for
 * every eligible moment in every region to turn up somewhere, and cheap enough that the
 * whole sweep is imperceptible next to one round trip to the database.
 */
const SEEDS = 400;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? null : args[at + 1] ?? '';
};
const has = (name) => args.includes(`--${name}`);

/** Every (region, seed, position) that puts `key` in front of a player. */
function candidatesFor(regions, { moment = null, region = null } = {}) {
  const found = [];

  for (const place of regions) {
    if (region && place.slug !== region) continue;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      for (const placed of momentsFor(place, seed)) {
        if (moment && placed.key !== moment) continue;
        found.push({ place, seed, at: placed.atHour, closesAt: placed.closesAt, key: placed.key });
      }
    }
  }

  return found;
}

/**
 * One candidate, drawn so that every moment is as likely as every other.
 *
 * Uniform over the list would be uniform over *placements*, and the two are nothing
 * alike: `the_tin` is eligible in all five long regions and `the_container` in one, so
 * a flat draw would show the tin about eight times as often. Which is exactly the
 * failure this tool started with, arrived at by a different route.
 */
function draw(candidates) {
  const byMoment = new Map();
  for (const candidate of candidates) {
    if (!byMoment.has(candidate.key)) byMoment.set(candidate.key, []);
    byMoment.get(candidate.key).push(candidate);
  }

  const keys = [...byMoment.keys()].sort();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  return pick(byMoment.get(pick(keys)));
}

const client = await pool.connect();

try {
  // The seven the map starts with. The road's four are reachable only behind a
  // completed link, and every moment they can hold is one of these regions' anyway —
  // see PLAYS_LIKE — so there is nothing to see there that is not here.
  const { rows: regions } = await pool.query(
    `select slug, name, travel_hours from regions
      where requires_link is null and travel_hours >= 0.5
      order by travel_hours`,
  );
  const places = regions.map((row) => ({
    slug: row.slug,
    name: row.name,
    travelHours: Number(row.travel_hours),
  }));

  if (has('list')) {
    const all = candidatesFor(places);
    const where = new Map();
    for (const candidate of all) {
      if (!where.has(candidate.key)) where.set(candidate.key, new Set());
      where.get(candidate.key).add(candidate.place.name);
    }

    for (const key of [...where.keys()].sort()) {
      const axis = MOMENTS[key].axis.padEnd(10);
      console.log(`  ${key.padEnd(20)} ${axis} ${[...where.get(key)].sort().join(', ')}`);
    }
    console.log(`\n  ${where.size} of ${Object.keys(MOMENTS).length} moments are reachable\n`);
    process.exit(0);
  }

  const wanted = flag('moment');
  if (wanted !== null && !(wanted in MOMENTS)) {
    console.error(`no moment called "${wanted}" — try --list`);
    process.exit(1);
  }

  const candidates = candidatesFor(places, { moment: wanted, region: flag('region') });
  if (candidates.length === 0) {
    console.error('nothing matches that — try --list');
    process.exit(1);
  }
  const chosen = draw(candidates);

  await client.query('begin');

  const now = Date.now();
  const email = flag('email') ?? `contact-${Date.now().toString(36)}@example.test`;
  const { settlementId } = await foundSettlement(client, {
    email,
    password: PASSWORD,
    settlementName: 'Ashwood',
    now,
  });
  await raiseSuccessor(client, settlementId, { now });

  // Stores enough to have sent somebody this far.
  await client.query(
    `update resources set amount = least(300, storage_cap) where settlement_id = $1`,
    [settlementId],
  );

  // Everything any option can ask for, so a priced option is affordable and its chip
  // names what it takes. `--empty-pack` is the other state worth looking at: the same
  // option, refused before the click, with the name of the thing it wants.
  if (!has('empty-pack')) {
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 2 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null
          and i.slug in ('preserved_meal', 'rad_scrubber', 'scrap_spear')
       on conflict (character_id, item_id) do update set qty = inventory_items.qty + 2`,
      [settlementId],
    );
  }

  const { expeditionId } = await dispatchExpedition(client, settlementId, chosen.place.slug, now);
  await client.query('update expeditions set seed = $2 where id = $1', [expeditionId, chosen.seed]);

  // A tenth of the way into the window, so most of it is left to read it in. Every
  // timestamp moves together or the tick advances past events still in the future —
  // the lesson `tools/wl.mjs` has learned three times and writes down.
  const into = chosen.at + (chosen.closesAt - chosen.at) * INTO_WINDOW;
  const shift = `${into} hours`;
  await client.query(
    `update settlements
        set last_tick_at = last_tick_at - $2::interval,
            next_raid_at = next_raid_at - $2::interval,
            next_caravan_at = next_caravan_at - $2::interval
      where id = $1`,
    [settlementId, shift],
  );
  await client.query(
    `update expeditions e set departed_at = e.departed_at - $2::interval,
                              returns_at = e.returns_at - $2::interval
       from characters c
      where c.id = e.character_id and c.settlement_id = $1 and e.status = 'active'`,
    [settlementId, shift],
  );

  await client.query('commit');

  const moment = MOMENTS[chosen.key];
  const minutes = Math.round((chosen.closesAt - into) * 60);

  console.log(`\n  email     ${email}`);
  console.log(`  password  ${PASSWORD}`);
  console.log(`\n  ${moment.title}  (${chosen.key}, ${moment.axis})`);
  console.log(`  ${into.toFixed(1)}h into ${chosen.place.name}, ${minutes} minutes left on it\n`);

  for (const option of moment.options) {
    const chips = optionEffects(option).map((effect) => effect.label);
    console.log(`    ${option.label.padEnd(24)} ${chips.join('  ')}`);
  }
  console.log('');
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  client.release();
  await pool.end();
}
