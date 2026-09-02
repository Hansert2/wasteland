import { InputError } from '../errors.js';
import { CARRY_CAP_GRAMS, howManyFit, saysWeight, weighPack } from '../game/carrying.js';
import { occupations, mustBeFree } from './who-is-free.js';

/**
 * Move something between a pack and the camp box.
 *
 * One verb rather than three. Storing, taking and handing over are the same act with
 * different ends, and writing them separately would mean three places that have to agree
 * about weight, about who is free, and about whether a raid is open.
 *
 * Each end is either `'box'` or a survivor's id. Everything else about the rules follows
 * from what the two ends are:
 *
 * - **A survivor who is away cannot reach either end.** Their pack is twenty hours down the
 *   road and so are they. This is the same line `answerRaid` draws — away is the occupation
 *   that nothing else can interrupt — and unlike `useItem`, which deliberately lets somebody
 *   open their own pack out there, this is about two things being in the same place.
 * - **Nothing moves while a raid is open.** The raid rests on `standFor` reading a *carried*
 *   weapon, so free transfers mid-raid would collapse "who stands" into "who can be handed
 *   the spear", and the decision the phase is built on would evaporate.
 * - **The box has no cap and a pack does.** So the only end that can refuse for want of room
 *   is a survivor.
 *
 * Being busy at camp is not a refusal here. A builder can put something in the box: the
 * whole point of the box is that it is at home, and reaching into it is not a job.
 */
export async function moveItem(client, settlementId, { from, to, slug, qty = 1 } = {}) {
  const wanted = String(slug ?? '').trim();
  if (!wanted) throw new InputError('Nothing was chosen.');

  const count = Math.floor(Number(qty));
  if (!Number.isFinite(count) || count < 1) throw new InputError('That is not a number to move.');
  if (String(from) === String(to)) throw new InputError('That is already where it is.');

  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { rows: openRaids } = await client.query(
    'select id from raids where settlement_id = $1 and resolved_at is null',
    [settlementId],
  );
  if (openRaids.length > 0) {
    throw new InputError('Not while they are at the fence. Whatever is in hand stays in hand.');
  }

  const { rows: living } = await client.query(
    `select id, name from characters
      where settlement_id = $1 and died_at is null order by born_at, id`,
    [settlementId],
  );
  const person = (end) =>
    end === 'box' ? null : living.find((one) => String(one.id) === String(end));

  const source = person(from);
  const target = person(to);
  if (from !== 'box' && !source) throw new InputError('Nobody here answers to that.');
  if (to !== 'box' && !target) throw new InputError('Nobody here answers to that.');

  const busy = await occupations(client, settlementId);
  for (const who of [source, target]) {
    if (who && busy.get(Number(who.id))?.kind === 'away') {
      mustBeFree(busy, who, 'hand anything over');
    }
  }

  // What is there to move, and what does one of them weigh.
  const held = source
    ? await client.query(
        `select ii.qty, i.name, i.weight_grams
           from inventory_items ii join items i on i.id = ii.item_id
          where ii.character_id = $1 and i.slug = $2`,
        [source.id, wanted],
      )
    : await client.query(
        `select si.qty, i.name, i.weight_grams
           from store_items si join items i on i.id = si.item_id
          where si.settlement_id = $1 and i.slug = $2`,
        [settlementId, wanted],
      );

  const stock = held.rows[0];
  if (!stock || stock.qty < count) {
    throw new InputError(
      source ? 'There is not that much in the pack.' : 'There is not that much in the box.',
    );
  }

  /*
   * Room at the far end, and the refusal names the shortfall.
   *
   * "No room" on its own sends the player to weigh a pack by hand. The cap is a number they
   * are allowed to know, so the message says what the pack already holds and what was being
   * handed to it — **in the same terms the pack tab prints above its list**, because a page
   * and a refusal describing one pack two different ways is how a player ends up doing
   * arithmetic to reconcile them.
   */
  if (target) {
    const { rows: carried } = await client.query(
      `select ii.qty, i.weight_grams
         from inventory_items ii join items i on i.id = ii.item_id
        where ii.character_id = $1`,
      [target.id],
    );
    const pack = carried.map((row) => ({ qty: row.qty, weightGrams: row.weight_grams }));
    const fits = howManyFit(pack, stock.weight_grams, count);

    if (fits < count) {
      throw new InputError(
        `${target.name} cannot carry that — ${saysWeight(weighPack(pack))} / ` +
          `${saysWeight(CARRY_CAP_GRAMS)} already, and that is ` +
          `${saysWeight(stock.weight_grams * count)}.`,
      );
    }
  }

  if (source) {
    await client.query(
      `update inventory_items ii set qty = ii.qty - $3
         from items i
        where i.id = ii.item_id and ii.character_id = $1 and i.slug = $2 and ii.qty >= $3`,
      [source.id, wanted, count],
    );
    await client.query(
      `delete from inventory_items ii using items i
        where i.id = ii.item_id and ii.character_id = $1 and i.slug = $2 and ii.qty <= 0`,
      [source.id, wanted],
    );
  } else {
    await client.query(
      `update store_items si set qty = si.qty - $3
         from items i
        where i.id = si.item_id and si.settlement_id = $1 and i.slug = $2 and si.qty >= $3`,
      [settlementId, wanted, count],
    );
    await client.query(
      `delete from store_items si using items i
        where i.id = si.item_id and si.settlement_id = $1 and i.slug = $2 and si.qty <= 0`,
      [settlementId, wanted],
    );
  }

  if (target) {
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, i.id, $3 from items i where i.slug = $2
       on conflict (character_id, item_id)
         do update set qty = inventory_items.qty + excluded.qty`,
      [target.id, wanted, count],
    );
  } else {
    await client.query(
      `insert into store_items (settlement_id, item_id, qty)
       select $1, i.id, $3 from items i where i.slug = $2
       on conflict (settlement_id, item_id)
         do update set qty = store_items.qty + excluded.qty`,
      [settlementId, wanted, count],
    );
  }

  return {
    name: stock.name,
    qty: count,
    to: target ? target.name : 'the box',
    from: source ? source.name : 'the box',
  };
}
