import { makeRandom } from './random.js';
import { FACTIONS } from './factions.js';
import { WORLD_EPOCH } from './world-events.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * How the crews stand with each other, which is a different question from how they stand
 * with you.
 *
 * Phase 17b. `faction_standing` has always answered "what do they think of this camp"; this
 * answers "what do they think of each other", and the two are deliberately separate mechanisms
 * because they are separate *kinds* of fact. Your standing is something you did. **This is
 * weather.**
 *
 * That is not a metaphor, it is the implementation: `world_events` is the one table in this
 * schema with no `settlement_id`, on the stated grounds that "every camp is under the same
 * sky, which is what makes an event something that happened to the world rather than something
 * that happened to you." Two crews falling out is exactly that kind of fact, so it is derived
 * from the same fixed world seed and every camp reads the same answer.
 *
 * ## Derived from the era, never folded from the epoch
 *
 * The obvious shape for a relationship is a walk: start at neutral and step warmer or colder
 * each time something happens. **It is the wrong shape here, and the reason is in the history
 * of `ensureWorldEvents`.** A walk means slot n cannot be computed without slot n-1, so asking
 * what two crews think of each other in the year 2287 means folding twenty-four thousand
 * events -- and `test/db/world.test.js` simulates exactly that year. The weather layer already
 * paid for this lesson once, in a hundred and fifty seconds of test time.
 *
 * So a relation is a **moving average of three draws**, one per era, and it is O(1) at any
 * instant however old the world is. That also buys the property the walk was wanted for: each
 * step replaces one of the three terms, so the value moves by at most a third of its range and
 * two crews cannot go from hostile to working together in one season. The wander is bounded by
 * construction rather than by a rule somebody has to remember.
 *
 * ## Nothing is stored, and that is a trade rather than a win
 *
 * The weather has a table because retuning `share` after a slot was shown to somebody would
 * make the page contradict a line the player has already read; migration `014` keeps written
 * slots and lets only unwritten ones follow the new content. **The same exposure exists here**
 * -- retuning the shares below would rewrite which season two crews fell out in. It is accepted
 * for now because nothing has ever been written from this file, so there is nothing yet to
 * contradict. The lever, if that changes, is `008`'s exact pattern: a slot table for which this
 * function is the generator.
 */

/** Cold to warm, and the order is load-bearing: a state's index *is* its temperature. */
export const STATES = ['hostile', 'tense', 'neutral', 'trading', 'working'];

/**
 * What each state is, and how much of the world's time it should take up.
 *
 * `share` rather than a threshold, for the reason `WORLD_EVENTS` learned the hard way:
 * thresholds are numbers nobody can check by reading, and the consequence of getting them
 * wrong is invisible. Intent is declared here and the cut points are derived from it -- see
 * `THRESHOLDS` -- so "the crews are at each other's throats a twelfth of the time" becomes a
 * sentence somebody can disagree with.
 *
 * Neutral is the biggest because neutral is what two crews who need each other mostly are.
 * The ends are narrow because a world permanently at war is a setting, not an event.
 */
export const RELATIONS = {
  hostile: {
    name: 'Hostile',
    /* What it reads as on a page, in the third person the world uses for the crews. */
    says: 'are taking each other’s people',
    share: 8,
  },
  tense: { name: 'Tense', says: 'are not speaking', share: 17 },
  neutral: { name: 'Neutral', says: 'keep out of each other’s way', share: 50 },
  trading: { name: 'Trading', says: 'are trading', share: 17 },
  working: { name: 'Working together', says: 'are working the same roads', share: 8 },
};

/**
 * How long a season of diplomacy is: four weeks.
 *
 * **Priced against a measured figure rather than picked.** `tools/caravan-reach.mjs` puts the
 * mean wait for any particular crew at 8.2 days, and a relation that turns over faster than a
 * camp can get to a caravan is a relation nobody can ever act on. Four weeks is two or three
 * chances to meet each crew inside one state, which is the least that makes it a thing to play
 * against rather than a thing to read about.
 *
 * It is also what makes the overhaul's "major diplomatic choices should be rare" true by
 * arithmetic rather than by restraint: three pairs, each changing state well under once an
 * era, is roughly one piece of news a fortnight in the whole world.
 */
