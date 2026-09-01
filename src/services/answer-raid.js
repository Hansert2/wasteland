import { InputError } from '../errors.js';
import { FACTIONS, raidTemper, standingOf } from '../game/factions.js';
import { resolveRaid } from '../game/raids.js';
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
  /*
   * Everybody who was named, and the page names as many as the player ticked.
   *
   * One survivor or four arrive here the same way, because a form with one box checked and
   * a form with four are the same submission with a different length. Deduplicated, since
   * a repeated id would otherwise stand somebody twice and hurt them twice for it.
   */
  const named = [...new Set([].concat(who ?? []).filter((one) => one != null).map(String))];
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

  const defenders =
    named.length === 0
      ? living.slice(0, 1)
      : named.map((id) => {
          const person = living.find((one) => String(one.id) === id);
          if (!person) throw new InputError('Nobody here answers to that.');
          return person;
        });
  if (defenders.length === 0) throw new InputError('Nobody stood.');

  /*
   * Away is the only occupation that stops you, and that is a decision rather than an
   * oversight: **building and crafting do not stop you defending.** A raid is not a job you
   * can be too busy for — you put the beam down. Somebody twenty hours down the road cannot
   * put anything down, which is the whole of what `mustBeFree` is being asked here.
   *
   * A sleeper cannot be in this list: the raid woke them when it arrived. See `openRaid`.
   */
  const busy = await occupations(client, settlementId, now);
  for (const person of defenders) {
    if (busy.get(Number(person.id))?.kind === 'away') {
      mustBeFree(busy, person, 'stand at the fence');
    }
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
   * What each of them is carrying, because that is what standing is worth. `standFor` reads
   * the best weapon in a pack — the same "no equip step" assumption `equipmentOf` makes for a
   * trip, and the right one: a survivor uses the best thing they own and there is no decision
   * in choosing to.
   *
   * One query for the lot rather than one per person, which is the same reason `loadWorld`
   * reads every pack at once: this is at most five rows deep and a round trip each is a round
   * trip too many.
   */
  const { rows: packs } = await client.query(
    `select ii.character_id, i.kind, i.potency, ii.qty from inventory_items ii
       join items i on i.id = ii.item_id
      where ii.character_id = any($1)`,
    [defenders.map((one) => one.id)],
  );

  const crew = defenders.map((person) => ({
    id: Number(person.id),
    name: person.name,
    alive: true,
    inventory: packs
      .filter((row) => Number(row.character_id) === Number(person.id))
      .map((row) => ({ kind: row.kind, potency: Number(row.potency), qty: Number(row.qty) })),
  }));

  const outcome = resolveRaid({
    wealth: campWealth(structures, resources),
    defence: campDefence(structures),
    resources,
    defenders: crew,
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

  /*
   * Hurt, never killed, and the floor is per survivor rather than on the total: a crew of
   * four comes home wrecked and alive. Each took their own roll — see `resolveRaid`, and the
   * reason it is not split between them.
   */
  for (const one of outcome.hurt) {
    if (one.damage > 0) {
      await client.query('update characters set health = greatest(1, health - $2) where id = $1', [
        one.id,
        one.damage,
      ]);
    }
    await client.query(
      `insert into raid_stands (raid_id, character_id, damage) values ($1, $2, $3)
       on conflict (raid_id, character_id) do nothing`,
      [raid.id, one.id, one.damage],
    );
  }

  await client.query(
    `update raids set resolved_at = $2, taken = $3, damage = $4, log = $5
      where id = $1 and resolved_at is null`,
    [
      raid.id,
      new Date(now),
      JSON.stringify(outcome.taken),
      outcome.damage,
      JSON.stringify(outcome.log),
    ],
  );

  return {
    stood: outcome.hurt.map((one) => one.name),
    taken: outcome.taken,
    hurt: outcome.hurt,
    damage: outcome.damage,
    log: outcome.log,
  };
}
