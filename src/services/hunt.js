import { InputError } from '../errors.js';
import { newSeed } from '../game/random.js';
import { STAMINA, movesFor, startOf, takeTurn, yieldOf } from '../game/hunting.js';
import { occupations, mustBeFree } from './who-is-free.js';
import { storeItems } from '../db/world.js';

/**
 * Start one, and take a turn of one.
 *
 * Two verbs in one file because they are two halves of a thing the player experiences as
 * continuous, and because they share the loading of it. Everything about the hunt *itself* is
 * in `src/game/hunting.js`, which is pure; this is the half that knows what a row is.
 *
 * **Neither of these writes a deadline, and nothing anywhere counts one down.** That is the
 * phase. A hunt sits exactly where the last press left it — across a page reload, across a
 * night, across a week — and the only thing that moves it is the player.
 *
 * Both assume the caller holds a transaction and has advanced the settlement, for the usual
 * reason and one of this verb's own: the stamina being spent is read here, and a survivor who
 * walked in the gate while the page sat there has spent a good deal of it since it was drawn.
 */

/** The survivor and their pack, which is what the hunt needs to know about them. */
async function hunterOf(client, settlementId, characterId) {
  const { rows } = await client.query(
    `select c.id, c.name, c.stamina, c.health, c.skill_scavenging
       from characters c
      where c.settlement_id = $1 and c.died_at is null and c.id = $2`,
    [settlementId, characterId],
  );
  if (!rows[0]) throw new InputError('Nobody here answers to that.');

  const { rows: pack } = await client.query(
    `select i.slug, i.kind, i.potency from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = $1 and ii.qty > 0`,
    [characterId],
  );

  return {
    id: rows[0].id,
    name: rows[0].name,
    stamina: Number(rows[0].stamina),
    health: Number(rows[0].health),
    skillScavenging: Number(rows[0].skill_scavenging),
    inventory: pack,
  };
}

/**
 * Go out after something.
 *
 * **The stamina is spent here, in full, before anything is known** — including which animal is
 * out there. That is the decision the phase is built on: a quarter of somebody's working day
 * against a seed nobody has read yet. Backing off on the first turn costs exactly as much as
 * backing off on the fifth, so leaving is about blood rather than about getting the day back.
 */
export async function startHunt(client, settlementId, who, now = Date.now()) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { rows: open } = await client.query(
    `select id from hunts where settlement_id = $1 and status = 'active'`,
    [settlementId],
  );
  if (open.length > 0) throw new InputError('Somebody is already out after something.');

  const { rows: living } = await client.query(
    `select id, name from characters where settlement_id = $1 and died_at is null
      order by born_at, id`,
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to send.');

  const person =
    who == null ? living[0] : living.find((one) => String(one.id) === String(who));
  if (!person) throw new InputError('Nobody here answers to that.');

  const busy = await occupations(client, settlementId, now);
  mustBeFree(busy, person, 'go out after anything');

  const hunter = await hunterOf(client, settlementId, person.id);

  /*
   * The gauge, and the refusal names the shortfall the way the road's does.
   *
   * A hunt is not a walk, so this is a floor rather than a rate: you either have a quarter of
   * a day in you or you do not. Refused rather than allowed at a crawl, because a hunt that
   * could be started on two points of stamina would be a hunt with no price at all.
   */
  if (hunter.stamina < STAMINA) {
    throw new InputError(
      `${hunter.name} has ${Math.floor(hunter.stamina)} left in them, and going out after ` +
        `something takes ${STAMINA}.`,
    );
  }

  const seed = newSeed();
  const state = startOf(seed);

  await client.query(
    'update characters set stamina = greatest(0, stamina - $2) where id = $1',
    [hunter.id, STAMINA],
  );
  const { rows: made } = await client.query(
    `insert into hunts (settlement_id, character_id, seed, state, started_at)
     values ($1, $2, $3, $4::jsonb, $5) returning id`,
    [settlementId, hunter.id, seed, JSON.stringify(state), new Date(now)],
  );

  return { huntId: made[0].id, state, hunter: hunter.name };
}

