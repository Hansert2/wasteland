import { InputError } from '../errors.js';

/**
 * Use something out of the pack, on purpose, whenever you like.
 *
 * Until now the only way to spend a consumable was to be offered one: a moment with a
 * `verb: 'spend'` option, on a trip long enough to have an interior, inside a window that
 * opens and closes on its own. Rations and antirads have been craftable and carryable since
 * the bench existed and there was no verb for simply taking one.
 *
 * ### Why this does not make the moment options redundant
 *
 * The moment is the better deal and stays the better deal. `radiationFactor: 0.1` on a
 * moment takes ninety percent of the dose the rest of the trip would have given; taking the
 * same tablets from here takes half their potency off the dose already carried. A moment is
 * a good price at an hour somebody else picks. This is a worse price at an hour you pick.
 *
 * ### The numbers, which are provisional
 *
 * Anchored rather than invented: the ration moment heals a flat 32 and the note beside it
 * records that as measured — "18 was worth less than the ration it burned; 32 is about a
 * meal". Half of potency puts a Preserved Meal at 35 and a Tinned Stew at 40, either side of
 * a number that was already tuned against real trips.
 *
 * The antirad half has no such anchor. Half of potency is 22 and 30 rads against a Deep Zone
 * trip that doses 25, which is the right order of magnitude and nothing more than that. It
 * wants measuring against `fuel-balance.mjs` before it is believed, for the same reason
 * everything else in this game does: a survivor who can scrub the dose on demand is a
 * survivor who idles less, and idling is what the whole fuel economy turns on.
 */

/** What a point of potency is worth, in points of the gauge it acts on. */
const POTENCY_TO_POINTS = 0.5;

/** The kinds that can be used at all. Everything else is worn, or is raw material. */
const CONSUMABLE = new Set(['ration', 'antirad']);

/**
 * @param {import('pg').PoolClient} client
 * @param {number} settlementId
 * @param {string} slug
 */
export async function useItem(client, settlementId, slug) {
  const wanted = String(slug ?? '').trim();
  if (!wanted) throw new InputError('Nothing was chosen.');

  const { rows: survivors } = await client.query(
    `select id, health, radiation from characters
      where settlement_id = $1 and died_at is null`,
    [settlementId],
  );
  const survivor = survivors[0];
  if (!survivor) throw new InputError('There is nobody to take it.');

  const { rows: held } = await client.query(
    `select ii.id, ii.qty, i.slug, i.name, i.kind, i.potency
       from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = $1 and i.slug = $2 and ii.qty > 0`,
    [survivor.id, wanted],
  );
  const item = held[0];
  if (!item) throw new InputError('There is nothing like that in the pack.');
  if (!CONSUMABLE.has(item.kind)) throw new InputError(`${item.name} is not something to take.`);

  const points = Number(item.potency) * POTENCY_TO_POINTS;
  const health = Number(survivor.health);
  const radiation = Number(survivor.radiation);

  /*
   * Refused rather than wasted.
   *
   * A ration at full health and a tablet on a clean survivor both do nothing, and both are
   * a crafted item gone. The bench charges 10 fuel and 15 scrap for a scrubber; spending
   * that to move a gauge that is already at its best is not a decision a player would make
   * on purpose, so it is one the page declines to let them make by accident.
   */
  if (item.kind === 'ration' && health >= 100) {
    throw new InputError('There is nothing to mend.');
  }
  if (item.kind === 'antirad' && radiation <= 0) {
    throw new InputError('There is no dose to scrub.');
  }

  const after =
    item.kind === 'ration'
      ? { health: Math.min(100, health + points), radiation }
      : { health, radiation: Math.max(0, radiation - points) };

  await client.query('update characters set health = $2, radiation = $3 where id = $1', [
    survivor.id,
    after.health,
    after.radiation,
  ]);

  // Spent the same way a moment spends it, down to deleting the empty row: two paths that
  // take one thing out of a pack should leave the pack in the same state.
  await client.query('update inventory_items set qty = qty - 1 where id = $1', [item.id]);
  await client.query('delete from inventory_items where id = $1 and qty <= 0', [item.id]);

  return {
    name: item.name,
    kind: item.kind,
    health: after.health - health,
    radiation: after.radiation - radiation,
  };
}
