import { InputError } from '../errors.js';
import { CONFIG } from '../game/constants.js';
import { occupations, mustBeFree } from './who-is-free.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Put somebody under for a fixed number of hours.
 *
 * Phase 10's last piece, and the smallest service in the camp: it spends nothing, produces
 * nothing and starts no queue. All it does is write the hour they wake, after which the tick
 * pays them `staminaSleepPerHour` instead of `staminaRegenPerHour` and every other verb
 * refuses them. See `recoveryOf` for the rate and migration `020` for the column.
 *
 * **There is no waking them.** That is the mechanic rather than an omission — recovery
 * happens anyway, so the only thing sleep can charge for the speed is the availability, and
 * an availability you can take back at any moment is not a price. A player who commits
 * twelve hours has committed them.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement, so the
 * stamina being read is the current one. It matters here in the ordinary way: a survivor who
 * walked in the gate a minute ago has spent stamina the page was not drawn with.
 */
export async function startSleep(client, settlementId, who, hours, now = Date.now()) {
  /*
   * One of the three, and not a number off the wire.
   *
   * `sleepHours` is a content decision — a nap, a night, a long night — so this compares
   * against the list rather than range-checking. A free number would have to be bounded
   * anyway, and a bound is a fourth constant nothing derives.
   */
  const wanted = Number(hours);
  if (!CONFIG.sleepHours.includes(wanted)) {
    throw new InputError('Nobody sleeps for that long.');
  }

  const { rows: living } = await client.query(
    `select id, name, stamina from characters
      where settlement_id = $1 and died_at is null order by born_at, id`,
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to rest.');

  const busy = await occupations(client, settlementId, now);
  const character =
    who == null
      ? living.find((one) => !busy.has(Number(one.id)))
      : living.find((one) => String(one.id) === String(who));

  /*
   * Already under, said plainly.
   *
   * `mustBeFree` refuses this too — sleeping is an occupation like any other — but it would
   * say "Vera is asleep and cannot lie down", which reads as a rule rather than as the
   * situation. The only way to reach it is a double submit or a second tab, and both deserve
   * the sentence that describes what is actually true.
   *
   * Both paths through the refusal, because they are the same sentence twice. The page's
   * form always names whose hours these are; a caller that does not gets the first free
   * survivor and, on a camp of one, that person's own reason — and the two must not differ
   * on which words a sleeping survivor is refused with.
   */
  const refuse = (person) => {
    if (busy.get(Number(person.id))?.kind === 'sleeping') {
      throw new InputError(`${person.name} is already asleep.`);
    }
    mustBeFree(busy, person, 'lie down');
  };

  if (!character) {
    if (who != null) throw new InputError('Nobody here answers to that.');
    if (living.length === 1) refuse(living[0]);
    throw new InputError('Everybody here is already busy with something.');
  }

  refuse(character);

  /*
   * Nothing to sleep off.
   *
   * Refused rather than allowed as a no-op, because a sleep at a full gauge is pure cost:
   * the hours are committed, the rations are drawn at the recovery multiple, and not one
   * point comes back. A player who does it by accident has taken somebody off the roster
   * for half a day in exchange for nothing, and the page has no way to tell them afterwards
   * that is what happened.
   */
  if (Number(character.stamina) >= 100) {
    throw new InputError(`${character.name} is rested — there is nothing to sleep off.`);
  }

  const wakesAt = new Date(now + wanted * HOUR_MS);
  await client.query('update characters set sleep_until = $2 where id = $1', [
    character.id,
    wakesAt,
  ]);

  return { name: character.name, hours: wanted, wakesAt };
}
