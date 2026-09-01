import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';

/**
 * Who is at the fence, right now.
 *
 * Reworked 2026-09-01 with the user. This used to *settle* a raid — one press, one outcome,
 * done. A raid has a duration now: raiders carry things off by the hour for four hours, and
 * what the camp loses is a function of how much of that it had somebody standing for. So this
 * service does no arithmetic at all. **It moves people to the fence and back, and the tick
 * charges every hour of it.**
 *
 * The whole crew is posted rather than one name at a time, which is what makes withdrawing
 * free: the page sends the set of people who should be out there, and anyone not in it comes
 * back. Send and pull out are the same act with a different list.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement — and it
 * matters more here than anywhere: the walk is what charges the hours somebody has already
 * stood, so changing the crew before advancing would bill the new arrangement for time it was
 * not present for.
 */
export async function answerRaid(client, settlementId, who, now = Date.now()) {
  const named = [...new Set([].concat(who ?? []).filter((one) => one != null).map(String))];

  const { rows: open } = await client.query(
    `select id, closes_at from raids
      where settlement_id = $1 and resolved_at is null`,
    [settlementId],
  );
  const raid = open[0];

  /*
   * Two absences, and they read differently to a player: one has never been raided this
   * evening, the other was and left it too long. The second is the ordinary way to meet this —
   * a raid runs four hours and a page is a render of a moment ago.
   */
  if (!raid) throw new InputError('Nobody is at the fence.');
  if (raid.closes_at.getTime() <= now) {
    throw new InputError('They have already gone, and taken what they came for.');
  }

  const { rows: living } = await client.query(
    `select id, name from characters
      where settlement_id = $1 and died_at is null order by born_at, id`,
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to stand.');

  const defenders = named.map((id) => {
    const person = living.find((one) => String(one.id) === id);
    if (!person) throw new InputError('Nobody here answers to that.');
    return person;
  });

  /*
   * Away is the only occupation that stops you going out, and that is the decision rather than
   * an oversight: **building and crafting do not stop you defending.** A raid is not a job you
   * can be too busy for — you put the beam down. Somebody twenty hours down the road cannot.
   *
   * `defending` is itself an occupation now, so somebody already at the fence would be refused
   * by `mustBeFree` for standing where they are already standing. Hence the narrow test.
   */
  const busy = await occupations(client, settlementId, now);
  for (const person of defenders) {
    if (busy.get(Number(person.id))?.kind === 'away') {
      mustBeFree(busy, person, 'stand at the fence');
    }
  }

  /*
   * Out, and back. `since` is the only field this writes: the hours, the damage and what each
   * of them kept out of the raiders' hands are all the walk's to accumulate.
   *
   * Anybody sent who is already out is left exactly as they are — rewriting `since` would
   * hand them back the time they have already stood.
   */
  const wanted = defenders.map((one) => Number(one.id));

  for (const id of wanted) {
    await client.query(
      `insert into raid_stands (raid_id, character_id, since)
       values ($1, $2, $3)
       on conflict (raid_id, character_id)
         do update set since = coalesce(raid_stands.since, excluded.since)`,
      [raid.id, id, new Date(now)],
    );
  }

  await client.query(
    `update raid_stands set since = null
      where raid_id = $1 and since is not null and not (character_id = any($2::bigint[]))`,
    [raid.id, wanted],
  );

  const { rows: standing } = await client.query(
    `select c.name from raid_stands s join characters c on c.id = s.character_id
      where s.raid_id = $1 and s.since is not null order by c.born_at, c.id`,
    [raid.id],
  );

  return { standing: standing.map((row) => row.name) };
}
