import { advanceSettlement } from './advance-settlement.js';
import { campStrength, productionRates, upgradeCost } from '../game/structures.js';

/**
 * Everything a camp page needs, as one transaction.
 *
 * The tick runs first: nothing is rendered from state that has not been brought up
 * to the current instant, so the page can never show stale resources or a survivor
 * who is, as of now, already dead.
 */
export async function viewCamp(client, settlementId, now = Date.now()) {
  const { state, events } = await advanceSettlement(client, settlementId, now);

  const { rows: settlements } = await client.query(
    'select name, founded_at from settlements where id = $1',
    [settlementId],
  );

  const { rows: structures } = await client.query(
    'select kind, level, build_completes_at from camp_structures where settlement_id = $1 order by kind',
    [settlementId],
  );

  const { rows: survivorRow } = await client.query(
    'select name from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );

  const { rows: roster } = await client.query(
    `select name, cause_of_death, days_survived
       from character_history
      where settlement_id = $1
      order by died_at desc`,
    [settlementId],
  );

  const { rows: regions } = await client.query(
    'select slug, name, danger, travel_hours, description from regions order by danger, travel_hours',
  );

  // Re-read rather than using the post-tick state: the tick may have just resolved
  // an expedition, and what the page wants is whatever is in flight *now*.
  const { rows: away } = await client.query(
    `select r.name, e.returns_at
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'`,
    [settlementId],
  );

  const { rows: inventory } = await client.query(
    `select i.name, i.kind, ii.qty
       from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is null and ii.qty > 0
      order by i.name`,
    [settlementId],
  );

  const rates = productionRates(structures);

  return {
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
    strength: campStrength(structures),
    structures: structures.map((s) => ({
      ...s,
      nextCost: upgradeCost(s.kind, s.level),
    })),
    buildInFlight: structures.some((s) => s.build_completes_at !== null),
    roster,
    events,
    regions,
    inventory,
    expedition: away[0] ? { regionName: away[0].name, returnsAt: away[0].returns_at } : null,
    survivor: state.survivor ? { ...state.survivor, name: survivorRow[0]?.name } : null,
    resources: Object.entries(state.settlement.resources).map(([kind, r]) => ({
      kind,
      amount: r.amount,
      cap: r.cap,
      ratePerHour: rates[kind] ?? 0,
    })),
  };
}
