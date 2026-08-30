import { pathToFileURL } from 'node:url';

import { pool } from './pool.js';

/**
 * Game content: regions, items and recipes.
 *
 * Content lives in a seed script rather than a migration because it gets edited
 * during balance passes, and a migration that has already run cannot be edited.
 * Every statement upserts on the natural key, so this is safe to run repeatedly.
 */

const ITEMS = [
  {
    slug: 'tinned_stew',
    name: 'Tinned Stew',
    kind: 'ration',
    potency: 80,
    description: 'Older than you are. Still food.',
  },
  {
    slug: 'rad_x',
    name: 'Rad-X',
    kind: 'antirad',
    potency: 60,
    description: 'Chalky tablets that scrub the worst of it out.',
  },
  {
    // Potency 0: a material does nothing when carried. It exists to be spent, and it
    // is the reason a recipe is a recipe rather than a shop counter.
    slug: 'scavenged_parts',
    name: 'Scavenged Parts',
    kind: 'material',
    potency: 0,
    description: 'Springs, wire, a motor that might still turn.',
  },
  {
    slug: 'scrap_spear',
    name: 'Scrap Spear',
    kind: 'weapon',
    potency: 25,
    description: 'Rebar, tape, and the confidence to keep something at arm’s length.',
  },
  {
    slug: 'plate_vest',
    name: 'Plate Vest',
    kind: 'armour',
    potency: 30,
    description: 'Road signs, cut down and stitched into a jacket. Heavy. Worth it.',
  },
  {
    slug: 'preserved_meal',
    name: 'Preserved Meal',
    kind: 'ration',
    potency: 70,
    description: 'Camp food, sealed while it was still worth sealing.',
  },
  {
    slug: 'rad_scrubber',
    name: 'Rad Scrubber',
    kind: 'antirad',
    potency: 45,
    description: 'Home-run chelation. Unpleasant, and better than the alternative.',
  },
];

/**
 * What the workshop can make.
 *
 * `costs` are settlement stores; `inputs` are items off the survivor's back. The
 * split matters: stores accumulate on their own while you are offline, so a recipe
 * priced only in stores is priced in patience. Pricing gear in `scavenged_parts`
 * makes it cost a trip into somewhere unpleasant instead.
 */
const RECIPES = [
  {
    slug: 'scrap_spear',
    name: 'Scrap Spear',
    output: 'scrap_spear',
    output_qty: 1,
    costs: { scrap: 20 },
    inputs: [],
    requires_workshop: 2,
    craft_hours: 0.1,
    description: 'Something to hold between you and whatever is in the dark.',
  },
  {
    slug: 'preserved_meal',
    name: 'Preserved Meal',
    output: 'preserved_meal',
    output_qty: 2,
    costs: { food: 20, scrap: 5 },
    inputs: [],
    requires_workshop: 2,
    craft_hours: 0.05,
    description: 'Turn a surplus you cannot store into a reserve you can carry.',
  },
  {
    slug: 'plate_vest',
    name: 'Plate Vest',
    output: 'plate_vest',
    output_qty: 1,
    costs: { scrap: 45 },
    inputs: [{ slug: 'scavenged_parts', qty: 2 }],
    requires_workshop: 4,
    craft_hours: 0.4,
    description: 'The difference between limping home and not coming home.',
  },
  {
    slug: 'rad_scrubber',
    name: 'Rad Scrubber',
    output: 'rad_scrubber',
    output_qty: 2,
    costs: { scrap: 15, fuel: 10 },
    inputs: [{ slug: 'scavenged_parts', qty: 1 }],
    requires_workshop: 4,
    craft_hours: 0.3,
    description: 'Farmland and the Deep Zone both become survivable with enough of these.',
  },
];

/**
 * Danger runs 1-5 and drives both the hazard chance and how hard it hits. Travel
 * hours are the real cost: the Deep Zone pays well, but it is most of a day during
 * which nobody is at the camp and nobody is scavenging anything else.
 */
/*
 * A note on `radiation_per_trip`, rewritten 2026-08-30.
 *
 * These used to be doses the walk itself scrubbed away. At 0.8 rads an hour a twelve-hour
 * trip removed 9.6 against Coastal Wreckage's listed 4, so four regions advertised a dose
 * and delivered a mean of nothing: Millrace 1 -> 0.0, Bunkers 2 -> 0.0, Coastal 4 -> 0.1,
 * Sixteen Wells 6 -> 0.8. The listed number was not a number.
 *
 * The road no longer scrubs (see `tick.js`), so what a region says is what it doses. The
 * figures came down to keep the game exactly where it was, and they were tuned by
 * measurement rather than by arithmetic — dividing by the observed sky factor was tried
 * first and missed, because that factor was measured across a spread of 0 to 47 rads and
 * was mostly noise. `fuel-balance.mjs`, before and after:
 *
 *     region                baseline   after   idle before -> after
 *     Underground Bunkers     13.0     13.0        0% ->  0%
 *     Coastal Wreckage        19.4     19.4        0% ->  0%
 *     Sixteen Wells            8.2      7.9        0% ->  5%
 *     The Deep Zone           13.6     14.1       40% -> 39%
 *     The Waterworks          14.3     14.7       44% -> 43%
 *     Harrow End              20.2     20.1       22% -> 23%
 *
 * Harrow End still out-earns Coastal Wreckage, so the danger-5 inversion stays closed.
 *
 * Coastal, the Millrace and the Bunkers now carry a zero, which is the truth and is what
 * `docs/LORE.md` section 2 already said: the farmland and the Deep Zone are hot, and they
 * are the only places that are.
 */
