import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import { UPGRADES, storageCap } from '../game/structures.js';
import { InputError } from '../errors.js';
import { wandererFor } from '../game/wanderers.js';
import { solarNoonFor, offsetForZone } from '../game/zones.js';

export { InputError };

// Level two of the small three, which is level one of the old scale: output per
// level was halved, so a camp starts with twice as many to be handed the same camp.
const STARTING_STRUCTURES = [
  { kind: 'shelter', level: 2 },
  { kind: 'garden', level: 2 },
  { kind: 'water_purifier', level: 2 },
  { kind: 'workshop', level: 0 },
  { kind: 'watchtower', level: 0 },
];

const STARTING_AMOUNTS = { food: 40, water: 40, scrap: 10, fuel: 0 };

/** What a new survivor inherits: the camp, minus a bite taken out of it. */
// Two levels, which is the one level it always was on the old scale.
const SUCCESSOR_STRUCTURE_LOSS = 2;
const SUCCESSOR_SALVAGE = 0.5;

/**
 * Create a player and their settlement. Deliberately *not* their survivor.
 *
 * An account owns a camp and never a person: `characters` hangs off `settlements`,
 * and `player_id` appears nowhere near it. Founding used to create the first survivor
 * anyway, which made registration ask you to name someone before you had seen the
 * place, and implied an ownership the schema does not have.
 *
 * So a new camp stands empty for exactly as long as it takes to say who is taking it
 * on, and the first survivor arrives through `raiseSuccessor` like every one after
 * them. There is no "first survivor" path to keep in step with the successor path,
 * because there is only the one path.
 *
 * Caller supplies the transaction; a half-founded account is not a state we allow.
 */
export async function foundSettlement(client, {
  email,
  password,
  settlementName,
  clockOffset = 0,
  zone = '',
  now = Date.now(),
}) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    throw new InputError('That does not look like an email address.');
  }
  if (String(password ?? '').length < MIN_PASSWORD_LENGTH) {
    throw new InputError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const camp = cleanName(settlementName, 'Camp');

  let playerId;
  try {
    const { rows } = await client.query(
      'insert into players (email, password_hash) values ($1, $2) returning id',
      [cleanEmail, await hashPassword(password)],
    );
    playerId = rows[0].id;
  } catch (error) {
    // 23505 = unique_violation, which here can only be the email index.
    if (error.code === '23505') throw new InputError('That email is already registered.');
    throw error;
  }

  /*
   * The camp's clock. Derived from the zone where the zone is one we know, and taken from
   * the browser's own report otherwise.
   *
   * That order rather than the reverse because the two can disagree, and when they do the
   * zone is the one that also fixes the sun — deriving both from one place is what keeps a
   * camp from claiming Amsterdam on a Denver clock. The browser's number stays as the
   * fallback because it is right for every zone, including the ones the table has never
   * heard of.
   */
  const reported = Math.max(-840, Math.min(840, Math.trunc(clockOffset) || 0));
  const derived = offsetForZone(zone, now);
  const offset = derived === null ? reported : derived;

  /*
   * Where the sun sits against that clock, derived from the browser's zone rather than
   * asked for — see `zones.js`. `null` for a zone nobody listed, and then the column keeps
   * its 720 default, which is the idealised sky every camp had before migration 016.
   *
   * Derived once and stored, like the offset and for the same reason: a camp must not
   * change its sky because the player travelled, or an expedition would stop replaying.
   */
  const noon = solarNoonFor(zone, offset);

  /*
   * Stamped only when the derivation actually worked — see migration 017.
   *
   * The column asks one question: was this camp ever placed. A camp founded from a zone the
   * table knows is placed, here, and never needs the control on the camp page. A camp whose
   * zone was unlisted or missing is standing on the idealised sky by default rather than by
   * anyone's choice, so it stays null and is offered the control once.
   *
   * Stamping unconditionally would be the easy mistake: it would mark every camp placed
   * including the ones that were not, and close the only door out of the default.
   */
  const placedAt = noon === null ? null : new Date(now);

  const { rows: settlements } = await client.query(
    `insert into settlements (player_id, name, founded_at, last_tick_at,
                              clock_offset_minutes, solar_noon_minutes, clock_changed_at)
     values ($1, $2, $3, $3, $4, coalesce($5, 720), $6) returning id`,
    // The camp's own hour, so dark outside and dark in the game are the same dark. Taken
    // from the browser that founded it and defaulted to Greenwich, which is what every
    // camp founded before migration 015 has.
    [playerId, camp, new Date(now), offset, noon, placedAt],
  );
  const settlementId = settlements[0].id;

  await writeStructures(client, settlementId, STARTING_STRUCTURES);

  const cap = storageCap(STARTING_STRUCTURES);
  for (const [kind, amount] of Object.entries(STARTING_AMOUNTS)) {
    await client.query(
      'insert into resources (settlement_id, kind, amount, storage_cap) values ($1, $2, $3, $4)',
      [settlementId, kind, Math.min(amount, cap), cap],
    );
  }

  return { playerId, settlementId };
}

/**
 * The camp outlives its people: a new survivor takes over a settlement that has been
 * knocked back rather than erased.
 *
 * Requires that nobody is currently alive there — the partial unique index would
 * refuse the insert anyway, but failing early gives a message instead of a 23505.
 */
