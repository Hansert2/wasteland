import { advanceSettlement } from './advance-settlement.js';
import { campStrength, productionRates } from '../game/structures.js';

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

  const rates = productionRates(structures);

  return {
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
    strength: campStrength(structures),
    structures,
    roster,
    events,
    survivor: state.survivor ? { ...state.survivor, name: survivorRow[0]?.name } : null,
    resources: Object.entries(state.settlement.resources).map(([kind, r]) => ({
      kind,
      amount: r.amount,
      cap: r.cap,
      ratePerHour: rates[kind] ?? 0,
    })),
  };
}
