import { newSeed } from '../game/random.js';
import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Send the survivor out. The outcome is not decided here — only the seed it will
 * later be rolled from, and the hour they are due back.
 *
 * Nothing about the trip is computed at dispatch time, because the player may not
 * return to the page for days and the result has to be derived from elapsed time
 * like everything else.
 */
/**
 * @param {string|number} [who] which survivor goes. Omitted means the first who is free,
 *   which is what every caller written before the roster meant by "the survivor".
 */
export async function dispatchExpedition(
  client,
  settlementId,
  regionSlug,
  now = Date.now(),
  who = null,
) {
  const { rows: characters } = await client.query(
    'select id, name from characters where settlement_id = $1 and died_at is null order by born_at, id',
    [settlementId],
  );
  if (characters.length === 0) throw new InputError('There is nobody here to send.');

  /*
   * Who goes, and whether they can.
   *
   * A survivor who is building cannot leave, and two who are both free can both go — so
   * being busy is a fact about the person rather than about the camp. This refused a second
   * trip by asking whether *this* character was already out, which was the same question
   * while a camp held one person and is the wrong one now: it would have let somebody walk
   * out of a half-built shelter.
   *
   * Named rather than picked when the caller says so. Without a name it takes the first free
   * survivor, which is what "the survivor" meant everywhere this was called from before the
   * roster existed and keeps those callers honest.
   */
  const busy = await occupations(client, settlementId, now);

  const character =
    who == null
      ? characters.find((one) => !busy.has(Number(one.id))) ?? characters[0]
      : characters.find((one) => String(one.id) === String(who));

  if (!character) throw new InputError('Nobody here answers to that.');
  mustBeFree(busy, character, 'go anywhere');

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
