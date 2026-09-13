import { applyTick } from '../game/tick.js';
import { loadWorld, saveWorld, grantItems, storeItems } from '../db/world.js';
import { WORLD_SEED, ensureWorldEvents, loadWorldEvents } from '../db/world-events.js';
import { deriveEventsBetween } from '../game/world-events.js';
import { roomToSpare, whoWouldArrive } from './take-in-wanderer.js';
import { insertSurvivor } from './settlement-lifecycle.js';

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

  /*
   * Phase 13: the pack has a bottom, and where a thing lands depends on where it was made.
   *
   * These two event kinds used to be one list because a pack that could not be full made
   * them the same act. They are not the same act any more, and they no longer even go to
   * the same place. **A find is out there**, carried home by whoever walked, so what does
   * not fit is left where it was found and the log says so.
   *
   * **A finished order is lifted off the bench, and the bench is at home beside the box**,
   * so the whole order goes on the shelf. It used to go into the crafter's pack with only
   * the overflow boxed, and play found the fault in that: parts came out of the workshop
   * owned by whoever was standing at it, so the next recipe could not reach them without a
   * transfer. The shelf is the one place every recipe already draws from.
   *
   * The events are appended here rather than raised by the tick because the tick cannot
   * know either: a pack's weight is a fact about rows in a table, and `applyTick` is a pure
   * function of the state it was handed.
   */
  if (advanced.survivor?.alive && found.length > 0) {
    const leftBehind = await grantItems(client, advanced.survivor.id, found);
    for (const { slug, qty } of leftBehind) {
      events.push({ at: now, type: 'find_left_behind', slug, qty });
    }
  }

  // No `alive` guard: the shelf outlives the people who filled it, which is what banking
  // against death has meant since migration 001.
  if (delivered.length > 0) {
    await storeItems(client, settlementId, delivered);
  }

  /*
   * And the camp being woken by raiders arriving actually reaches the camp.
   *
   * `wakeTheCamp` in the tick has cleared `sleepUntil` on the state since raids gained a
   * duration — the one exception to "there is no waking them", and the right one: it is the
   * raid that wakes you, not the choice. But `saveWorld` deliberately does not write
   * `sleep_until` ("a survivor's sleep is set by the service that started it and by nothing
   * else"), so the column kept its old value and the next page load read them straight back
   * under. The simulation had them up and every service still refused them — `occupations`
   * asks the database, not the walk — which is this project's oldest failure shape: a page
   * and a tick disagreeing about one fact.
   *
   * Written here rather than in `saveWorld` for the reason the grants above are: the tick
   * deals in state and cannot run a query, so the caller applies what it decided. By id, not
   * by name — two survivors can share one, as the page-state fixtures prove.
   */
  /*
   * Phase 15: somebody followed a survivor home, and the gate decides whether they stay.
   *
   * Settled here rather than in the walk for the two reasons the finds above give — who it is
   * comes from a row count, and whether there is a bed is a question about
   * `structure_upgrades` — and it uses `roomToSpare` and `whoWouldArrive`, the gate's own two
   * functions, so the two doors into this camp cannot disagree about its capacity or about who
   * is standing at them.
   *
   * **The bed is checked now and not when they were met**, which is the decision rather than
   * an implementation detail: a survivor agrees to bring somebody back from twenty hours away
   * and finds out at the gate whether the camp can keep them. A rescue does not conjure a room.
   *
   * The turned-away case is an event rather than a silence. Nothing else on the page would ever
   * mention it, and a player who spent a ration on the road is owed the sentence.
   */
  const followed = events.filter((event) => event.type === 'walked_in_with_them');
  for (const arrival of followed) {
    void arrival;
    const { room } = await roomToSpare(client, settlementId);
    if (room <= 0) {
      events.push({ at: now, type: 'arrival_turned_away' });
      continue;
    }
    const wanderer = await whoWouldArrive(client, settlementId);
    await insertSurvivor(client, settlementId, wanderer, now);
    events.push({ at: now, type: 'joined_the_camp', who: wanderer.name });
  }

  const woken = events.filter((event) => event.type === 'woken' && event.characterId != null);
  if (woken.length > 0) {
    await client.query('update characters set sleep_until = null where id = any($1)', [
      woken.map((event) => event.characterId),
    ]);
  }

  return { state: advanced, events };
}
