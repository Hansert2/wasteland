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

/**
 * The sky, and what each kind is *for*.
 *
 * `share` is the fraction of weathered time this kind should occupy, relative to the
 * others. It exists because the first version of this had no such control and the
 * consequence was invisible: three kinds were drawn with equal probability per slot,
 * their durations spanned two and a half times, and so the time a player actually spent
 * under each was nothing like equal. Measured, ninety days across five worlds: blight
 * in force 31% of hours, caravan 19%, rad storm 9%.
 *
 * **The game's dominant weather was the one with no decision attached, and the one
 * worth reading was the rarest.** A blight is a thing that happens to you — you cannot
 * build against it and there is no move except to have banked food. A rad storm is the
 * one event that genuinely changes what you do that afternoon. Getting those the wrong
 * way round is not a balance nudge, it is the feature pointing backwards.
 *
 * So intent is declared here and the draw is derived from it — see `WEIGHTS`. Duration
 * is now free to say what an event *is*: dust blows through in an afternoon, a blight
 * settles in for days, and neither fact leaks into how often you meet it.
 */
export const WORLD_EVENTS = {
  rad_storm: {
    name: 'Rad Storm',
    hours: [18, 48],
    share: 14,
    // Water is what you catch from the sky, so a dirty sky is dirty water.
    production: { water: 0.4 },
    radiation: 1.8,
    description: 'The sky is the colour of a bruise. Everything outside is hotter than it looks.',
  },
  caravan: {
    name: 'Caravan Season',
    hours: [24, 72],
    share: 15,
    // Traffic on the roads means more worth finding, and more people to find it first.
    loot: 1.5,
    description: 'Somebody is moving goods again. The roads are worth walking.',
  },
  blight: {
    name: 'Blight',
    hours: [48, 120],
    // Was a third of all weather by accident. It is the least interesting thing the sky
    // does — there is no move against it, only having banked food — so it keeps its
    // long duration, which is what a blight *is*, and gives up its frequency.
    share: 12,
    production: { food: 0.35 },
    description: 'Whatever is in the soil this season, the garden does not care for it.',
  },

  /**
   * The four below, and the first three of them are the point.
   *
   * The old sky was 40% against the player and 19% for, and the only thing that ever
   * helped helped *expeditions*. Nothing the sky did was ever good news for the camp,
   * which made "check the sky" a matter of finding out how you were being taxed. A
   * player should sometimes look up and change their plans because something is going
   * well, and none of these needed a new mechanism — the production lever has been
   * sitting there since the first three were written, pointing only downward.
   */
  long_light: {
    name: 'Long Light',
    hours: [24, 60],
    share: 12,
    production: { food: 1.5 },
    description: 'The season has turned and stayed turned. Things are growing that had stopped.',
  },
  hard_rain: {
    name: 'Hard Rain',
    hours: [8, 20],
    share: 9,
    production: { water: 2.2 },
    description:
      'It has not stopped since the night before last. Everything in the camp that holds water is out in it.',
  },
  the_slip: {
    name: 'The Slip',
    hours: [12, 30],
    share: 9,
    // The only event that touches scrap, and the only one that is unambiguously an
    // opportunity: the camp makes more of the resource everything else is priced in.
    production: { scrap: 1.8 },
    description:
      'Something large came down in the night, out past the wire. It is in pieces now, and the pieces are close.',
  },
  dust: {
    name: 'Dust',
    // Short on purpose, and it is the shortness that makes it a decision rather than a
    // tax: the correct answer to dust is to wait it out, and an afternoon is a wait a
    // player will actually take. The same penalty over four days would only be a worse
    // week.
    hours: [6, 14],
    share: 9,
    loot: 0.6,
    description:
      'The air is full of it and the light is the wrong colour. Nobody who went out this morning found much.',
  },
};

const KINDS = Object.keys(WORLD_EVENTS);

/**
 * How likely each kind is to be drawn, so that `share` is what the player experiences.
 *
 * A kind that lasts twice as long fills twice as much of the calendar per draw, so to
 * hold a stated share of *time* it must be drawn half as often: weight is share over
 * mean duration. That is the whole trick, and it is the thing the first version was
 * missing rather than a tuning pass on top of it.
 *
 * Derived rather than written down, so adding an event means choosing what it is and
 * how long it lasts and nothing else — the arithmetic that keeps the calendar honest is
 * not something content should have to remember.
 */
const WEIGHTS = KINDS.map((kind) => {
  const spec = WORLD_EVENTS[kind];
  const meanHours = (spec.hours[0] + spec.hours[1]) / 2;
  return (spec.share ?? 1) / meanHours;
});
const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);

/**
 * The kind a single draw lands on.
 *
 * **One draw, in the position the uniform pick used to occupy.** Everything downstream
 * — the start hour, the duration — comes off the same generator, so inserting or
 * reordering a draw here would re-roll every event in every world's history. The
 * mapping from that one number to a kind is all that changed.
 *
 * Slots already generated and stored keep whatever they were: `ensureWorldEvents`
 * inserts with `on conflict do nothing`, so the past is what the database says it is
 * and only unwritten slots follow the new shares. A calendar that rewrote its own
 * history on a deploy would be a worse bug than the skew this fixes.
 */
function kindFor(roll) {
  let cursor = roll * TOTAL_WEIGHT;
  for (let i = 0; i < KINDS.length; i += 1) {
    cursor -= WEIGHTS[i];
    if (cursor < 0) return KINDS[i];
  }
  return KINDS[KINDS.length - 1];
}

/**
 * The nth event the world has ever had.
 *
 * Derived from the world seed and the slot number alone, so every settlement that
 * generates slot 40 generates exactly the same storm — which is what lets this be
 * "global" without anything coordinating.
 */
export function eventForSlot(seed, slot) {
  const random = makeRandom(Number(seed) + slot * 7919);

  const kind = kindFor(random());
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

/**
 * What an event does, as a list the page can print.
 *
 * Derived from the same `WORLD_EVENTS` entry the simulation multiplies by, rather than
 * written out again next to the prose. The sky used to be two sentences and a
 * countdown: you were told there was a blight and left to notice, over some days, that
 * the garden had slowed down. A player who cannot see the number cannot plan around it,
 * and the whole decision the weather offers is *when to spend survivor-hours* — which
 * is not a decision at all if the multiplier is a secret.
 *
 * Order is fixed rather than object order: stores first because that is what the camp
 * is doing to itself, then the two that only apply out there. `where` lets the page
 * group them without knowing what any particular kind contains.
 */
export function effectsOf(kind) {
  const spec = WORLD_EVENTS[kind] ?? {};
  const effects = [];

  for (const resource of ['food', 'water', 'scrap', 'fuel']) {
    const factor = spec.production?.[resource];
    if (factor !== undefined && factor !== 1) {
      effects.push({ what: resource, factor, where: 'camp' });
    }
  }

  if (spec.loot !== undefined && spec.loot !== 1) {
    effects.push({ what: 'haul', factor: spec.loot, where: 'road' });
  }
  if (spec.radiation !== undefined && spec.radiation !== 1) {
    effects.push({ what: 'dose', factor: spec.radiation, where: 'road' });
  }

  return effects;
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
