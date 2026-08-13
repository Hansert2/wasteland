import { makeRandom, intBetween, chance } from './random.js';

/**
 * What a trip into a region produced. Pure: no clock, no database, no global
 * randomness — everything is derived from the seed the expedition was dispatched with.
 *
 * @param {object} args
 * @param {object} args.region   danger, loot ranges, finds, radiation
 * @param {object} args.survivor health and scavenging skill at the moment of return
 * @param {number} args.seed
 */
export function resolveExpedition({ region, survivor, seed }) {
  const random = makeRandom(seed);
  const log = [];

  const loot = rollLoot(random, region, survivor, log);
  const finds = rollFinds(random, region, log);
  const radiation = rollRadiation(random, region, log);
  const { damage, cause } = rollHazard(random, region, log);

  // Death is decided here rather than left to the tick, because the survivor has to
  // die of what happened out there — "mauled in the Deep Zone", not "starvation" at
  // whatever the camp's food happened to be that hour.
  const died = damage >= survivor.health;
  if (died) {
    log.push(`They did not make it back from ${region.name}.`);
  } else if (damage > 0) {
    log.push(`They limped home.`);
  } else {
    log.push(`They returned from ${region.name} without incident.`);
  }

  return { loot, finds, radiation, damage, died, cause: died ? cause : null, log };
}

function rollLoot(random, region, survivor, log) {
  const loot = {};
  // Scavenging is worth a tenth more per level over the first.
  const skill = 1 + (Math.max(1, survivor.skillScavenging ?? 1) - 1) * 0.1;

  for (const [kind, [min, max]] of Object.entries(region.loot ?? {})) {
    const amount = Math.round(intBetween(random, min, max) * skill);
    if (amount > 0) {
      loot[kind] = amount;
      log.push(`Scavenged ${amount} ${kind}.`);
    }
  }

  if (Object.keys(loot).length === 0) log.push('They came back empty-handed.');
  return loot;
}

function rollFinds(random, region, log) {
  const finds = [];

  for (const find of region.finds ?? []) {
    if (!chance(random, find.chance)) continue;
    const [min, max] = find.qty ?? [1, 1];
    const qty = intBetween(random, min, max);
    if (qty <= 0) continue;

    finds.push({ slug: find.slug, qty });
    log.push(`Found ${qty} × ${find.slug.replaceAll('_', ' ')}.`);
  }

  return finds;
}

function rollRadiation(random, region, log) {
  const base = Number(region.radiationPerTrip ?? 0);
  if (base <= 0) return 0;

  // Half to one and a half times the region's nominal dose.
  const dose = Math.round(base * (0.5 + random()) * 10) / 10;
  if (dose > 0) log.push(`Took ${dose} rads out there.`);
  return dose;
}

function rollHazard(random, region, log) {
  const danger = Number(region.danger ?? 1);

  if (!chance(random, danger * 0.09)) {
    return { damage: 0, cause: null };
  }

  const damage = intBetween(random, danger * 3, danger * 9);
  const cause = HAZARDS[Math.min(danger, HAZARDS.length) - 1];
  log.push(`${capitalise(cause)} — ${damage} damage.`);

  return { damage, cause };
}

const HAZARDS = [
  'a bad fall',
  'a scavenger ambush',
  'a collapsing floor',
  'something in the dark',
  'the Deep Zone itself',
];

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
