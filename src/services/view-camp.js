import { advanceSettlement } from './advance-settlement.js';
import {
  STRUCTURES,
  campStrength,
  productionRates,
  structureEffect,
  upgradeCost,
  upgradeFor,
} from '../game/structures.js';

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

  const { rows: recipes } = await client.query(
    `select rec.slug, rec.name, rec.costs, rec.inputs, rec.output_qty,
            rec.requires_workshop, rec.craft_hours, rec.description,
            i.name as output_name
       from recipes rec
       join items i on i.id = rec.output_item_id
      order by rec.requires_workshop, rec.craft_hours`,
  );

  // Re-read for the same reason the expedition is: the tick may have just lifted an
  // order off the bench, and what the page wants is whatever is on it *now*.
  const { rows: onTheBench } = await client.query(
    `select rec.name, co.completes_at
       from craft_orders co
       join recipes rec on rec.id = co.recipe_id
      where co.settlement_id = $1 and co.status = 'active'`,
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

  const { rows: upgradeRows } = await client.query(
    'select kind, upgrade, completes_at, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );
  const fitted = new Set(
    upgradeRows.filter((row) => row.installed_at !== null).map((row) => row.upgrade),
  );
  const beingFitted = upgradeRows.find((row) => row.installed_at === null) ?? null;

  const rates = productionRates(structures);

  return {
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
    strength: campStrength(structures),
    structures: structures.map((s) => {
      const branch = upgradeFor(s.kind);
      return {
        ...s,
        nextCost: upgradeCost(s.kind, s.level),
        // What it does now and what the next level buys, so the page can answer
        // "why would I upgrade this" without the player working it out themselves.
        effect: structureEffect(s.kind, s.level),
        nextEffect: structureEffect(s.kind, s.level + 1),
        summary: STRUCTURES[s.kind]?.summary ?? '',
        // The fuel branch, if this structure has one.
        upgrade: branch
          ? {
              ...branch,
              fitted: fitted.has(branch.slug),
              fittingUntil:
                beingFitted?.upgrade === branch.slug ? beingFitted.completes_at : null,
            }
          : null,
      };
    }),
    // Builds and fittings share one crew, so either one occupies the queue.
    buildInFlight: structures.some((s) => s.build_completes_at !== null) || beingFitted !== null,
    roster,
    events,
    regions,
    inventory,
    recipes,
    // What the bench can take on is gated by the workshop, so the page has to know
    // its level to explain why a recipe has no button rather than just hiding it.
    workshopLevel: Number(structures.find((s) => s.kind === 'workshop')?.level ?? 0),
    craft: onTheBench[0]
      ? { name: onTheBench[0].name, completesAt: onTheBench[0].completes_at }
      : null,
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
