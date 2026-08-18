/**
 * What an expedition offers the player who is there to answer it.
 *
 * A trip is otherwise a dispatch and a log: everything is decided the instant you click
 * and resolves while nobody is watching. A moment is a window during the trip where,
 * if you happen to be on the page, you get a say.
 *
 * Content, in the `STRUCTURES` and `FACTIONS` pattern — pure data beside pure
 * functions. Deliberately not in `src/db/seed.js`, where recipes and regions live:
 * those are rows other tables join to, and a moment derives from the expedition's seed
 * and is never stored, so it needs no row and no migration.
 *
 * **Everything here draws from `mix(seed, 'moments')` and never from the generator
 * `resolveExpedition` opens.** That is what keeps a trip nobody attends identical to
 * one taken before any of this existed.
 */
import { makeRandom, mix } from './random.js';
import { FACTIONS } from './factions.js';

const FACTION_SLUGS = Object.keys(FACTIONS).sort();

/** The salt. Changing it re-rolls which moments every trip offers; see `mix`. */
export const MOMENTS_SALT = 'moments';

/**
 * A third stream, for what a chosen option *does*.
 *
 * Separate from `MOMENTS_SALT` rather than sharing it: `momentsFor` has already drawn
 * from that one to shuffle and place, so re-opening it for consequences would make an
 * option's find roll the same number as a shuffle draw. Harmless today and the sort of
 * hidden correlation that is miserable to find later.
 */
export const EFFECTS_SALT = 'effects';

/**
 * The six things a moment can be *about*.
 *
 * The rule that makes the content worth reading twice: **no two moments on one trip may
 * key off the same axis.** Encounter content otherwise degenerates — twenty moments get
 * written, they all reduce to press on or hold back, and within three trips the player
 * stops reading and picks the known-best option. Six different questions cannot collapse
 * into one the way six phrasings of the same question can.
 */
export const AXES = ['health', 'radiation', 'time', 'haul', 'supplies', 'standing'];

/** The five regions at four hours and over. The two short ones have no interior. */
export const LONG_REGIONS = [
  'ruined_city',
  'irradiated_farmland',
  'underground_bunkers',
  'coastal_wreckage',
  'the_deep_zone',
];

/**
 * The starter set: one per axis, fully specified, so the shape can be judged before
 * twenty more are written.
 *
 * Every moment has exactly one `default` option, and it must be a no-op — *what the
 * expedition would have done before any of this existed*. Attending may add upside and
 * a risk the player took knowingly; it may never restore a baseline that absence took
 * away. A test pins that.
 *
 * The numbers on the other options are **provisional and unmeasured**. The plan's
 * target is that attending every moment on a trip is worth at most one region step of
 * loot — roughly a third on the mid regions — and that is a figure to be established
 * with `tools/`, over sixty days, in the way filtration was. Nobody should believe
 * these until then.
 */
