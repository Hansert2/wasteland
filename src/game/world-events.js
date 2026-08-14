import { makeRandom, intBetween } from './random.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Weather for everybody at once.
 *
 * The plan filed this under "flavour on top of a loop, not new decisions", and that
 * is true of any single one of these. It stops being true when two of them pull the
 * same decision in opposite directions: a rad storm makes going out expensive, a
 * caravan season makes it lucrative, and the one question the game already asks —
 * do I send them now or wait — gets an answer that changes week to week.
 *
 * These are global. Every camp is under the same sky, which is what makes an event
 * something that happened to the world rather than something that happened to you.
 * That also makes them pure data: a window with a kind, generated deterministically
 * from one world seed, so nothing here needs a clock or a settlement.
 */

/** The world's calendar starts here. Slots are counted from it. */
export const WORLD_EPOCH = Date.UTC(2026, 0, 1);

/** Average hours between the start of one event and the next. */
export const MEAN_GAP_HOURS = 96;

export const WORLD_EVENTS = {
  rad_storm: {
    name: 'Rad Storm',
    hours: [18, 48],
    // Water is what you catch from the sky, so a dirty sky is dirty water.
    production: { water: 0.4 },
    radiation: 1.8,
    description: 'The sky is the colour of a bruise. Everything outside is hotter than it looks.',
  },
  caravan: {
    name: 'Caravan Season',
    hours: [24, 72],
    // Traffic on the roads means more worth finding, and more people to find it first.
    loot: 1.5,
    description: 'Somebody is moving goods again. The roads are worth walking.',
  },
  blight: {
    name: 'Blight',
    hours: [48, 120],
    production: { food: 0.35 },
    description: 'Whatever is in the soil this season, the garden does not care for it.',
  },
};

const KINDS = Object.keys(WORLD_EVENTS);

/**
 * The nth event the world has ever had.
 *
 * Derived from the world seed and the slot number alone, so every settlement that
 * generates slot 40 generates exactly the same storm — which is what lets this be
 * "global" without anything coordinating.
 */
export function eventForSlot(seed, slot) {
  const random = makeRandom(Number(seed) + slot * 7919);

  const kind = KINDS[Math.floor(random() * KINDS.length)];
  const spec = WORLD_EVENTS[kind];

  // Spread either side of the mean gap so the calendar is not metronomic.
  const startsAt = WORLD_EPOCH + (slot * MEAN_GAP_HOURS + random() * MEAN_GAP_HOURS) * HOUR_MS;
  const hours = intBetween(random, spec.hours[0], spec.hours[1]);

  return { slot, kind, startsAt, endsAt: startsAt + hours * HOUR_MS };
}

/** The last slot whose event could plausibly have started by `at`. */
export function slotAt(at) {
  return Math.max(0, Math.ceil((at - WORLD_EPOCH) / (MEAN_GAP_HOURS * HOUR_MS)));
}

/** Events covering an instant. Several can overlap; the world is not tidy. */
export function activeAt(events, at) {
  return (events ?? []).filter((e) => e.startsAt <= at && at < e.endsAt);
}

/**
 * Production multipliers by resource kind, composed across everything in force.
 * Two blights are worse than one.
 */
export function productionFactors(active) {
  const factors = {};
  for (const event of active) {
    for (const [kind, factor] of Object.entries(WORLD_EVENTS[event.kind]?.production ?? {})) {
      factors[kind] = (factors[kind] ?? 1) * factor;
    }
  }
  return factors;
}

/**
 * What the sky is doing to a trip. Applied to the *results* of rolls and never to
 * the number of rolls taken, the same rule gear follows — an expedition under a clear
 * sky must draw exactly what it drew before world events existed.
 */
export function expeditionFactors(active) {
  let loot = 1;
  let radiation = 1;

  for (const event of active) {
    const spec = WORLD_EVENTS[event.kind] ?? {};
    loot *= spec.loot ?? 1;
    radiation *= spec.radiation ?? 1;
  }

  return { loot, radiation };
}

/** The next moment the weather changes after `cursor`, or Infinity. */
export function nextBoundaryAfter(events, cursor) {
  let next = Infinity;
  for (const event of events ?? []) {
    if (event.startsAt > cursor) next = Math.min(next, event.startsAt);
    if (event.endsAt > cursor) next = Math.min(next, event.endsAt);
  }
  return next;
}
