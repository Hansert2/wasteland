/**
 * What time it is in the world, and how much of a trip happened in the light.
 *
 * The camp already knows what the sky is doing. It does not know what hour it is, and the
 * hour is the only thing that changes what the sky costs you. This module is that hour.
 *
 * **Pure, and stateless in the strongest sense.** Nothing here is stored, generated,
 * seeded or cached — every answer is arithmetic on an epoch millisecond. There is no
 * world-time row to migrate, nothing for the tick to carry in `State`, and no way for two
 * camps to disagree about what o'clock it is. That is the whole reason the clock could be
 * built before the roster: it adds a decision without adding a fact.
 *
 * **World time is UTC**, for the reason `world_events` has no `settlement_id`: every camp
 * is under the same sky, and a sky that told two players different hours would be two
 * skies. Computed by arithmetic rather than through `Date` getters so that a machine set
 * to Chicago and a machine set to Seoul cannot possibly answer differently — the Unix
 * epoch is midnight UTC, so the fractional part of `now / DAY_MS` *is* the fraction of the
 * world's day, on every platform, with no timezone database involved.
 *
 * **The year is real.** The world runs at one hour to the hour from `WORLD_EPOCH`, so a
 * real year is a world year and the seasons cost one cosine term. That was not built for
 * flavour: it turns out to move which choices a long trip *has* rather than only what they
 * are worth — see the reach table in `docs/PLAN.md` — because a trip longer than the night
 * cannot be sent into it, and in high summer the night is six hours.
 */

import {
  activeAt,
  integrateFactors,
  nextBoundaryAfter,
  warmthOf,
} from './world-events.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The mean tropical year, which is what makes the seasons come back to the same place.
 *
 * A flat 365 would drift a full day every four years and put midsummer in the wrong month
 * inside a decade; this is off by about a day per three thousand years, which is not a
 * problem this game will have. Deliberately not a leap-year calendar: nothing here needs
 * to know what date it is, only how far round the year it is, and a fraction is the
 * honest way to say that.
 */
const YEAR_DAYS = 365.2425;

/**
 * The winter solstice the world's seasons are measured from — the shortest day, eleven
 * days before `WORLD_EPOCH`.
 *
 * Written as an instant rather than as an offset from the epoch because it is an
 * astronomical fact and the epoch is a bookkeeping one. They are near each other by
 * coincidence, and tying the seasons to the weather calendar's start would make retuning
 * one silently move the other.
 */
const WINTER_SOLSTICE = Date.UTC(2025, 11, 21);

/** Hours of daylight at the equinox, and how far the solstices swing either side of it. */
const MEAN_DAYLIGHT_HOURS = 12;
const DAYLIGHT_SWING_HOURS = 3;

/**
 * Solar noon, in world hours.
 *
 * Fixed at midday rather than derived, because the world has one longitude by
 * construction. Daylight is symmetric about it, which is what keeps sunrise and sunset a
 * single number apart and lets everything below be stated in terms of that number.
 */
const SOLAR_NOON = 12;

/**
 * The five bands, in the order the day runs through them.
 *
 * These are what the page says before the camp can afford a clock, and they are always
 * free to read: the *mechanic* is never a secret here, only the precision. A player
 * without the clock knows it is night and knows the night is kinder on the counter; what
 * they cannot do is tell you when it stops being night.
 *
 * Boundaries are fractions of the daylight span rather than fixed hours, so the bands
 * keep their proportions as the season stretches them. `before dawn` and the hour after
 * sunset are the two exceptions, held at a constant length: twilight does not get longer
 * because the day did.
 */
export const BANDS = ['before dawn', 'morning', 'the heat of the day', 'evening', 'night'];

const DAWN_HOURS = 1.5;
const DUSK_HOURS = 1;
const MORNING_ENDS = 0.35;
const HEAT_ENDS = 0.75;

/** Days elapsed since the reference solstice, as a fraction of a year. */
function yearPhase(at) {
  const days = (at - WINTER_SOLSTICE) / DAY_MS;
  const turns = days / YEAR_DAYS;
  return turns - Math.floor(turns);
}

