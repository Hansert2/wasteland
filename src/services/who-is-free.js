import { InputError } from '../errors.js';
import { UPGRADES } from '../game/structures.js';

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
  sleeping: 'asleep',
};

/**
 * A map of character id to what they are doing, holding only the busy.
 *
 * The value carries the job as well as the kind. A page that can only say "fitting" makes
 * the player open the structures block to find out fitting *what*, and the answer is one
 * column away in the row this already reads — so it is read here rather than looked up
 * again by whoever renders it.
 *
 * `what` is a display string, and null for a job with nothing to name.
 *
 * @returns {Promise<Map<number, { kind: keyof OCCUPATIONS, what: string|null }>>}
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
  // Where they went is on the survivor's own block already, printed with the countdown, so
  // this does not join the regions table to say it a second time.
  for (const row of away) busy.set(Number(row.character_id), { kind: 'away', what: null });

  /*
   * Asleep, which is the one occupation that is not a job.
   *
   * It belongs here all the same, because what this map answers is "can this person be asked
   * to do something else" and the answer is no for exactly the same reason — Phase 10's
   * fifth decision is that sleep trades availability for speed, and the trade is only real
   * if the refusals are. There is no waking them: the countdown is the commitment.
   *
   * `sleep_until` in the future and nothing else. Nothing clears the column when a sleep
   * ends, so the comparison against the clock *is* the state — see migration `020`.
   */
  const { rows: sleeping } = await client.query(
    `select id from characters
      where settlement_id = $1 and died_at is null and sleep_until > $2`,
    [settlementId, at],
  );
  // What there is to name is the hour they wake, and that is a countdown rather than a
  // string — the survivor's own block prints it from `sleepUntil`. This says only who.
  for (const row of sleeping) busy.set(Number(row.id), { kind: 'sleeping', what: null });

  /*
   * A job counts as occupying only while it is unfinished. The tick is what marks a build
   * done, and it runs before any of these callers — but a page loaded at the exact instant
   * one completes should not hold its builder for another slice, so the comparison is
   * against the clock rather than against the row's presence.
   */
  const { rows: building } = await client.query(
    `select built_by, kind from camp_structures
      where settlement_id = $1 and built_by is not null and build_completes_at > $2`,
    [settlementId, at],
  );
  for (const row of building) {
    // The column, as the page spells it: a structure has no display name of its own, and
    // every other place that prints one turns the underscores into spaces.
    busy.set(Number(row.built_by), { kind: 'building', what: String(row.kind).replace(/_/g, ' ') });
  }

  const { rows: fitting } = await client.query(
    `select fitted_by, upgrade from structure_upgrades
      where settlement_id = $1 and fitted_by is not null
        and installed_at is null and completes_at > $2`,
    [settlementId, at],
  );
  for (const row of fitting) {
    // Lowercased, because a fitting's name is title case for a label strip — "A Bed", "The
    // Clock" — and this lands mid-sentence under somebody's name.
    const named = UPGRADES[row.upgrade]?.name ?? row.upgrade;
    busy.set(Number(row.fitted_by), { kind: 'fitting', what: String(named).toLowerCase() });
  }

  const { rows: crafting } = await client.query(
    `select co.crafted_by, rec.name from craft_orders co
       join recipes rec on rec.id = co.recipe_id
      where co.settlement_id = $1 and co.crafted_by is not null
        and co.status = 'active' and co.completes_at > $2`,
    [settlementId, at],
  );
  for (const row of crafting) {
    busy.set(Number(row.crafted_by), { kind: 'crafting', what: String(row.name).toLowerCase() });
  }

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
  throw new InputError(`${who} is ${OCCUPATIONS[doing.kind]} and cannot ${verb}.`);
}
