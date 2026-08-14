/**
 * Everyone who has held this camp, and what it cost them.
 *
 * The camp outliving its people is the whole premise, and this is the only page where
 * that premise is the subject rather than the mechanism. It exists because the data
 * was already there and nobody was looking at it: nothing in the game deletes a dead
 * survivor's pack or their expedition history, so what someone was carrying when they
 * starved is still sitting in `inventory_items` waiting to be read.
 *
 * No tick here. The dead do not change, so there is nothing to advance — this is the
 * one page that can be rendered from a plain read.
 */
export async function viewGraveyard(client, settlementId) {
  const { rows: settlements } = await client.query(
    'select name, founded_at from settlements where id = $1',
    [settlementId],
  );
  if (!settlements[0]) throw new Error(`no settlement ${settlementId}`);

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
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
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
