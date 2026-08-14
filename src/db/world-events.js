import { eventForSlot, slotAt } from '../game/world-events.js';

/**
 * The world's weather, kept ahead of whoever is looking at it.
 *
 * Nothing schedules these — there is no cron anywhere in this project, deliberately,
 * because a game that resolves an eight-week absence on the next page load should not
 * need a process running to have had weather during it. Instead any tick that needs
 * slot 41 generates slot 41, and because the whole row derives from the world seed and
 * the slot number, every camp generates the same one.
 *
 * The primary key is what makes that safe under concurrency: two settlements ticking
 * at the same instant both compute the missing slots, one wins the insert, and the
 * other's `do nothing` is the correct outcome rather than an error to handle.
 */

/**
 * The world seed. Fixed rather than random: it *is* the world, and regenerating it
 * would silently rewrite history for every camp at once.
 */
const WORLD_SEED = 20260101;

/** Generate any events missing up to `until`, plus a little beyond. */
export async function ensureWorldEvents(client, until) {
  const wanted = slotAt(until);

  const { rows } = await client.query('select coalesce(max(slot), -1) as highest from world_events');
  const highest = Number(rows[0].highest);
  if (highest >= wanted) return 0;

  let written = 0;
  for (let slot = highest + 1; slot <= wanted; slot++) {
    const event = eventForSlot(WORLD_SEED, slot);
    const { rowCount } = await client.query(
      `insert into world_events (slot, kind, starts_at, ends_at)
       values ($1, $2, $3, $4) on conflict (slot) do nothing`,
      [event.slot, event.kind, new Date(event.startsAt), new Date(event.endsAt)],
    );
    written += rowCount;
  }

  return written;
}

/**
 * Every event overlapping the window a tick is about to walk.
 *
 * The whole window, not just what is in force now: a tick replaying six weeks has to
 * see the blight that started and ended in the middle of them.
 */
export async function loadWorldEvents(client, from, until) {
  const { rows } = await client.query(
    `select slot, kind, starts_at, ends_at
       from world_events
      where starts_at < $2 and ends_at > $1
      order by starts_at`,
    [new Date(from), new Date(until)],
  );

  return rows.map((row) => ({
    slot: row.slot,
    kind: row.kind,
    startsAt: row.starts_at.getTime(),
    endsAt: row.ends_at.getTime(),
  }));
}
