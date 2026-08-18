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
export async function answerMoment(client, settlementId, { index, option }, now = Date.now()) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  // Answering needs living hands in the same sense every other verb does: there has to
  // be somebody out there to be answering for.
  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  const character = living[0];
  if (!character) throw new InputError('There is nobody out there to answer for.');

  const { rows: active } = await client.query(
    `select e.id, e.seed, e.choices, e.departed_at, e.returns_at,
            r.slug, r.travel_hours
       from expeditions e
       join regions r on r.id = e.region_id
      where e.character_id = $1 and e.status = 'active'`,
    [character.id],
  );
  const expedition = active[0];
  if (!expedition) throw new InputError('Nobody is out there.');

  const travelHours = Number(expedition.travel_hours);
  const moments = momentsFor({ slug: expedition.slug, travelHours }, Number(expedition.seed));

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
    await spendOne(client, character.id, chosen.consumes);
  }

  await client.query('update expeditions set choices = $2 where id = $1', [
    expedition.id,
    JSON.stringify([...choices, { index: moment.index, option: chosen.key }]),
  ]);

  // Turning back and pressing on are the two answers that move the return. Everything
  // else is settled at resolution and needs nothing here.
  if (chosen.key === TURN_BACK.key) {
    const home = now + walkHomeHours(elapsed, travelHours) * HOUR_MS;
    await client.query('update expeditions set returns_at = $2 where id = $1', [
      expedition.id,
      new Date(home),
    ]);
  } else if (chosen.hours) {
    await client.query(
      `update expeditions set returns_at = returns_at + ($2 || ' hours')::interval where id = $1`,
      [expedition.id, String(chosen.hours)],
    );
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

  const held = rows.find((row) => slugs.includes(row.slug));
  if (!held) throw new InputError('There is nothing like that in the pack.');

  const best = slugs.map((slug) => rows.find((row) => row.slug === slug)).find(Boolean);

  await client.query('update inventory_items set qty = qty - 1 where id = $1', [best.id]);
  await client.query('delete from inventory_items where id = $1 and qty <= 0', [best.id]);
}