export const ERA_HOURS = 28 * 24;

/** The era covering an instant. Anything before the world began is era zero. */
export function eraAt(at) {
  return Math.max(0, Math.floor((Number(at) - WORLD_EPOCH) / (ERA_HOURS * HOUR_MS)));
}

/** Every unordered pair of crews, in a stable order derived from the declaration order. */
export const PAIRS = (() => {
  const slugs = Object.keys(FACTIONS);
  const pairs = [];
  for (let i = 0; i < slugs.length; i += 1) {
    for (let j = i + 1; j < slugs.length; j += 1) pairs.push([slugs[i], slugs[j]]);
  }
  return pairs;
})();

/**
 * A pair's name, order-free, so (a, b) and (b, a) are one relationship.
 *
 * Sorted rather than declaration-ordered here on purpose: this string is what seeds the draw,
 * and a key that depended on the order of `FACTIONS` would re-roll every relationship in
 * history the day somebody rearranged that object.
 */
export function pairKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

/** A stable number in [0, 1) for one pair in one era. */
function noise(seed, key, era) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return makeRandom(Number(seed) + Math.abs(hash) * 104729 + era * 7907)();
}

/** The terms in the average. Three: the fewest that bounds a step below one whole state. */
const TERMS = 3;

/**
 * Where a pair sits on the cold-to-warm line in a given era, as a number in [0, 1).
 *
 * Eras before the world began read as era zero, so the average at the very start is three
 * copies of one draw rather than an undefined reach backwards. That makes the first season
 * more extreme than later ones by construction, which is fine and is the only place the
 * arithmetic is visible.
 */
export function temperatureOf(seed, a, b, era) {
  const key = pairKey(a, b);
  let sum = 0;
  for (let i = 0; i < TERMS; i += 1) sum += noise(seed, key, Math.max(0, era - i));
  return sum / TERMS;
}

/**
 * The cut points between the five states, derived from their shares.
 *
 * The value being cut is the mean of three uniforms, whose distribution is emphatically not
 * uniform -- it piles up around a half -- so equal shares would *not* mean equally spaced
 * thresholds, and thresholds that look evenly spread would not mean the shares they look like.
 * The exact distribution is known (Irwin-Hall, for the sum of three), so the cut points are its
 * quantiles, found by bisection once at load. A dozen lines to never have to trust a guess.
 */
const THRESHOLDS = (() => {
  /* P(sum of three uniforms <= x), exact. */
  const cdfSum = (x) => {
    if (x <= 0) return 0;
    if (x >= TERMS) return 1;
    let total = 0;
    for (let k = 0; k <= Math.floor(x); k += 1) {
      const choose = k === 0 ? 1 : k === 1 ? 3 : k === 2 ? 3 : 1;
      total += (k % 2 === 0 ? 1 : -1) * choose * (x - k) ** 3;
    }
    return total / 6;
  };
  const cdf = (t) => cdfSum(t * TERMS);

  const total = STATES.reduce((sum, state) => sum + RELATIONS[state].share, 0);
  const cuts = [];
  let below = 0;
  for (const state of STATES.slice(0, -1)) {
    below += RELATIONS[state].share / total;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 60; i += 1) {
      const mid = (lo + hi) / 2;
      if (cdf(mid) < below) lo = mid;
      else hi = mid;
    }
    cuts.push((lo + hi) / 2);
  }
  return cuts;
})();

/** The state a temperature falls in. */
export function stateOf(temperature) {
  for (let i = 0; i < THRESHOLDS.length; i += 1) {
    if (temperature < THRESHOLDS[i]) return STATES[i];
  }
  return STATES[STATES.length - 1];
}

/** How two crews stand at an instant. */
export function relationAt(seed, a, b, at) {
  return stateOf(temperatureOf(seed, a, b, eraAt(at)));
}

/** Every pair at an instant, which is the whole of the world's politics in three rows. */
export function relationsAt(seed, at) {
  const era = eraAt(at);
  return PAIRS.map(([a, b]) => ({
    a,
    b,
    state: stateOf(temperatureOf(seed, a, b, era)),
  }));
}

/**
 * What a pair's relation is worth as a number, for anything that wants to scale by it.
 *
 * Neutral is zero and the ends are plus or minus two. What those numbers buy is 17c's business
 * rather than this file's; the mapping from a word to a number is here because it should exist
 * once.
 */
