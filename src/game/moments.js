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
import { isLit, DEFAULT_SOLAR_NOON } from './daylight.js';

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
 * The road's four, and the region each one plays like.
 *
 * Phase 8 opens four new places, and every one of them would have arrived with no
 * contact in it — moments name region slugs, and no moment names a region that did not
 * exist when it was written. Shipping a phase whose reward is *somewhere to go* and
 * having that somewhere be the only silent place on the map would have been a grim
 * joke, given what the week before it was about.
 *
 * The alternative was adding four slugs to sixteen hand-written region lists, which is
 * sixteen chances to forget one and no statement anywhere about what these places are
 * like. This says it once: the Millrace plays like the Bunkers, Sixteen Wells like the
 * Wreckage, and the two hot ones at the far end like the Deep Zone. New content can
 * still name them directly, and eventually should.
 */
const PLAYS_LIKE = {
  the_millrace: 'underground_bunkers',
  sixteen_wells: 'coastal_wreckage',
  the_waterworks: 'the_deep_zone',
  harrow_end: 'the_deep_zone',
};

/**
 * Eighteen moments, three per axis.
 *
 * Started as six — one per axis — to judge the shape before writing volume. The shape
 * held, so this is the volume. Each axis now has three, spread so that every region has
 * more eligible moments than it has slots, which is what stops a trip offering the same
 * set every time.
 *
 * Each one is written in two parts, and the split is the whole reason it reads as a
 * scene rather than a riddle. The `scene` is what the survivor is standing in: where
 * they are, what is in front of them, how they got here. The `prose` is the **turn** —
 * the last line, the one the choices answer. For a long time there was only the turn,
 * which meant every moment opened on its own final sentence with nothing underneath it;
 * "a door someone welded shut from the outside" is a good closing line and a terrible
 * opening one, because the player has to reconstruct the corridor, the bay and the weld
 * from a clause. The scene does that work, and the turn keeps the weight it had.
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
    scene:
      'The corridor gives out into a service bay, and the bay ends in steel. Someone ran a bead of weld all the way round the frame and then walked away from it, and the weld is on this side.',
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
    scene:
      'They have had the wind on their left cheek since first light, coming clean off the high ground and over fields that stopped being fields a long time ago. Around noon it swings round to the north.',
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
    scene:
      'It started somewhere behind the shoulder of the road, and it has never once been in the same place twice. Every time the survivor stops walking, it stops walking.',
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
    scene:
      'The tide has stacked them three deep along the shingle and the salt has done the rest, so that half of them are opening like fruit. One has come apart down the welded seam, and the inside of it is dry.',
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
    scene:
      'The pack has been lighter than it ought to be since the second hour, and the survivor has known exactly what is left in it the whole time. Somewhere past midday the walking starts costing more than it did in the morning.',
    prose: 'They have walked on nothing since dawn, and there is a long way still to go.',
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
    scene:
      'A ring of stones in the lee of a wall, and grey ash banked up in the middle of it. The survivor puts a flat hand over the ash and holds it there a moment before saying anything.',
    prose: 'A fire an hour old, still warm, and three sets of boot prints leaving it. The prints are not running.',
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
    scene:
      'Everything worth having is two floors down, and the building has already had its say about how anybody gets there: what is left of the stairwell is a slope of concrete and bent bar going nowhere.',
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
    scene:
      'The sun has been on them all afternoon and there is no shade in any direction worth the walk to reach it. Behind a fallen outbuilding sits a concrete cistern with a foot of water in it, under a skin of dust that has not been broken in years.',
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

  /*
   * Two more places where the dose is something to spend rather than something to suffer.
   *
   * `the_hot_room` was the only moment that could raise a dose, and it reaches the bunkers,
   * the coast and the Deep Zone — which left the two hottest regions in the game, the
   * Waterworks and Harrow End, with no way to trade radiation for anything at all. Their
   * dose was a tax and never a decision.
   *
   * Both follow the hot room's shape rather than inventing one: a default that walks past,
   * a full commitment that pays well and costs a great deal of dose, and a hurried version
   * that takes a little of each. Three options, one axis, and the deciding number is how
   * much of the counter the player is willing to spend.
   */
  the_settling_tanks: {
    axis: 'radiation',
    title: 'The settling tanks',
    regions: ['the_waterworks'],
    scene:
      'Six open tanks in a row, and the fifth never drained. What is left in it has gone the colour of weak tea and lies perfectly still, and the walkway over it is stacked with the tooling somebody was using on the day they stopped.',
    prose: 'Everything worth taking is on the walkway, and the walkway is over the tank.',
    options: [
      { key: 'around', verb: 'default', label: 'Go round', detail: 'they walk on' },
      {
        key: 'clear',
        verb: 'press_on',
        label: 'Clear the walkway',
        detail: 'all of it, and a long time stood over the tank',
        lootFactor: 1.32,
        radiationFactor: 2.2,
      },
      {
        key: 'reach',
        verb: 'press_on',
        label: 'Take what is in reach',
        detail: 'the near end only, and less of the water under them',
        lootFactor: 1.1,
        radiationFactor: 1.3,
      },
    ],
  },

  the_last_gallery: {
    axis: 'radiation',
    title: 'The last gallery',
    regions: ['harrow_end'],
    scene:
      'The gallery runs on past where the lamps were strung, and the air in it is dry and still and tastes of nothing. Two hundred paces in, the counter stops keeping time and simply holds a note.',
    prose: 'Nobody has been this far along it. That is why there is anything left.',
    options: [
      { key: 'turn', verb: 'default', label: 'Turn back at the lamps', detail: 'they walk on' },
      {
        key: 'far',
        verb: 'press_on',
        label: 'Go to the end of it',
        detail: 'whatever is down there, and every step of it counting',
        lootFactor: 1.4,
        radiationFactor: 2.4,
      },
      {
        key: 'near',
        verb: 'press_on',
        label: 'As far as the lamps reach',
        detail: 'what the last crew left, and a reading they can walk off',
        lootFactor: 1.15,
        radiationFactor: 1.35,
      },
    ],
  },

  the_hot_room: {
    axis: 'radiation',
    title: 'The hot room',
    /*
     * The Deep Zone only, since 2026-08-30.
     *
     * It listed the bunkers and the coast as well, and both of those now dose nobody — so
     * radiationFactor 2.1 multiplied a zero and the room charged nothing at all for a 1.28x
     * haul. Measured: +0.6 fuel a day at the bunkers and +0.9 at the coast, free.
     *
     * A cost written as a multiplier can only be paid by a region with something to
     * multiply. It is also what docs/LORE.md section 2 already said — the farmland and the
     * Deep Zone are hot and they are the only places that are — so a room whose counter
     * holds a flat tone was never coherent on a coast the world calls clean.
     */
    regions: ['the_deep_zone'],
    scene:
      'Shelving from floor to ceiling, and none of it stripped: cable, tooling, sealed cases still stacked the way somebody left them on the last ordinary day. Between the doorway and the first shelf the dosimeter goes from ticking to a flat tone.',
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
    scene:
      'Hot ground reads high, and then higher, and that is what makes it hot ground. The survivor has walked two miles of it and the needle has not come off the same mark since the fence.',
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
    scene:
      'From the top of the rise they can watch the road do the entire thing — out, around, and back to a point about a mile from where they are standing. The field it goes around is flat, dry and empty.',
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
    scene:
      'They have been working the same run of rooms since mid-afternoon and are still turning things up in it. The shadows have crossed the floor and started up the far wall while they worked.',
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
    scene:
      'It is all lying where it came down and nobody has been through it since. The survivor stands in the middle of it doing the arithmetic that everybody out here ends up doing sooner or later.',
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
    scene:
      'Upstream of the crossing the channel widens out over gravel and the bottom of it is visible the whole way across. Downstream it is a long walk of bank before the road comes back to the water.',
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
    scene:
      'There is a line on the ground where the grass gives up — not a fence and not a wall, only the place where things stopped. The dosimeter finds it a few paces before the survivor does.',
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
    scene:
      'He has a hand cart heaped with copper and cut plate, and he has been sitting beside it long enough to have thought it through, because there is nowhere he can push it that is safe to push it to. He looks at the spear on the survivor’s back before he looks at the survivor.',
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
    scene:
      'Two vehicles nose to nose across both lanes, there long enough for the weeds to come up through the wheel arches. Somebody is sitting on the bonnet of the nearer one, and has been watching them come for a while now.',
    prose: 'They have been seen. Whoever it is has not stood up, and has not reached for anything either.',
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
    scene:
      'The wall is the only thing standing for fifty yards in any direction, and there is somebody propped against the foot of it with one leg straight out in front of them, wrapped in what used to be a jacket.',
    prose: 'One of theirs, and they have seen the survivor. The leg will not take weight, and nobody else is coming.',
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
 * The same twenty moments, after dark.
 *
 * Keyed by the day moment each one re-reads, and **an entry can only override text.** It
 * carries a title, a scene, a turn, and per-option `label` and `detail` — nothing else, and
 * a test pins that. The option objects themselves are the daylight ones, merged rather than
 * replaced, so an option's key, verb, hours, `consumes`, `findChance` and factors are the
 * same after dark as before it.
 *
 * That constraint is the whole design, and it was worth a rewrite to get. The first draft of
 * this table retyped each option in full, which reads naturally and is a trap: `answerMoment`
 * finds the chosen option *on the moment it was handed* and applies whatever is on it, so a
 * mirror that retyped `Give him the spear` without its `consumes` and `lootFactor` would have
 * quietly made the night version of that trade free and worthless. Three of the four I had
 * written that way had already lost mechanics. Overrides cannot do this: there is nowhere to
 * put a number.
 *
 * The swap happens *after* the axes are picked and the hours are placed, so a night trip
 * offers the same count, on the same axes, in the same windows. Only the reading changes.
 *
 * **Different in kind, not better.** `coefficientsAt` has already priced the hours — night
 * pays fewer finds and charges less dose — and that trade is not this table's business.
 * Nothing here is worth more than its daylight partner because nothing here *can* be. What
 * changes is the question, and in three places the day's correct answer becomes the wrong
 * one, which is the clearest evidence the content is doing its job:
 *
 * - `wind_turns`: by day the dose is blowing past and sitting it out is right. At night the
 *   cold air has sunk into the low ground and stopped, so the culvert is *in* it.
 * - `the_ford`: by day the gravel bottom is visible the whole way across and fording is a
 *   look followed by a decision. At night the depth is a thing you find out with a leg.
 * - `the_long_way`: by day the short cut is a bet on whether the track connects. At night it
 *   is a bet on whether it can be followed at all.
 *
 * **Three things the dark has that the day has not**, which is where the rest come from: it
 * hides what you would have judged by looking, and sells it back for time; it shows the few
 * things only visible when they are the brightest thing present; and it makes being seen
 * expensive, so the standing moments now price visibility rather than approach.
 *
 * **Underground, night is not about light.** A gallery is dark at noon. For the interior
 * moments — `the_climb`, `the_last_gallery`, `the_hot_room`, `welded_door` — the difference
 * the hour makes is to the *survivor*: the torch has been burning for hours by then, and
 * there is no daylight to come back out into. Writing those as "it is dark down there" would
 * have been true of the day version too, which is the check that caught the first draft.
 *
 * A moment with no entry keeps its daylight text. Nothing uses that today — all twenty are
 * here — but it is deliberate rather than incidental: it means the next moment written can
 * ship before its mirror without a half-filled table changing how many moments a trip has.
 */
export const NIGHT = {
  welded_door: {
    title: 'The door standing open',
    scene:
      'The same bay and the same steel, except that the weld has been cut through and the door is propped wide with a length of pipe. The cut is bright. Nothing has had time to rust it.',
    prose: 'Somebody opened it, and not long ago. The dark past the frame is a different dark from the corridor.',
    options: {
      leave: { detail: 'they do not look' },
      work: { label: 'Go in after them', detail: 'two hours, and whoever else is in there' },
    },
  },

  wind_turns: {
    title: 'The air that stopped moving',
    scene:
      'The wind drops with the temperature, the way it always does, and the cold air slides off the high ground and lies down in the low places. The counter does not start clicking. It has been clicking for a while.',
    prose: 'Nothing is blowing it anywhere tonight, and the culvert is at the bottom of the field.',
    options: {
      push: { detail: 'take the dose' },
      // Same hour and the same relief. What it buys is different: by day the hour is spent
      // waiting for the wind to take the dose away, and tonight it is spent walking uphill
      // out of the dose, because it is not going anywhere on its own.
      wait: { label: 'Get to higher ground', detail: 'an hour uphill, and most of the dose' },
      tablets: { detail: 'one dose from the pack, and almost none of it' },
    },
  },

  kept_pace: {
    title: 'The easiest thing to follow',
    scene:
      'It started somewhere behind the shoulder of the road and it has never once been in the same place twice. There is exactly one thing moving through this valley that can be seen from a distance, and the survivor is carrying it.',
    prose: 'Something has kept pace with them for an hour. It does not need to see the road to do it.',
    options: {
      keep: { detail: 'they walk on, lit' },
      ground: { label: 'Put the light out', detail: 'an hour sat in the dark, and it goes past' },
      face: { label: 'Turn and face it', detail: 'settle it at arm’s length, which is as far as they can see' },
    },
  },

  the_container: {
    title: 'As far in as the torch reaches',
    scene:
      'The tide has stacked them three deep along the shingle and the salt has opened half of them. One has come apart down the welded seam, and the inside is dry, and it goes back further than the light does.',
    prose: 'The limit is not what one back can carry. It is what they can find in there before the torch is done.',
    options: {
      fits: { label: 'Take what the light finds', detail: 'they walk on' },
      overload: { label: 'Go in properly', detail: 'half again, an hour slower, and a rotten floor they cannot see' },
    },
  },

  the_tin: {
    title: 'The last tin, and the cold',
    scene:
      'The pack has been lighter than it ought to be since the second hour. What has changed since the light went is that standing still has started to cost something, and the walking is the only thing keeping the cold off.',
    prose: 'They have walked on nothing since the light went, and the night is taking its cut whether they eat or not.',
    options: {
      save: { detail: 'they walk on, cold' },
      eat: { detail: 'one ration, and something to burn against the cold' },
    },
  },

  the_fire: {
    title: 'The fire that is still lit',
    scene:
      'A ring of stones in the lee of a wall, and this time there is no need to hold a hand over it: it is burning, and it has been visible from the rise for the last twenty minutes. Whoever is sitting round it has had exactly as long to watch the survivor’s light come down the road.',
    prose: 'A fire, three people at it, and both parties have known about each other for a mile.',
    options: {
      off: { label: 'Douse the light and go wide', detail: 'they walk on, unseen' },
      hail: { label: 'Call out early', detail: 'whoever they are, and whatever they make of a light in the dark' },
    },
  },

  the_climb: {
    title: 'The shaft, by a dying torch',
    scene:
      'The stairwell is the same slope of concrete and bent bar it would be at noon, and the shaft beside it is the same shaft. What is different is that the torch has been lit since the light went, and the circle it throws on the far wall has been shrinking for an hour.',
    prose: 'The rungs have not changed. What they have to see them by has.',
    options: {
      around: { detail: 'they walk on' },
      climb: { label: 'Take it while it lasts', detail: 'half again, if the rungs hold and the torch does' },
    },
  },

  bad_water: {
    title: 'The cistern you cannot see into',
    scene:
      'The heat went with the sun and the thirst did not. Behind the fallen outbuilding the cistern is where it always was, and the torch puts a coin of light on the surface that says nothing whatever about the foot of water underneath it.',
    prose: 'The canteen has been empty since the pylons. By day they would look at this and decide.',
    options: {
      thirst: { detail: 'they walk on' },
      boil: { detail: 'forty minutes and the fuel for it, and they drink safely' },
      drink: { label: 'Drink what they cannot see', detail: 'no time lost, and no way of knowing' },
    },
  },

  the_settling_tanks: {
    title: 'The tank that gives nothing back',
    scene:
      'Six open tanks in a row and the fifth still full. By day the surface at least tells you where it is; at this hour it returns the torch as nothing at all, and the edge of the walkway is something found with a boot.',
    prose: 'Everything worth taking is still on the walkway, and tonight the walkway has no edge.',
    options: {
      around: { detail: 'they walk on' },
      clear: { label: 'Clear the walkway by feel', detail: 'all of it, and a long time stood over water they cannot see' },
      reach: { detail: 'the near end only, and less of the water under them' },
    },
  },

  the_last_gallery: {
    title: 'The gallery, and the way out',
    scene:
      'The gallery is exactly as dark as it was at noon, because it has been dark since the lamps came down. What is different is behind them: the walk back out of it ends in more of this, and the counter has been holding its one note for a long time already.',
    prose: 'Nobody has been this far along it. Going further tonight means the whole way back in the dark as well.',
    options: {
      turn: { detail: 'they walk on' },
      far: { label: 'Go to the end of it anyway', detail: 'whatever is down there, and every step of it counting, twice' },
      near: { detail: 'what the last crew left, and a reading they can walk off' },
    },
  },

  the_hot_room: {
    title: 'The hot room, by torch',
    scene:
      'Shelving floor to ceiling and none of it stripped, and the dosimeter goes from ticking to a flat tone between the doorway and the first shelf, the same as it would at any hour. The difference is that everything on those shelves has to be told apart by hand.',
    prose: 'A room worth stripping, and no way to see which of it is worth carrying.',
    options: {
      skip: { detail: 'they walk on' },
      strip: { label: 'Strip it by feel', detail: 'a good deal more, and a good deal more of the dose' },
      // The day version can grab the light things because it can see which they are. At
      // night this is the same two minutes spent finding that out.
      quick: { label: 'Two minutes, no more', detail: 'whatever comes to hand first, and barely a reading' },
    },
  },

  counter_clicks: {
    title: 'What the needle does not see',
    scene:
      'Two miles of hot ground and the needle has not come off the same mark since the fence. Off the shoulder of the road there is a ditch with a faint green low down in it — the sort of light there is no finding at noon, because at noon there is something brighter to lose it in.',
    prose: 'The instrument still says the same number. Their eyes have started to disagree with it.',
    options: {
      trust: { label: 'Trust the needle', detail: 'they walk on' },
      assume: { label: 'Trust their eyes', detail: 'work the shallow ground, an hour longer, and take less of it' },
      dose: { detail: 'one from the pack, and stop wondering' },
    },
  },

  the_long_way: {
    title: 'The field they cannot see across',
    scene:
      'The rise is the same rise, and from the top of it there is now nothing to see: the road is a darker line for as far as the torch goes, and the field it bends around is a flat absence with a mile of somewhere on the other side of it.',
    prose: 'The bend still costs the hours it costs. Cutting the corner is no longer a look at the ground first.',
    options: {
      road: { detail: 'they walk on' },
      cut: { label: 'Cut across blind', detail: 'the hours the bend would cost, and ground nobody has seen tonight' },
    },
  },

  light_is_going: {
    /*
     * The one mirror that had to be written twice, and the reason is worth keeping.
     *
     * The first version was the pretty inversion: the day moment is the light running out,
     * so the night one was dawn coming up — the same room at the other end of the night, two
     * hours on offer, and the reason to spend them reversed. Then it was rendered through
     * `tools/page-states.mjs` at a departure of eight in the evening, met at half past ten,
     * and said the sun would be up in an hour. It would not.
     *
     * The swap knows whether an hour is lit, which is all it knows and all it should know.
     * So a mirror cannot claim a *particular* dark hour, only the fact of darkness — and the
     * honest re-reading of this moment is not the sunrise, it is that the light stopped being
     * the thing that ends the search. What ends it now is the walk home.
     */
    title: 'The road home in the dark',
    scene:
      'They have been working the same run of rooms by torch for hours and are still turning things up in it. The light stopped being a reason to leave somewhere back down the corridor.',
    prose:
      'There is more here than they have hands for, and every hour spent on it is another hour walking home in the dark.',
    options: {
      pack: { detail: 'they walk on, while the walk is short' },
      stay: { label: 'Work on anyway', detail: 'two hours more, and two more of them in the dark' },
    },
  },

  too_much_to_carry: {
    title: 'The arithmetic, done by torch',
    scene:
      'It is all lying where it came down and nobody has been through it since. The survivor stands in the middle of it doing the usual arithmetic, with the difference that the pile has no edge to it — the light stops before the heap does.',
    prose: 'More than one back can take, and no way of knowing how much more.',
    options: {
      best: { label: 'The best the light found', detail: 'they walk on' },
      strap: { detail: 'a third again, and slower going over ground they cannot see' },
    },
  },

  the_ford: {
    title: 'The ford, heard and not seen',
    scene:
      'Upstream the channel widens out over gravel, and by day the bottom of it is visible the whole way across. Tonight there is the noise it makes, which gives them roughly where it is and roughly how fast, and nothing at all about how deep.',
    prose: 'The long way round is still a long way. The short way is a thing they find out about with a leg.',
    options: {
      around: { detail: 'they walk on' },
      ford: { label: 'Wade it blind', detail: 'an hour and a half saved, and whatever the water takes' },
    },
  },

  the_medkit: {
    title: 'The line they will not see',
    scene:
      'By day the hot ground announces itself: there is a place where the grass gives up and it can be seen from a hundred yards. In the dark the grass is grass, and the first thing that knows is the dosimeter.',
    prose: 'The hot ground starts somewhere here, and a long way across it, and they will be in it before they see it.',
    options: {
      later: { label: 'Save it for later', detail: 'they walk on' },
      ahead: { detail: 'one from the pack, before ground they cannot see the edge of' },
    },
  },

  trade_the_spear: {
    title: 'The man beside the cart',
    scene:
      'He has not moved the cart and he has not lit anything, and he heard them coming a hundred yards back — copper and cut plate heaped up, and a man sitting beside it who chose to stay sitting rather than get off the road. He looks at the spear first, the same as he would have at noon.',
    prose: 'A man with nothing wants a weapon, and there are hours of dark still to walk through with or without one.',
    options: {
      keep: { detail: 'they walk on, armed' },
      sell: { label: 'Give him the spear', detail: 'the weapon off their back, and the rest of the night without it' },
    },
  },

  the_roadblock: {
    title: 'The lamp on the roadblock',
    scene:
      'Two vehicles nose to nose across both lanes with the weeds up through the wheel arches, and a lamp on the bonnet of the nearer one pointed out along the road rather than down at whoever is behind it. That is a decision somebody made about being walked up on in the dark.',
    prose: 'They have been seen, and they cannot be seen back. Nobody sitting at a roadblock enjoys that arrangement.',
    options: {
      around: { label: 'Go around in the dark', detail: 'the long way, and nothing to give them away' },
      talk: { label: 'Walk into the lamp', detail: 'whoever they are, and whatever they make of the camp' },
    },
  },

  the_wounded: {
    title: 'Someone calling from the dark',
    scene:
      'The wall is the only thing standing for fifty yards in any direction, and from the foot of it a voice asks for help in a tone that is either honest or very well practised. Turning the torch on it would answer that question, and would answer it for anybody else in the valley at the same time.',
    prose: 'One of theirs, and the leg will not take weight. Helping means being the brightest thing out here for as long as it takes.',
    options: {
      pass: { label: 'Keep walking', detail: 'nobody sees them do it' },
      help: { label: 'Get them upright, lit', detail: 'an hour, a ration, a story, and a light everyone can see' },
    },
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
const HOUR_MS = 3_600_000;

/**
 * A region, plus when the trip that is walking it left and what the sky was doing.
 *
 * Every caller that renders or logs a moment's words has to place them in the same hour, or
 * the page offers "The failing light" while the log that comes home says "The light coming
 * back". Both of those callers already compose the sky for `travelFactors` — the same three
 * values, in the same place, four lines apart — so this exists to be called *beside* that,
 * off the same three expressions, rather than to be assembled independently twice.
 *
 * It is not needed to *resolve* a trip and deliberately does not affect one: night changes
 * text and never mechanics, so `tools/moment-balance.mjs` and every other pure caller can go
 * on handing `momentsFor` a bare region. A region without these fields reads as daylight,
 * which is what every trip taken before this existed replays as.
 */
export function withClock(region, departedAt, clockOffset, solarNoon) {
  return { ...region, departedAt, clockOffset, solarNoon };
}

/**
 * Which words this moment gets, from the hour it actually happens at.
 *
 * Merged rather than swapped: the option objects stay the daylight ones and only pick up a
 * `label` and a `detail`, so nothing in `NIGHT` can change what an option costs, spends or
 * pays. See the note on the table.
 */
function wordsFor(key, at, region) {
  const night = NIGHT[key];
  if (!night || at === null) return MOMENTS[key];

  const lit = isLit(at, region.clockOffset ?? 0, region.solarNoon ?? DEFAULT_SOLAR_NOON);
  if (lit) return MOMENTS[key];

  return {
    ...MOMENTS[key],
    title: night.title,
    scene: night.scene,
    prose: night.prose,
    options: MOMENTS[key].options.map((option) =>
      night.options?.[option.key] ? { ...option, ...night.options[option.key] } : option,
    ),
  };
}

export function momentsFor(region, seed) {
  const travelHours = Number(region?.travelHours) || 0;
  /*
   * How many, from the place. When, from the trip.
   *
   * A shortcut makes a walk shorter without making the place emptier — the same rule the dose
   * already follows, where `rollRadiation` reads the region and ignores the clock entirely.
   * Without this a 236-fuel shortcut to the Deep Zone would have dropped it under the
   * fifteen-hour band and *deleted one of its contacts*, which is paying to be given less.
   *
   * The windows still scale with the real trip, so on a shortened run the same four are
   * packed into fewer hours and each is a little tighter to catch. That is the honest cost of
   * arriving sooner, and it is bought back by there being more runs in a day.
   *
   * Defaults to the trip's own hours, so every caller that has never heard of a shortcut is
   * unchanged.
   */
  const count = momentCount(Number(region?.baseTravelHours ?? travelHours) || 0);
  if (count === 0) return [];

  const random = makeRandom(mix(seed, MOMENTS_SALT));

  const like = PLAYS_LIKE[region.slug];
  const eligible = Object.keys(MOMENTS)
    .filter(
      (key) =>
        MOMENTS[key].regions.includes(region.slug) ||
        (like !== undefined && MOMENTS[key].regions.includes(like)),
    )
    .sort();

  const chosen = pickDistinctAxes(eligible, count, random);
  if (chosen.length === 0) return [];

  const window = windowHours(travelHours, count);
  const from = travelHours * 0.1;
  const band = (travelHours * 0.8) / count;
  const room = Math.max(0, band - window);

  /*
   * Where the trip started, or null for a caller that has not said.
   *
   * Read once outside the loop so that every moment on one trip is placed against the same
   * departure — and so that the whole question is answered in one place rather than per
   * moment. Null means daylight everywhere below, which is how a bare region behaves and
   * therefore how every trip taken before Phase 14 replays.
   */
  const departedAt = Number.isFinite(region?.departedAt) ? Number(region.departedAt) : null;

  return chosen.map((key, index) => {
    const centre = from + band * (index + 0.5);
    const atHour = centre + (random() - 0.5) * room;

    /*
     * Day or night, decided *after* the hour is placed and never before it.
     *
     * That order is the constraint the phase is built on: the count comes from the region,
     * the axes and the hours come from the seed, and none of them has heard of the clock. So
     * a trip that leaves at nine at night offers the same moments, on the same axes, in the
     * same windows as the same seed leaving at nine in the morning. Only the words differ.
     *
     * Deciding it here rather than in the caller also means the two ends of a long trip can
     * disagree, which is right: a fourteen-hour walk that leaves in the afternoon meets its
     * first moment in daylight and its last one after dark.
     */
    const words = wordsFor(key, departedAt === null ? null : departedAt + atHour * HOUR_MS, region);

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
      title: words.title,
      scene: words.scene,
      prose: words.prose,
      // Turning back is assembled in here rather than written into every moment: the
      // content declares what is particular to it, and the trip adds what is always
      // true. It is last because it is the way out, not one of the things on offer.
      options: [...words.options, TURN_BACK],
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
 * What an option does, as figures rather than as a clause.
 *
 * Every option already carries a `detail` — "half again, an hour slower, and clumsy
 * where clumsy costs" — and that line is doing two jobs badly. It is the flavour *and*
 * the price list, so the flavour has to stay vague enough to be true at every scale and
 * the price ends up as "half again" of something the sentence never names. A player
 * reading three of those side by side is not choosing between consequences; they are
 * translating.
 *
 * So the numbers come out and stand on their own, and they are **derived from the same
 * fields the resolution reads** rather than written beside them. That is the point: a
 * chip cannot drift from what the option does, because there is nowhere for it to drift
 * to. The `detail` keeps the flavour and loses the arithmetic.
 *
 * Four tones, and the palette is the argument for them: this page has exactly one
 * colour, so brightness carries benefit — a gain is bone, a cost is dim, the incidental
 * is fainter still — and oxide is kept for what can actually hurt the survivor. A green
 * "good" chip would be the first green pixel in the game.
 *
 * `walkHome` is the hours turning back would cost from where they stand, which is a
 * property of the trip and not of the option, so the caller that knows measures it and
 * passes it in — and the chip is simply absent when nobody has.
 *
 * Named for the option rather than as `effectsOf`, which is the same idea for weather
 * and is already imported into the one view that needs both.
 */
export function optionEffects(option, { walkHome = null } = {}) {
  const chips = [];
  const add = (tone, label) => chips.push({ tone, label });

  const hours = Number(option.hours) || 0;
  if (hours > 0) add('cost', `+${clock(hours)} out`);
  if (hours < 0) add('gain', `−${clock(-hours)} out`);

  // Loot and dose both scale what is *left* of the trip rather than the total, which is
  // why these read "from here" and why the block says so once underneath. A "+55% haul"
  // that lands as +20% on the return is the kind of number that teaches a player to
  // stop believing the page.
  if (option.lootFactor > 1) add('gain', `+${percent(option.lootFactor)} haul from here`);
  if (option.lootFactor < 1) add('cost', `−${percent(option.lootFactor)} haul from here`);
  if (option.dropsCarried) add('cost', `−${pct(option.dropsCarried)} of the pack`);

  if (option.radiationFactor < 1) add('gain', `−${percent(option.radiationFactor)} rads from here`);
  if (option.radiationFactor > 1) add('risk', `+${percent(option.radiationFactor)} rads from here`);

  if (option.heals) add('gain', `+${option.heals} health`);
  if (option.findChance) add('gain', `${pct(option.findChance)} chance of a find`);
  if (option.clearsHazard) add('gain', 'Shakes off what is ahead');

  // The one thing on the page that can kill somebody, so it says the whole spread and
  // not an average. Same arithmetic as `worstCase` and as `confront`'s roll, before
  // armour — armour only ever makes it smaller, so the range is a promise the game can
  // keep.
  if (option.hazard) {
    const danger = Number(option.hazard.danger);
    add('risk', `${danger * 3}–${danger * 9} damage`);
  }

  if (option.parley) add('plain', 'Standing decides it');

  // The price out of the pack, which this module cannot name: a moment is drawn from a
  // region and a seed, and what a Rad Scrubber is called lives in a table. So the chip
  // is **marked** rather than merely worded, and the caller that resolves the pack
  // rewrites it in place. Marking it is the point — the first version of this had the
  // caller derive the whole list again with the name in hand, which silently dropped
  // every other chip on the option, because by then it was holding a view object with
  // `consumes` on it and nothing else. Rewriting one marked chip cannot do that.
  if (option.consumes) chips.push({ tone: 'cost', label: '−1 from the pack', needs: true });

  if (option.turnBack) {
    add('gain', 'Banks the haul');
    add('cost', 'Ends the trip');
    if (walkHome !== null) add('plain', `${clock(walkHome)} walk home`);
  }

  // The default option, and anything else that turns out to do nothing. Saying so is
  // the point: "they walk on" is the baseline every other chip is measured against, and
  // an empty row beside three full ones reads as missing data rather than as no change.
  return chips.length > 0 ? chips : [{ tone: 'plain', label: 'No change' }];
}

/** A factor as the change it makes: 1.55 -> "55%", 0.3 -> "70%". */
function percent(factor) {
  return `${Math.round(Math.abs(Number(factor) - 1) * 100)}%`;
}

/** A share as itself: 0.22 -> "22%". */
function pct(share) {
  return `${Math.round(Number(share) * 100)}%`;
}

/**
 * Hours as a clock, to the nearest five minutes.
 *
 * The rounding is not cosmetic. Boiling the cistern is 0.7 hours, which is "42m" exact
 * and "forty minutes" in the prose beside it, and a chip that disagrees with the
 * sentence it sits under is worse than no chip at all.
 */
function clock(hours) {
  const minutes = Math.round((Number(hours) || 0) * 12) * 5;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (whole === 0) return `${rest}m`;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
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
