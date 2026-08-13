import { pathToFileURL } from 'node:url';

import { pool } from './pool.js';

/**
 * Game content: regions and items.
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
];

/**
 * Danger runs 1-5 and drives both the hazard chance and how hard it hits. Travel
 * hours are the real cost: the Deep Zone pays well, but it is most of a day during
 * which nobody is at the camp and nobody is scavenging anything else.
 */
const REGIONS = [
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
    finds: [{ slug: 'tinned_stew', chance: 0.35, qty: [1, 3] }],
    radiation_per_trip: 4,
    description: 'Hulls the size of buildings, and whatever lives in them now.',
  },
  {
    slug: 'the_deep_zone',
    name: 'The Deep Zone',
    danger: 5,
    travel_hours: 18,
    loot: { scrap: [25, 60], fuel: [10, 25] },
    finds: [{ slug: 'rad_x', chance: 0.4, qty: [1, 3] }],
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

  return { items: ITEMS.length, regions: REGIONS.length };
}

// Run directly: `npm run seed`. pathToFileURL rather than string-building the URL:
// on Windows Node produces file:///C:/... and a hand-rolled file://C:/... never matches.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const counts = await seed(pool);
    console.log(`seeded ${counts.items} items, ${counts.regions} regions`);
  } catch (error) {
    console.error(`seed failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
