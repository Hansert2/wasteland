import { viewCamp } from './view-camp.js';

/**
 * Everyone who has held this camp, and what it cost them.
 *
 * The camp outliving its people is the whole premise, and this is the only page where
 * that premise is the subject rather than the mechanism. It exists because the data
 * was already there and nobody was looking at it: nothing in the game deletes a dead
 * survivor's pack or their expedition history, so what someone was carrying when they
 * starved is still sitting in `inventory_items` waiting to be read.
 *
 * **The dead do not change; everything around them does.** This page skipped the tick on
 * the grounds that a graveyard has nothing to bring up to date, which is true of the
 * graves and was quietly wrong about the page: the rail's stores climb, the hour turns,
 * and a Contact window opens and closes on a timer. Records was the one view where all
 * three were simply absent — a player who wandered in during a moment's window would find
 * it gone, having never been shown it.
 *
 * So the camp's own view is built first and this adds the graves to it. One call rather
 * than a second copy of the shell: the camp page and this one now render the same rail,
 * the same strip and the same box, and cannot drift apart because there is nothing to
 * drift from. It costs a handful of queries on a page nobody loads twice a minute, which
 * is the cheaper half of the trade.
 */
export async function viewGraveyard(client, settlementId, now = Date.now()) {
  const camp = await viewCamp(client, settlementId, now);

  const { rows: fallen } = await client.query(
    `select h.id, h.name, h.born_at, h.died_at, h.cause_of_death, h.days_survived,
            (select count(*) from expeditions e where e.character_id = h.id) as trips,
            (select r.name
               from expeditions e join regions r on r.id = e.region_id
              where e.character_id = h.id
              order by e.departed_at desc limit 1) as last_region
       from character_history h
      where h.settlement_id = $1
      order by h.died_at desc`,
    [settlementId],
  );

  // What they had on them at the end. Fetched for everyone at once rather than per
  // survivor, because a roster of thirty should not be thirty round trips.
  const { rows: carried } = await client.query(
    `select ii.character_id, i.name, ii.qty
       from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is not null and ii.qty > 0
      order by i.name`,
    [settlementId],
  );

  const packs = new Map();
  for (const item of carried) {
    const pack = packs.get(String(item.character_id)) ?? [];
    pack.push({ name: item.name, qty: item.qty });
    packs.set(String(item.character_id), pack);
  }

  const { rows: living } = await client.query(
    `select name, born_at from characters
      where settlement_id = $1 and died_at is null`,
    [settlementId],
  );

  return {
    // Everything the shell needs — name, stores, the hour, whatever is on the wire —
    // comes through unchanged, so the page below can be the same page.
    ...camp,
    holding: living[0] ? { name: living[0].name, bornAt: living[0].born_at } : null,
    fallen: fallen.map((row) => ({
      name: row.name,
      diedAt: row.died_at,
      cause: row.cause_of_death,
      daysSurvived: Number(row.days_survived),
      trips: Number(row.trips),
      lastRegion: row.last_region,
      carrying: packs.get(String(row.id)) ?? [],
    })),
  };
}
