import { makeRandom, mix, intBetween } from './random.js';
import { bestOfKind, equipmentOf } from './equipment.js';
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

/**
 * What the survivor is carrying, and what each half of it is worth here.
 *
 * Both halves, because a hunt is the one place in the game that reads *both*: the weapon
 * decides how alert the animal may be when the strike comes — `toleranceFor`, the call the
 * shot itself resolves with — and the armour decides what it costs when one turns round,
 * capped at sixty percent by `equipmentOf`. Both figures are the arithmetic's own, not a
 * second statement of them.
 */
export function kitOf(survivor) {
  const { weapon, armour, damageMultiplier } = equipmentOf(survivor);
  return {
    weapon: weapon
      ? { name: weapon.name ?? 'a weapon', allows: toleranceFor(survivor) }
      : null,
    armour: armour
      ? { name: armour.name ?? 'armour', cuts: Math.round((1 - damageMultiplier) * 100) }
      : null,
  };
}

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
 * **`focus` is where the animal actually is in its plate**, as a percentage across and down.
 * The board zooms the photograph about that point as the ground closes, so closing the
 * distance moves the camera rather than a marker — and a focal point that is merely "the
 * middle" would walk the animal out of frame at the far end of the zoom. Read off the three
 * 1200x400 plates in `public/img/`; if a plate is ever regenerated, this moves with it.
 *
 * **The meat figures are derived, not chosen, and they have been re-derived twice.** `STAMINA`
 * is 25 points and the plan's measured figure is that a full gauge costs the camp 50 food, so
 * a hunt has spent about 12.5 food in recovery before it pays anything. These are set so that
 * *expected* food across every outcome lands near that — and the bar moved when the dice came
 * out on 2026-09-13.
 *
 * Under the roll, a good player took 58% and the yields were raised to suit. Deterministic,
 * a player reading the board takes 66% and a perfect line takes 89%, which put the same
 * figures at 13.2 and about 17.8 against the 12.5 they cost: **a food printer for anybody who
 * got good at it**, which is precisely what a reverse arrow must never become. Cut by about a
 * third, so that a *perfect* line breaks even and everybody else is paying for the materials.
 * Skill buys hide and sinew, not a larder.
 */
