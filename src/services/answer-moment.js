import { TURN_BACK, isOpen, momentsFor, walkHomeHours } from '../game/moments.js';
import { InputError } from '../errors.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Answer a moment while the survivor is still out there.
 *
 * The whole verb, and deliberately a small one: it records what the player said and
 * adjusts when they get home. **It decides nothing about the outcome** — that is still
 * rolled from the seed at `returns_at`, with the recorded answers as an input, which is
 * what keeps a retried request from re-rolling the trip.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement, so
 * "is this window open right now" is asked of a clock that is current — the same
 * arrangement `tradeWithCaravan` relies on for "is a caravan at the gate".
 */
/**
 * A trip as its moments see it: how long it ran, and how long the place is.
 *
 * The two used to be one number. A shortcut takes a fifth off the walk to a place for a camp
 * that has reached the link, so the region says eighteen hours while the trip ran fourteen —
 * and the windows have to be placed across the hours that actually passed, or a moment opens
 * after the survivor is already home. The count comes from the region, because how much there
 * is to meet somewhere is a fact about the somewhere.
 */
const spanOf = (trip) => ({
  slug: trip.slug,
  travelHours: (trip.returns_at.getTime() - trip.departed_at.getTime()) / 3_600_000,
  baseTravelHours: Number(trip.travel_hours),
});

