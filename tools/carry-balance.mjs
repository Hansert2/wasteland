/**
 * What does a trip actually bring home, and how heavy is it?
 *
 * Phase 13 sets one flat carry cap for everybody, and the plan's rule for it is about the
 * map rather than about a sweep:
 *
 *   > A survivor can carry their kit, what they will need on the longest walk, and what
 *   > that walk is likely to find.
 *
 * Each of those three is a number this measures. The finds term is the 90th percentile
 * rather than the mean, deliberately: a cap set at the average makes the better half of
 * all trips drop something, and a cap nothing ever reaches is a column nobody reads.
 *
 * **Weights are in grams, at Phase 18's conversion of 125 g to the food unit** (decided
 * 2026-09-02, ahead of that phase, so the cap is derived once rather than twice).
 *
 * Run: node --env-file=.env tools/carry-balance.mjs
 */
import { pool } from '../src/db/pool.js';
import { CONFIG } from '../src/game/constants.js';
import { resolveExpedition } from '../src/game/expeditions.js';

const SEEDS = 4000;

/** Phase 18's denomination. One food unit is a meal-sized weight of tins and dry goods. */
const GRAMS_PER_FOOD_UNIT = 125;

/**
 * What one point of hunger costs in food, and therefore in grams.
 *
 * Derived rather than chosen: eating covers `hungerFallPerHour` points an hour and costs
 * `foodPerHour` while it does, so a point of hunger is that ratio of a unit. This is the
 * number that lets a ration's *weight* come out of its *potency* instead of being invented
 * beside it — see WEIGHTS below, where it lands within 5% of a real tin of stew.
 */
const GRAMS_PER_HUNGER_POINT = (CONFIG.foodPerHour / CONFIG.hungerFallPerHour) * GRAMS_PER_FOOD_UNIT;

/**
 * Grams per item.
 *
 * **Rations are derived.** A ration's potency is hunger points, and hunger points have a
 * mass through the stores, so a ration weighs what the same relief would weigh eaten out of
 * the larder. Nothing to anchor and nothing to argue about.
 *
 * **The rest are anchored content, and this is the anchoring pass the plan asked for**: a
 * tablet against a spear against a plate vest. Stated here so they are read as chosen, and
 * so the next person changes them on purpose.
 */
const ANCHORED = {
  rad_x: 20, // a strip of chalky tablets
  rad_scrubber: 120, // a bottle of something worse
  scavenged_parts: 750, // springs, wire, a motor that might still turn
  scrap_spear: 2000, // rebar and tape, carried in one hand
  plate_vest: 9000, // road signs stitched into a jacket; the heaviest thing in the game
};

const { rows: items } = await pool.query('select slug, kind, potency from items');
const bySlug = new Map(items.map((i) => [i.slug, i]));

const WEIGHTS = new Map(
  items.map((i) => [
    i.slug,
    i.kind === 'ration'
      ? Math.round(Number(i.potency) * GRAMS_PER_HUNGER_POINT)
      : (ANCHORED[i.slug] ?? 0),
  ]),
);

