import { OVERLAP_MARGIN_SLOTS, eventForSlot, slotAt } from '../game/world-events.js';

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
export const WORLD_SEED = 20260101;

/**
 * Generate whatever weather is missing for the window `[from, until]`.
 *
 * Only that window. Slots are deliberately not required to be contiguous, and this
 * is the reason: an earlier version generated every slot from the epoch up to the
 * horizon, which is fine while the horizon is today and catastrophic the moment it
 * is not. `test/db/world.test.js` simulates the year 2287, so each of its ticks
 * generated some twenty-four thousand rows one insert at a time — none of which could
 * overlap the window it was asking about — and took the database suite from nine
 * seconds to a hundred and sixty.
 *
 * Work is now proportional to the window being simulated rather than to the age of
 * the world, which is the property that has to hold for a game meant to be running
 * years from now.
 */
export async function ensureWorldEvents(client, from, until) {
  const first = Math.max(0, slotAt(from) - OVERLAP_MARGIN_SLOTS);
  const last = slotAt(until);
  if (last < first) return 0;

  const { rows } = await client.query(
    'select slot from world_events where slot between $1 and $2',
    [first, last],
  );
  const have = new Set(rows.map((row) => row.slot));

  const missing = [];
  for (let slot = first; slot <= last; slot++) {
    if (!have.has(slot)) missing.push(eventForSlot(WORLD_SEED, slot));
  }
  if (missing.length === 0) return 0;

  // One statement rather than one per slot. A camp coming back from a long absence
  // should not pay a round trip per storm it missed.
  const values = missing
    .map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`)
    .join(', ');
  const params = missing.flatMap((event) => [
    event.slot,
    event.kind,
    new Date(event.startsAt),
    new Date(event.endsAt),
  ]);

  const { rowCount } = await client.query(
    `insert into world_events (slot, kind, starts_at, ends_at)
     values ${values} on conflict (slot) do nothing`,
    params,
  );

  return rowCount;
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
