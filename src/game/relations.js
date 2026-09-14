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

/**
 * ## What the politics actually do — Phase 17c
 *
 * Everything below is a multiplier on a number that already exists, and every one of them is
 * built the same way: **one quantity, three swings.** The quantity is how warm a crew's world
 * is; the swings say how much that is worth to a price, to a raid clock and to a road.
 *
 * The swings are all smaller than what standing already does, and that ordering is the
 * design rather than caution. Standing spans x1.4 to x0.6 on a price because standing is the
 * thing the player *chose*; relations are weather, and weather that out-weighed a decision
 * would make the decision feel unearned. A player should be able to notice the world and
 * still believe their own trading mattered more.
 */

/**
 * How warm a crew's world is: the mean of its relations with everybody else, in [-2, +2].
 *
 * Takes the already-computed rows rather than a seed and an instant, so a page that has
 * worked out the world's politics once does not work them out again per offer — and so this
 * is testable without a clock.
 */
export function warmthAround(relations, slug) {
  const mine = (relations ?? []).filter((row) => row.a === slug || row.b === slug);
  if (mine.length === 0) return 0;
  return mine.reduce((sum, row) => sum + warmthOf(row.state), 0) / mine.length;
}

/** A tenth either way on what a crew charges. */
export const PRICE_SWING = 0.05;

/**
 * What a crew's politics do to its prices: crews at war undercut each other for your custom,
 * crews working together have no reason to.
 *
 * **Competition, not goodwill**, and the direction catches people out until it is said that
 * way round: two crews getting along is bad news at the gate. It is also the only one of the
 * three effects the player can do arithmetic on, which is why it is the one the caravan block
 * prints in full.
 */
export function priceFactor(warmth) {
  return 1 + PRICE_SWING * warmth;
}

/** Fifteen percent either way on the gap between one crew's raids. */
export const TEMPO_SWING = 0.075;

/**
 * What a crew's politics do to how often it comes for you.
 *
 * A crew fighting its neighbours has less to spend on a camp with a garden; a crew at peace
 * with everybody has nothing better to do. **World peace is bad for you**, which is the most
 * useful sentence this mechanic can say: it stops "warm everywhere" from being a strictly
 * better world and makes the Standing block a thing to read rather than a scoreboard.
 *
 * A multiplier on the *gap*, so above one is calmer — the same convention `raidTempo` uses.
 */
export function tempoFactor(warmth) {
  return 1 - TEMPO_SWING * warmth;
}

/** Fifteen percent either way on the odds of trouble on somebody's ground. */
export const ROAD_SWING = 0.075;

/**
 * What a crew's politics do to the roads it holds.
 *
 * Applied to the *odds* of a hazard and never to the damage or to the region's danger rating,
 * which is a deliberate narrowing: `danger` also picks which hazard you met, so nudging it
 * would turn a bad fall into a scavenger ambush and back again as the seasons turned, and a
 * region's character is content rather than weather. Contested ground means you run into
 * trouble more often. It does not mean the floor collapses harder.
 */
export function roadFactor(warmth) {
  return 1 - ROAD_SWING * warmth;
}

/**
 * Who holds which road.
 *
 * The territorial half of the Wellkeepers, promised in 17a and owed here: they are the crew
 * whose ground you walk rather than the crew who walks to you, and this is the only place
 * that is true of anybody.
 *
 * **Three places are held by nobody, and that is the point of the list.** The fence line is
 * yours. The Deep Zone belongs to no one by the oldest rule in `LORE.md` — nobody agrees what
 * is down there, and a crew with a claim on it would be an answer. Coastal Wreckage keeps
 * "whatever lives in them now", which is not a faction. A map carved up three ways would say
 * somebody is in charge, and the lore's position is that nobody is.
 *
 * Read off the lore rather than invented: the Crews hold a junction, so they hold the road,
 * the rooms machines lived in, and the far end that is the reason there is a road. The
 * Provisioners hold what is grown and what was kept in houses. The Wellkeepers hold the wheel,
 * the shafts and the pumps.
 */
export const HOLDINGS = {
  junction_crews: ['the_service_road', 'underground_bunkers', 'harrow_end'],
  green_river: ['irradiated_farmland', 'ruined_city'],
  wellkeepers: ['the_millrace', 'sixteen_wells', 'the_waterworks'],
};

/** Whose ground a place is, or null for the three that are nobody's. */
export function holderOf(slug) {
  for (const [faction, places] of Object.entries(HOLDINGS)) {
    if (places.includes(slug)) return faction;
  }
  return null;
}

/**
 * What the politics are doing to one road at one instant — **one function, because two
 * callers have to agree exactly.**
 *
 * `tick.js` resolves the trip that came home and `view-camp.js` resolves the same trip to
 * report on it while it is still out, and the sky is already composed through a single
 * `travelFactors` for precisely this reason: two call sites that build the same number
 * separately are two call sites that will one day build it differently, and the symptom is a
 * page promising one trip and the log delivering another.
 *
 * Read at the hour the trip **left**, not at the hour it comes back. A survivor walks the road
 * that was there when they set out, and a season turning under them mid-walk would move a
 * number the page had already printed.
 */
export function roadPolitics(seed, slug, at) {
  const holder = holderOf(slug);
  if (!holder) return 1;
  return roadFactor(warmthAround(relationsAt(seed, at), holder));
}

/**
 * The crews falling out over a particular road, or null — Phase 17d.
 *
 * A quarrel is hostile or tense and nothing milder: "not speaking" is the point at which two
 * crews stop sharing a road, and below that there is nothing for a passing survivor to be in
 * the middle of.
 *
 * **The holder is always the first of the pair**, which is what makes the moment on that road
 * legible: you are on somebody's ground, and the other crew is the one who came for them.
 * A road nobody holds has no quarrel by construction, which is the Deep Zone staying nobody's
 * business in one more place.
 *
 * Read at the instant a trip *left*, never at the instant it is being looked at. A season
 * turning mid-walk would otherwise re-roll a trip's whole moment list between two page loads,
 * because eligibility feeds `pickDistinctAxes` — 26 hours against a 28-day season makes that
 * about one trip in twenty-five, which is exactly often enough to be a bug somebody reports
 * and nobody can reproduce.
 */
export function quarrelOver(seed, slug, at) {
  const holder = holderOf(slug);
  if (!holder) return null;

  const rows = relationsAt(seed, at);
  for (const row of rows) {
    if (row.a !== holder && row.b !== holder) continue;
    if (row.state !== 'hostile' && row.state !== 'tense') continue;
    return { holder, other: row.a === holder ? row.b : row.a, state: row.state };
  }
  return null;
}

/**
 * What standing in somebody's quarrel is worth, to both crews at once — Phase 17d.
 *
 * Twenty, against `TRADE_STANDING_GAIN` of six, and the ratio is the design rather than the
 * number: **one press is worth three and a bit caravans in each direction at the same time.**
 * The overhaul asks for diplomatic choices that are rare and consequential and for ordinary
 * trading not to swing the world, and a figure smaller than this would make taking a side
 * another day's trading, while a much larger one would make a single unlucky moment
 * unrecoverable — and `caravan-reach` says buying your way back costs 8.2 days per chance.
 *
 * Symmetric, so siding nets the camp nothing overall and is purely a choice about *who*. That
 * is what stops it being a resource to farm: there is no side of this that is simply better,
 * only a side that suits the camp you are running.
 */
export const SIDING_SWING = 20;