/**
 * How many hours of daylight the world gets on the day containing `at`.
 *
 * Minimum at the winter solstice, maximum at the summer one, and the cosine between. Nine
 * hours to fifteen: the swing is deliberately wide, because a season that moves the
 * daylight by an hour would move nothing a player could plan around.
 */
export function daylightHoursAt(at) {
  return MEAN_DAYLIGHT_HOURS - DAYLIGHT_SWING_HOURS * Math.cos(2 * Math.PI * yearPhase(at));
}

/**
 * Sunrise and sunset for the world day containing `at`, in world hours.
 *
 * Symmetric about solar noon, so the pair is always `SOLAR_NOON ± L/2`. The widest the
 * day ever gets is fifteen hours, which puts sunrise at 04:30 and sunset at 19:30 — both
 * comfortably inside the day, so **the lit window never crosses midnight** and nothing
 * downstream has to handle a wrap.
 */
export function sunAt(at) {
  const hours = daylightHoursAt(at);
  return { sunrise: SOLAR_NOON - hours / 2, sunset: SOLAR_NOON + hours / 2, hours };
}

/** The world hour of `at`, as a fraction: 13.5 is half past one in the afternoon. */
export function hourAt(at) {
  const days = at / DAY_MS;
  return (days - Math.floor(days)) * 24;
}

/**
 * What time it is in the world, for a page to print.
 *
 * `hour` and `minute` are what a repaired clock shows; `band` is what anybody can see by
 * looking up. Both come off the same instant, so a camp with a clock and a camp without
 * are never describing different afternoons.
 */
export function worldTimeAt(at) {
  requireInstant(at, 'worldTimeAt');

  const hour = hourAt(at);
  return {
    hour: Math.floor(hour),
    minute: Math.floor((hour % 1) * 60),
    band: bandAt(at),
    daylightHours: daylightHoursAt(at),
    ...sunAt(at),
  };
}

/** Which of the five bands `at` falls in. */
export function bandAt(at) {
  requireInstant(at, 'bandAt');

  const hour = hourAt(at);
  const { sunrise, sunset, hours } = sunAt(at);

  if (hour < sunrise - DAWN_HOURS) return 'night';
  if (hour < sunrise) return 'before dawn';
  if (hour < sunrise + hours * MORNING_ENDS) return 'morning';
  if (hour < sunrise + hours * HEAT_ENDS) return 'the heat of the day';
  if (hour < sunset + DUSK_HOURS) return 'evening';
  return 'night';
}

/**
 * The next instant the band changes — what a page showing the band has to wake up for.
 *
 * The turn of the light is not enough on its own: `evening` begins three-quarters of the
 * way through the daylight and `night` an hour after sunset, so a strip armed only for
 * sunrise and sunset would sit on a stale word for hours. Walked in minutes rather than
 * solved, because the boundaries are fractions of a daylight span that itself moves, and
 * a day is 1,440 of them.
 */
export function nextBandChange(at) {
  requireInstant(at, 'nextBandChange');

  const here = bandAt(at);
  const minute = 60_000;

  for (let step = 1; step <= 24 * 60; step += 1) {
    const when = at + step * minute;
    if (bandAt(when) !== here) return when;
  }

  return at + DAY_MS;
}

/** Whether the sun is up at `at`. */
export function isLit(at) {
  const hour = hourAt(at);
  const { sunrise, sunset } = sunAt(at);
  return hour >= sunrise && hour < sunset;
}

/**
 * The share of `[from, to)` that fell in daylight — the `d` everything else is built on.
 *
 * **Integrated, not sampled, and this is the constraint rather than a preference.** The
 * dispatch table will tell the player how many hours of a proposed trip fall in the dark
 * *before they commit*, and a reading taken at either end would make that sentence false:
 * a trip nine-tenths in daylight that happened to arrive at half past midnight would score
 * as a pure night trip, and "always arrive at 2am" would beat choosing a destination.
 *
 * Walked day by day rather than solved, because the length of the day changes across a
 * long trip and the arithmetic for "how much of this window was lit" is only simple
 * within one of them. A trip is at most twenty-six hours, so this is two iterations.
 *
 * Returns 0.5 — the neutral value, the one that scales nothing — for an empty window,
 * matching `integrateFactors` returning 1.0 for the same case.
 */
