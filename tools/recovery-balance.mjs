/**
 * What `AT_ONCE` and the half-life actually cost a camp.
 *
 * Phase 16 adds exactly two numbers to the game — 0.7 of a pack survives at once, and half
 * of what is left goes every 72 hours — and the doctrine here is that a figure is measured
 * before it is trusted. This is that measurement. Nothing about the curve is reimplemented:
 * it calls `whatIsLeft` and `searchHours`, the same functions `advance-settlement` pays out
 * from and the band prints.
 *
 * ## What is being asked
 *
 * Not "what is 70% of a pack" — the arithmetic is four lines and needs no tool. The question
 * is what the *rounding* does, because a pack is a handful of stacks of one or two and
 * `survives` rounds rather than floors. A rule that reads as a gentle taper on paper is a
 * cliff on a real pack: a stack of one is either wholly there or wholly gone, and which of
 * those it is flips at a single hour.
 *
 * Three things come out of it:
 *
 * 1. **The deadline per stack.** The hour a stack of n stops coming back at all. For n = 1
 *    that is the whole mechanic — most rows in a real pack are a stack of one.
 * 2. **What a death actually hands back**, over the stacks this database really holds rather
 *    than over the nominal share. The one figure this phase adds to camp balance is what a
 *    death inside the wire returns to the shelf, and rounding makes that kinder than 0.7.
 * 3. **The deadline against the map**, which is the part that decides whether the rule ever
 *    creates a decision. A deadline nothing can be reached inside is a rule that only ever
 *    says no; one every region beats by a week is a rule that never says anything.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/recovery-balance.mjs
 */
import { pool } from '../src/db/pool.js';
import {
  AT_ONCE,
  HALF_LIFE_HOURS,
  searchHours,
  shareLeft,
  survives,
  whatIsLeft,
} from '../src/game/recovery.js';

/** The hour a stack of `qty` stops coming back, to the quarter hour. */
function deadlineFor(qty) {
  let hour = 0;
  while (hour < 24 * 60) {
    if (survives(qty, shareLeft(hour)) === 0) return hour;
    hour += 0.25;
  }
  return Infinity;
}

const client = await pool.connect();
try {
  console.log(`AT_ONCE ${AT_ONCE}   HALF_LIFE ${HALF_LIFE_HOURS}h\n`);

  /* 1. The deadline per stack size. */
  console.log('  a stack of   comes home until   share at that hour');
  for (const qty of [1, 2, 3, 4, 5, 8, 12]) {
    const at = deadlineFor(qty);
    console.log(
      `  ${String(qty).padStart(10)}   ${`${(at / 24).toFixed(1)}d`.padStart(16)}` +
        `   ${shareLeft(at - 0.25).toFixed(3)}`,
    );
  }

  /*
   * 2. What comes back, over the stacks the game has really built.
   *
   * Quantities are read from the table rather than assumed: if play has produced stacks of
   * six, the rounding is being asked a different question than it is on stacks of one, and
   * that is exactly the thing a guess would get wrong.
   *
   * One table rather than one per pack size, because the share is applied stack by stack — a
   * pack of eight keeps the same fraction as a pack of one, and the fraction is what a camp
   * reads.
   */
  const { rows: held } = await client.query(
    `select qty, count(*)::int as n from inventory_items group by qty order by qty`,
  );
  const bag = held.flatMap((row) => Array(row.n).fill(Number(row.qty)));
  const pack = (bag.length > 0 ? bag : [1]).map((qty, i) => ({ item_id: i, qty }));
  const had = pack.reduce((sum, one) => sum + one.qty, 0);
  console.log(
    `\n  ${pack.length} stacks in play, quantities ${held.map((r) => `${r.qty}x${r.n}`).join(' ')}`,
  );

  console.log('\n  hours out   nominal   items kept   stacks kept   what rounding adds');
  for (const hours of [0, 12, 24, 35, 48, 72, 120, 168]) {
    const left = whatIsLeft(pack, hours);
    const kept = left.reduce((sum, one) => sum + one.qty, 0);
    const nominal = shareLeft(hours);
    const gap = (kept / had - nominal) * 100;
    console.log(
      `  ${`${hours}h`.padStart(9)}   ${`${(nominal * 100).toFixed(0)}%`.padStart(7)}` +
        `   ${`${((kept / had) * 100).toFixed(0)}%`.padStart(10)}` +
        `   ${`${left.length}/${pack.length}`.padStart(11)}` +
        `   ${`${gap >= 0 ? '+' : ''}${gap.toFixed(0)} points`.padStart(18)}`,
    );
  }

  /*
   * 3. And against the map, which is what decides whether any of it is a decision.
   *
   * `travel_hours` is the whole trip, out and back — a plain walk's `returns_at` is
   * `now + travel_hours` — so an errand is that plus the search and nothing doubled. The
   * share is read when the trip gets home, which is the pessimistic reading and the one the
   * settlement actually uses.
   */
  const { rows: regions } = await client.query(
    'select name, travel_hours from regions order by travel_hours',
  );
  const lone = deadlineFor(1);
  console.log(
    `\n  a stack of one is gone after ${(lone / 24).toFixed(1)}d, and the share is read when` +
      ` the errand gets home.\n  Turning straight round from a death at hour zero:`,
  );
  for (const region of regions) {
    const walk = Number(region.travel_hours);
    const cost = walk + searchHours(walk);
    console.log(
      `  ${region.name.padEnd(24)} ${`${walk}h trip`.padStart(10)}  errand ${`${cost.toFixed(1)}h`.padStart(7)}` +
        `  ${
          cost < lone
            ? `${(lone - cost).toFixed(1)}h of dithering before a lone item is lost`
            : 'TOO LATE, even leaving at once'
        }`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
