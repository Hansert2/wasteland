import { makeRandom, mix, intBetween } from './random.js';
import { bestOfKind } from './equipment.js';
import { scavengingMultiplier } from './wanderers.js';

/**
 * The hunt: the one verb in this game that runs the chain backwards.
 *
 * Everything since Phase 10 has been about making one arrow the only way across —
 * `stores -> hunger -> stamina -> work` — and each phase has closed a crossing rather than
 * opened one. **A hunt spends stamina to make stores.** That reversal is the reason it exists
 * and also the whole of its danger: a reverse arrow priced generously is a camp that sleeps,
 * hunts and sleeps for ever, and has solved food.
 *
 * So it is priced at a wash. The plan's measured figure is that a full stamina gauge costs the
 * camp 50 food, which puts a point of stamina at about half a unit — and `STAMINA` below is
 * spent for a yield of about the same. **The meat is not the reward.** It is the reason a
 * *starving* camp hunts, spending tomorrow's working hours to eat tonight, which is a decision
 * the game has never been able to offer. The reward is the hide and the sinew, which nothing
 * else in the game produces.
 *
 * ## What this module is, and is not
 *
 * Pure. A hunt is a function of `(seed, the answers so far)` exactly as a trip is, so it
 * replays identically, cannot be re-rolled by reloading the page, and needs no clock at all.
 * **There is no timer anywhere in it** — that is the user's actual request, and it makes this
 * the only block in the game that does not move on its own.
 *
 * It does not know what an item id is, what a survivor's row looks like, or whether the camp
 * has anywhere to put a hide. Those are the service's, in the same division `moments.js` and
 * `answer-moment.js` already keep.
 *
 * ## Two rules that are not tuning
 *
 * **It may pay no scrap and no fuel.** Fuel for the reason trade may not: it is the one
 * resource nothing in the camp produces, which is what the entire fuel track is priced
 * against. Scrap because the roads are what scrap is for, and the moment a hunt pays any, the
 * Fence Line's 23.5 a survivor-hour decides this design instead of the design deciding it.
 *
 * **Nothing here can kill without a warning turn first.** `turning` is set at the end of a
 * turn and read at the start of the next, so a lethal outcome is always preceded by a screen
 * that says the quarry has stopped backing away and offers leaving. A player who presses on
 * has decided. This is why the walk-away option is a price of the design rather than a
 * courtesy — it is what makes the stake fair.
 */

/** What a hunt costs in a survivor's day, spent when they commit and never refunded. */
export const STAMINA = 25;

/**
 * Alarm at which the quarry breaks and the hunt is over.
 *
 * Three rather than a health bar, because a hunt is a stalk and not a fight: what you are
 * spending is the animal's patience, and what a bad move costs is its attention. A quarry with
 * hit points would have made the weapon a damage number and the whole thing a slower version
 * of the fence.
 */
export const BOLTS_AT = 3;

/** How close is close enough to strike, and the ceiling on closing. */
export const WITHIN_REACH = 2;

/**
 * The hunt ends here whatever happens, and it is a content decision rather than a guard.
 *
 * Five presses is about a minute of a player's attention, which is the length this is trying
 * to be: something to do *now*, between the countdowns. A hunt that could run twenty turns
 * would become the countdown.
 *
 * **Measured at six and lowered.** Closing twice and striking is three turns, so six left
 * three spare and standing still was very nearly free — `tools/hunt-balance.mjs` put the
 * patient line and the greedy line within three points of each other across four thousand
 * hunts, which is a mode with one strategy and a decoration where its decision should be.
 * At five, settling the animal costs the only attempt you had in reserve.
 */
export const MAX_TURNS = 5;

/**
 * Three quarry, and the axis between them is not size — it is what going wrong costs.
 *
 * The hare cannot hurt anybody and is worth almost nothing; the boar can kill a healthy
 * survivor and is worth a day's food and both materials. So *which animal is out there* is the
 * whole of the decision to start, and the seed decides it before the player commits.
 *
 * `meat` is food into the stores. `hide` and `sinew` are the materials, and the reason the
 * bench cares. Both are before skill, which `yieldOf` applies.
 *
 * **The meat figures are derived, not chosen.** `STAMINA` is 25 points and the plan's measured
 * figure is that a full gauge costs the camp 50 food, so a hunt has spent about 12.5 food in
 * recovery before it pays anything — and these are set so that *expected* food across every
 * outcome lands near that for a survivor with a weapon, rather than the successful case doing
 * so. Measured at 6.8 on the first pass and raised by about two thirds: a hunter who fails
 * three times in ten was being priced as though they never failed. Bare-handed still loses,
 * which is the weapon mattering.
 */