const REGIONS = [
  /**
   * The two short ones exist because time was never what made the early game slow —
   * scrap was. Nothing in a new camp produces any, so before these the opening move
   * was a four-hour walk, and no build curve however fast could change that. These
   * are minutes long and pay little, which is the point: they are the loop that gets
   * a camp to the level where the long walks are worth taking.
   */
  {
    slug: 'the_fence_line',
    name: 'The Fence Line',
    danger: 1,
    travel_hours: 0.17,
    loot: { scrap: [2, 6], food: [0, 2] },
    finds: [],
    radiation_per_trip: 0,
    description: 'As far as the wire and back. Ten minutes, and never nothing.',
  },
  {
    slug: 'the_service_road',
    name: 'The Old Service Road',
    danger: 1,
    travel_hours: 0.75,
    loot: { scrap: [6, 14], water: [0, 4] },
    finds: [{ slug: 'tinned_stew', chance: 0.15, qty: [1, 1] }],
    radiation_per_trip: 0,
    description: 'Follows the pylons out and comes back the same way. Picked over, but close.',
  },
  {
    slug: 'ruined_city',
    name: 'The Ruined City',
    danger: 1,
    travel_hours: 4,
    loot: { scrap: [4, 14], food: [0, 5], water: [0, 3] },
    finds: [{ slug: 'tinned_stew', chance: 0.25, qty: [1, 1] }],
    radiation_per_trip: 0,
    description: 'Picked over a hundred times, but the city is large.',
  },
  {
    slug: 'irradiated_farmland',
    name: 'Irradiated Farmland',
    danger: 2,
    travel_hours: 6,
    loot: { food: [6, 18], water: [2, 8], scrap: [0, 4] },
    finds: [{ slug: 'rad_x', chance: 0.15, qty: [1, 1] }],
    radiation_per_trip: 2,
    description: 'Things still grow here. That is the problem.',
  },
  {
    slug: 'underground_bunkers',
    name: 'Underground Bunkers',
    danger: 3,
    travel_hours: 9,
    loot: { scrap: [10, 25], fuel: [2, 8], food: [0, 6] },
    finds: [
      { slug: 'rad_x', chance: 0.2, qty: [1, 2] },
      { slug: 'tinned_stew', chance: 0.3, qty: [1, 2] },
      { slug: 'scavenged_parts', chance: 0.3, qty: [1, 1] },
    ],
    radiation_per_trip: 0,
    description: 'Sealed for a reason. Sealed things keep well.',
  },
  {
    slug: 'coastal_wreckage',
    name: 'Coastal Wreckage',
    danger: 4,
    travel_hours: 12,
    loot: { scrap: [15, 35], fuel: [5, 15], water: [5, 15] },
    finds: [
      { slug: 'tinned_stew', chance: 0.35, qty: [1, 3] },
      { slug: 'scavenged_parts', chance: 0.4, qty: [1, 2] },
    ],
    radiation_per_trip: 0,
    description: 'Hulls the size of buildings, and whatever lives in them now.',
  },
  {
    slug: 'the_deep_zone',
    name: 'The Deep Zone',
    danger: 5,
    travel_hours: 18,
    loot: { scrap: [25, 60], fuel: [10, 25] },
    finds: [
      { slug: 'rad_x', chance: 0.4, qty: [1, 3] },
      { slug: 'scavenged_parts', chance: 0.55, qty: [2, 3] },
    ],
    radiation_per_trip: 10,
    description: 'Nobody agrees on what is down there. Few go twice.',
  },

  /**
   * The four the road opens. `requires_link` is the link that reaches them, and until
   * it is made these rows exist and are simply not offered.
   *
   * They are not stronger than the Deep Zone so much as *other*. Loot per hour stays
   * flat across the long regions on purpose — ranges and travel times escalate together
   * and cancel — so a new place earns its keep by paying in a different mix, not by
   * paying more. The Millrace is the only long region that pays water; Sixteen Wells is
   * the best odds on parts in the game; the Waterworks is fuel at a price in rads; and
   * Harrow End is simply the longest trip there is, which is the one thing no existing
   * region can offer a player who checks in twice a day.
   */
  {
    slug: 'the_millrace',
    name: 'The Millrace',
    danger: 3,
    travel_hours: 8,
    requires_link: 1,
    loot: { water: [10, 24], scrap: [6, 16], food: [0, 6] },
    finds: [
      { slug: 'preserved_meal', chance: 0.25, qty: [1, 2] },
      { slug: 'scavenged_parts', chance: 0.3, qty: [1, 1] },
    ],
    radiation_per_trip: 0,
    description: 'The wheel still turns. Somebody kept it turning for a long time.',
  },
  {
    slug: 'sixteen_wells',
    name: 'Sixteen Wells',
    danger: 4,
    travel_hours: 14,
    requires_link: 3,
    loot: { water: [12, 30], scrap: [10, 24], fuel: [2, 8] },
    finds: [
      { slug: 'scavenged_parts', chance: 0.5, qty: [1, 2] },
      { slug: 'tinned_stew', chance: 0.3, qty: [1, 2] },
      { slug: 'rad_x', chance: 0.25, qty: [1, 1] },
    ],
    radiation_per_trip: 1,
    description: 'Sixteen shafts, and the water in them has never seen the sky.',
  },
  {
    slug: 'the_waterworks',
    name: 'The Waterworks',
    danger: 5,
    travel_hours: 20,
    requires_link: 5,
    loot: { fuel: [14, 30], scrap: [20, 45], water: [0, 8] },
    finds: [
      { slug: 'rad_x', chance: 0.45, qty: [1, 3] },
      { slug: 'scavenged_parts', chance: 0.5, qty: [2, 3] },
    ],
    radiation_per_trip: 13,
    description: 'Pumps the size of houses, and something still drawing power to them.',
  },
  {
    slug: 'harrow_end',
    name: 'Harrow End',
    danger: 5,
    travel_hours: 26,
    requires_link: 7,
    loot: { scrap: [35, 80], fuel: [18, 40] },
    finds: [
      { slug: 'scavenged_parts', chance: 0.6, qty: [2, 4] },
      { slug: 'rad_x', chance: 0.4, qty: [2, 3] },
    ],
    radiation_per_trip: 7,
    description: 'The far end of the road, and the reason there is a road.',
  },
];

