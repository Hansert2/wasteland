import { InputError } from '../errors.js';
import { FACTIONS, raidTemper, standingOf } from '../game/factions.js';
import { resolveRaid, standFor } from '../game/raids.js';
import { campDefence, campWealth } from '../game/structures.js';
import { occupations, mustBeFree } from './who-is-free.js';

/**
 * Somebody stands at the fence.
 *
 * Phase 12's verb, and the only one in the game that answers something happening *to* the
 * camp rather than out on the road. The raid is already open — `openRaid` in the tick put it
 * there and left it — and this settles it early, with a defender, instead of letting the
 * window shut on nobody.
 *
 * The arithmetic is `resolveRaid`, the same function the walk uses when the window closes on
 * silence. Only one argument differs between the two paths, which is the point: a raid
 * answered and a raid hidden from must not be two implementations that drift.
 *
 * Direct SQL rather than a load-and-save of the whole world, which is `useItem`'s pattern and
 * right for the same reason: this touches the stores, one survivor and one raid row, and
 * walking the simulation to do it would be a second place for the outcome to come from.
 *
 * Assumes the caller holds a transaction and has already advanced the settlement — which
 * matters more here than anywhere else in the game, because the thing being answered has a
 * deadline. An un-advanced call could answer a raid the clock has already closed.
 */
export async function answerRaid(client, settlementId, who, now = Date.now()) {
  const { rows: open } = await client.query(
    `select id, at, closes_at, seed, faction from raids
      where settlement_id = $1 and resolved_at is null`,
    [settlementId],
  );
  const raid = open[0];

  /*
   * Two absences, and they read differently to a player: one has never been raided this
   * evening, the other was and took too long deciding. The second is the ordinary way to meet
   * this — a window is four hours and a page is a render of a moment ago.
   */
  if (!raid) throw new InputError('Nobody is at the fence.');
  if (raid.closes_at.getTime() <= now) {
    throw new InputError('They have already gone, and taken what they came for.');
  }

  const { rows: living } = await client.query(
    `select id, name, health from characters
      where settlement_id = $1 and died_at is null order by born_at, id`,
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to stand.');

  const defender = who == null ? living[0] : living.find((one) => String(one.id) === String(who));
  if (!defender) throw new InputError('Nobody here answers to that.');

  /*
   * Away is the only occupation that stops you, and that is a decision rather than an
   * oversight: **building and crafting do not stop you defending.** A raid is not a job you
   * can be too busy for — you put the beam down. Somebody twenty hours down the road cannot
   * put anything down, which is the whole of what `mustBeFree` is being asked here.
   *
   * A sleeper cannot be in this list: the raid woke them when it arrived. See `openRaid`.
   */
  const busy = await occupations(client, settlementId, now);
  if (busy.get(Number(defender.id))?.kind === 'away') {
    mustBeFree(busy, defender, 'stand at the fence');
  }

  const [{ rows: structures }, { rows: resourceRows }, { rows: standingRows }] = [
    await client.query(
      'select kind, level from camp_structures where settlement_id = $1',
      [settlementId],
    ),
    await client.query(
      'select kind, amount, storage_cap from resources where settlement_id = $1',
      [settlementId],
    ),
    await client.query(
      'select faction, standing from faction_standing where settlement_id = $1',
      [settlementId],
    ),
  ];

  const resources = {};
  for (const row of resourceRows) resources[row.kind] = { amount: Number(row.amount) };
  const standings = {};
  for (const row of standingRows) standings[row.faction] = Number(row.standing);

  /*
   * What they are carrying, because that is what standing is worth. `standFor` reads the best
   * weapon in the pack — the same "no equip step" assumption `equipmentOf` makes for a trip,
   * which is the right one: a survivor uses the best thing they own and there is no decision
   * in choosing to.
   */
  const { rows: pack } = await client.query(
    `select i.kind, i.potency, ii.qty from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = $1`,
    [defender.id],
  );

  const survivor = {
    id: defender.id,
    name: defender.name,
    alive: true,
    inventory: pack.map((row) => ({
      kind: row.kind,
      potency: Number(row.potency),
      qty: Number(row.qty),
    })),
  };

  const outcome = resolveRaid({
    wealth: campWealth(structures, resources),
    defence: campDefence(structures),
    resources,
    survivor,
    stood: standFor(survivor),
    // The tower already asked whether they would come at all, when the raid opened. Asking
    // again here would let a raid the player is looking at turn out never to have happened.
    engaged: true,
    seed: Number(raid.seed),
    crew: FACTIONS[raid.faction]?.name,
    temper: raidTemper(standingOf(standings, raid.faction)),
  });

  for (const [kind, amount] of Object.entries(outcome.taken)) {
    // Conditional and floored in the statement, as every spend in this codebase is: the row
    // refuses to go negative even if the read above went stale.
    await client.query(
      `update resources set amount = greatest(0, amount - $3)
        where settlement_id = $1 and kind = $2`,
      [settlementId, kind, amount],
    );
  }

  // Hurt, never killed — the one figure in the raid table that has never moved.
  if (outcome.damage > 0) {
    await client.query('update characters set health = greatest(1, health - $2) where id = $1', [
      defender.id,
      outcome.damage,
    ]);
  }

  await client.query(
    `update raids set stood_by = $2, resolved_at = $3, taken = $4, damage = $5, log = $6
      where id = $1 and resolved_at is null`,
    [
      raid.id,
      defender.id,
      new Date(now),
      JSON.stringify(outcome.taken),
      outcome.damage,
      JSON.stringify(outcome.log),
    ],
  );

  return { name: defender.name, taken: outcome.taken, damage: outcome.damage, log: outcome.log };
}