export const QUARRY = {
  hare: {
    name: 'a hare',
    danger: 0,
    wary: 2,
    meat: 6,
    hide: 1,
    sinew: 0,
    sighted:
      'Something moves in the scrub at the edge of the cleared ground, and stops when the survivor does.',
  },
  deer: {
    name: 'a thin deer',
    danger: 1,
    wary: 3,
    meat: 22,
    hide: 2,
    sinew: 1,
    sighted:
      'It is standing in the open with its head down, and it has not seen anybody yet. There is not much on it, and there is more on it than there is in the larder.',
  },
  boar: {
    name: 'a boar',
    danger: 4,
    /*
     * As slow to take fright as the deer, and measured that way rather than chosen.
     *
     * It was 1, on the reading that a boar notices you immediately — and that made the best
     * quarry in the game the one nobody could take: the patient line stood still at the first
     * flicker of alarm, never reached striking distance inside five turns, and the greedy line
     * walked into four points of danger. `tools/hunt-balance.mjs` showed the boar taken almost
     * never and mauling almost always, which is not a hard quarry, it is a quarry with no line
     * through it.
     *
     * What makes a boar a boar is `danger`, not `wary`. It does not bolt — nothing above
     * danger 3 does — so alarm on a boar is not fear of losing it. It is the count toward it
     * turning round.
     */
    wary: 3,
    meat: 34,
    hide: 3,
    sinew: 2,
    sighted:
      'It is rooting along the fence line and it has not moved off, which is the part worth noticing. It knows the survivor is there.',
  },
};

/**
 * Which animal, decided by the seed before anybody commits.
 *
 * Weighted toward the middle: the hare is the disappointment, the boar is the one worth the
 * stamina and the one that can kill. A player cannot see which it is until they have paid,
 * which is what makes paying a decision rather than a formality.
 */
export function quarryFor(seed) {
  const random = makeRandom(mix(seed, 'quarry'));
  const roll = random();
  if (roll < 0.3) return 'hare';
  if (roll < 0.75) return 'deer';
  return 'boar';
}

/** A hunt as it begins: nothing spent, nothing known, nobody alarmed. */
export function startOf(seed) {
  return {
    quarry: quarryFor(seed),
    turn: 0,
    closeness: 0,
    alarm: 0,
    turning: false,
    status: 'active',
    damage: 0,
    log: [],
  };
}

/**
 * What the survivor can do about it right now.
 *
 * Derived rather than stored, so a hunt loaded from a row and a hunt in memory offer the same
 * four things. Leaving is on every turn without exception — see the header.
 */
export function movesFor(state) {
  if (state.status !== 'active') return [];

  const moves = [
    {
      key: 'close',
      label: 'Close the distance',
      detail: state.turning ? 'straight at it, with it facing you' : 'quietly, and hope',
    },
    { key: 'still', label: 'Stand still', detail: 'let it settle, and lose the ground' },
  ];

  if (state.closeness >= WITHIN_REACH) {
    moves.push({ key: 'strike', label: 'Take it', detail: 'now, with whatever is in hand' });
  }

  moves.push({ key: 'leave', label: 'Back off', detail: 'nothing, and no holes in you' });
  return moves;
}

/**
 * What the quarry yields, once it is down.
 *
 * `scavengingMultiplier` against `ORDINARY` — the same reader the haul uses, so a good
 * scavenger is up about thirty percent here as they are out there and the economy does not
 * gain a second skill to balance. **The weapon decides whether there is a carcass at all and
 * the skill decides what comes off it**, which is the split settled with the user: both
 * matter, and neither is the combat skill that was measured as scenery.
 */
export function yieldOf(state, survivor) {
  const spec = QUARRY[state.quarry];
  const skill = scavengingMultiplier(survivor?.skillScavenging);
  const scale = (n) => Math.max(n > 0 ? 1 : 0, Math.round(n * skill));

  return { food: scale(spec.meat), raw_hide: scale(spec.hide), sinew: scale(spec.sinew) };
}

/**
 * The chance this strike lands.
 *
 * Closeness is most of it, the weapon is the rest, and alarm is what takes it away. A survivor
 * with nothing in their hands can still take a hare and will lose a boar, which is the mirror
 * of the fence: unarmed is possible and bad.
 */
export function strikeChance(state, survivor) {
  const spec = QUARRY[state.quarry];
  const weapon = bestOfKind(survivor?.inventory, 'weapon');
  const potency = Math.max(0, Number(weapon?.potency) || 0);

  const reach = Math.min(1, state.closeness / WITHIN_REACH);
  const odds = 0.15 + 0.35 * reach + potency / 100 - state.alarm * 0.12 - spec.danger * 0.04;
  return Math.max(0.05, Math.min(0.95, odds));
}

/**
 * One turn. Pure, and the whole of the mechanic.
 *
 * The random stream is per turn — `mix(seed, 'hunt' + turn)` — rather than one generator
 * carried across the hunt, for the reason `EFFECTS_SALT` exists: a hunt reloaded mid-way must
 * draw the same numbers, and a generator whose position depends on how many turns have been
 * taken is a generator the player can shake by refreshing.
 */