export function daylightFraction(from, to) {
  requireInstant(from, 'daylightFraction');
  requireInstant(to, 'daylightFraction');

  const span = to - from;
  if (span <= 0) return 0.5;

  let lit = 0;
  const firstDay = Math.floor(from / DAY_MS);
  const lastDay = Math.floor((to - 1) / DAY_MS);

  for (let day = firstDay; day <= lastDay; day += 1) {
    const midnight = day * DAY_MS;
    const { sunrise, sunset } = sunAt(midnight);

    const litFrom = midnight + sunrise * HOUR_MS;
    const litTo = midnight + sunset * HOUR_MS;

    lit += Math.max(0, Math.min(to, litTo) - Math.max(from, litFrom));
  }

  return lit / span;
}

/**
 * The same window as hours of light and hours of dark, which is what the dispatch table
 * says once the camp has a clock: "6h light, 3h dark".
 */
export function splitOf(from, to) {
  const span = Math.max(0, to - from) / HOUR_MS;
  const light = daylightFraction(from, to) * span;
  return { light, dark: span - light };
}

function requireInstant(at, who) {
  if (!Number.isFinite(at)) {
    throw new TypeError(`${who}: expected an epoch-ms number`);
  }
}

// ---------------------------------------------------------------------------
// Temperature, and the one thing it decides.
// ---------------------------------------------------------------------------

/**
 * The world's temperature in degrees: annual mean, and how far the solstices swing it.
 *
 * Fictional and globally consistent, like the hour and for the same reason. Seven degrees
 * at midwinter and thirty-three at midsummer — a wide year, because a season that moved
 * the thermometer by three degrees would be a readout rather than a thing to plan around.
 */
const ANNUAL_MEAN_C = 20;
const ANNUAL_SWING_C = 13;

/** How far the day climbs above its own mean, and the hour it peaks. */
const DIURNAL_SWING_C = 7;
const HOTTEST_HOUR = 15;

/**
 * The climate band `Kr` and `Kf` are read against, and the bounds they are held inside.
 *
 * The clamp is not decoration. A year-long term means a suite that passes in August can
 * fail in January on a day nobody deployed, and a sky that stacked three warm events
 * would otherwise push the factors past anything that had been measured. Held here, the
 * bound is a property of the code rather than of the calendar the test happened to run in.
 */
const CLIMATE_FLOOR_C = 5;
const CLIMATE_CEILING_C = 35;

export const KR_RANGE = [0.2, 0.45];
export const KF_RANGE = [0.35, 0.65];

/**
 * How warm the season and the sky are, independent of the hour.
 *
 * **This is the number that decides how much the hour matters, and the diurnal term is
 * deliberately not in it.** Putting it in would count the same fact twice: the swing
 * between day and night *is* what `Kr` scales, so feeding the current point on that swing
 * back in as an input would make a trip's factor depend on when you happened to look.
 */
export function climateAt(at, active) {
  requireInstant(at, 'climateAt');
  return seasonalMean(at) + warmthOf(active);
}

/**
 * What the thermometer reads: the climate plus wherever the day has got to.
 *
 * Coldest a little before dawn, hottest in the middle of the afternoon. This is the glass's
 * readout and nothing else reads it — the mechanical work is all done by `climateAt`.
 */
export function temperatureAt(at, active) {
  requireInstant(at, 'temperatureAt');
  const hour = hourAt(at);
  const diurnal = DIURNAL_SWING_C * Math.cos((2 * Math.PI * (hour - HOTTEST_HOUR)) / 24);
  return climateAt(at, active) + diurnal;
}

function seasonalMean(at) {
  return ANNUAL_MEAN_C - ANNUAL_SWING_C * Math.cos(2 * Math.PI * yearPhase(at));
}