export const QUARRY = {
  hare: {
    name: 'a hare',
    plain: 'hare',
    focus: { x: 70, y: 44 },
    danger: 0,
    wary: 2,
    meat: 4,
    hide: 1,
    sinew: 0,
    sighted:
      'Something moves in the scrub at the edge of the cleared ground, and stops when the survivor does.',
  },
  deer: {
    name: 'a thin deer',
    plain: 'deer',
    focus: { x: 52, y: 50 },
    danger: 1,
    wary: 3,
    meat: 15,
    hide: 2,
    sinew: 1,
    sighted:
      'It is standing in the open with its head down, and it has not seen anybody yet. There is not much on it, and there is more on it than there is in the larder.',
  },
  boar: {
    name: 'a boar',
    plain: 'boar',
    focus: { x: 74, y: 46 },
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
    meat: 24,
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

/**
 * A hunt as it begins — and the seed's whole job is here, in the deal.
 *
 * **Which animal, which way the wind is, and where its attention has got to.** After this the
 * seed decides nothing: every press resolves from the rules and the state in front of the
 * player. That is the trade this phase was rebuilt on 2026-09-13 to make — a situation you are
 * dealt and then play, rather than a wager you place and then watch.
 */
export function startOf(seed) {
  const random = makeRandom(mix(seed, 'deal'));
  return {
    quarry: quarryFor(seed),
    wind: WINDS[Math.floor(random() * WINDS.length)],
    beat: Math.floor(random() * BEATS.length),
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
 * Where the animal's attention is, on a cycle the player can read.
 *
 * Three beats, advancing one a turn whatever anybody does. **The board shows this beat and the
 * next**, which is the whole of what makes the hunt a puzzle rather than a wager: closing while
 * it feeds is free, while its head comes up costs one, while it is watching costs two, and the
 * cheap moment comes round on a schedule you can count.
 *
 * Advancing on every press — including `still` — is what puts the two halves of the decision in
 * tension. Waiting for a feeding beat is how you close for nothing; waiting is also how you run
 * out of presses.
 */
export const BEATS = ['feeding', 'lifting', 'watching'];

/** What closing costs at each beat, before the wind. */
const BEAT_COST = { feeding: 0, lifting: 1, watching: 2 };

/**
 * The wind, dealt by the seed and fixed for the hunt.
 *
 * The second readable fact, and the one that makes two hunts on the same beats play
 * differently: it shifts every closing cost by one either way. Behind them, a lifting head is
 * still free; into their faces, even a feeding animal notices.
 */
export const WINDS = ['behind', 'across', 'ahead'];
const WIND_SHIFT = { behind: -1, across: 0, ahead: 1 };

/**
 * How much of the animal's attention a strike can survive, by what is in their hands.
 *
 * **This is what replaced the dice, and it is the whole reason the weapon matters.** A strike
 * no longer rolls: it lands when they are close enough and the animal is no more alert than
 * the weapon allows. So a bow does not make you luckier, it buys you *slack* — two points of
 * attention you are allowed to have spent getting there — and slack is a thing a player can
 * plan around where a percentage is a thing they can only hope about.
 *
 * A point of tolerance per fifteen of potency: bare hands 0, the scrap spear 1, the bow 2.
 */
export function toleranceFor(survivor) {
  const weapon = bestOfKind(survivor?.inventory, 'weapon');
  return Math.min(BOLTS_AT, Math.floor(Math.max(0, Number(weapon?.potency) || 0) / 15));
}

/** What closing would cost right now, in the animal's attention. */
export function alarmCostOf(state) {
  const beat = BEATS[state.beat % BEATS.length];
  return Math.max(0, BEAT_COST[beat] + WIND_SHIFT[state.wind ?? 'across']);
}

/**
 * Whether a strike would land, and why — the figure the board is built around.
 *
 * Deterministic, and stated rather than rolled, which is the point: a player who can see
 * "clean" and "it moves first" is a player deciding, where one who sees 57% is a player
 * gambling. Everything that used to be hidden in the roll is now a number they can act on.
 */
export function shotOf(state, survivor) {
  const tolerance = toleranceFor(survivor);
  const reach = state.closeness >= WITHIN_REACH;
  const calm = state.alarm <= tolerance;

  return {
    lands: reach && calm,
    tolerance,
    alarm: state.alarm,
    /* One reason, and the nearest one: what to fix first. */
    why: reach ? (calm ? 'clean' : 'too alert') : 'too far',
    /* And what it would take, so the next press is obvious rather than deduced. */
    shortBy: reach ? Math.max(0, state.alarm - tolerance) : WITHIN_REACH - state.closeness,
  };
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
  /*
   * The survivor's own name, in every line they are the subject of.
   *
   * It was "They" throughout, which on a camp of four is a pronoun with four possible
   * referents on one page — and the block above it names whoever is out. A caller with no name
   * falls back to the pronoun rather than to a blank.
   */
  const who = survivor?.name ?? 'They';
  const random = makeRandom(mix(seed, `hunt${state.turn}`));
  const next = { ...state, turn: state.turn + 1, log: [] };

  // Whether this turn is *allowed* to be lethal, read before anything moves. Set at the end of
  // the last turn, so the screen that offered this move is the screen that carried the warning.
  const lethal = state.turning;

  if (move === 'leave') {
    next.status = 'left';
    next.log.push(`${who} backed off. Nothing gained, and nobody hurt.`);
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
    /*
     * And what they are wearing is worth something, which it was not until 2026-09-13.
     *
     * `rollHazard` has run a region's damage through `equipmentOf`'s `damageMultiplier` since
     * gear existed. This did not, so a plate vest was worth thirty percent out on the road and
     * nothing at all against a boar twenty yards from the fence — the same survivor, the same
     * coat, two different games. **The same reader, so there is one arithmetic**: armour is
     * capped at 0.6 there and is capped at 0.6 here because it is the same call.
     */
    const { damageMultiplier } = equipmentOf(survivor);
    const hurt = Math.round(intBetween(random, spec.danger * 3, spec.danger * 9) * damageMultiplier);
    next.damage += hurt;
    next.log.push(`The ${spec.plain} charged ${who}.`);
  }

  if (move === 'strike') {
    /*
     * No roll. It lands when they are close enough and the animal is no more alert than the
     * weapon allows, and the board said so before the press — see `shotOf`.
     *
     * A strike taken outside that is not refused, because there are hunts where it is the last
     * press and a bad shot beats no shot at all. It simply does what everyone could see it
     * would do.
     */
    const shot = shotOf(state, survivor);
    if (shot.lands) {
      next.status = 'taken';
      next.log.push(`${who} took the ${spec.plain}.`);
      // Whatever it did on the way down still happened. A boar taken as it came is the good
      // outcome of a bad turn, and the survivor wears it.
      if (next.damage > state.damage) next.log.push(`It reached ${who} on the way down.`);
      return next;
    }

    next.alarm += 2;
    next.log.push(
      shot.why === 'too far'
        ? `Too far for ${who} to reach it. The try put it on edge — alarm up 2.`
        : `It moved before ${who} did — alarm up 2.`,
    );
    if (spec.danger >= 3) next.turning = true;
  }

  if (move === 'close') {
    // Walking into something already coming at you ends it there: the only press in the game
    // with no upside at all. The damage itself was taken above.
    if (lethal && spec.danger > 0) {
      next.status = 'mauled';
      return next;
    }

    /*
     * What it costs is the beat and the wind, and the player was shown both.
     *
     * This is where the skill went. Closing on a feeding animal with the wind behind is free;
     * closing while it watches, into its face, costs three and ends the hunt. In between is
     * the decision the mode is made of — pay attention now, or spend a press waiting for the
     * cheap moment and risk running out of presses.
     */
    const cost = alarmCostOf(state);
    next.closeness = Math.min(WITHIN_REACH, state.closeness + 1);
    next.alarm += cost;
    next.log.push(
      cost === 0
        ? `${who} closed a few yards. It never lifted its head.`
        : `${who} closed a few yards and it noticed — alarm up ${cost}.`,
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
    next.log.push(`${who} stood still. It settled — alarm down 1.`);
  }

  /*
   * And the animal's attention moves on, whatever anybody did.
   *
   * Every press, including standing still — which is what makes waiting a *cost* rather than a
   * free reset, and what lets a player count the cheap moment toward them.
   */
  next.beat = (state.beat + 1) % BEATS.length;

  /*
   * And what the animal does about it. A quarry at its own wariness starts thinking about
   * leaving; past `BOLTS_AT` it is gone, which ends the hunt with the stamina already spent.
   * The dangerous ones do not leave — they turn — and that is what `turning` is for.
   */
  if (next.alarm >= BOLTS_AT) {
    if (spec.danger >= 3) {
      next.turning = true;
      next.log.push(
        `The ${spec.plain} has turned to face ${who}. It will not run now. Any move but backing ` +
          'off means taking a charge.',
      );
    } else {
      next.status = 'bolted';
      next.log.push(`The ${spec.plain} broke and ran. The hunt is over.`);
      return next;
    }
  }

  if (next.turn >= MAX_TURNS && next.status === 'active') {
    next.status = 'lost';
    next.log.push(`${who} ran out of light. It was gone by then.`);
  }

  return next;
}

/**
 * How far in they are, as the camera sees it.
 *
 * One scale per stop rather than a formula, because these are three framings of a photograph
 * and the middle one has to look like somewhere a person is standing — not like the mean of
 * the other two. The frame's height never changes; only what is inside it does.
 */
const ZOOM = [1, 1.55, 2.3];

/** Where they are standing, in the words the frame uses. */
const STOPS = ['Across the clearing', 'Half the ground', 'Within reach'];

export function cameraFor(state) {
  const spec = QUARRY[state.quarry];
  const step = Math.max(0, Math.min(WITHIN_REACH, Number(state.closeness) || 0));

  /*
   * And the animal drifts toward the middle of the frame as they close.
   *
   * Scaling about the animal keeps it pinned at its own place in the plate — the boar sits at
   * 74% across, so at full zoom it was jammed into the right-hand edge and under the verdict.
   * Which is also wrong about looking at something: the closer you get, the more it is the
   * thing you are looking at. So the frame slides it seven tenths of the way to centre across
   * the two presses. A plate whose animal is already central barely moves.
   */
  const drift = ((50 - spec.focus.x) * 0.7 * step) / WITHIN_REACH;

  return {
    plate: state.quarry,
    focus: spec.focus,
    scale: ZOOM[step] ?? 1,
    shift: Number(drift.toFixed(2)),
    where: STOPS[step] ?? STOPS[0],
    step,
    of: WITHIN_REACH,
  };
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
  if (state.turning) {
    return `The ${spec.plain} has turned to face them — any move but backing off takes a charge.`;
  }
  if (state.closeness >= WITHIN_REACH) return `Close enough to the ${spec.plain} to try.`;
  if (state.alarm >= spec.wary) return `A ${spec.plain}, and it knows something is wrong.`;
  return `A ${spec.plain}, and it has not noticed them.`;
}
