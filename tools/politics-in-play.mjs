/**
 * What 17c's three multipliers did once they were switched on, rather than in isolation.
 *
 * `politics-effects.mjs` measured each swing on its own: how often a crew is at one, and what
 * it is worth on a price, a raid clock and a hazard roll. **That is not the same question as
 * what happens to a camp**, and three of the gaps between those two questions are worth a
 * number rather than an argument:
 *
 * 1. **A multiplier on a gap is not a symmetric multiplier on a rate.** `tempoFactor` stretches
 *    and compresses the interval between one crew's raids by up to fifteen percent either way,
 *    and a player experiences raids *per hour*, which is its reciprocal. `E[1/f] > 1/E[f]` for
 *    anything that varies at all, so a swing that looks even makes raids strictly more frequent.
 *    The only question is by how much.
 * 2. **The road multiplies the odds of trouble, and trouble is what kills people.** Seven and a
 *    half percent on a hazard roll is small; a camp that walks the same contested road twice a
 *    day for a season is not making one roll.
 * 3. **Prices net to nothing over a year and that was the design** — restated here so the three
 *    live together and a later reader can see which of them was allowed to move.
 *
 * Nothing is reimplemented: the hazard figures come from `resolveExpedition` itself, run over
 * real region shapes with and without the factor.
 *
 *   node tools/politics-in-play.mjs
 */
import { resolveExpedition } from '../src/game/expeditions.js';
import { ORDINARY } from '../src/game/wanderers.js';
import {
  ERA_HOURS,
  HOLDINGS,
  relationsAt,
  roadPolitics,
  tempoFactor,
  warmthAround,
} from '../src/game/relations.js';
import { FACTIONS } from '../src/game/factions.js';
import { WORLD_EPOCH, WORLD_SEED } from '../src/game/world-events.js';

const HOUR = 3600_000;
const SLUGS = Object.keys(FACTIONS);

/* 1. The raid clock, and the asymmetry hiding in it. */
{
  let gap = 0;
  let rate = 0;
  let n = 0;
  for (let world = 1; world <= 400; world += 1) {
    for (let era = 0; era < 120; era += 1) {
      const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
      const relations = relationsAt(world * 7717, at);
      for (const slug of SLUGS) {
        const factor = tempoFactor(warmthAround(relations, slug));
        gap += factor;
        rate += 1 / factor;
        n += 1;
      }
    }
  }
  console.log('1. the raid clock');
  console.log(`   mean multiplier on the gap    ${(gap / n).toFixed(5)}`);
  console.log(`   mean multiplier on the rate   ${(rate / n).toFixed(5)}`);
  console.log(
    `   raids are ${(((rate / n) - 1) * 100).toFixed(2)}% more frequent than before 17c —` +
      ' the swing is even on the gap and cannot be on the rate.\n',
  );
}

/*
 * 2. The road. The real regions, at their real danger, walked by an ordinary unarmed survivor
 *    so the hazard multiplier is the politics and nothing else.
 */
const ROADS = [
  ['the_service_road', 1],
  ['ruined_city', 2],
  ['irradiated_farmland', 2],
  ['the_millrace', 3],
  ['underground_bunkers', 3],
  ['sixteen_wells', 4],
  ['the_waterworks', 5],
  ['harrow_end', 5],
];

/*
 * Real loot and finds tables, because an empty region draws a different number of times from
 * the generator and would put every hazard roll on a different value than a real trip does.
 * The figures below are the seed's own for the far end of the road.
 */
const SHAPE = {
  loot: { scrap: [35, 80], fuel: [18, 40] },
  finds: [{ slug: 'scavenged_parts', chance: 0.6, qty: [2, 4] }],
  radiationPerTrip: 7,
};

const TRIPS = 4000;

function walker() {
  return {
    id: 1,
    alive: true,
    health: 100,
    hunger: 0,
    radiation: 0,
    skillScavenging: ORDINARY,
    inventory: [],
  };
}

/**
 * Counted on `damage`, not on `cause`.
 *
 * `resolveExpedition` returns `cause: died ? trip.cause : null` — the cause is what killed
 * them, so a hazard somebody walked away from comes home with a cause of null. The first cut
 * of this file counted causes and reported that nothing on the map is ever dangerous, which
 * is a measurement failing rather than a finding.
 */
function hazards(region, politics) {
  let hit = 0;
  let damage = 0;
  let died = 0;
  for (let seed = 1; seed <= TRIPS; seed += 1) {
    const outcome = resolveExpedition({ region, survivor: walker(), seed, politics });
    if (outcome.damage > 0) {
      hit += 1;
      damage += outcome.damage;
    }
    if (outcome.died) died += 1;
  }
  return { share: hit / TRIPS, perTrip: damage / TRIPS, deaths: died / TRIPS };
}

console.log('2. the road, over four thousand trips each');
console.log('   place                  danger   trouble before   contested   quiet   worst swing');
for (const [slug, danger] of ROADS) {
  const region = { slug, name: slug, danger, travelHours: 12, ...SHAPE };

  /* The two ends the seasons actually reach, read off `roadPolitics` rather than assumed. */
  let hot = 1;
  let cool = 1;
  for (let era = 0; era < 200; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
    const factor = roadPolitics(WORLD_SEED, slug, at);
    hot = Math.max(hot, factor);
    cool = Math.min(cool, factor);
  }

  const flat = hazards(region, 1);
  const contested = hazards(region, hot);
  const quiet = hazards(region, cool);
  const pct = (x) => `${(x * 100).toFixed(1)}%`;

  console.log(
    `   ${slug.padEnd(20)}   ${String(danger).padStart(6)}   ${pct(flat.share).padStart(14)}` +
      `   ${pct(contested.share).padStart(9)}   ${pct(quiet.share).padStart(5)}` +
      `   ${`${((contested.share / flat.share - 1) * 100).toFixed(1)}%`.padStart(11)}`,
  );
}

/*
 * And the figure that decides whether any of that matters: a camp walking one contested road
 * twice a day for a season makes fifty-six trips, so the question is how many *extra* times it
 * meets trouble across one.
 */
const deep = { slug: 'harrow_end', name: 'Harrow End', danger: 5, travelHours: 26, ...SHAPE };
const flatFar = hazards(deep, 1);
const hotFar = hazards(deep, 1.075);
const aSeason = (ERA_HOURS / 24) * 2;
console.log(
  `\n   Walking Harrow End twice a day for a season is ${aSeason} trips:` +
    ` ${(flatFar.share * aSeason).toFixed(1)} meetings with trouble in a calm season against` +
    ` ${(hotFar.share * aSeason).toFixed(1)} in a contested one.`,
);
console.log(
  `   That is ${((hotFar.share - flatFar.share) * aSeason).toFixed(1)} extra over four weeks,` +
    ` costing ${((hotFar.perTrip - flatFar.perTrip) * aSeason).toFixed(0)} more health across all` +
    ' of them.\n',
);

console.log('3. prices net to nothing over a year — see tools/politics-effects.mjs, -0.08%.');
console.log('   The swing is a reason to buy this season rather than a tax, and that was the');
console.log('   design. It is restated here so all three effects can be read in one place.');

console.log(
  `\n   ${Object.values(HOLDINGS).flat().length} of 11 places are somebody's ground; the fence` +
    " line, the coast and the Deep Zone are nobody's and are untouched by any of this.",
);