export async function seed(client) {
  for (const item of ITEMS) {
    await client.query(
      `insert into items (slug, name, kind, potency, description)
       values ($1, $2, $3, $4, $5)
       on conflict (slug) do update
         set name = excluded.name, kind = excluded.kind,
             potency = excluded.potency, description = excluded.description`,
      [item.slug, item.name, item.kind, item.potency, item.description],
    );
  }

  for (const region of REGIONS) {
    await client.query(
      `insert into regions (slug, name, danger, travel_hours, description, loot, finds, radiation_per_trip, requires_link)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (slug) do update
         set name = excluded.name, danger = excluded.danger,
             travel_hours = excluded.travel_hours, description = excluded.description,
             loot = excluded.loot, finds = excluded.finds,
             radiation_per_trip = excluded.radiation_per_trip,
             requires_link = excluded.requires_link`,
      [
        region.slug,
        region.name,
        region.danger,
        region.travel_hours,
        region.description,
        JSON.stringify(region.loot),
        JSON.stringify(region.finds),
        region.radiation_per_trip,
        region.requires_link ?? null,
      ],
    );
  }

  // Recipes last: every one of them points at an item that must already exist.
  for (const recipe of RECIPES) {
    const { rowCount } = await client.query(
      `insert into recipes
         (slug, name, output_item_id, output_qty, costs, inputs, requires_workshop, craft_hours, description)
       select $1, $2, i.id, $3, $4, $5, $6, $7, $8 from items i where i.slug = $9
       on conflict (slug) do update
         set name = excluded.name, output_item_id = excluded.output_item_id,
             output_qty = excluded.output_qty, costs = excluded.costs,
             inputs = excluded.inputs, requires_workshop = excluded.requires_workshop,
             craft_hours = excluded.craft_hours, description = excluded.description`,
      [
        recipe.slug,
        recipe.name,
        recipe.output_qty,
        JSON.stringify(recipe.costs),
        JSON.stringify(recipe.inputs),
        recipe.requires_workshop,
        recipe.craft_hours,
        recipe.description,
        recipe.output,
      ],
    );
    // `insert ... select` writes nothing when the output item is missing, which would
    // otherwise be a silently absent recipe rather than an error.
    if (rowCount === 0) {
      throw new Error(`recipe ${recipe.slug} names an unknown output item: ${recipe.output}`);
    }
  }

  return { items: ITEMS.length, regions: REGIONS.length, recipes: RECIPES.length };
}

// Run directly: `npm run seed`. pathToFileURL rather than string-building the URL:
// on Windows Node produces file:///C:/... and a hand-rolled file://C:/... never matches.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = await seed(pool);
    console.log(
      `seeded ${counts.items} items, ${counts.regions} regions, ${counts.recipes} recipes`,
    );
  } catch (error) {
    console.error(`seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
