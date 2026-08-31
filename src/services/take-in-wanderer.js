import { InputError } from '../errors.js';
import { fittingsAllowed, bedsToRoster } from '../game/structures.js';
import { wandererFor } from '../game/wanderers.js';
import { insertSurvivor } from './settlement-lifecycle.js';

/**
 * Somebody walks up to a camp that already has people in it, and stays.
 *
 * ### Why this is not `raiseSuccessor`
 *
 * That one refuses outright when anybody is living, and its whole body is inheritance: the
 * structures come down by `SUCCESSOR_STRUCTURE_LOSS`, the stores are salvaged at a fraction,
 * standings halve toward neutral, and `last_tick_at` is reset so the incoming survivor is
 * not retroactively starved across however long the camp stood empty.
 *
 * **Every one of those is about a camp that stood empty, and none of them is true here.**
 * The camp is running, somebody is already holding it, and nothing has gone to ruin waiting.
 * A joiner inherits nothing because there is nothing to inherit — they are a second pair of
 * hands, not a successor. Reusing the succession path would have halved a working camp's
 * standings for the crime of growing.
 *
 * ### What decides whether anyone is there to take in
 *
 * A bed. `fittingsAllowed` is the ceiling the shelter's level sets and `bedsToRoster` turns
 * beds into people — the first survivor needs no bed, so a camp with one bed holds two. The
 * check is here as well as on the page for the usual reason: the page is a render of a
 * moment ago, and a bed can be the camp's last one in two tabs at once.
 */
export async function takeInWanderer(client, settlementId, { now = Date.now() } = {}) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );

  /*
   * An empty camp is succession, not joining, and it goes through the other door — which
   * halves what is left, because a camp nobody held has been standing open.
   */
  if (living.length === 0) {
    throw new InputError('Nobody is holding this camp. Somebody has to take it on first.');
  }

  const { rows: structures } = await client.query(
    "select level from camp_structures where settlement_id = $1 and kind = 'shelter'",
    [settlementId],
  );
  const { rows: beds } = await client.query(
    `select count(*)::int as n from structure_upgrades
      where settlement_id = $1 and upgrade = 'bed' and installed_at is not null`,
    [settlementId],
  );

  // Beds standing, but never more than the shelter can hold — a shelter knocked down by a
  // succession can leave a bed in a room that is no longer there.
  const standing = Math.min(beds[0].n, fittingsAllowed('bed', Number(structures[0]?.level ?? 0)));
  const room = bedsToRoster(standing) - living.length;

  if (room <= 0) {
    throw new InputError(
      standing === 0
        ? 'There is nowhere for them to sleep. A bed goes in the shelter.'
        : 'Every bed in this camp is taken.',
    );
  }

  /*
   * Who walks up, on the same rule succession uses: the camp's own seed and the number of
   * people who have ever held it, so a camp meets a different person every time and cannot
   * reload for a better one. The count includes the dead and now includes the living, which
   * is what stops the second and third arrivals being the same face.
   */
  const { rows: [camp] } = await client.query(
    'select caravan_seed from settlements where id = $1',
    [settlementId],
  );
  const { rows: [held] } = await client.query(
    'select count(*)::int as n from characters where settlement_id = $1',
    [settlementId],
  );

  const wanderer = wandererFor(camp.caravan_seed, held.n);
  const characterId = await insertSurvivor(client, settlementId, wanderer, now);

  return { characterId, wanderer };
}
