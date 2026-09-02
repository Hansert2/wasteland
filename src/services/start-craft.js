import { craftHoursMultiplier } from '../game/structures.js';
import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Put an order on the workshop bench.
 *
 * The mirror of `startBuild`, and deliberately so: the cost is paid up front, the
 * goods arrive when the tick reaches the completion hour, and the queue holds one.
 * The queue is a *separate* one, though — sharing it with builds would mean crafting
 * a spear blocks upgrading the garden, and that is not a decision worth making
 * interesting. They are different workbenches.
 *
 * Where it departs from a build: a recipe is priced in two currencies. `costs` come
 * out of settlement stores, which accumulate on their own while you are offline, so
 * a recipe priced only in stores is priced in patience. `inputs` come off the
 * survivor's back, and that is what makes a recipe a recipe rather than a shop
 * counter — the interesting half of the price is the thing you had to go and find.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement, so
 * the stores being spent are current rather than stale. Every refusal throws before
 * anything is deducted, and the transaction is what guarantees the rest.
 */
/**
 * @param {string|number} [who] whose hands, as `startBuild`.
 */
export async function startCraft(client, settlementId, recipeSlug, now = Date.now(), who = null) {
  const { rows: recipes } = await client.query(
    `select id, slug, name, costs, inputs, requires_workshop, craft_hours
       from recipes where slug = $1`,
    [String(recipeSlug ?? '')],
  );
  const recipe = recipes[0];
  if (!recipe) throw new InputError('Nobody here knows how to make that.');

  // Starting work needs hands, even though finishing does not.
  const { rows: living } = await client.query(
    'select id, name from characters where settlement_id = $1 and died_at is null order by born_at, id',
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to work the bench.');



  const { rows: active } = await client.query(
    `select id from craft_orders where settlement_id = $1 and status = 'active'`,
    [settlementId],
  );
  if (active.length > 0) throw new InputError('The bench is already in use.');

  // After the bench's own rule, not before it: a camp still runs one order at a time and
  // that refusal names the bench. Asking who is free first would replace it with a vaguer
  // message on a camp of one, where both are true.
  /*
   * Whose hands. A survivor at the bench is at the bench — Phase 10's first decision is that
   * stamina depletes from crafting as much as from walking, and it cannot be charged to
   * anybody until the order says whose it is.
   *
   * The pack matters here in a way it does not for a build: a recipe's inputs come out of
   * somebody's inventory, so the person named is also the person paying.
   */
  const busy = await occupations(client, settlementId, now);
  const character =
    who == null
      ? living.find((one) => !busy.has(Number(one.id)))
      : living.find((one) => String(one.id) === String(who));

  if (!character) {
    if (who != null) throw new InputError('Nobody here answers to that.');

    /*
     * Nobody free, and on a camp of one "everybody here is already busy" is a worse sentence
     * than naming them: there is one person, the player knows who, and what they want to know
     * is what that person is doing instead. `mustBeFree` says it.
     */
    if (living.length === 1) mustBeFree(busy, living[0], 'work the bench');
    throw new InputError('Everybody here is already busy with something.');
  }
  mustBeFree(busy, character, 'work the bench');

  await requireWorkshop(client, settlementId, recipe);
  await payCosts(client, settlementId, recipe);
  await consumeInputs(client, settlementId, character.id, recipe);

  // The bench's speed is fixed when the order starts — the tools you had when you
  // put it on. A machine shop fitted halfway through does not retroactively hurry it.
  const { rows: fitted } = await client.query(
    `select upgrade from structure_upgrades
      where settlement_id = $1 and installed_at is not null`,
    [settlementId],
  );
  const hours =
    Number(recipe.craft_hours) * craftHoursMultiplier(fitted.map((row) => row.upgrade));

  const completesAt = new Date(now + hours * HOUR_MS);

  const { rows } = await client.query(
    `insert into craft_orders (settlement_id, recipe_id, started_at, completes_at, crafted_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [settlementId, recipe.id, new Date(now), completesAt, character.id],
  );

  return { craftOrderId: rows[0].id, recipeName: recipe.name, completesAt };
}

async function requireWorkshop(client, settlementId, recipe) {
  const needed = Number(recipe.requires_workshop);
  if (needed <= 0) return;

  const { rows } = await client.query(
    `select level from camp_structures where settlement_id = $1 and kind = 'workshop'`,
    [settlementId],
  );

  if (Number(rows[0]?.level ?? 0) < needed) {
    throw new InputError(`That needs a workshop at level ${needed}.`);
  }
}

/**
 * Spend settlement stores. Checked in full before anything is deducted, so the
 * message names the first thing actually short rather than whichever key iterated
 * last, and a refusal never leans on the rollback to undo a half-paid order.
 */
async function payCosts(client, settlementId, recipe) {
  const costs = Object.entries(recipe.costs ?? {});
  if (costs.length === 0) return;

  const { rows } = await client.query(
    'select kind, amount from resources where settlement_id = $1',
    [settlementId],
  );
  const held = new Map(rows.map((row) => [row.kind, Number(row.amount)]));

  for (const [kind, amount] of costs) {
    // An unknown key is a content bug, not a player one: it means a recipe in the
    // seed names a resource the schema has never heard of. Loud, and not a 400.
    if (!held.has(kind)) {
      throw new Error(`recipe ${recipe.slug} names an unknown resource: ${kind}`);
    }
    if (held.get(kind) < Number(amount)) {
      throw new InputError(`Not enough ${kind} — that needs ${amount}.`);
    }
  }

  for (const [kind, amount] of costs) {
    // Conditional update rather than trusting the read above: the row refuses to go
    // negative even if a concurrent request slipped past the settlement lock somehow.
    const { rowCount } = await client.query(
      `update resources set amount = amount - $3
        where settlement_id = $1 and kind = $2 and amount >= $3`,
      [settlementId, kind, amount],
    );
    if (rowCount === 0) throw new InputError(`Not enough ${kind} — that needs ${amount}.`);
  }
}

/**
 * Spend materials out of the crafter's pack, and out of the camp box behind it.
 *
 * **The box is reachable from the bench** — the user's call on 2026-09-02, and the point of
 * the phase. Finds land on whoever walked, so the parts for one vest end up spread across
 * three people; if the bench could only see one pack, the fix for that would be shuttling
 * everything to the crafter before every order, which is busywork replacing an
 * impossibility.
 *
 * **The pack is spent first.** Not arbitrary: a survivor's own materials are the ones that
 * die with them, so spending those first is the ordering that loses least. It also keeps the
 * box as what it is — a reserve — rather than the first thing raided.
 *
 * The recipe's argument survives all of this. *The interesting half of a recipe is the thing
 * you had to go and find* is about where a material came from, not which pocket it sat in.
 */
async function consumeInputs(client, settlementId, characterId, recipe) {
  const inputs = recipe.inputs ?? [];
  if (inputs.length === 0) return;

  const { rows } = await client.query(
    `select i.slug, i.name,
            coalesce(ii.qty, 0) as carried,
            coalesce(si.qty, 0) as stored,
            coalesce(ii.qty, 0) + coalesce(si.qty, 0) as qty
       from items i
       left join inventory_items ii on ii.item_id = i.id and ii.character_id = $1
       left join store_items si on si.item_id = i.id and si.settlement_id = $2
      where coalesce(ii.qty, 0) + coalesce(si.qty, 0) > 0`,
    [characterId, settlementId],
  );
  const pack = new Map(rows.map((row) => [row.slug, row]));

  for (const { slug, qty } of inputs) {
    const carried = pack.get(slug);
    if (!carried || carried.qty < qty) {
      const name = carried?.name ?? slug.replaceAll('_', ' ');
      throw new InputError(`Not enough ${name} — that needs ${qty}.`);
    }
  }

  for (const { slug, qty } of inputs) {
    const held = pack.get(slug);
    const fromPack = Math.min(qty, Number(held.carried));
    const fromBox = qty - fromPack;

    if (fromPack > 0) {
      const { rowCount } = await client.query(
        `update inventory_items ii set qty = ii.qty - $3
           from items i
          where i.id = ii.item_id and ii.character_id = $1 and i.slug = $2 and ii.qty >= $3`,
        [characterId, slug, fromPack],
      );
      if (rowCount === 0) {
        throw new InputError(`Not enough ${slug.replaceAll('_', ' ')} — that needs ${qty}.`);
      }
    }

    if (fromBox > 0) {
      const { rowCount } = await client.query(
        `update store_items si set qty = si.qty - $3
           from items i
          where i.id = si.item_id and si.settlement_id = $1 and i.slug = $2 and si.qty >= $3`,
        [settlementId, slug, fromBox],
      );
      if (rowCount === 0) {
        throw new InputError(`Not enough ${slug.replaceAll('_', ' ')} — that needs ${qty}.`);
      }
    }

    // Empty rows go, on both sides, so a pack and a box read the same way after a craft as
    // they do after anything else that spends from them.
    await client.query('delete from inventory_items where character_id = $1 and qty <= 0', [
      characterId,
    ]);
    await client.query('delete from store_items where settlement_id = $1 and qty <= 0', [
      settlementId,
    ]);
  }
}
