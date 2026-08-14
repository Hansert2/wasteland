/**
 * Play-test helpers against a real camp. Not part of the app.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/wl.mjs you@example.com skip 9
 *   node scripts/with-db.mjs node --env-file=.env tools/wl.mjs you@example.com grant 2
 *   node scripts/with-db.mjs node --env-file=.env tools/wl.mjs you@example.com show
 *
 * `skip <hours>` rewinds the settlement clock *and every pending event timestamp* by
 * the same amount, so the next page load ticks forward by that much for real — the
 * tick itself is untouched and does the whole job.
 *
 * That "every" is the part worth remembering. This helper has now silently done
 * nothing three separate times because a new phase added a timestamp it did not know
 * about: `structure_upgrades.completes_at`, then `settlements.next_raid_at`. Each
 * time the skip appeared to work and simply produced no events. **Anything new that
 * schedules something must be added to the query below**, or play-testing it will
 * quietly show you an empty log.
 */
import { pool } from '../src/db/pool.js';

const [email, command, ...args] = process.argv.slice(2);

if (!email || !command) {
  console.error('usage: wl.mjs <email> <skip hours | grant [workshopLevel] | show>');
  process.exit(1);
}

const { rows } = await pool.query(
  `select s.id from settlements s
     join players p on p.id = s.player_id
    where lower(p.email) = lower($1)`,
  [email],
);
if (!rows[0]) {
  console.error(`no camp for ${email}`);
  await pool.end();
  process.exit(1);
}
const id = rows[0].id;

if (command === 'skip') {
  const shift = `${Number(args[0])} hours`;
  await pool.query(
    `update settlements
        set last_tick_at = last_tick_at - $2::interval,
            next_raid_at = next_raid_at - $2::interval,
            next_caravan_at = next_caravan_at - $2::interval
      where id = $1`,
    [id, shift],
  );
  await pool.query(
    `update camp_structures set build_completes_at = build_completes_at - $2::interval
      where settlement_id = $1 and build_completes_at is not null`,
    [id, shift],
  );
  await pool.query(
    `update craft_orders set started_at = started_at - $2::interval,
                             completes_at = completes_at - $2::interval
      where settlement_id = $1 and status = 'active'`,
    [id, shift],
  );
  await pool.query(
    `update expeditions e set departed_at = e.departed_at - $2::interval,
                              returns_at = e.returns_at - $2::interval
      from characters c
     where c.id = e.character_id and c.settlement_id = $1 and e.status = 'active'`,
    [id, shift],
  );
  // Every pending timestamp has to move with the clock, or the tick advances past an
  // event that is still in the future and nothing happens.
  await pool.query(
    `update structure_upgrades set started_at = started_at - $2::interval,
                                   completes_at = completes_at - $2::interval
      where settlement_id = $1 and installed_at is null`,
    [id, shift],
  );
  console.log(`skipped ${shift} ahead`);
}

if (command === 'grant') {
  // A workshop and the stores to feed it, without waiting out two real builds.
  await pool.query(
    `update camp_structures set level = $2 where settlement_id = $1 and kind = 'workshop'`,
    [id, Number(args[0] ?? 2)],
  );
  await pool.query(
    `update resources set amount = least(300, storage_cap) where settlement_id = $1`,
    [id],
  );
  await pool.query(
    `insert into inventory_items (character_id, item_id, qty)
     select c.id, i.id, 2 from characters c, items i
      where c.settlement_id = $1 and c.died_at is null and i.slug = 'scavenged_parts'
     on conflict (character_id, item_id) do update set qty = inventory_items.qty + 2`,
    [id],
  );
  console.log('granted a workshop, stores and parts');
}

if (command === 'show') {
  const q = async (label, sql) => {
    const { rows } = await pool.query(sql, [id]);
    console.log(label, JSON.stringify(rows));
  };
  await q('stores  ', `select kind, round(amount) as amount from resources where settlement_id = $1 order by kind`);
  await q('pack    ', `select i.slug, ii.qty from inventory_items ii join items i on i.id = ii.item_id
                        join characters c on c.id = ii.character_id
                       where c.settlement_id = $1 and c.died_at is null and ii.qty > 0`);
  await q('orders  ', `select rec.slug, co.status from craft_orders co
                        join recipes rec on rec.id = co.recipe_id where co.settlement_id = $1`);
}

await pool.end();
