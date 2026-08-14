import { hashPassword, MIN_PASSWORD_LENGTH } from '../auth/passwords.js';
import { UPGRADES, storageCap } from '../game/structures.js';
import { InputError } from '../errors.js';

export { InputError };

const STARTING_STRUCTURES = [
  { kind: 'shelter', level: 1 },
  { kind: 'garden', level: 1 },
  { kind: 'water_purifier', level: 1 },
  { kind: 'workshop', level: 0 },
  { kind: 'watchtower', level: 0 },
];

const STARTING_AMOUNTS = { food: 40, water: 40, scrap: 10, fuel: 0 };

/** What a new survivor inherits: the camp, minus a bite taken out of it. */
const SUCCESSOR_STRUCTURE_LOSS = 1;
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
export async function foundSettlement(client, { email, password, settlementName, now = Date.now() }) {
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

  const { rows: settlements } = await client.query(
    'insert into settlements (player_id, name, founded_at, last_tick_at) values ($1, $2, $3, $3) returning id',
    [playerId, camp, new Date(now)],
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
export async function raiseSuccessor(client, settlementId, { name, now = Date.now() } = {}) {
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

  const characterId = await insertSurvivor(client, settlementId, cleanName(name, 'Survivor'), now);
  return { characterId };
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

async function insertSurvivor(client, settlementId, name, now) {
  const { rows } = await client.query(
    'insert into characters (settlement_id, name, born_at) values ($1, $2, $3) returning id',
    [settlementId, name, new Date(now)],
  );
  return rows[0].id;
}

function cleanName(value, fallback) {
  const name = String(value ?? '').trim().slice(0, 40);
  return name.length > 0 ? name : fallback;
}
