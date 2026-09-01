import { makeRandom, chance } from './random.js';
import { bestOfKind } from './equipment.js';

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
export const NOT_WORTH_THE_WALK = 6;

/** The most of a store a raid can carry off, before defence is taken into account. */
const MAX_SHARE_TAKEN = 0.35;

/** Defence needed to turn raids away outright reliably, and to blunt what they take. */
const DEFENCE_FOR_REPEL = 40;
const DEFENCE_FOR_SOFTENING = 30;
const MAX_REPEL_CHANCE = 0.75;
const MAX_SOFTENING = 0.7;

/**
 * How long a raid stands open before it settles itself.
 *
 * Phase 12: raiders arrive and the camp is *being raided* until this passes, in which time a
 * player who is there may name who holds the fence. Measured in `tools/raid-window.mjs`
 * rather than picked — four hours is about one raid in three for a twice-a-day player, which
 * is the aim, and the catch rate turns out to depend on the gap between check-ins and not at
 * all on how often raiders come.
 *
 * A third of raids arrive between 23:00 and 07:00 and no sane window reaches them. Settled
 * with the user: raiders keep the small hours. Being raided in the night is the setting
 * working rather than a mechanic failing.
 */
export const RAID_WINDOW_HOURS = 4;

/**
 * What hiding costs, over and above a raid's ordinary share.
 *
 * Deliberately small, and the measurement is why. `tools/raid-absence.mjs`: a week away at
 * +30% costs forty more food against a storage cap of 350, and somebody who hid also dodges
 * an injury of 8 to 30 — so at any factor in this range the absent player is *better off*
 * than under the raid this replaces. The harsher share cannot be what makes standing worth
 * it, and with a four-hour window it is what happens to two raids in three.
 *
 * So it is priced as what it is: **the ordinary cost of a raid nobody answered**, not a
 * penalty for having a life. The weight of the mechanic sits in `standFor` instead.
 */
const HIDDEN_SHARE_BOOST = 1.15;

/** Standing bare-handed is worth something, and not much. */
const BARE_STAND = 0.2;

/** And nothing makes a raid free. */
const MAX_STAND = 0.9;

/**
 * How much of the take one survivor keeps hold of by standing in front of it.
 *
 * **Gear, not a skill, and that was the decision.** `skill_combat` has been on `characters`
 * since migration `001` and has never been written by anything — every survivor in every camp
 * is a 1 — so resting a mechanic on it would have meant inventing the column, revising the
 * wanderer pool and backfilling every existing person before a raid could be measured at all.
 * What somebody is carrying is already a fact, already per-survivor, and already reduced to a
 * number by `equipmentOf`.
 *
 * It is also the better loop. A skill is the luck of who wandered in; a spear is something
 * the player made and gave to somebody. There is no verb for handing an item to another
 * survivor, so **who has the spear is a lasting fact about a person** — one you built rather
 * than rolled.
 *
 *     bare-handed        0.20   saves a fifth, and still takes the injury
 *     scrap spear (25)   0.45   roughly halves the take
 *     a better weapon     ->    up to 0.9
 *
 * Potency reads as a percentage, which is the same scale `equipmentOf` already uses for
 * hazard avoidance — no second meaning for the number. **The top of that range is not
 * reachable today**: the only weapon in the game is the spear at 25. Fending a raid off
 * outright is designed and waits on content, which is the honest way round — better than
 * inflating the one item that exists until it carries the whole mechanic.
 *
 * `stand` does *not* reduce the damage the defender takes. If one number did both, the
 * best-equipped survivor would simply always stand and there would be no question left; kept
 * apart, the call weighs what you save against who can afford to be hurt.
 */
export function standFor(defender) {
  if (!defender) return 0;
  const weapon = bestOfKind(defender.inventory, 'weapon');
  const potency = Math.max(0, Number(weapon?.potency) || 0);
  return Math.min(MAX_STAND, BARE_STAND + potency / 100);
}

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
 * @param {number} [tempo] standing's stretch on the gap — `raidTempo`, 1 when neutral
 */
