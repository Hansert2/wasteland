import { STRUCTURES, UPGRADES, upgradeCost } from '../game/structures.js';
import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';

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
/**
 * @param {string|number} [who] whose hands. Omitted means the first free survivor, which is
 *   what "there is somebody here" meant before there was a roster to choose from.
 */
export async function startBuild(client, settlementId, kind, now = Date.now(), who = null) {
  if (!STRUCTURES[String(kind ?? '')]) {
    throw new InputError('No such structure.');
  }

  // Starting work needs hands, even though finishing does not.
  const { rows: living } = await client.query(
    'select id, name from characters where settlement_id = $1 and died_at is null order by born_at, id',
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



  // Builds and upgrade fittings share one queue: it is one crew, and choosing what
  // they work on next is the game. `startUpgrade` refuses in the other direction.
  const { rows: fitting } = await client.query(
    `select upgrade from structure_upgrades
      where settlement_id = $1 and installed_at is null`,
    [settlementId],
  );
  if (fitting[0]) {
    const name = UPGRADES[fitting[0].upgrade]?.name ?? fitting[0].upgrade;
    throw new InputError(`The crew is fitting the ${name.toLowerCase()}.`);
  }

  /*
   * And whose hands, because a build occupies them: a survivor who is building cannot
   * dispatch. The first free one, which is what "there is somebody here" meant before the
   * roster — the page will name them once it has a chooser on the row.
   *
   * **After the camp-wide check, not before it.** A camp still runs one build at a time and
   * that rule has its own reason — choosing what to build next is the game. Asking who is
   * free first would answer a different question and replace that refusal's message with a
   * vaguer one, on a camp of one where both are true.
   */
  const busy = await occupations(client, settlementId, now);

  const builder =
    who == null
      ? living.find((one) => !busy.has(Number(one.id)))
      : living.find((one) => String(one.id) === String(who));

  if (!builder) {
    if (who != null) throw new InputError('Nobody here answers to that.');

    /*
     * Nobody free, and on a camp of one "everybody here is already busy" is a worse sentence
     * than naming them: there is one person, the player knows who, and what they want to know
     * is what that person is doing instead. `mustBeFree` says it.
     */
    if (living.length === 1) mustBeFree(busy, living[0], 'build');
    throw new InputError('Everybody here is already busy with something.');
  }
  mustBeFree(busy, builder, 'build');

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
  // And who is raising it, so they cannot walk out of a half-built shelter.
  await client.query(
    'update camp_structures set build_completes_at = $2, built_by = $3 where id = $1',
    [target.id, completesAt, builder.id],
  );

  return { kind, toLevel: target.level + 1, completesAt, cost };
}
