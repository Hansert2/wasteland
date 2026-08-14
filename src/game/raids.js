import { makeRandom, chance } from './random.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Raiders. The first threat that comes to you rather than being sought out.
 *
 * Pure, like every other outcome in this game: no clock, no database, no global
 * randomness. A raid is rolled from a seed derived from the settlement's own seed and
 * how many raids it has already seen, which means a month-long absence resolves the
 * same sequence of raids however the interval happens to be sliced.
 *
 * The settled rule, from the plan: **a raid steals and wounds and never kills.**
 * Losing a survivor to something you could not have seen while offline is the one
 * death that would feel unfair, and the whole tuning guard exists to keep death the
 * price of neglect rather than of having a life. A raid can leave someone at 1 health
 * with empty stores, and the tick may well finish them off later — but that death is
 * then the player's to prevent.
 */

/** Longest and shortest average gap between visits, in hours. */
const SLOWEST_INTERVAL_HOURS = 240;
const FASTEST_INTERVAL_HOURS = 48;

/** Below this much wealth, raiders have to be lucky to find anything worth carrying. */
const NOT_WORTH_THE_WALK = 6;

/** The most of a store a raid can carry off, before defence is taken into account. */
const MAX_SHARE_TAKEN = 0.35;

/** Defence needed to turn raids away outright reliably, and to blunt what they take. */
const DEFENCE_FOR_REPEL = 40;
const DEFENCE_FOR_SOFTENING = 30;
const MAX_REPEL_CHANCE = 0.75;
const MAX_SOFTENING = 0.7;

/**
 * When the next raid falls due.
 *
 * Decided once, at a fixed point — the moment the previous raid resolved, or the
 * start of the first tick that needs one — rather than recomputed from current
 * wealth as the hours pass. A schedule that drifted with the stores would be a moving
 * target for the tick's slice boundaries, and the result would depend on how the
 * interval was divided, which is the one thing the slice walk exists to prevent.
 *
 * @param {number} since epoch ms to measure from
 * @param {number} wealth `campWealth` at that moment
 */
export function nextRaidAt(since, wealth, seed, index) {
  const random = makeRandom(Number(seed) + index * 7919);

  // Richer camps are visited more often, down to a floor: even a hoard gets time to
  // breathe, or a successful player would be under permanent siege.
  const mean = Math.max(
    FASTEST_INTERVAL_HOURS,
    SLOWEST_INTERVAL_HOURS / (1 + Math.max(0, wealth) / 10),
  );

  // Spread either side of the mean so raids are not metronomic.
  return since + mean * (0.5 + random()) * HOUR_MS;
}

/**
 * What a raid took and what it cost the survivor.
 *
 * @param {object} args
 * @param {number} args.wealth   what the camp looks worth
 * @param {number} args.defence  `campDefence`
 * @param {Record<string, {amount: number}>} args.resources
 * @param {object|null} args.survivor  null when nobody is holding the camp
 * @param {number} args.seed
 */
export function resolveRaid({ wealth, defence, resources, survivor, seed }) {
  const random = makeRandom(seed);
  const log = [];

  // A tower does not merely soften a raid; often enough it means there is no raid.
  // This is the watchtower's whole job, and the reason it stops being decoration.
  const repelChance = Math.min(MAX_REPEL_CHANCE, Math.max(0, defence) / DEFENCE_FOR_REPEL);
  if (chance(random, repelChance)) {
    log.push('Raiders came as far as the fence, thought better of it, and moved on.');
    return { repelled: true, taken: {}, damage: 0, log };
  }

  if (wealth < NOT_WORTH_THE_WALK) {
    log.push('Raiders picked over the camp, found nothing worth carrying, and left.');
    return { repelled: false, taken: {}, damage: 0, log };
  }

  const softening = Math.min(MAX_SOFTENING, Math.max(0, defence) / DEFENCE_FOR_SOFTENING);
  const share = MAX_SHARE_TAKEN * (1 - softening);

  const taken = {};
  for (const [kind, resource] of Object.entries(resources ?? {})) {
    const held = Number(resource?.amount) || 0;
    const amount = Math.floor(held * share * (0.5 + random()));
    if (amount > 0) taken[kind] = amount;
  }

  const carried = Object.entries(taken)
    .map(([kind, amount]) => `${amount} ${kind}`)
    .join(', ');
  log.push(carried ? `Raiders took ${carried}.` : 'Raiders found the stores already bare.');

  let damage = 0;
  if (survivor?.alive) {
    // Hurt, not killed. The tick holds them at 1 health; what happens after is the
    // player's problem to solve, which is the difference between harsh and unfair.
    damage = Math.round((8 + random() * 22) * (1 - softening));
    if (damage > 0) {
      log.push(`Whoever was holding the camp came off badly — ${damage} damage.`);
    }
  } else {
    log.push('There was nobody here to stop them.');
  }

  return { repelled: false, taken, damage, log };
}
