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
/**
 * Beds standing, and how many more people they will hold.
 *
 * Exported because Phase 15 gave the camp a second door. Somebody met on the road arrives at
 * the gate hours after the meeting, and the question asked there has to be *the same question*
 * the gate asks — one shelter, one set of beds, one answer. Two copies of this arithmetic
 * would be two camps' worth of capacity the first time one of them was retuned.
 *
 * Never more beds than the shelter can hold: a shelter knocked down by a succession can leave
 * a bed standing in a room that is no longer there.
 */
export async function roomToSpare(client, settlementId) {
  const { rows: living } = await client.query(
    'select id, name from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  const { rows: structures } = await client.query(
    "select level from camp_structures where settlement_id = $1 and kind = 'shelter'",
    [settlementId],
  );
  const { rows: beds } = await client.query(
    `select count(*)::int as n from structure_upgrades
      where settlement_id = $1 and upgrade = 'bed' and installed_at is not null`,
    [settlementId],
  );

  const standing = Math.min(beds[0].n, fittingsAllowed('bed', Number(structures[0]?.level ?? 0)));
  return { living, standing, room: bedsToRoster(standing) - living.length };
}

/**
 * And who would walk up, on the rule succession uses.
 *
 * The camp's own seed and the number of people who have ever held it, so a camp meets a
 * different person every time and cannot reload for a better one. The count includes the dead
 * and the living, which is what stops the second and third arrivals being the same face.
 *
 * **It counts people who joined, never people who were offered** — which is the answer to the
 * question the gate rebuild left open. Declining an arrival, at the gate or on the road, moves
 * nothing: the next occasion meets the same person. Refusal is therefore not a reroll, and the
 * no-shopping rule this content is written around holds without a rule of its own.
 */
export async function whoWouldArrive(client, settlementId) {
  const { rows: [camp] } = await client.query(
    'select caravan_seed from settlements where id = $1',
    [settlementId],
  );
  const { rows: [held] } = await client.query(
    'select count(*)::int as n from characters where settlement_id = $1',
    [settlementId],
  );
  const { rows: living } = await client.query(
    'select name from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );

  // Who is already here, so nobody is offered twice — a camp holding two Veras is a bug the
  // player would read as one. The page passes the same list.
  return wandererFor(camp.caravan_seed, held.n, { taken: living.map((one) => one.name) });
}

export async function takeInWanderer(client, settlementId, { now = Date.now() } = {}) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { living, standing, room } = await roomToSpare(client, settlementId);

  /*
   * An empty camp is succession, not joining, and it goes through the other door — which
   * halves what is left, because a camp nobody held has been standing open.
   */
  if (living.length === 0) {
    throw new InputError('Nobody is holding this camp. Somebody has to take it on first.');
  }

  if (room <= 0) {
    throw new InputError(
      standing === 0
        ? 'There is nowhere for them to sleep. A bed goes in the shelter.'
        : 'Every bed in this camp is taken.',
    );
  }

  const wanderer = await whoWouldArrive(client, settlementId);
  const characterId = await insertSurvivor(client, settlementId, wanderer, now);

  return { characterId, wanderer };
}
