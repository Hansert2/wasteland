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
    requires_workshop: 1,
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
    requires_workshop: 1,
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
    requires_workshop: 2,
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
    requires_workshop: 2,
    craft_hours: 0.3,
    description: 'Farmland and the Deep Zone both become survivable with enough of these.',
  },
];

/**
 * Danger runs 1-5 and drives both the hazard chance and how hard it hits. Travel
 * hours are the real cost: the Deep Zone pays well, but it is most of a day during
 * which nobody is at the camp and nobody is scavenging anything else.
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
    radiation_per_trip: 8,
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
    radiation_per_trip: 2,
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
    radiation_per_trip: 4,
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
    radiation_per_trip: 25,
    description: 'Nobody agrees on what is down there. Few go twice.',
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
      `insert into regions (slug, name, danger, travel_hours, description, loot, finds, radiation_per_trip)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (slug) do update
         set name = excluded.name, danger = excluded.danger,
             travel_hours = excluded.travel_hours, description = excluded.description,
             loot = excluded.loot, finds = excluded.finds,
             radiation_per_trip = excluded.radiation_per_trip`,
      [
        region.slug,
        region.name,
        region.danger,
        region.travel_hours,
        region.description,
        JSON.stringify(region.loot),
        JSON.stringify(region.finds),
        region.radiation_per_trip,
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
