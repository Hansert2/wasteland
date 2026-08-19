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

  const { rows } = await client.query(
    `insert into expeditions (character_id, region_id, departed_at, returns_at, seed)
     values ($1, $2, $3, $4, $5) returning id`,
    [character.id, region.id, new Date(now), returnsAt, newSeed()],
  );

  return { expeditionId: rows[0].id, returnsAt, regionName: region.name };
}