export async function raiseSuccessor(client, settlementId, { now = Date.now() } = {}) {
  await client.query('select id from settlements where id = $1 for update', [settlementId]);

  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  if (living.length > 0) {
    throw new InputError('Someone is already holding this camp.');
  }

  // Nobody has held this camp before, so there is nothing to inherit and nothing to
  // have gone to ruin: this is the founder walking in, not a successor picking
  // through what is left. You cannot inherit a ruin from nobody.
  const { rows: predecessors } = await client.query(
    'select 1 from characters where settlement_id = $1 limit 1',
    [settlementId],
  );
  const inherits = predecessors.length > 0;

  const { rows: structures } = await client.query(
    'select kind, level from camp_structures where settlement_id = $1',
    [settlementId],
  );
  const reduced = structures.map((s) => ({
    kind: s.kind,
    level: inherits ? Math.max(0, s.level - SUCCESSOR_STRUCTURE_LOSS) : s.level,
  }));

  if (inherits) {
    await writeStructures(client, settlementId, reduced);
    await shedUnsupportedUpgrades(client, settlementId, reduced);

    // Factions dealt with the camp, but the new face at the gate is not the one they
    // trusted — or the one they cursed. Standing halves toward neutral either way,
    // the same shape as the structure knock, and it cuts grudges as well as
    // friendships: a successor is a chance to change sides.
    await client.query(
      'update faction_standing set standing = standing * 0.5 where settlement_id = $1',
      [settlementId],
    );
  }

  // Smaller shelter, smaller stores. Clamping to the new cap is not cosmetic: the
  // resources_within_cap constraint would reject the row otherwise, and a settlement
  // that shrank while full is the ordinary case rather than an edge one.
  const cap = storageCap(reduced);
  await client.query(
    `update resources
        set storage_cap = $2,
            amount = least(amount * $3, $2)
      where settlement_id = $1`,
    [settlementId, cap, inherits ? SUCCESSOR_SALVAGE : 1],
  );

  // Start the clock now so the incoming survivor is not retroactively starved across
  // however long the camp stood empty.
  await client.query('update settlements set last_tick_at = $2 where id = $1', [
    settlementId,
    new Date(now),
  ]);

  /**
   * Who walks in, and it is not up to anybody.
   *
   * Derived from the camp's own seed and the number of people who have held it before —
   * `caravan_seed` rather than a new column, because it is already a per-camp constant
   * that exists for exactly this kind of question and a second one would be a migration
   * to store the same fact twice. The count includes the dead, so a camp on its fourth
   * survivor meets its fourth wanderer.
   *
   * **The player is not offered a choice and cannot refresh for a better one.** That is
   * the whole design: someone arrives, the place is empty, and they stay. A name box
   * made every survivor the same person with different spelling; a picker would make
   * them a stat block with a paragraph attached. See `src/game/wanderers.js`.
   */
  const { rows: [camp] } = await client.query(
    'select caravan_seed from settlements where id = $1',
    [settlementId],
  );
  const { rows: [held] } = await client.query(
    'select count(*)::int as n from characters where settlement_id = $1',
    [settlementId],
  );
  const wanderer = wandererFor(camp.caravan_seed, held.n);

  const characterId = await insertSurvivor(client, settlementId, wanderer, now);
  return { characterId, wanderer };
}

/**
 * Drop any fuel upgrade whose structure no longer holds it up.
 *
 * "An upgrade needs its structure at level N" was already the rule at the moment of
 * fitting; this makes it true at every moment instead. A purifier knocked from 2 to
 * 1 cannot carry filtration, and the fuel has to be found again — out there, which is
 * the only place fuel comes from.
 *
 * The consequence is deliberate and is the interesting part: a structure built one
 * level *past* its upgrade's requirement survives a death with the upgrade intact.
 * Overbuilding is insurance, which is a decision worth having.
 *
 * A fitting still in progress is shed on the same rule. The camp fell apart around
 * the crew; the half-mounted rig comes off with it.
 */
async function shedUnsupportedUpgrades(client, settlementId, structures) {
  const levels = new Map(structures.map((s) => [s.kind, s.level]));

  const { rows } = await client.query(
    'select upgrade from structure_upgrades where settlement_id = $1',
    [settlementId],
  );

  for (const { upgrade } of rows) {
    const spec = UPGRADES[upgrade];
    // An upgrade the code no longer defines is left alone rather than silently
    // deleted: that is a content change, and losing a player's fuel to one is rude.
    if (!spec) continue;
    if ((levels.get(spec.kind) ?? 0) >= spec.requiresLevel) continue;

    await client.query(
      'delete from structure_upgrades where settlement_id = $1 and upgrade = $2',
      [settlementId, upgrade],
    );
  }
}

async function writeStructures(client, settlementId, structures) {
  for (const { kind, level } of structures) {
    await client.query(
      `insert into camp_structures (settlement_id, kind, level) values ($1, $2, $3)
       on conflict (settlement_id, kind) do update set level = excluded.level`,
      [settlementId, kind, level],
    );
  }
}

/** Camp names are still the player's; survivors are not. */
function cleanName(value, fallback) {
  const name = String(value ?? '').trim().slice(0, 40);
  return name.length > 0 ? name : fallback;
}

/**
 * Put a person in a camp. Shared by succession and by joining, because the two differ in
 * everything that happens *around* the arrival and in nothing about the arrival itself.
 */
export async function insertSurvivor(client, settlementId, wanderer, now) {
  const { rows } = await client.query(
    `insert into characters (settlement_id, name, born_at, skill_scavenging, skill_medicine)
     values ($1, $2, $3, $4, $5) returning id`,
    [settlementId, wanderer.name, new Date(now), wanderer.scavenging, wanderer.medicine],
  );
  return rows[0].id;
}
