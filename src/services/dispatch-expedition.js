import { newSeed } from '../game/random.js';
import { InputError } from '../errors.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Send the survivor out. The outcome is not decided here — only the seed it will
 * later be rolled from, and the hour they are due back.
 *
 * Nothing about the trip is computed at dispatch time, because the player may not
 * return to the page for days and the result has to be derived from elapsed time
 * like everything else.
 */
export async function dispatchExpedition(client, settlementId, regionSlug, now = Date.now()) {
  const { rows: characters } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  const character = characters[0];
  if (!character) throw new InputError('There is nobody here to send.');

  const { rows: active } = await client.query(
    `select id from expeditions where character_id = $1 and status = 'active'`,
    [character.id],
  );
  if (active.length > 0) throw new InputError('They are already out there.');

  const { rows: regions } = await client.query(
    'select id, name, travel_hours, requires_link from regions where slug = $1',
    [String(regionSlug ?? '')],
  );
  const region = regions[0];
  if (!region) throw new InputError('There is no such place on the map.');

  // A place the road has not reached yet is refused here and not only hidden on the
  // page, for the reason written above the pack check in answerMoment: the page is a
  // render of a moment ago, and a form is whatever was posted to it. The page leading a
  // refusal is what makes the refusal unreachable from an honest click, not what makes
  // it unnecessary.
  if (region.requires_link !== null) {
    const { rows: link } = await client.query(
      `select 1 from road_links
        where settlement_id = $1 and link_index = $2 and completed_at is not null`,
      [settlementId, Number(region.requires_link)],
    );
    if (link.length === 0) {
      throw new InputError(`There is no road to ${region.name} yet.`);
    }
  }

  const returnsAt = new Date(now + region.travel_hours * HOUR_MS);

  /*
   * The sky the trip is leaving under, frozen onto the trip — see migration 017.
   *
   * Daylight multiplies finds, and `returnExpedition` integrates it between departure and
   * return. Reading the camp's clock at resolution instead would let a player who can set
   * their own timezone send somebody out at dusk and collect at dawn, which is the same
   * shape as the sky exploit of 2026-08-27. Stored with the trip, like `departed_at` and
   * `seed`, so it replays exactly whatever the camp does afterwards.
   */
  const { rows: camp } = await client.query(
    'select clock_offset_minutes, solar_noon_minutes from settlements where id = $1',
    [settlementId],
  );

  const { rows } = await client.query(
    `insert into expeditions (character_id, region_id, departed_at, returns_at, seed,
                              clock_offset_minutes, solar_noon_minutes)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      character.id,
      region.id,
      new Date(now),
      returnsAt,
      newSeed(),
      camp[0]?.clock_offset_minutes ?? 0,
      camp[0]?.solar_noon_minutes ?? 720,
    ],
  );

  return { expeditionId: rows[0].id, returnsAt, regionName: region.name };
}
