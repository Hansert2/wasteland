/**
 * How often is a camp asked to take a side, and what does saying yes actually cost?
 *
 * Phase 17d puts the first thing on the road that changes a crew's mind about the camp —
 * before it, trade was the only verb in the game that could. Two numbers decide whether that
 * is a mechanic or a curiosity, and neither is in the diff:
 *
 * 1. **How often the question is asked.** It needs three things at once: a trip to ground
 *    somebody holds, a season those crews are falling out in, and a seed that rolls a
 *    standing-axis moment. Each is likely enough on its own to feel inevitable, and the
 *    product of three likely things is where intuition reliably fails.
 * 2. **What twenty points is worth in the units the player has.** `caravan-reach` measured
 *    8.2 days as the mean wait for a particular crew's caravan and a trade moves standing by
 *    six, so the cost of undoing a side taken is a number of *days*, not a number of points.
 *
 * Nothing is reimplemented: the moments come from `momentsFor`, the seasons from
 * `quarrelOver`, and the walk is the map's own hours.
 *
 *   node tools/taking-sides.mjs
 */
import { momentsFor, withClock } from '../src/game/moments.js';
import { HOLDINGS, SIDING_SWING, holderOf, quarrelOver, ERA_HOURS } from '../src/game/relations.js';
import { TRADE_STANDING_GAIN } from '../src/game/factions.js';
import { WORLD_EPOCH, WORLD_SEED } from '../src/game/world-events.js';

const HOUR = 3600_000;

/* The map, as the trips a camp actually takes: slug, the walk, and whether anybody holds it. */
const MAP = [
  ['the_fence_line', 0.17],
  ['the_service_road', 0.75],
  ['ruined_city', 4],
  ['irradiated_farmland', 6],
  ['the_millrace', 8],
  ['underground_bunkers', 9],
  ['coastal_wreckage', 12],
  ['sixteen_wells', 14],
  ['the_deep_zone', 18],
  ['the_waterworks', 20],
  ['harrow_end', 26],
];

const SEASONS = 240;
const SEEDS = 60;

/*
 * 1. How often the road is in a quarrel at all, per place. A season a crew spends falling out
 *    with somebody is a season every road they hold can offer this.
 */
console.log('  place                    holder                         seasons in a quarrel');
for (const [slug] of MAP) {
  const holder = holderOf(slug);
  let quarrels = 0;
  for (let era = 0; era < SEASONS; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
    if (quarrelOver(WORLD_SEED, slug, at)) quarrels += 1;
  }
  console.log(
    `  ${slug.padEnd(22)}   ${(holder ?? '—').padEnd(28)}   ${
      holder ? `${((quarrels / SEASONS) * 100).toFixed(0)}%` : 'never — nobody holds it'
    }`,
  );
}

/*
 * 2. And then the question actually being asked, which needs the seed to roll a standing
 *    moment as well. Every place, every season, sixty seeds.
 */
let trips = 0;
let offered = 0;
const byPlace = new Map();

for (const [slug, hours] of MAP) {
  let here = 0;
  let mine = 0;
  for (let era = 0; era < SEASONS; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const moments = momentsFor(withClock({ slug, travelHours: hours }, at, 0, 12), seed);
      here += 1;
      if (moments.some((one) => one.key === 'the_standoff')) mine += 1;
    }
  }
  trips += here;
  offered += mine;
  byPlace.set(slug, mine / here);
}

console.log('\n  trips that are offered the standoff, by place');
for (const [slug, share] of byPlace) {
  console.log(`  ${slug.padEnd(22)}   ${`${(share * 100).toFixed(1)}%`.padStart(6)}`);
}
console.log(
  `\n  Across the whole map, ${((offered / trips) * 100).toFixed(1)}% of trips.` +
    ' A camp working the far end meets it far more often than one working the near end,' +
    '\n  which is right: the roads worth walking are the roads worth fighting over.',
);

/*
 * 3. What it costs to undo, in the only unit a player has for standing: days of waiting for a
 *    caravan they can buy their way back with.
 */
const tradesToUndo = SIDING_SWING / TRADE_STANDING_GAIN;
const MEAN_WAIT_DAYS = 8.2; // measured, tools/caravan-reach.mjs
console.log(
  `\n  Taking a side moves ${SIDING_SWING} points each way. A trade moves` +
    ` ${TRADE_STANDING_GAIN}, so undoing it is ${tradesToUndo.toFixed(1)} caravans` +
    ` — about ${(tradesToUndo * MEAN_WAIT_DAYS).toFixed(0)} days of waiting at` +
    ` ${MEAN_WAIT_DAYS} days a visit.`,
);
console.log(
  '  Consequential and recoverable, which is the pair of words the design asked for. A swing' +
    '\n  much larger than this would make one unlucky press something a camp never gets out of.',
);

const places = Object.values(HOLDINGS).flat().length;
console.log(
  `\n  ${places} of ${MAP.length} places can ever ask. The fence line, the coast and the Deep` +
    ' Zone never do.',
);