export function nextRaidAt(since, wealth, seed, index, tempo = 1) {
  const random = makeRandom(Number(seed) + index * 7919);

  // Richer camps are visited more often, down to a floor: even a hoard gets time to
  // breathe, or a successful player would be under permanent siege. Standing then
  // stretches or compresses the gap — a friendly crew finds reasons not to come —
  // and the floor is applied last, so no hostility makes raids continuous.
  const mean = Math.max(
    FASTEST_INTERVAL_HOURS,
    (SLOWEST_INTERVAL_HOURS / (1 + Math.max(0, wealth) / 10)) * tempo,
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
 * @param {string} [args.crew]  who these raiders answer to, for the log
 * @param {{repelBonus: number, softening: number, shareBoost: number}} [args.temper]
 *        standing's effect — `raidTemper`, neutral when omitted
 */
/**
 * How often raiders come as far as the fence and think better of it.
 *
 * Exported because the camp page has to answer "is the tower worth another level"
 * with the same number the raid itself will roll against. A second copy of
 * `defence / 40` living in the advice would drift the first time this is tuned, and
 * would drift silently — the page would promise a figure raids no longer use.
 */
export function repelChance(defence, bonus = 0) {
  return Math.min(MAX_REPEL_CHANCE, Math.max(0, Number(defence) || 0) / DEFENCE_FOR_REPEL + bonus);
}

export function resolveRaid({
  wealth,
  defence,
  resources,
  survivor,
  stood = 0,
  engaged = false,
  seed,
  crew,
  temper,
}) {
  const random = makeRandom(seed);
  const log = [];
  const who = crew ? `Raiders out of ${crew}` : 'Raiders';
  const t = { repelBonus: 0, softening: 0, shareBoost: 1, ...temper };

  /*
   * A tower does not merely soften a raid; often enough it means there is no raid. This is
   * the watchtower's whole job — and a friendly crew finds its own reasons to think better of
   * it, which is standing doing the same job for free.
   *
   * `engaged` is for the caller that has already asked this question. Once a raid opens a
   * window the player is looking at, it cannot turn out afterwards to have never happened:
   * they would have been asked who stands in front of nothing. So the tick rolls the repel
   * when the raid arrives, on a stream of its own, and says so here.
   */
  if (!engaged && chance(random, repelChance(defence, t.repelBonus))) {
    log.push(`${who} came as far as the fence, thought better of it, and moved on.`);
    return { repelled: true, taken: {}, damage: 0, log };
  }

  if (wealth < NOT_WORTH_THE_WALK) {
    log.push(`${who} picked over the camp, found nothing worth carrying, and left.`);
    return { repelled: false, taken: {}, damage: 0, log };
  }

  const softening = Math.min(
    MAX_SOFTENING,
    Math.max(0, defence) / DEFENCE_FOR_SOFTENING + t.softening,
  );

  /*
   * Two gates, and they answer different questions, which is what keeps both worth having.
   *
   * The watchtower decided whether they came at all, above. This is what they leave with, and
   * it is the half the player has a hand in: somebody stood, or nobody did.
   *
   * `stand` is what the defender's gear holds on to — see `standFor`. Nobody standing is not
   * merely the absence of that; hiding costs a little extra on top, which is the user's call
   * and is priced as the ordinary outcome rather than as a punishment. See
   * `HIDDEN_SHARE_BOOST`.
   */
  const stand = survivor ? Math.min(MAX_STAND, Math.max(0, Number(stood) || 0)) : 0;
  const answered = survivor ? 1 - stand : HIDDEN_SHARE_BOOST;

  // Hostility widens what they carry off, capped so no grudge takes everything.
  const share = Math.min(0.5, MAX_SHARE_TAKEN * (1 - softening) * t.shareBoost * answered);

  const taken = {};
  for (const [kind, resource] of Object.entries(resources ?? {})) {
    const held = Number(resource?.amount) || 0;
    const amount = Math.floor(held * share * (0.5 + random()));
    if (amount > 0) taken[kind] = amount;
  }

  const carried = Object.entries(taken)
    .map(([kind, amount]) => `${amount} ${kind}`)
    .join(', ');
  log.push(carried ? `${who} took ${carried}.` : `${who} found the stores already bare.`);

  /*
   * The injury is the price of standing, and only of standing.
   *
   * It used to land on whoever was alive, which on a roster meant the founder — wounded by a
   * raid they were twenty hours down the road from. Nobody is hurt by a raid they hid from
   * now, which is the trade the whole phase is built on: health for stores, chosen.
   *
   * Still hurt rather than killed. The caller holds them at 1; what happens after is the
   * player's problem to solve, which is the difference between harsh and unfair.
   */
  let damage = 0;
  if (survivor?.alive) {
    damage = Math.round((8 + random() * 22) * (1 - softening));
    const name = survivor.name ?? 'Whoever was holding the camp';
    if (damage > 0) log.push(`${name} came off badly — ${damage} damage.`);
    else log.push(`${name} held the fence and walked away from it.`);
  } else {
    log.push('Nobody stood in their way.');
  }

  return { repelled: false, taken, damage, log };
}