/**
 * One press.
 *
 * The move is validated against `movesFor` rather than against a list written here, so the
 * page and the service cannot disagree about what is on offer — the same arrangement
 * `answerMoment` has with a moment's options, and for the same reason: the page is a render of
 * a moment ago and "Take it" can have stopped being available since it was drawn.
 */
export async function huntTurn(client, settlementId, move, now = Date.now()) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { rows: open } = await client.query(
    `select id, character_id, seed, state from hunts
      where settlement_id = $1 and status = 'active'`,
    [settlementId],
  );
  const hunt = open[0];
  if (!hunt) throw new InputError('Nobody is out after anything.');

  const hunter = await hunterOf(client, settlementId, hunt.character_id);
  const state = hunt.state;

  const wanted = String(move ?? '');
  if (!movesFor(state).some((one) => one.key === wanted)) {
    throw new InputError('That is not one of the things they can do.');
  }

  const next = takeTurn(state, wanted, { seed: Number(hunt.seed), survivor: hunter });

  /*
   * What it cost them, and it is the only write here that can end a life.
   *
   * Death is settled in the same statement that applies the damage rather than being left for
   * the tick to notice, for the reason the trip settles its own: a survivor has to die of what
   * happened to them — "gored at the fence line", not "starvation" at whatever the camp's food
   * happened to be that hour. See the warning rule in `hunting.js`: nothing reaches here
   * without a screen having offered the way out first.
   */
  let died = false;
  if (next.damage > state.damage) {
    const hurt = next.damage - state.damage;
    died = hunter.health - hurt <= 0;

    /*
     * Two statements rather than one with a conditional body.
     *
     * The first draft chose the SQL *and* the parameter list with the same ternary, which left
     * a null in `$2` that the surviving branch never mentioned — and Postgres cannot infer a
     * type for a parameter no clause uses, so the write failed with "could not determine data
     * type of parameter $2" exactly when somebody was hurt and lived. It passed every time
     * they died and every time they were untouched, which is why it took eight runs to see.
     */
    if (died) {
      await client.query(
        `update characters set health = 0, died_at = $2, cause_of_death = 'mauled while hunting'
          where id = $1`,
        [hunter.id, new Date(now)],
      );
    } else {
      await client.query(
        'update characters set health = greatest(0, health - $2) where id = $1',
        [hunter.id, hurt],
      );
    }

    /*
     * And the hunt ends with them, whatever the state machine thought.
     *
     * Found by a test that pressed on at twelve health: a strike that killed the hunter left
     * the row `active`, so the next page load asked `hunterOf` for a survivor who was dead
     * and the block refused to render at all. The pure module cannot know this — it is handed
     * a survivor and never told what a health column says — so ending it is the service's,
     * exactly as writing the death is.
     */
    if (died) next.status = 'mauled';
  }

  if (next.status === 'taken') {
    /*
     * Meat to the stores and material to the box, and the split is the same one Phase 13 drew:
     * a find is out there and the box is at home. **A hunt is at home** — it happens at the
     * camp's edge and the survivor is standing in the camp when it ends — so none of it goes
     * into a pack that could be too full to take it. The one thing that could refuse this is
     * a pack, and there is no reason for a pack to be involved.
     *
     * Food is capped by storage the way every other income is. Over the cap is lost, which is
     * the shelter doing its job and not a special case for meat.
     */
    const gained = yieldOf(next, hunter);
    await client.query(
      `update resources set amount = least(storage_cap, amount + $2)
        where settlement_id = $1 and kind = 'food'`,
      [settlementId, gained.food],
    );
    const materials = [
      { slug: 'raw_hide', qty: gained.raw_hide },
      { slug: 'sinew', qty: gained.sinew },
    ].filter((one) => one.qty > 0);
    if (materials.length > 0) await storeItems(client, settlementId, materials);

    next.gained = gained;
  }

  await client.query(
    `update hunts set state = $2::jsonb, status = $3, resolved_at = $4 where id = $1`,
    [
      hunt.id,
      JSON.stringify(next),
      next.status,
      next.status === 'active' ? null : new Date(now),
    ],
  );

  return { state: next, died, hunter: hunter.name };
}
