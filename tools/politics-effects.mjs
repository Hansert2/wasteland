/**
 * Is any of 17c felt, and how often is it felt at all?
 *
 * Three multipliers went in — on a price, on a raid clock, on the odds of trouble — and each
 * is deliberately smaller than what standing already does, because standing is what the player
 * chose and this is weather. **Small and always-on is a real mechanic; small and mostly zero
 * is a decoration with an implementation.** That second possibility is the one this file
 * exists to rule out, and nothing in the diff answers it: neutral is half the world by design,
 * and a crew with one warm neighbour and one cold one averages to exactly nothing.
 *
 * So the question is not "what is the swing" — that is two constants — but **what fraction of
 * seasons a crew is at a swing at all, and what the swing is worth in the units a player
 * actually reads**: scrap on the shelf, days between raids, hazards per hundred trips.
 *
 * Measured over many worlds, because the world the game runs is one sample of a slow process.
 *
 *   node tools/politics-effects.mjs
 */
import {
  PAIRS,
  HOLDINGS,
  priceFactor,
  relationsAt,
  roadFactor,
  tempoFactor,
  warmthAround,
  ERA_HOURS,
} from '../src/game/relations.js';
import { FACTIONS } from '../src/game/factions.js';
import { WORLD_EPOCH } from '../src/game/world-events.js';

const HOUR = 3600_000;
const WORLDS = 400;
const ERAS = 120;
const SLUGS = Object.keys(FACTIONS);

/* Every crew's warmth in every season of every world. */
const warmths = [];
for (let world = 1; world <= WORLDS; world += 1) {
  for (let era = 0; era < ERAS; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
    const relations = relationsAt(world * 7717, at);
    for (const slug of SLUGS) warmths.push(warmthAround(relations, slug));
  }
}

const share = (test) => (warmths.filter(test).length / warmths.length) * 100;

console.log(`${WORLDS} worlds x ${ERAS} seasons x ${SLUGS.length} crews = ${warmths.length} readings\n`);
console.log('  how often a crew is at a swing at all');
console.log(`    dead level (no effect)        ${share((w) => w === 0).toFixed(1)}%`);
console.log(`    their world is cold           ${share((w) => w < 0).toFixed(1)}%`);
console.log(`    their world is warm           ${share((w) => w > 0).toFixed(1)}%`);
console.log(`    at the rail (|warmth| >= 1.5) ${share((w) => Math.abs(w) >= 1.5).toFixed(1)}%`);

/*
 * And what it is worth where a player reads it. The offers are the real ones, so a price in
 * scrap is a price somebody actually pays; the raid gap is the game's own mean; the hazard
 * figure is `danger * 0.09` at the two ends of the map.
 */
const dearest = Math.max(
  ...Object.values(FACTIONS).flatMap((spec) => spec.offers.map((o) => o.costs?.scrap ?? 0)),
);
const bands = [-2, -1, 0, 1, 2];

console.log('\n  what each swing is worth, by how cold or warm that crew’s world is');
console.log(
  `    warmth   price on the ${dearest}-scrap offer   gap between their raids   trouble at danger 5`,
);
for (const w of bands) {
  const price = Math.ceil(dearest * priceFactor(w));
  const gap = 1 / tempoFactor(w);
  const hazard = 5 * 0.09 * roadFactor(w);
  console.log(
    `    ${String(w).padStart(6)}   ${`${price} scrap`.padStart(25)}` +
      `   ${`x${tempoFactor(w).toFixed(3)}`.padStart(23)}   ${`${(hazard * 100).toFixed(1)}%`.padStart(19)}`,
  );
  void gap;
}

/*
 * The road effect lands unevenly on purpose — three places are held by nobody — so the share
 * of the map that can ever be contested is a fact worth printing rather than assuming.
 */
const held = Object.values(HOLDINGS).flat();
console.log(
  `\n  ${held.length} of the map’s 11 places are somebody’s ground;` +
    ' the fence line, the coast and the Deep Zone are nobody’s.',
);
for (const [slug, places] of Object.entries(HOLDINGS)) {
  console.log(`    ${FACTIONS[slug].name.padEnd(32)} ${places.join(', ')}`);
}

/*
 * Finally the compounded question, which is the one that decides whether this is a mechanic:
 * across a year of one world, how many scrap does the politics move on a camp that buys the
 * dearest offer once a fortnight?
 */
const A_YEAR = Math.round((365 * 24) / ERA_HOURS);
let spentFlat = 0;
let spentReal = 0;
for (let world = 1; world <= WORLDS; world += 1) {
  for (let era = 0; era < A_YEAR; era += 1) {
    const at = WORLD_EPOCH + era * ERA_HOURS * HOUR + HOUR;
    const relations = relationsAt(world * 7717, at);
    /* Two buys a season, from whichever crew the camp happens to meet — so, on average, all
       three equally, which is what `caravanVisit`'s uniform draw actually produces. */
    for (const slug of SLUGS) {
      spentFlat += (2 / SLUGS.length) * dearest;
      spentReal += (2 / SLUGS.length) * dearest * priceFactor(warmthAround(relations, slug));
    }
  }
}
console.log(
  `\n  A camp buying the dearest offer twice a season for a year spends` +
    ` ${(spentReal / WORLDS).toFixed(0)} scrap where a politics-free world costs` +
    ` ${(spentFlat / WORLDS).toFixed(0)} — a difference of` +
    ` ${(((spentReal - spentFlat) / spentFlat) * 100).toFixed(2)}% over a year.`,
);
console.log(
  '  Near zero is the right answer there: the swing is a reason to buy *this* season rather' +
    ' than a tax, and a mechanic that moved the yearly total would be a tax.',
);
console.log(
  `  What it is worth per visit is the line above — ${Math.ceil(dearest * priceFactor(-2))}` +
    ` against ${Math.ceil(dearest * priceFactor(2))} scrap on the same goods.`,
);