/** Where a climate sits in its band, 0 at the floor and 1 at the ceiling. */
function warmth01(climate) {
  const span = CLIMATE_CEILING_C - CLIMATE_FLOOR_C;
  return Math.min(1, Math.max(0, (climate - CLIMATE_FLOOR_C) / span));
}

const lerp = ([low, high], t) => low + (high - low) * t;

/**
 * How much the hour is worth, at a given climate.
 *
 * `radiation` is what a daylight hour costs on the counter and a dark one saves; `finds`
 * is what daylight turns up and darkness misses. Heat widens both; cold and cloud narrow
 * them. That is temperature's entire mechanical job — one lever, deliberately, because the
 * sky already owns production, haul and dose, and a second global system pulling the same
 * three would make `effectsOf` an incomplete account of what the weather costs.
 */
export function coefficientsAt(climate) {
  const t = warmth01(climate);
  return { radiation: lerp(KR_RANGE, t), finds: lerp(KF_RANGE, t) };
}

/**
 * What the sun did to a whole trip: `{ radiation, finds }`, centred on 1.
 *
 * Both are `1 + K * (2d - 1)`, so a trip that spent half its hours in the light is
 * multiplied by exactly one and resolves as it would have with no sun in the game at all.
 * That is the same compatibility guarantee gear and weather already hold to.
 *
 * **Integrated properly, not as a product of two averages.** The interval is walked in the
 * pieces the weather cuts it into — `nextBoundaryAfter` yields those, as it does for the
 * sky — and each piece contributes its own daylight share at its own climate. Taking the
 * trip's mean `d` and its mean climate and combining them once would be cheaper and would
 * quietly misattribute a hot spell that fell entirely in the dark.
 *
 * Bulk loot is not here. Daylight pays in finds, so that the Fence Line — ten minutes,
 * `finds: []`, no dose — is exactly and automatically indifferent to the hour rather than
 * collecting a free multiplier on the highest-throughput region in the game.
 */
export function sunFactors(events, from, to) {
  requireInstant(from, 'sunFactors');
  requireInstant(to, 'sunFactors');

  const span = to - from;
  if (span <= 0) return { radiation: 1, finds: 1 };

  let radiation = 0;
  let finds = 0;
  let cursor = from;

  while (cursor < to) {
    const next = Math.min(to, nextBoundaryAfter(events, cursor));
    const hours = next - cursor;

    const k = coefficientsAt(climateAt(cursor, activeAt(events, cursor)));
    const lean = 2 * daylightFraction(cursor, next) - 1;

    radiation += (1 + k.radiation * lean) * hours;
    finds += (1 + k.finds * lean) * hours;
    cursor = next;
  }

  return { radiation: radiation / span, finds: finds / span };
}

/**
 * Everything the world did to a trip, as one set of factors: `{ loot, radiation, finds }`.
 *
 * **One function, because two call sites must not compose this twice.** `returnExpedition`
 * resolves a trip that has landed and `reportOn` describes one still in the air, and if
 * they multiplied the same two things in two places the page would eventually describe a
 * trip that did not happen. That failure has already happened once here in a smaller form;
 * this is the shape that prevents it.
 *
 * The sky contributes haul and dose, integrated across the trip. The sun contributes dose
 * and finds, integrated the same way. Dose is the one they share, and they compose
 * multiplicatively on it: a daylight trip under a rad storm is dearer than either alone,
 * which is both what the fiction says and what two independent scalings mean.
 *
 * Bulk loot belongs to the sky alone. That is the decision that keeps the Fence Line —
 * ten minutes to the wire, no find table, no dose — exactly and automatically indifferent
 * to the hour, instead of collecting a free multiplier on the highest-throughput region in
 * the game.
 */
export function travelFactors(events, from, to) {
  const sky = integrateFactors(events, from, to);
  const sun = sunFactors(events, from, to);

  return {
    loot: sky.loot,
    radiation: sky.radiation * sun.radiation,
    finds: sun.finds,
  };
}