export function takeTurn(state, move, { seed, survivor }) {
  if (state.status !== 'active') return state;

  const spec = QUARRY[state.quarry];
  const random = makeRandom(mix(seed, `hunt${state.turn}`));
  const next = { ...state, turn: state.turn + 1, log: [] };

  // Whether this turn is *allowed* to be lethal, read before anything moves. Set at the end of
  // the last turn, so the screen that offered this move is the screen that carried the warning.
  const lethal = state.turning;

  if (move === 'leave') {
    next.status = 'left';
    next.log.push('They backed out of it and came away with nothing, which is a thing you can do.');
    return next;
  }

  /*
   * Something that has turned takes its own turn, and it does so whatever you do except leave.
   *
   * **This was measured as broken, and it is the fault the instrument found.** The mauling
   * used to hang off `close` alone — so a player already within reach never pressed the move
   * that could hurt them, and `tools/hunt-balance.mjs` ran twelve thousand hunts without a
   * single mauling or one point of damage. The boar was the dangerous quarry in the content
   * and the safest thing in the game.
   *
   * So the warning means what it says: once it has turned, every press but one costs blood —
   * striking included, because a miss at that range is the worst place to be standing. Backing
   * off is still free, which is what makes the screen before this a decision rather than an
   * announcement.
   */
  if (lethal && spec.danger > 0 && move !== 'leave') {
    const hurt = intBetween(random, spec.danger * 3, spec.danger * 9);
    next.damage += hurt;
    next.log.push('It came the other way, and it came fast.');
  }

  if (move === 'strike') {
    if (state.closeness < WITHIN_REACH) {
      next.log.push('Too far, and they know it.');
      next.alarm += 1;
    } else if (random() < strikeChance(state, survivor)) {
      next.status = 'taken';
      next.log.push(`They took ${spec.name}.`);
      // Whatever it did on the way down still happened. A boar taken as it came is the good
      // outcome of a bad turn, and the survivor wears it.
      if (next.damage > state.damage) next.log.push('Not before it reached them, though.');
      return next;
    } else {
      next.alarm += 2;
      next.log.push('It moved first.');
      if (spec.danger >= 3) next.turning = true;
    }
  }

  if (move === 'close') {
    /*
     * Pressing in on something that has turned is where the blood is, and it is the only
     * place in the hunt that can take a survivor's life. The damage is drawn against the
     * quarry's danger the way a region's hazard is, and a hare has none of it.
     */
    // Walking into something already coming at you ends it there: the only press in the game
    // with no upside at all. The damage itself was taken above.
    if (lethal && spec.danger > 0) {
      next.status = 'mauled';
      return next;
    }

    /*
     * Closing always costs attention, and that is what makes standing still a move.
     *
     * It was a coin toss, and a coin toss is not a price a player can plan against: half the
     * time closing was free, so the patient line bought nothing it could rely on. Now two
     * closes put any quarry within one of breaking, and whether to spend a turn settling it
     * before striking is the decision the hunt is made of.
     */
    next.closeness = Math.min(WITHIN_REACH, state.closeness + 1);
    next.alarm += 1;
    next.log.push(
      next.closeness >= WITHIN_REACH
        ? 'They are close enough now, and the next thing they do will be the last quiet one.'
        : 'A few yards, slowly.',
    );
  }

  if (move === 'still') {
    // Standing still in front of something that has turned is not settling it. It is standing
    // still in front of something that has turned.
    if (lethal && spec.danger > 0) {
      next.status = 'mauled';
      return next;
    }
    next.alarm = Math.max(0, state.alarm - 1);
    next.log.push('Nothing moves for a while, and it goes back to what it was doing.');
  }

  /*
   * And what the animal does about it. A quarry at its own wariness starts thinking about
   * leaving; past `BOLTS_AT` it is gone, which ends the hunt with the stamina already spent.
   * The dangerous ones do not leave — they turn — and that is what `turning` is for.
   */
  if (next.alarm >= BOLTS_AT) {
    if (spec.danger >= 3) {
      next.turning = true;
      next.log.push('It is not going anywhere. It has turned to face them.');
    } else {
      next.status = 'bolted';
      next.log.push('It broke, and the scrub took it.');
      return next;
    }
  } else if (next.alarm >= spec.wary && !next.turning) {
    next.log.push('Its head is up.');
  }

  if (next.turn >= MAX_TURNS && next.status === 'active') {
    next.status = 'lost';
    next.log.push('The light went, and it was somewhere else by then.');
  }

  return next;
}

/**
 * What the page says about where this stands, in one line.
 *
 * Here rather than in `render.js` because it reads the same state the moves are derived from,
 * and two readers of one state is how a page ends up offering a move it has just said is
 * impossible.
 */
export function saysHunt(state) {
  const spec = QUARRY[state.quarry];
  if (state.status !== 'active') return null;
  if (state.turning) return `${spec.name} has stopped backing away.`;
  if (state.closeness >= WITHIN_REACH) return `Within reach of ${spec.name}.`;
  if (state.alarm >= spec.wary) return `${spec.name}, and it knows something is wrong.`;
  return `${spec.name}, and it has not seen them yet.`;
}
