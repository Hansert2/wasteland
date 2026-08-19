import { LINKS, linkCost } from '../game/road.js';
import { InputError } from '../errors.js';

/**
 * Pour fuel into the next link of the road.
 *
 * The one verb Phase 8 adds, and deliberately the only one. The road is a place fuel
 * goes, not a new thing to do every visit — if it became the most interesting button on
 * the page it would have made the check-in thinner while claiming to give it a
 * destination, which is the failure this phase is most likely to have.
 *
 * Fuel committed here does not come back out. That is what makes it a decision: fuel
 * has two sinks now, and choosing the road over filtration is a real choice about what
 * kind of camp this is. It is also the only shape that works at all — storage caps in
 * the hundreds and the seventh link costs 797, so "unlocks when you can afford it"
 * could never be satisfied past the fourth.
 *
 * Unlike a build or a fitting this needs no hands. Nobody is doing the work: the camp
 * is putting fuel aside, and a survivor nine hours into the Bunkers does not stop it.
 * The only living-hands check in the game that would apply here is the one that turned
 * out to mean *alive, not home* — see the Phase 6 reachability note in docs/PLAN.md —
 * and applying it to a savings account would be the same mistake on purpose.
 */
export async function commitToRoad(client, settlementId, amount, now = Date.now()) {
  const fuel = Number(amount);
  if (!Number.isFinite(fuel) || fuel <= 0) {
    throw new InputError('Say how much fuel to send up the road.');
  }

  const { rows: links } = await client.query(
    `select link_index, fuel, completed_at from road_links
      where settlement_id = $1 order by link_index`,
    [settlementId],
  );

  const open = links.find((row) => row.completed_at === null);
  const done = links.filter((row) => row.completed_at !== null).length;

  // The next link is whichever one is already being paid for, or the one after the
  // last finished. A link cannot be started before the one ahead of it is done, which
  // is what "a road" means rather than a shopping list.
  const index = open ? Number(open.link_index) : done + 1;
  const cost = linkCost(index);

  if (cost === null) {
    throw new InputError(`The road is finished. There is nothing past ${LINKS} links.`);
  }

  const already = Number(open?.fuel ?? 0);
  const wanted = Math.min(fuel, cost - already);

  // Rounding a spend down to zero would take fuel and give nothing, so it is refused
  // rather than silently swallowed.
  if (wanted <= 0) throw new InputError('That link is already paid for.');

  // Conditional update rather than read-then-write, the same guard `startUpgrade` uses:
  // the row refuses to go negative even if a concurrent request slipped past the lock.
  const { rowCount } = await client.query(
    `update resources set amount = amount - $2
      where settlement_id = $1 and kind = 'fuel' and amount >= $2`,
    [settlementId, wanted],
  );
  if (rowCount === 0) {
    throw new InputError(`Not enough fuel — that needs ${wanted}, and only trips bring it in.`);
  }

  const total = already + wanted;
  const completedAt = total >= cost ? new Date(now) : null;

  await client.query(
    `insert into road_links (settlement_id, link_index, fuel, completed_at)
     values ($1, $2, $3, $4)
     on conflict (settlement_id, link_index)
     do update set fuel = road_links.fuel + $3, completed_at = $4`,
    [settlementId, index, wanted, completedAt],
  );

  return {
    index,
    committed: wanted,
    // What is in the link now, and what it still wants. The page needs both, and
    // computing them here means the caller never has to know the cost curve.
    fuel: total,
    cost,
    completed: completedAt !== null,
  };
}
