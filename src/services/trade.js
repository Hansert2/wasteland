import {
  FACTIONS,
  TRADE_STANDING_GAIN,
  caravanVisit,
  postKeeper,
  priceAt,
  rivalOf,
} from '../game/factions.js';
import { grantItems, storeItems } from '../db/world.js';
import { InputError } from '../errors.js';
import { TRADE_POST_LINKS } from '../game/road.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Buy from the caravan at the gate.
 *
 * A trade is instantaneous — no queue, no order row, no lifecycle. It happens while
 * the buyer is standing there, pays out of stores on the spot, and the standing
 * shift is the only record it leaves. Commerce is trust: each purchase warms the
 * seller and cools their rival, half as much — deliberately not zero-sum, so a camp
 * that trades with both crews drifts warmer with the world overall.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement,
 * so "is a caravan here right now" is asked of a clock that is current.
 */
export async function tradeWithCaravan(client, settlementId, { faction, offer }, now = Date.now()) {
  const spec = FACTIONS[String(faction ?? '')];
  if (!spec) throw new InputError('Nobody trades under that name.');

  // Trading needs living hands: somebody has to carry it in from the gate.
  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  const character = living[0];
  if (!character) throw new InputError('There is nobody here to meet them.');

  // Is that crew's caravan actually at the gate? The window derives from the same
  // seed and count the tick uses, so the page and this check can never disagree.
  const { rows: settlements } = await client.query(
    'select caravan_seed, caravan_count, next_caravan_at from settlements where id = $1',
    [settlementId],
  );
  const row = settlements[0];
  const visit = caravanVisit(Number(row.caravan_seed), row.caravan_count);
  const arrival = row.next_caravan_at?.getTime();
  const open =
    arrival != null && arrival <= now && now < arrival + visit.stayHours * HOUR_MS;

  // Two ways the door can be open. A caravan is a window — it arrives, it stays a few
  // hours, it goes — and a trade post is the road's answer to that: reconnecting to
  // somewhere means somebody is always there. The post is not a better caravan, it is a
  // different good, which is the whole reason the road buys reliability rather than
  // discounts.
  const { rows: posts } = await client.query(
    `select r.link_index from road_links r
      where r.settlement_id = $1 and r.completed_at is not null and r.link_index = any($2)`,
    [settlementId, TRADE_POST_LINKS],
  );

  const { rows: allStandings } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1',
    [settlementId],
  );
  const held = Object.fromEntries(allStandings.map((row) => [row.faction, Number(row.standing)]));
  const keeper = posts.length > 0 ? postKeeper(held) : null;

  if (!open && keeper === null) throw new InputError('There is no caravan at the gate.');

  if (open && visit.faction !== faction) {
    // A caravan at the gate is still *that* crew's caravan. The post is the fallback,
    // not an override, so trading with the crew who is not standing there goes through
    // the post if there is one and is refused as it always was if there is not.
    if (keeper !== faction) {
      throw new InputError(`It is ${FACTIONS[visit.faction].name} at the gate, not them.`);
    }
  }

  if (!open && keeper !== faction) {
    throw new InputError(`The post on the road is ${FACTIONS[keeper].name}, not them.`);
  }

  const goods = spec.offers[Number(offer)];
  if (!goods) throw new InputError('They are not selling that.');

  const { rows: standings } = await client.query(
    'select standing from faction_standing where settlement_id = $1 and faction = $2',
    [settlementId, faction],
  );
  const standing = Number(standings[0]?.standing ?? 0);
  const costs = priceAt(goods, standing);

  await payCosts(client, settlementId, costs);
  await grant(client, settlementId, character.id, goods);
  await shiftStanding(client, settlementId, faction);

  return {
    factionName: spec.name,
    bought: goods.item ?? goods.resource,
    qty: goods.qty,
    paid: costs,
  };
}

/** Same shape as the workshop's: check everything, then spend, so the message names
 * the first thing actually short and a refusal never half-pays. */
async function payCosts(client, settlementId, costs) {
  const { rows } = await client.query(
    'select kind, amount from resources where settlement_id = $1',
    [settlementId],
  );
  const held = new Map(rows.map((row) => [row.kind, Number(row.amount)]));

  for (const [kind, amount] of Object.entries(costs)) {
    if (!held.has(kind)) throw new Error(`offer priced in an unknown resource: ${kind}`);
    if (held.get(kind) < amount) {
      throw new InputError(`Not enough ${kind} — they want ${amount}.`);
    }
  }

  for (const [kind, amount] of Object.entries(costs)) {
    const { rowCount } = await client.query(
      `update resources set amount = amount - $3
        where settlement_id = $1 and kind = $2 and amount >= $3`,
      [settlementId, kind, amount],
    );
    if (rowCount === 0) throw new InputError(`Not enough ${kind} — they want ${amount}.`);
  }
}

async function grant(client, settlementId, characterId, goods) {
  if (goods.item) {
    /*
     * Phase 13: a caravan trades at the gate, so whatever will not fit in the pack goes in
     * the box rather than being lost. The camp is standing right there, and a purchase that
     * silently evaporated because somebody was carrying a plate vest would be a worse
     * surprise than the cap itself.
     */
    const overflow = await grantItems(client, characterId, [
      { slug: goods.item, qty: goods.qty },
    ]);
    if (overflow.length > 0) await storeItems(client, settlementId, overflow);
    return;
  }

  // Bulk resources go straight to the stores, clamped at the cap like everything
  // else: buy sixty food into a full larder and the surplus is the caravan's tip.
  await client.query(
    `update resources set amount = least(amount + $3, storage_cap)
      where settlement_id = $1 and kind = $2`,
    [settlementId, goods.resource, goods.qty],
  );
}

async function shiftStanding(client, settlementId, faction) {
  await client.query(
    `insert into faction_standing (settlement_id, faction, standing)
     values ($1, $2, least(100, $3))
     on conflict (settlement_id, faction)
       do update set standing = least(100, faction_standing.standing + $3)`,
    [settlementId, faction, TRADE_STANDING_GAIN],
  );

  const rival = rivalOf(faction);
  if (rival) {
    await client.query(
      `insert into faction_standing (settlement_id, faction, standing)
       values ($1, $2, greatest(-100, $3))
       on conflict (settlement_id, faction)
         do update set standing = greatest(-100, faction_standing.standing + $3)`,
      [settlementId, rival, -TRADE_STANDING_GAIN / 2],
    );
  }
}
