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
 * Eighteen moments, three per axis.
 *
 * Started as six — one per axis — to judge the shape before writing volume. The shape
 * held, so this is the volume. Each axis now has three, spread so that every region has
 * more eligible moments than it has slots, which is what stops a trip offering the same
 * set every time.
 *
 * Every moment has exactly one `default` option, and it must be a no-op — *what the
 * expedition would have done before any of this existed*. Attending may add upside and
 * a risk the player took knowingly; it may never restore a baseline that absence took
 * away. A test pins that.
 *
 * The numbers are measured rather than guessed — see `tools/moment-balance.mjs`, which
 * checks that attending everything stays under one region step of loot, that no option
 * is simply the right answer, and that a healthy survivor cannot be killed by answering
 * badly. Re-run it after touching any of them.
 */
export const MOMENTS = {
  welded_door: {
    axis: 'time',
    title: 'The welded door',
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
    title: 'The turning wind',
    regions: ['irradiated_farmland', 'the_deep_zone'],
    prose: 'The wind turns and the counter starts clicking. There is a culvert half a mile back.',
    options: [
      { key: 'push', verb: 'default', label: 'Push through', detail: 'take the dose' },
      {
        key: 'wait',
        verb: 'wait',
        label: 'Sit it out',
        detail: 'an hour, and most of the dose',
        // Ninety minutes was more than the dose was worth outside the band where
        // radiation actually bites, so pushing through was right 65% of the time.
        hours: 1,
        radiationFactor: 0.3,
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
    title: 'Whatever was following',
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
        // An hour of scavenging given up, not a sixth of the trip: at 0.85 this was
        // taken 4% of the time, which made hiding a worse answer than walking on into
        // whatever was following them.
        lootFactor: 0.94,
        clearsHazard: true,
      },
      {
        key: 'face',
        verb: 'confront',
        label: 'Turn and face it',
        finding: {
          missed: 'Whatever it was, it had nothing on it worth carrying.',
          found: (what) => `It had been carrying ${what}.`,
        },
        detail: 'settle it now, at whatever health they have',
        hazard: { danger: 5 },
        clearsHazard: true,
        findChance: 0.6,
      },
    ],
  },

  the_container: {
    axis: 'haul',
    title: 'The split container',
    regions: ['coastal_wreckage'],
    prose: 'A container split along its seam, and more inside than one person moves.',
    options: [
      { key: 'fits', verb: 'default', label: 'Take what fits', detail: 'they walk on' },
      {
        key: 'overload',
        verb: 'press_on',
        label: 'Overload',
        detail: 'half again, an hour slower, and clumsy where clumsy costs',
        hours: 1,
        // Measured at 1.33 and taken only 9% of the time — the hazard and the hour
        // outweighed it, so "take what fits" was right 82% of the time and this was
        // decoration. See tools/moment-balance.mjs.
        lootFactor: 1.55,
        hazard: { danger: 2 },
      },
    ],
  },

  the_tin: {
    axis: 'supplies',
    title: 'The last tin',
    regions: LONG_REGIONS,
    prose:
      'They have walked on nothing since dawn, and there is a long way still to go.',
    options: [
      { key: 'save', verb: 'default', label: 'Save it', detail: 'they walk on' },
      {
        key: 'eat',
        verb: 'spend',
        label: 'Eat it',
        detail: 'one ration, and something back in them for the rest of it',
        consumes: ['preserved_meal', 'tinned_stew'],
        // 18 was worth less than the ration it burned; 32 is about a meal. Raising it
        // to 42 was tried and measured no different, because healing past the damage
        // actually taken buys nothing — which is why "save it" stays the right answer
        // about 70% of the time. See the note in docs/PLAN.md: that is a moment which
        // is usually correctly declined, not a number still waiting to be found.
        heals: 32,
      },
    ],
  },

  the_fire: {
    axis: 'standing',
    title: 'The warm fire',
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

  the_climb: {
    axis: 'health',
    title: 'The shaft',
    regions: ['ruined_city', 'underground_bunkers', 'coastal_wreckage'],
    prose: 'The stair is gone. The shaft beside it is not, and it goes the right way.',
    options: [
      { key: 'around', verb: 'default', label: 'Go around', detail: 'they walk on' },
      {
        key: 'climb',
        verb: 'press_on',
        label: 'Take the shaft',
        detail: 'half again, if the rungs hold',
        lootFactor: 1.55,
        hazard: { danger: 2 },
      },
    ],
  },

  bad_water: {
    axis: 'health',
    title: 'The still cistern',
    regions: ['the_service_road', 'ruined_city', 'irradiated_farmland'],
    prose: 'The canteen has been empty since the pylons. There is a cistern here, and it is not moving.',
    options: [
      { key: 'thirst', verb: 'default', label: 'Stay thirsty', detail: 'they walk on' },
      {
        key: 'boil',
        verb: 'wait',
        label: 'Boil it',
        detail: 'forty minutes, and they drink safely',
        hours: 0.7,
        heals: 26,
      },
      {
        key: 'drink',
        verb: 'press_on',
        label: 'Drink it as it is',
        detail: 'no time lost, and whatever was in it',
        heals: 26,
        radiationFactor: 1.5,
        hazard: { danger: 1 },
      },
    ],
  },

  the_hot_room: {
    axis: 'radiation',
    title: 'The hot room',
    regions: ['underground_bunkers', 'coastal_wreckage', 'the_deep_zone'],
    prose: 'A room worth stripping, and the counter will not settle while they stand in it.',
    options: [
      { key: 'skip', verb: 'default', label: 'Leave it', detail: 'they walk on' },
      {
        key: 'strip',
        verb: 'press_on',
        label: 'Strip it anyway',
        detail: 'a good deal more, and a good deal more of the dose',
        lootFactor: 1.28,
        radiationFactor: 2.1,
      },
      {
        key: 'quick',
        verb: 'press_on',
        label: 'Two minutes, no more',
        detail: 'the light things only, and barely a reading',
        lootFactor: 1.12,
        radiationFactor: 1.15,
      },
    ],
  },

  counter_clicks: {
    axis: 'radiation',
    title: 'The quiet dosimeter',
    regions: ['irradiated_farmland', 'the_deep_zone'],
    prose: 'The dosimeter has read the same number for two hours. It is either broken or they are lucky.',
    options: [
      { key: 'trust', verb: 'default', label: 'Trust it', detail: 'they walk on' },
      {
        key: 'assume',
        verb: 'wait',
        label: 'Assume the worst',
        detail: 'work the shallow ground, an hour longer, and take less of it',
        hours: 1,
        lootFactor: 0.9,
        radiationFactor: 0.45,
      },
      {
        key: 'dose',
        verb: 'spend',
        label: 'Dose and carry on',
        detail: 'one from the pack, and stop wondering',
        consumes: ['rad_scrubber', 'rad_x'],
        radiationFactor: 0.15,
      },
    ],
  },

  the_long_way: {
    axis: 'time',
    title: 'The bend in the road',
    regions: ['the_service_road', 'ruined_city', 'irradiated_farmland'],
    prose: 'The road bends a long way around a field nobody has crossed in years. There is a reason for the bend.',
    options: [
      { key: 'road', verb: 'default', label: 'Keep to the road', detail: 'they walk on' },
      {
        key: 'cut',
        verb: 'press_on',
        label: 'Cut across',
        detail: 'the hours the bend would cost, and the ground nobody works',
        hours: -0.5,
        lootFactor: 1.4,
        hazard: { danger: 2 },
      },
    ],
  },

  light_is_going: {
    axis: 'time',
    title: 'The failing light',
    regions: ['ruined_city', 'underground_bunkers', 'coastal_wreckage', 'the_deep_zone'],
    prose: 'The light is going and there is more here than they have hands for.',
    options: [
      { key: 'pack', verb: 'default', label: 'Pack up', detail: 'they walk on' },
      {
        key: 'stay',
        verb: 'investigate',
        label: 'Work into the dark',
        detail: 'two hours more, and what the dark is worth',
        hours: 2,
        lootFactor: 1.25,
        findChance: 0.35,
        hazard: { danger: 2 },
      },
    ],
  },

  too_much_to_carry: {
    axis: 'haul',
    title: 'More than one back can take',
    regions: ['ruined_city', 'underground_bunkers', 'the_deep_zone'],
    prose: 'More than one back can take. Some of it will be here next time. Some of it will not.',
    options: [
      { key: 'best', verb: 'default', label: 'Take the best of it', detail: 'they walk on' },
      {
        key: 'strap',
        verb: 'press_on',
        label: 'Strap on what will hold',
        detail: 'a third again, and slower going with it',
        hours: 1.5,
        lootFactor: 1.35,
      },
    ],
  },

  the_ford: {
    axis: 'haul',
    title: 'The ford',
    regions: ['the_service_road', 'irradiated_farmland', 'coastal_wreckage'],
    prose: 'The water is moving faster than it looks, and the bridge went before they were born. The long way round is a long way.',
    options: [
      // Built wrong the first time: wading was the free default and both alternatives
      // were pure cost, so it was the right answer 93% of the time. The crossing is the
      // shortcut now, and the safe road is what it costs you.
      { key: 'around', verb: 'default', label: 'Take the long way', detail: 'they walk on' },
      {
        key: 'ford',
        verb: 'press_on',
        label: 'Ford it',
        detail: 'an hour and a half saved, and whatever the water takes',
        hours: -1.5,
        dropsCarried: 0.22,
      },
    ],
  },

  the_medkit: {
    axis: 'supplies',
    title: 'The hot ground',
    regions: ['irradiated_farmland', 'the_deep_zone'],
    prose: 'The hot ground starts here, and a long way across it.',
    options: [
      { key: 'later', verb: 'default', label: 'Save it for later', detail: 'they walk on' },
      {
        key: 'ahead',
        verb: 'spend',
        label: 'Take it before crossing',
        detail: 'one from the pack, ahead of the ground rather than after it',
        consumes: ['rad_scrubber', 'rad_x'],
        radiationFactor: 0.15,
        lootFactor: 1.15,
      },
    ],
  },

  trade_the_spear: {
    axis: 'supplies',
    title: 'The man who wants the spear',
    regions: ['the_service_road', 'ruined_city', 'underground_bunkers'],
    prose: 'A man with nothing wants a weapon, and has more scrap than he can carry.',
    options: [
      { key: 'keep', verb: 'default', label: 'Keep it', detail: 'they walk on' },
      {
        key: 'sell',
        verb: 'parley',
        label: 'Give him the spear',
        detail: 'the weapon off their back, for as much as they can carry',
        consumes: ['scrap_spear'],
        lootFactor: 2.1,
      },
    ],
  },

  the_roadblock: {
    axis: 'standing',
    title: 'The roadblock',
    regions: ['the_service_road', 'ruined_city', 'irradiated_farmland'],
    prose: 'Two vehicles across the road and somebody sitting on the bonnet, waiting to be talked to.',
    options: [
      { key: 'around', verb: 'default', label: 'Go around', detail: 'the long way, quietly' },
      {
        key: 'talk',
        verb: 'parley',
        label: 'Walk up and talk',
        finding: {
          missed: 'They talked a while, and were let through with nothing but the road.',
          found: (what) => `They were pointed at something worth the detour: ${what}.`,
        },
        detail: 'whoever they are, and whatever they make of the camp',
        parley: true,
        findChance: 0.3,
      },
    ],
  },

  the_wounded: {
    axis: 'standing',
    title: 'Their wounded',
    regions: ['underground_bunkers', 'coastal_wreckage', 'the_deep_zone'],
    prose: 'One of theirs, sat against a wall with a leg that will not take weight. They have seen the survivor.',
    options: [
      { key: 'pass', verb: 'default', label: 'Keep walking', detail: 'they walk on' },
      {
        key: 'help',
        verb: 'parley',
        label: 'Get them upright',
        finding: {
          missed: 'They had nothing to give back but the story.',
          found: (what) => `They pressed ${what} on the survivor and would not hear otherwise.`,
        },
        detail: 'an hour, a ration, and a story they will tell',
        hours: 1,
        consumes: ['preserved_meal', 'tinned_stew'],
        parley: true,
        findChance: 0.55,
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

/**
 * How many moments a trip offers.
 *
 * Raised across the board after the soak measured a twice-daily player meeting a moment
 * about once a fortnight. The old table gave the Deep Zone three and everything under
 * four hours nothing at all, which made encounters a thing that happened on the long
 * trips of an attentive player and to nobody else.
 *
 * The Fence Line still gets none, and always will: ten minutes end to end has no
 * interior to put anything in. The Old Service Road now gets one, which is the shortest
 * trip that can hold a window worth catching.
 */
/**
 * **Prose may not assert what is in the pack.** A moment is drawn from a region and a
 * seed and nothing else, so it cannot know what the survivor is carrying — and three of
 * the six consuming moments said "there is a tin in the pack", "there is a dose in the
 * pack", "the spear" anyway. Played on 2026-08-19: the page promised a dose, the option
 * beside it refused on click, and every test passed because the option worked exactly
 * as specified for a survivor who happened to have one.
 *
 * A price belongs in the option's `detail`, where the page can check it against the
 * real pack and say "needs a Rad Scrubber or Rad-X" before the click rather than after.
 */
export function momentCount(travelHours) {
  const hours = Number(travelHours) || 0;
  if (hours < 0.5) return 0;
  if (hours < 2) return 1;
  if (hours < 8) return 2;
  if (hours < 15) return 3;
  return 4;
}

/**
 * How long a window stays answerable.
 *
 * Proportional to the trip rather than fixed, so this never becomes a page you have to
 * sit on. The divisor is the coverage dial, and it was widened to 1.75 (~58% of a trip
 * open) and then tightened again to 3 (~33%) once there were more moments to catch.
 *
 * The two moves belong together and undoing one without the other would be a mistake.
 * Wide windows on few moments made each encounter easy to catch and rare to meet, which
 * is the worst of both: you could answer whenever you liked, and seldom had anything to
 * answer. More moments in narrower windows trades "always catchable" for "actually
 * happening", which is what a live encounter is supposed to feel like.
 *
 * The floor is twelve minutes rather than forty-five, so a forty-five-minute trip on the
 * Old Service Road can hold a window at all.
 */
export function windowHours(travelHours, count = momentCount(travelHours)) {
  if (count <= 0) return 0;
  return Math.max(0.2, (Number(travelHours) || 0) / (count * 3));
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
      // The short name, which is how the moment is referred to anywhere it is not being
      // read in full: the answered line on the camp page, and the log line its outcome
      // eventually produces. The prose is the situation; the title is what to call it
      // afterwards, and without one an outcome comes home attached to nothing.
      title: MOMENTS[key].title,
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