export const MOMENTS = {
  welded_door: {
    axis: 'time',
    regions: ['underground_bunkers', 'coastal_wreckage'],
    prose: 'A door someone welded shut from the outside. That was a decision, once.',
    options: [
      { key: 'leave', verb: 'default', label: 'Leave it', detail: 'they walk on' },
      {
        key: 'work',
        verb: 'investigate',
        label: 'Work it open',
        detail: 'two hours, and whatever the welder wanted kept in',
        hours: 2,
        findChance: 0.5,
      },
    ],
  },

  wind_turns: {
    axis: 'radiation',
    regions: ['irradiated_farmland', 'the_deep_zone'],
    prose: 'The wind turns and the counter starts clicking. There is a culvert half a mile back.',
    options: [
      { key: 'push', verb: 'default', label: 'Push through', detail: 'take the dose' },
      {
        key: 'wait',
        verb: 'wait',
        label: 'Sit it out',
        detail: 'ninety minutes, and most of the dose',
        hours: 1.5,
        radiationFactor: 0.35,
      },
      {
        key: 'tablets',
        verb: 'spend',
        label: 'Take the tablets',
        detail: 'one dose from the pack, and almost none of it',
        consumes: ['rad_scrubber', 'rad_x'],
        radiationFactor: 0.1,
      },
    ],
  },

  kept_pace: {
    axis: 'health',
    regions: ['the_deep_zone'],
    prose: 'Something has kept pace with them for an hour. It has not closed.',
    options: [
      { key: 'keep', verb: 'default', label: 'Keep moving', detail: 'they walk on' },
      {
        key: 'ground',
        verb: 'wait',
        label: 'Go to ground',
        detail: 'an hour lost, and the trail with it',
        hours: 1,
        lootFactor: 0.85,
        clearsHazard: true,
      },
      {
        key: 'face',
        verb: 'confront',
        label: 'Turn and face it',
        detail: 'settle it now, at whatever health they have',
        hazard: { danger: 5 },
        clearsHazard: true,
        findChance: 0.6,
      },
    ],
  },

  the_container: {
    axis: 'haul',
    regions: ['coastal_wreckage'],
    prose: 'A container split along its seam, and more inside than one person moves.',
    options: [
      { key: 'fits', verb: 'default', label: 'Take what fits', detail: 'they walk on' },
      {
        key: 'overload',
        verb: 'press_on',
        label: 'Overload',
        detail: 'a third again, an hour slower, and clumsy where clumsy costs',
        hours: 1,
        lootFactor: 1.33,
        hazard: { danger: 2 },
      },
    ],
  },

  the_tin: {
    axis: 'supplies',
    regions: LONG_REGIONS,
    prose:
      'They have walked on nothing since dawn. There is a sealed tin in the pack and a long way still to go.',
    options: [
      { key: 'save', verb: 'default', label: 'Save it', detail: 'they walk on' },
      {
        key: 'eat',
        verb: 'spend',
        label: 'Eat it',
        detail: 'one ration, and something back in them for the rest of it',
        consumes: ['preserved_meal', 'tinned_stew'],
        heals: 18,
      },
    ],
  },

  the_fire: {
    axis: 'standing',
    regions: LONG_REGIONS,
    prose:
      'A fire an hour old, still warm, and three sets of boot prints leaving it. The prints are not running.',
    options: [
      { key: 'off', verb: 'default', label: 'Keep off the skyline', detail: 'they walk on' },
      {
        key: 'hail',
        verb: 'parley',
        label: 'Hail them',
        detail: 'whoever they are, and whatever they make of the camp',
        parley: true,
      },
    ],
  },
};

/**
 * Offered at every moment rather than being a moment of its own.
 *
 * That is what makes the mid-trip report load-bearing: you turn back *because* the news
 * was bad, and no encounter ever has to be written to ask whether they should come home.
 * The walk home is what stops it dominating — see `walkHomeHours`.
 */
export const TURN_BACK = {
  key: 'turn_back',
  verb: 'turn_back',
  label: 'Start for home',
  detail: 'bank what they are carrying, and leave the rest',
  turnBack: true,
};

/** None below two hours; one at four to six; two at nine to twelve; three at eighteen. */
export function momentCount(travelHours) {
  const hours = Number(travelHours) || 0;
  if (hours < 2) return 0;
  if (hours < 8) return 1;
  if (hours < 15) return 2;
  return 3;
}

/**
 * How long a window stays answerable.
 *
 * Proportional to the trip rather than fixed, so this never becomes a page you have to
 * sit on. The divisor is the coverage dial: at 1.75 the open windows come to a little
 * under sixty per cent of a trip, which is the point where one check-in usually finds
 * something and catching all of them still takes attention or the radio. Full coverage
 * was refused deliberately — it would make timing worthless, and timing is the only
 * thing the radio sells.
 */
export function windowHours(travelHours, count = momentCount(travelHours)) {
  if (count <= 0) return 0;
  return Math.max(0.75, (Number(travelHours) || 0) / (count * 1.75));
}

/**
 * The walk home, if they turn back at `hours` into a trip of `travelHours`.
 *
 * Without a cost, turning back dominates every trip: the haul curve tapers towards the
 * end, so bailing at four fifths forfeits almost nothing and saves a fifth of the hours.
 * A survivor is treated as being as far from home as the trip's midpoint implies —
 * cheap when they have barely set out, expensive in the middle where they are furthest
 * from anywhere, and worth almost nothing near the end, which is exactly when it should
 * be worth almost nothing.
 */
