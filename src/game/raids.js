import { makeRandom } from './random.js';
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

/**
 * What a defender takes for every hour they are at the fence.
 *
 * Derived rather than picked, from the raid this replaced: a single press cost 8 to 30 damage,
 * averaging 19, and a raid lasts `RAID_WINDOW_HOURS`. So five an hour means **standing through
 * a whole raid costs about what standing once used to**, and standing for one hour of it costs
 * a quarter of that. The watchtower's softening applies to it exactly as it did to the hit.
 *
 * Which is what makes pulling somebody out a real decision rather than damage control: an hour
 * at the fence has a price, and you can stop paying it.
 */
export const RAID_DAMAGE_PER_HOUR = 5;

/**
 * What the raiders carry off each hour with nobody in their way.
 *
 * Fixed at the hour they arrive and never recomputed — see migration `023`. The share is the
 * one `resolveRaid` has always used, spread across the window, so **four undefended hours come
 * to exactly what a raid took when it was a single press.** No balance figure moves, and a
 * rate that does not move is the only kind a live counter can honestly extrapolate forward.
 *
 * `HIDDEN_SHARE_BOOST` is folded in here rather than kept as its own idea. Under a raid with a
 * duration, "nobody answered" and "nobody is defending right now" are the same state, so the
 * boost simply is the base rate.
 */
export function drainPerHour({ resources, defence, temper }) {
  const t = { softening: 0, shareBoost: 1, ...temper };
  const softening = Math.min(
    MAX_SOFTENING,
    Math.max(0, Number(defence) || 0) / DEFENCE_FOR_SOFTENING + t.softening,
  );
  const share = Math.min(
    0.5,
    MAX_SHARE_TAKEN * (1 - softening) * t.shareBoost * HIDDEN_SHARE_BOOST,
  );

  const perHour = {};
  for (const [kind, resource] of Object.entries(resources ?? {})) {
    const held = Number(resource?.amount) || 0;
    if (held > 0) perHour[kind] = (held * share) / RAID_WINDOW_HOURS;
  }
  return perHour;
}

/**
 * One slice of a raid: what is carried off, what is kept back, and what it costs to keep it.
 *
 * The whole of the running mechanic, and pure — the tick hands it the hour and the crew and
 * writes down what comes back. Nothing here reads a clock or a database.
 *
 * `prevented` is attributed in proportion to each defender's own share of what the crew held
 * back. With `standTogether` being multiplicative there is no single right answer to "which of
 * the three stopped that sack of grain", and proportional is the one a player can follow: the
 * one with the spear is credited more than the one without, and the parts sum to the whole.
 */
export function raidHour({ perHour, defenders, defence, temper, hours }) {
  const t = { softening: 0, ...temper };
  const softening = Math.min(
    MAX_SOFTENING,
    Math.max(0, Number(defence) || 0) / DEFENCE_FOR_SOFTENING + t.softening,
  );

  const crew = (defenders ?? []).filter((one) => one?.alive);
  const stand = standTogether(crew);
  const span = Math.max(0, Number(hours) || 0);

  const taken = {};
  const kept = {};
  for (const [kind, rate] of Object.entries(perHour ?? {})) {
    taken[kind] = rate * (1 - stand) * span;
    kept[kind] = rate * stand * span;
  }

  const weights = crew.map((one) => standFor(one));
  const total = weights.reduce((sum, one) => sum + one, 0);

  const hurt = crew.map((one, index) => ({
    id: one.id ?? null,
    name: one.name ?? 'Somebody',
    damage: RAID_DAMAGE_PER_HOUR * (1 - softening) * span,
    prevented: Object.fromEntries(
      Object.entries(kept).map(([kind, amount]) => [
        kind,
        total > 0 ? (amount * weights[index]) / total : 0,
      ]),
    ),
  }));

  return { taken, kept, stand, hurt };
}

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
/**
 * What a crew holds back between them.
 *
 * **Everybody who stands, stands** — decided by the user on 2026-09-01 after playing the
 * one-defender version. Phase 12 had left this as the thing it did not decide, on the reading
 * that one survivor stands and the rest are simply not the ones standing. Wrong, and obviously
 * so once the block was on screen with four names on it.
 *
 * `1 - the product of what each fails to hold`, which is the honest model rather than a
 * chosen curve: each of them independently stops some of it, and what gets through is what
 * got past all of them. It can never exceed the whole, and the second body is worth less than
 * the first without any rule saying so.
 *
 *     Vera .45   Hansert .45   Wren .20
 *
 *     Vera alone          45%
 *     Vera + Hansert      70%
 *     all three           76%
 *     Wren + Hansert      56%
 *
 * The alternative was adding them up to a cap, which makes the third body worth nothing and
 * the second worth everything — a cliff at a number nobody can see.
 */
export function standTogether(defenders) {
  let held = 0;
  for (const defender of defenders ?? []) held += standFor(defender) * (1 - held);
  return Math.min(MAX_STAND, held);
}

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
 * Exported because the camp page has to answer "is the tower worth another level" with the
 * same number the raid itself will roll against. A second copy of `defence / 40` living in the
 * advice would drift the first time this is tuned, and would drift silently — the page would
 * promise a figure raids no longer use.
 *
 * Rolled when raiders arrive rather than when a raid settles, since the rework: a raid the
 * player is looking at cannot turn out afterwards never to have happened.
 */
export function repelChance(defence, bonus = 0) {
  return Math.min(MAX_REPEL_CHANCE, Math.max(0, Number(defence) || 0) / DEFENCE_FOR_REPEL + bonus);
}

/*
 * `resolveRaid` lived here until 2026-09-01 and is gone rather than deprecated.
 *
 * It settled a raid in one call: repel, share, damage, log. Every one of those has moved to
 * where it belongs now that a raid has a duration — the repel is rolled when raiders arrive
 * (`openRaid`, on a stream of its own, so a raid the player is looking at cannot turn out
 * never to have happened), the share became `drainPerHour`, and the damage and the log are
 * charged and written by the hour in the walk.
 *
 * Deleted rather than left for the tools, because a function the game no longer calls is a
 * function that drifts from the game and then gets measured as though it had not.
 */

