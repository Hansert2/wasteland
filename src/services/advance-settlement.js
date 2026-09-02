import { applyTick } from '../game/tick.js';
import { loadWorld, saveWorld, grantItems, storeItems } from '../db/world.js';
import { WORLD_SEED, ensureWorldEvents, loadWorldEvents } from '../db/world-events.js';
import { deriveEventsBetween } from '../game/world-events.js';

/**
 * Bring a settlement up to date: load, simulate, write back.
 *
 * This is what every page load calls before rendering anything. It takes a `client`
 * and assumes the caller has opened a transaction, because the read-modify-write is
 * only safe as a unit.
 *
 * The row lock matters more than it looks. Two requests arriving together — a page
 * load and a build order, say — would otherwise both read the same `last_tick_at`,
 * both compute the same elapsed hours, and both add that production. Resources would
 * quietly double. `for update` makes the second request wait for the first to commit,
 * after which it sees an already-advanced clock and computes nothing.
 *
 * @returns {{ state: object, events: object[] }} events are the log to show on login
 */
export async function advanceSettlement(client, settlementId, now) {
  const { rows } = await client.query('select id from settlements where id = $1 for update', [
    settlementId,
  ]);
  if (rows.length === 0) throw new Error(`no settlement ${settlementId}`);

  const state = await loadWorld(client, settlementId);

  // The weather for the stretch about to be simulated. Generated on demand rather
  // than by anything scheduled: a camp resolving a six-week absence needs the storms
  // that happened during it, and nothing was running to have recorded them.
  //
  // **The window reaches back to an in-flight departure, not only to the last tick.**
  // The sky is integrated across a whole trip, and a trip that began before the last
  // check-in started before this window would otherwise open. Loading from
  // `lastTickAt` alone would leave those early hours with no events found, which
  // `activeAt` reports as clear sky — so a storm walked through would silently cost
  // nothing, and the more often a player checked in the more of their own weather
  // they would erase. The tick's own walk still starts at `lastTickAt`; this only
  // widens what it can see.
  const from = Math.min(state.lastTickAt, state.expedition?.departedAt ?? Infinity);

  await ensureWorldEvents(client, from, now);
  const recorded = await loadWorldEvents(client, from, now);

  /*
   * And forward to the end of a trip in flight, derived rather than recorded.
   *
   * The tick now settles a trip's damage and dose across its hours instead of at the gate,
   * and to know what a whole trip is worth it has to integrate the whole trip's sky —
   * including the part that has not happened yet. Weather is a pure function of WORLD_SEED
   * and the slot number, so those hours are knowable without being stored, which is the
   * same derivation `reportOn` has used to preview a trip since the glass was fitted.
   *
   * Not persisted, deliberately. `ensureWorldEvents` writes the past because the past must
   * agree between camps forever; the future needs no such promise, and writing it would
   * commit the world to weather no player has yet lived through.
   */
  const until = state.expedition?.status === 'active' ? state.expedition.returnsAt : now;
  const ahead =
    until > now ? deriveEventsBetween(WORLD_SEED, now, until).filter((e) => e.startsAt >= now) : [];

  state.worldEvents = [...recorded, ...ahead];

  const { state: advanced, events } = applyTick(state, now);
  await saveWorld(client, advanced);

  // Items the tick produced — found out there, or lifted off the workshop bench — are
  // granted here, where slugs can be resolved to rows. Both kinds carry a slug and a
  // quantity and nothing else, because that is all the tick knows. A survivor who died on
  // the way home has no pack to put them in.
  const found = events.filter((event) => event.type === 'item_found');
  const delivered = events.filter((event) => event.type === 'craft_delivered');

  if (advanced.survivor?.alive && (found.length > 0 || delivered.length > 0)) {
    /*
     * Phase 13: the pack has a bottom, and where the overflow goes depends on where they are.
     *
     * These two event kinds used to be one list because a pack that could not be full made
     * them the same act. They are not the same act any more. **A find is out there and the
     * box is at home**, so what does not fit is left where it was found and the log says so.
     * **A finished order is lifted off the bench, which is at home**, so what does not fit
     * goes on the shelf beside it — refusing it would destroy something the player has
     * already paid fuel and scrap for, over a pack they could empty in one press.
     *
     * The events are appended here rather than raised by the tick because the tick cannot
     * know either: a pack's weight is a fact about rows in a table, and `applyTick` is a pure
     * function of the state it was handed.
     */
    const leftBehind = await grantItems(client, advanced.survivor.id, found);
    for (const { slug, qty } of leftBehind) {
      events.push({ at: now, type: 'find_left_behind', slug, qty });
    }

    const overflowed = await grantItems(client, advanced.survivor.id, delivered);
    if (overflowed.length > 0) {
      await storeItems(client, settlementId, overflowed);
      for (const { slug, qty } of overflowed) {
        events.push({ at: now, type: 'craft_boxed', slug, qty });
      }
    }
  }

  return { state: advanced, events };
}
