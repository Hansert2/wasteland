import { STRUCTURES, upgradeCost } from '../game/structures.js';
import { InputError } from '../errors.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Start upgrading a structure. One build at a time per settlement — the Ogame queue
 * of one — which is enforced here and is also what keeps the decision interesting:
 * choosing what to build next is the game.
 *
 * The scrap is paid up front; the level arrives when the tick reaches the
 * completion hour. Assumes the caller holds a transaction and has already advanced
 * the settlement, so the scrap balance being spent is current rather than stale.
 */
export async function startBuild(client, settlementId, kind, now = Date.now()) {
  if (!STRUCTURES[String(kind ?? '')]) {
    throw new InputError('No such structure.');
  }

  // Starting work needs hands, even though finishing does not.
  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to build.');

  const { rows: structures } = await client.query(
    'select id, kind, level, build_completes_at from camp_structures where settlement_id = $1',
    [settlementId],
  );

  const inFlight = structures.find((s) => s.build_completes_at !== null);
  if (inFlight) {
    throw new InputError(`The ${inFlight.kind.replaceAll('_', ' ')} is already being worked on.`);
  }

  const target = structures.find((s) => s.kind === kind);
  if (!target) throw new InputError('No such structure.');

  const cost = upgradeCost(kind, target.level);

  // Conditional update rather than read-then-write: the row refuses to go negative
  // even if a concurrent request slipped past the settlement lock somehow.
  const { rowCount } = await client.query(
    `update resources set amount = amount - $2
      where settlement_id = $1 and kind = 'scrap' and amount >= $2`,
    [settlementId, cost.scrap],
  );
  if (rowCount === 0) {
    throw new InputError(`Not enough scrap — that needs ${cost.scrap}.`);
  }

  const completesAt = new Date(now + cost.hours * HOUR_MS);
  await client.query('update camp_structures set build_completes_at = $2 where id = $1', [
    target.id,
    completesAt,
  ]);

  return { kind, toLevel: target.level + 1, completesAt, cost };
}
