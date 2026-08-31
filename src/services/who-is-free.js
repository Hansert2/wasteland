import { InputError } from '../errors.js';

/**
 * What each survivor in a camp is doing, and therefore who can be asked to do something else.
 *
 * The rule, from the user on 2026-08-31: **a survivor who is building cannot dispatch, and
 * two survivors who are both free can both go.** Occupation is a fact about a person rather
 * than about a camp, which it could not have been while a camp held one survivor — "the camp
 * is building" and "the survivor is building" were the same sentence, and the schema said so
 * by having nowhere to record which.
 *
 * One place, because the alternative is four verbs each deciding what busy means and drifting
 * apart at three of them. Every one of them refuses through `mustBeFree`.
 *
 * ### An unowned job occupies nobody
 *
 * Every build, fitting and craft that was standing when migration `019` landed has a null
 * owner, because the person who started it cannot be known and may be in the graveyard.
 * Those jobs finish on their own and hold nobody back — which is what they have been doing
 * all along, and is the honest reading rather than a guess about who was carrying the beam.
 */

/** What somebody can be busy with, in the words the refusals use. */
const OCCUPATIONS = {
  away: 'out there',
  building: 'building',
  fitting: 'fitting something',
  crafting: 'at the bench',
};

/**
 * A map of character id to what they are doing, holding only the busy.
 *
 * @returns {Promise<Map<number, keyof OCCUPATIONS>>}
 */
export async function occupations(client, settlementId, now = Date.now()) {
  const busy = new Map();
  const at = new Date(now);

  const { rows: away } = await client.query(
    `select e.character_id from expeditions e
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and e.status = 'active'`,
    [settlementId],
  );
  for (const row of away) busy.set(Number(row.character_id), 'away');

  /*
   * A job counts as occupying only while it is unfinished. The tick is what marks a build
   * done, and it runs before any of these callers — but a page loaded at the exact instant
   * one completes should not hold its builder for another slice, so the comparison is
   * against the clock rather than against the row's presence.
   */
  const { rows: building } = await client.query(
    `select built_by from camp_structures
      where settlement_id = $1 and built_by is not null and build_completes_at > $2`,
    [settlementId, at],
  );
  for (const row of building) busy.set(Number(row.built_by), 'building');

  const { rows: fitting } = await client.query(
    `select fitted_by from structure_upgrades
      where settlement_id = $1 and fitted_by is not null
        and installed_at is null and completes_at > $2`,
    [settlementId, at],
  );
  for (const row of fitting) busy.set(Number(row.fitted_by), 'fitting');

  const { rows: crafting } = await client.query(
    `select crafted_by from craft_orders
      where settlement_id = $1 and crafted_by is not null
        and status = 'active' and completes_at > $2`,
    [settlementId, at],
  );
  for (const row of crafting) busy.set(Number(row.crafted_by), 'crafting');

  return busy;
}

/**
 * Refuse unless this person can take something else on.
 *
 * Named in the refusal, because "somebody is busy" on a camp of three is a message the
 * player has to go and investigate. `verb` is what they were being asked to do.
 */
export function mustBeFree(busy, character, verb) {
  const doing = busy.get(Number(character.id));
  if (!doing) return;

  const who = character.name ?? 'They';
  throw new InputError(`${who} is ${OCCUPATIONS[doing]} and cannot ${verb}.`);
}