const { rows: regions } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by travel_hours, danger`,
);

const survivor = { health: 100, skillScavenging: 1, inventory: [] };

/** The mass a trip brings home, trip by trip, so the distribution can be read off it. */
function trips(region) {
  const masses = [];
  const counts = [];
  const seen = new Map();

  for (let seed = 0; seed < SEEDS; seed++) {
    const out = resolveExpedition({
      region: {
        name: region.name,
        danger: region.danger,
        loot: region.loot,
        finds: region.finds,
        radiationPerTrip: Number(region.radiation_per_trip),
      },
      survivor,
      seed,
    });

    if (out.died) continue; // nothing comes home, and nothing to carry it in

    let grams = 0;
    let qty = 0;
    for (const f of out.finds) {
      grams += (WEIGHTS.get(f.slug) ?? 0) * f.qty;
      qty += f.qty;
      seen.set(f.slug, (seen.get(f.slug) ?? 0) + f.qty);
    }
    masses.push(grams);
    counts.push(qty);
  }

  masses.sort((a, b) => a - b);
  counts.sort((a, b) => a - b);
  return { masses, counts, seen };
}

const at = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const kg = (g) => (g >= 1000 ? `${(g / 1000).toFixed(1)} kg` : `${Math.round(g)} g`);

console.log(`\nOne food unit = ${GRAMS_PER_FOOD_UNIT} g, so one point of hunger = ${GRAMS_PER_HUNGER_POINT.toFixed(1)} g.`);
console.log('\n=== what an item weighs ===');
console.log('  item                 kind        grams   how');
console.log('  ' + '-'.repeat(62));
for (const i of items) {
  const how = i.kind === 'ration' ? `derived: ${Number(i.potency)} hunger` : 'anchored';
  console.log(
    `  ${i.slug.padEnd(20)} ${i.kind.padEnd(10)} ${String(WEIGHTS.get(i.slug)).padStart(6)}   ${how}`,
  );
}

console.log('\n=== what a trip brings home ===');
console.log('  region                  h   finds/trip        p50      p90      max');
console.log('  ' + '-'.repeat(70));

const measured = new Map();
for (const region of regions) {
  const t = trips(region);
  measured.set(region.slug, t);
  const mean = t.counts.reduce((a, b) => a + b, 0) / t.counts.length;
  console.log(
    `  ${region.name.padEnd(22)} ${String(Number(region.travel_hours)).padStart(2)}` +
      `   ${mean.toFixed(2).padStart(8)}   ${kg(at(t.masses, 0.5)).padStart(8)}` +
      ` ${kg(at(t.masses, 0.9)).padStart(8)} ${kg(t.masses.at(-1)).padStart(8)}`,
  );
}

/*
 * The cap, assembled from the rule's three terms.
 *
 * The longest walk is the one that sets it: it is the trip that needs the most carried with
 * it and, being long, tends to find the most as well.
 */
const longest = regions.reduce((a, b) => (Number(a.travel_hours) >= Number(b.travel_hours) ? a : b));
const hours = Number(longest.travel_hours);

const stew = bySlug.get('tinned_stew');
const radx = bySlug.get('rad_x');

// Enough food to cover the hunger the walk accrues with a camp that has run dry behind you,
// and enough tablets to clear the dose it hands you.
const rations = Math.ceil((hours * CONFIG.hungerRisePerHour) / Number(stew.potency));
const tablets = Math.ceil(Number(longest.radiation_per_trip) / Number(radx.potency));

const kit = WEIGHTS.get('scrap_spear') + WEIGHTS.get('plate_vest');
const supplies = rations * WEIGHTS.get('tinned_stew') + tablets * WEIGHTS.get('rad_x');
const haul = at(measured.get(longest.slug).masses, 0.9);
const worstHaul = Math.max(...[...measured.values()].map((t) => at(t.masses, 0.9)));

console.log(`\n=== the cap, on the longest walk: ${longest.name} (${hours}h) ===`);
console.log(`  kit          spear + vest                       ${kg(kit).padStart(9)}`);
console.log(`  supplies     ${rations} ration(s) + ${tablets} tablet(s)              ${kg(supplies).padStart(9)}`);
console.log(`  finds (p90)  what that walk is likely to bring   ${kg(haul).padStart(9)}`);
console.log('  ' + '-'.repeat(56));
console.log(`  cap                                             ${kg(kit + supplies + haul).padStart(9)}`);
console.log(`\n  worst region's p90 haul is ${kg(worstHaul)}, so the cap binds`);
console.log(`  there at ${kg(kit + supplies + worstHaul)} if the kit is worn on that walk too.`);

/*
 * The number the player actually meets.
 *
 * A cap is not a per-trip limit — finds accumulate in the pack until somebody walks them to
 * the box. So what a cap really sets is *how many trips you get before you have to*, and
 * that is the figure to argue about rather than the kilograms.
 *
 * Two columns, because the kit is the whole question: carrying it leaves a quarter of the
 * pack for everything else, and hanging it on a peg at home leaves nearly all of it.
 */
const cap = kit + supplies + haul;

console.log(`\n=== trips before the pack is full, at a ${kg(cap)} cap ===`);
console.log('  region                  p50/trip   with kit   without kit');
console.log('  ' + '-'.repeat(58));

for (const region of regions) {
  const t = measured.get(region.slug);
  const median = at(t.masses, 0.5);
  const mean = t.masses.reduce((a, b) => a + b, 0) / t.masses.length;
  const rate = median || mean; // a median of nothing says nothing about the tenth trip
  const withKit = rate ? (cap - kit - supplies) / rate : Infinity;
  const without = rate ? (cap - supplies) / rate : Infinity;
  const trips = (n) => (Number.isFinite(n) ? n.toFixed(1).padStart(9) : '      n/a');
  console.log(
    `  ${region.name.padEnd(22)} ${kg(rate).padStart(9)}  ${trips(withKit)}   ${trips(without)}`,
  );
}

await pool.end();