export async function answerMoment(client, settlementId, { index, option }, now = Date.now()) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  /*
   * Whose trip this is, which the moment itself decides.
   *
   * This took the first living character and answered *their* trip: `living[0]`, from a
   * query with no ORDER BY, so on a camp of one it was the survivor and on a camp of more
   * it was whoever the heap handed back first. With two people in the field it answered the
   * wrong person's window, or — when that person was standing in the camp — refused with
   * "Nobody is out there" while somebody genuinely was.
   *
   * It is the same fault as the singular `state.expedition` in the tick and the singular
   * `rows[0]` the soak's own reader had: a phrase that meant one thing while a camp held one
   * person and quietly meant something else afterwards. Measured 2026-08-31: ninety days of
   * play with a roster of ten answered **zero** moments out of 479 trips, because the first
   * living character was rarely the one with a window open.
   *
   * A moment index belongs to a trip — `momentsFor` derives it from that trip's region and
   * seed — so the trip is found by asking which active one actually has this index, rather
   * than by picking a survivor and hoping. Ordered by departure so that a camp where two
   * trips somehow offer the same index answers the older one, which is the one whose window
   * closes first.
   */
  const { rows: active } = await client.query(
    `select e.id, e.seed, e.choices, e.departed_at, e.returns_at, e.character_id,
            r.slug, r.travel_hours
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'
      order by e.departed_at, e.id`,
    [settlementId],
  );
  /*
   * Two different absences, and they had two different sentences before this query joined
   * them together. Worth keeping apart: one is "you have not sent anybody" and the other is
   * "the person you sent is dead", and a player meeting the second has lost somebody.
   */
  if (active.length === 0) {
    const { rows: orphaned } = await client.query(
      `select 1 from expeditions e
         join characters c on c.id = e.character_id
        where c.settlement_id = $1 and e.status = 'active' and c.died_at is not null
        limit 1`,
      [settlementId],
    );
    throw new InputError(
      orphaned.length > 0
        ? 'There is nobody out there to answer for.'
        : 'Nobody is out there.',
    );
  }

  const wanted = Number(index);
  const expedition =
    active.find((trip) => {
      const answered = new Set((trip.choices ?? []).map((choice) => Number(choice.index)));
      if (answered.has(wanted)) return false;
      return momentsFor(spanOf(trip), Number(trip.seed)).some((moment) => moment.index === wanted);
    }) ?? active[0];

  const travelHours = spanOf(expedition).travelHours;
  const moments = momentsFor(spanOf(expedition), Number(expedition.seed));

  const moment = moments[Number(index)];
  if (!moment) throw new InputError('Nothing happened out there.');

  // How far into the trip they are. Measured from departure rather than counted back
  // from the return, because pressing on moves the return and must not move the hours
  // that have already happened.
  const elapsed = (now - expedition.departed_at.getTime()) / HOUR_MS;
  if (!isOpen(moment, elapsed)) {
    // Both directions are possible from a stale page, and they are not the same news:
    // one is a window that closed while it was being read, which is the ordinary case,
    // and the other is an answer to something that has not happened yet.
    throw new InputError(
      elapsed < moment.atHour ? 'That has not happened yet.' : 'That moment has passed.',
    );
  }

  const choices = expedition.choices ?? [];
  if (choices.some((choice) => Number(choice.index) === moment.index)) {
    throw new InputError('That has already been settled.');
  }

  const chosen = moment.options.find((candidate) => candidate.key === String(option ?? ''));
  if (!chosen) throw new InputError('That is not one of the options.');

  // Spending something means having it. Checked here rather than only being hidden on
  // the page, because the page is a render of a moment ago.
  if (chosen.consumes) {
    // From the pack of whoever is actually out there. It read the first living character's,
    // which on a roster is a survivor standing in the camp being charged for a tablet
    // somebody else swallowed a day's walk away.
    await spendOne(client, expedition.character_id, chosen.consumes);
  }

  // The moment's own name travels with the answer, not just its position. Content is
  // not frozen the way `mix` is — moments get written, retuned and reordered — and a
  // trip already in flight recomputes its schedule from the seed on every read. Without
  // the name, an answer recorded against index 2 lands on whatever now occupies index 2,
  // and `turn_back` is a key on every moment, so it would still match: the trip would
  // bank at the wrong hour and nothing would flag it.
  await client.query('update expeditions set choices = $2 where id = $1', [
    expedition.id,
    JSON.stringify([...choices, { index: moment.index, key: moment.key, option: chosen.key }]),
  ]);

  // Turning back and pressing on are the two answers that move the return. Everything
  // else is settled at resolution and needs nothing here.
  //
  // **Nothing can get them home sooner than the walk home.** A shortcut with negative
  // hours would otherwise be able to set the return before the answer, or before the
  // departure — cutting across a field saves ninety minutes off a forty-five minute
  // trip, which is not a faster trip, it is a trip that ends before it started. The
  // floor is the same one turning back uses, for the same reason: however clever the
  // route, they still have to walk back.
  const earliest = now + walkHomeHours(elapsed, travelHours) * HOUR_MS;

  if (chosen.key === TURN_BACK.key) {
    await client.query('update expeditions set returns_at = $2 where id = $1', [
      expedition.id,
      new Date(earliest),
    ]);
  } else if (chosen.hours) {
    const moved = expedition.returns_at.getTime() + Number(chosen.hours) * HOUR_MS;
    await client.query('update expeditions set returns_at = $2 where id = $1', [
      expedition.id,
      new Date(Math.max(moved, earliest)),
    ]);
  }

  return { index: moment.index, option: chosen.key };
}

/**
 * Take one of whichever of these they actually have, best first.
 *
 * The order in `consumes` is the preference order — a crafted scrubber before a found
 * tablet — which matches the tick's existing habit of reaching for the better thing
 * without asking.
 */
async function spendOne(client, characterId, slugs) {
  const { rows } = await client.query(
    `select ii.id, i.slug
       from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = $1 and ii.qty > 0 and i.slug = any($2)`,
    [characterId, slugs],
  );

  // Walked in preference order rather than in whatever order the rows arrived, so a
  // crafted scrubber goes before a found tablet.
  const best = slugs.map((slug) => rows.find((row) => row.slug === slug)).find(Boolean);
  if (!best) throw new InputError('There is nothing like that in the pack.');

  await client.query('update inventory_items set qty = qty - 1 where id = $1', [best.id]);
  await client.query('delete from inventory_items where id = $1 and qty <= 0', [best.id]);
}
