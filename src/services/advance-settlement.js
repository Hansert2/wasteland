import { applyTick } from '../game/tick.js';
import { loadWorld, saveWorld, grantItems } from '../db/world.js';

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
  const { state: advanced, events } = applyTick(state, now);
  await saveWorld(client, advanced);

  // Items the tick produced — found out there, or lifted off the workshop bench —
  // are granted here, where slugs can be resolved to rows. Both event kinds carry a
  // slug and a quantity and nothing else, because that is all the tick knows.
  // A survivor who died on the way home has no pack to put them in.
  const grants = events.filter(
    (event) => event.type === 'item_found' || event.type === 'craft_delivered',
  );
  if (grants.length > 0 && advanced.survivor?.alive) {
    await grantItems(client, advanced.survivor.id, grants);
  }

  return { state: advanced, events };
}