export function walkHomeHours(hours, travelHours) {
  const total = Number(travelHours) || 0;
  const at = Math.min(total, Math.max(0, Number(hours) || 0));
  return Math.min(at, total - at) * 0.5;
}

/**
 * Which moments a trip offers, and when.
 *
 * Draw order is the derivation and must not be disturbed: the shuffle first, then one
 * placement draw per chosen moment. A draw inserted in the middle re-rolls every trip in
 * flight.
 *
 * Moments are placed in bands across the interior of the trip — never the first or last
 * tenth, so there is always a report worth reading and always enough trip left for the
 * answer to matter — and the placement jitter is bounded by the band minus the window,
 * so two windows can touch but never overlap. That is what makes the coverage figure
 * above true rather than approximate.
 */
export function momentsFor(region, seed) {
  const travelHours = Number(region?.travelHours) || 0;
  const count = momentCount(travelHours);
  if (count === 0) return [];

  const random = makeRandom(mix(seed, MOMENTS_SALT));

  const eligible = Object.keys(MOMENTS)
    .filter((key) => MOMENTS[key].regions.includes(region.slug))
    .sort();

  const chosen = pickDistinctAxes(eligible, count, random);
  if (chosen.length === 0) return [];

  const window = windowHours(travelHours, count);
  const from = travelHours * 0.1;
  const band = (travelHours * 0.8) / count;
  const room = Math.max(0, band - window);

  return chosen.map((key, index) => {
    const centre = from + band * (index + 0.5);
    const atHour = centre + (random() - 0.5) * room;

    // Whose fire it is, for the moments that are about that. Drawn immediately after
    // the placement of the moment it belongs to, so the order stays stated and stable.
    const faction =
      MOMENTS[key].axis === 'standing'
        ? FACTION_SLUGS[Math.floor(random() * FACTION_SLUGS.length)]
        : null;

    return {
      index,
      key,
      axis: MOMENTS[key].axis,
      faction,
      prose: MOMENTS[key].prose,
      // Turning back is assembled in here rather than written into every moment: the
      // content declares what is particular to it, and the trip adds what is always
      // true. It is last because it is the way out, not one of the things on offer.
      options: [...MOMENTS[key].options, TURN_BACK],
      atHour,
      // Half-open, and clamped: a window running past the return is hours in which the
      // trip is already over.
      closesAt: Math.min(travelHours, atHour + window),
    };
  });
}

/** Whether a moment is answerable at a given hour of the trip. */
export function isOpen(moment, hours) {
  return hours >= moment.atHour && hours < moment.closesAt;
}

/**
 * Whether an option has to be shown with a warning.
 *
 * Lethality by disclosure, which needs no threshold constant: **an option whose worst
 * case exceeds the survivor's health at that moment is shown warned, and is never
 * offered without one.** A survivor at full health never sees a warning, because the
 * worst case cannot reach them — the same arithmetic that already makes maximum hazard
 * at danger five 45 against 100 health. "A healthy survivor cannot die on an
 * expedition" survives this phase untouched, and the real risk stays what it has always
 * been here: going out hurt.
 */
export function worstCase(option) {
  // Matches rollHazard: intBetween(danger * 3, danger * 9), before any armour.
  return option.hazard ? Number(option.hazard.danger) * 9 : 0;
}

export function isWarned(option, healthAtMoment) {
  return worstCase(option) >= Number(healthAtMoment);
}

/**
 * Greedy pick over a shuffled list, skipping any axis already taken.
 *
 * Fewer than `count` is a content shortage rather than an error — a region with only
 * two eligible axes offers two moments, and the answer is to write more content rather
 * than to relax the rule.
 */
function pickDistinctAxes(keys, count, random) {
  const pool = [...keys];

  // Fisher-Yates, so the shuffle is one draw per element and the order is stable.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const taken = new Set();
  const chosen = [];

  for (const key of pool) {
    if (chosen.length === count) break;
    if (taken.has(MOMENTS[key].axis)) continue;
    taken.add(MOMENTS[key].axis);
    chosen.push(key);
  }

  return chosen;
}