export function warmthOf(state) {
  return STATES.indexOf(state) - STATES.indexOf('neutral');
}

/**
 * Why it changed, which is the whole of the overhaul doc's requirement for this.
 *
 * "Relations change through visible world events rather than unexplained background
 * randomness... Each event should appear in the camp log or road reports so the player
 * understands why the world changed." A state that moves with no sentence attached is a
 * hidden slider, and a hidden slider is the thing this phase exists not to be.
 *
 * Keyed on the state being *entered* rather than on the direction alone, because the two ends
 * are different news: falling out of neutral is an incident, and falling out of trading is an
 * arrangement lapsing. Neutral is the one state that needs both, since it is arrived at from
 * either side.
 *
 * Written to the lore's own checklist: no proper nouns from before, no numbers with authority,
 * nobody evil. A crew takes a caravan for the same reason a camp scavenges a city.
 *
 * And none of them may restate its own state, which is not a style note: the log line is
 * `says` and then the cause, so a cause echoing the phrase in front of it reads as the page
 * stuttering. Two did, and both were rewritten after being read aloud rather than after being
 * reasoned about — "keep out of each other's way. The taking has stopped. They are keeping out
 * of each other's way instead."
 */
const CAUSES = {
  hostile: [
    'A caravan was taken on the service road. Both of them say it was the other.',
    'Somebody was held over a debt, and somebody else was held over that.',
    'One of them has stopped pretending the road is anybody else’s.',
  ],
  tense: [
    'A road was closed to one of them. Nobody has said which road.',
    'An accusation about who is sheltering whose raiders, and no answer to it.',
    'A shipment went short, and the short end was nobody’s fault twice over.',
  ],
  /* Arrived at from either side, so it is two lists rather than one. */
  neutral_cooling: [
    'The arrangement lapsed. Neither of them moved to renew it.',
    'What they were doing together stopped, quietly, before the season did.',
    'The joint stretch of road is being walked separately again.',
  ],
  neutral_warming: [
    'Whatever it was, it has stopped. Nobody is saying it is settled.',
    'The taking has stopped. Nobody has said what was given up for it.',
    'A truce nobody signed, and both of them are keeping it.',
  ],
  trading: [
    'Supplies changed hands after a bad season, and the terms held.',
    'A road was reopened to them, and the first three wagons came back.',
    'Somebody needed something badly enough to pay for it rather than take it.',
  ],
  working: [
    'Neither of them is being shot at on the far stretch any more.',
    'A stretch nobody could hold alone is being held by both.',
    'Whatever came out of the Deep Zone last season, it came for both of them.',
  ],
};

function causeFor(seed, a, b, era, before, after) {
  const warmer = STATES.indexOf(after) > STATES.indexOf(before);
  const key =
    after !== 'neutral' ? after : warmer ? 'neutral_warming' : 'neutral_cooling';
  const lines = CAUSES[key];
  const roll = noise(seed, `${pairKey(a, b)}#why`, era);
  return lines[Math.floor(roll * lines.length) % lines.length];
}

/**
 * Every change of state in `[from, to)`, which is what a tick turns into log lines.
 *
 * Walks era boundaries inside the window and nothing else, so a camp resolving a six-week
 * absence pays for six weeks rather than for the age of the world — the property the whole
 * moving-average shape was chosen to keep.
 *
 * Era zero has no era before it and therefore no change to report: the world does not open
 * with three crews having just fallen out.
 */
export function changesBetween(seed, from, to) {
  const changes = [];
  const first = Math.max(1, eraAt(from));
  const last = eraAt(to);

  for (let era = first; era <= last; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR_MS;
    if (at <= from || at > to) continue;

    for (const [a, b] of PAIRS) {
      const before = stateOf(temperatureOf(seed, a, b, era - 1));
      const after = stateOf(temperatureOf(seed, a, b, era));
      if (before === after) continue;

      changes.push({
        at,
        a,
        b,
        from: before,
        to: after,
        warmer: STATES.indexOf(after) > STATES.indexOf(before),
        cause: causeFor(seed, a, b, era, before, after),
      });
    }
  }

  return changes;
}
