import { InputError } from '../errors.js';
import { solarNoonFor, offsetForZone, ZONE_LONGITUDE } from '../game/zones.js';

/**
 * Move the camp's clock, and the sun with it.
 *
 * Both numbers or neither. Migration `015` gave the camp an hour and `016` gave it a sun,
 * and the whole lesson of the two was that moving one without the other carries the sun
 * along with the clock face and leaves it in the wrong place against the sky. So this takes
 * a zone — a place — and derives both, rather than taking either number directly.
 *
 * **Once, and only for a camp that was never placed.** Founding already does this: the
 * browser's zone is read at registration and both numbers derived, with nobody asked
 * anything. So this exists for the camps that hole was dug under — those founded before the
 * derivation, and those whose zone was not in the curated table. Both stand on Greenwich and
 * the idealised sky with no way to say otherwise, and both need saying once.
 *
 * That makes the control self-liquidating: it leaves the game as the last unplaced camp is
 * placed, rather than sitting on the strip offering to re-answer a settled question.
 *
 * Nothing here guards the simulation. A trip freezes the sky it left under onto its own row
 * at dispatch (migration `017`), so a clock moved mid-trip cannot reach a survivor already
 * out — which is what closes the exploit. A limit on how often the clock may move would only
 * ever have rationed it.
 */

/**
 * The zones a camp may choose, sorted by their sun rather than their name.
 *
 * Alphabetical would put Anchorage next to Amsterdam. Sorting by longitude walks the list
 * from west to east, which is the order the places actually stand in and puts anywhere a
 * player might mistake for their own right beside it.
 */
export function choosableZones() {
  return Object.keys(ZONE_LONGITUDE)
    .sort((a, b) => ZONE_LONGITUDE[a] - ZONE_LONGITUDE[b])
    .map((zone) => ({
      zone,
      // `Europe/Amsterdam` -> `Europe / Amsterdam`, which is what a person reads.
      label: zone.replace(/_/g, ' ').replace(/\//g, ' / '),
    }));
}

/**
 * Whether this camp has ever been placed — founded with a zone the table knew, or placed by
 * hand since. An unplaced camp is the only one the page offers the control to.
 */
export function isPlaced(changedAt) {
  return changedAt !== null && changedAt !== undefined;
}

/**
 * Set the camp's timezone from a zone name, deriving both the clock and the sun.
 *
 * @param {import('pg').PoolClient} client
 * @param {number} settlementId
 * @param {{ zone: string, now?: number }} input
 */
export async function setCampClock(client, settlementId, { zone, now = Date.now() }) {
  const name = String(zone ?? '').trim();

  /*
   * A place, and nothing else. The offset is derived here rather than sent alongside,
   * because Node ships the tz database and the two are not independent facts: a camp
   * claiming Amsterdam on a Denver clock is not a camp anywhere. Taking both from the form
   * would have let them disagree, and the disagreement would have been the player's to
   * choose.
   */
  const offset = offsetForZone(name, now);
  const noon = offset === null ? null : solarNoonFor(name, offset);
  if (offset === null || noon === null) {
    throw new InputError('That is not a place this camp knows how to find the sun from.');
  }

  const { rows } = await client.query(
    'select clock_changed_at from settlements where id = $1',
    [settlementId],
  );
  if (rows.length === 0) throw new InputError('No such camp.');

  if (isPlaced(rows[0].clock_changed_at)) {
    throw new InputError('This camp already knows where it stands.');
  }

  await client.query(
    `update settlements
        set clock_offset_minutes = $2,
            solar_noon_minutes = $3,
            clock_changed_at = to_timestamp($4 / 1000.0)
      where id = $1`,
    [settlementId, offset, noon, now],
  );

  return { zone: name, offsetMinutes: offset, solarNoonMinutes: noon };
}
