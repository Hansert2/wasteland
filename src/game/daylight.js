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
 * **The hour belongs to the camp; the weather belongs to the world.** Every function here
 * takes an `offset` in minutes, which comes from `settlements.clock_offset_minutes` and is
 * nothing more than a shift of the instant before the arithmetic starts.
 *
 * That split replaced a single UTC clock on 2026-08-27, and the reasoning it replaced is
 * worth keeping because it was half right. Weather genuinely is global — every camp must
 * see the same storm, which is why `world_events` has no `settlement_id`. The *hour* is
 * not: nothing compares two camps' clocks, and sharing one meant a player in Auckland
 * always checked in at world-night while one in Denver always checked in at world-morning.
 *
 * **Stored, never read from a clock.** The offset is a column, so a camp's sky does not
 * change when the server moves or the player travels, and an expedition still replays
 * exactly. Reading the host's locale here would have been the same class of mistake as
 * reading `Date.now()` inside the tick.
 *
 * Computed by arithmetic rather than through `Date` getters, so that a machine set to
 * Chicago and one set to Seoul cannot answer differently for the same camp — the Unix
 * epoch is midnight UTC, so the fractional part of `now / DAY_MS` is the fraction of the
 * day, on every platform, with no timezone database involved.
 *
 * **The year is real.** The world runs at one hour to the hour from `WORLD_EPOCH`, so a
 * real year is a world year and the seasons cost one cosine term. That was not built for
 * flavour: it turns out to move which choices a long trip *has* rather than only what they
 * are worth — see the reach table in `docs/PLAN.md` — because a trip longer than the night
 * cannot be sent into it, and in high summer the night is six hours.
 */

import { makeRandom } from './random.js';
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

/** An instant shifted into a camp's own reckoning. */
const local = (at, offset = 0) => at + (Number(offset) || 0) * 60_000;

/** The camp's hour at `at`, as a fraction: 13.5 is half past one in the afternoon. */
export function hourAt(at, offset = 0) {
  const days = local(at, offset) / DAY_MS;
  return (days - Math.floor(days)) * 24;
}

/**
 * What time it is in the world, for a page to print.
 *
 * `hour` and `minute` are what a repaired clock shows; `band` is what anybody can see by
 * looking up. Both come off the same instant, so a camp with a clock and a camp without
 * are never describing different afternoons.
 */
export function worldTimeAt(at, offset = 0) {
  requireInstant(at, 'worldTimeAt');

  const hour = hourAt(at, offset);
  return {
    hour: Math.floor(hour),
    minute: Math.floor((hour % 1) * 60),
    band: bandAt(at, offset),
    daylightHours: daylightHoursAt(at),
    ...sunAt(at),
  };
}

/** Which of the five bands `at` falls in. */
export function bandAt(at, offset = 0) {
  requireInstant(at, 'bandAt');

  const hour = hourAt(at, offset);
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
export function nextBandChange(at, offset = 0) {
  requireInstant(at, 'nextBandChange');

  const here = bandAt(at, offset);
  const minute = 60_000;

  for (let step = 1; step <= 24 * 60; step += 1) {
    const when = at + step * minute;
    if (bandAt(when, offset) !== here) return when;
  }

  return at + DAY_MS;
}

/**
 * The next instant the temperature the page is *showing* stops being true.
 *
 * The strip prints a whole number of degrees, and the air moves about two degrees an hour
 * at the steep part of the day — so the figure is stale roughly eight minutes after it is
 * rendered, and three hours later it is out by three. On its own that is a small lie; next
 * to a chart whose marker is walking correctly along the line it is a page disagreeing
 * with itself, which this file already has a rule about.
 *
 * Walked minute by minute and rounded the same way the page rounds, so the answer is the
 * instant the *displayed* value changes rather than the instant the underlying one does.
 * There is no closed form worth having: the curve is a seasonal cosine, a diurnal cosine
 * and a smoothstepped drift, and the rounding boundary is what matters.
 *
 * Capped, because a plateau at the turn of the day can sit inside one degree for hours and
 * an alarm that never fires is the thing this is fixing.
 */
export function nextDegreeChange(events, at, capHours = 3) {
  requireInstant(at, 'nextDegreeChange');

  const minute = 60_000;
  const shown = Math.round(temperatureAt(at, activeAt(events, at)));

  for (let step = 1; step <= capHours * 60; step += 1) {
    const when = at + step * minute;
    if (Math.round(temperatureAt(when, activeAt(events, when))) !== shown) return when;
  }

  return at + capHours * 60 * minute;
}

/** Whether the sun is up at `at`. */
export function isLit(at, offset = 0) {
  const hour = hourAt(at, offset);
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
export function daylightFraction(from, to, offset = 0) {
  requireInstant(from, 'daylightFraction');
  requireInstant(to, 'daylightFraction');

  const span = to - from;
  if (span <= 0) return 0.5;

  // Worked entirely in the camp's own reckoning: the window shifts, and so do the day
  // boundaries the lit hours are measured inside. A trip is the same length either way,
  // so only where it falls against the sun changes.
  const start = local(from, offset);
  const end = local(to, offset);

  let lit = 0;
  const firstDay = Math.floor(start / DAY_MS);
  const lastDay = Math.floor((end - 1) / DAY_MS);

  for (let day = firstDay; day <= lastDay; day += 1) {
    const midnight = day * DAY_MS;
    const { sunrise, sunset } = sunAt(midnight);

    const litFrom = midnight + sunrise * HOUR_MS;
    const litTo = midnight + sunset * HOUR_MS;

    lit += Math.max(0, Math.min(end, litTo) - Math.max(start, litFrom));
  }

  return lit / span;
}

/**
 * The same window as hours of light and hours of dark, which is what the dispatch table
 * says once the camp has a clock: "6h light, 3h dark".
 */
export function splitOf(from, to, offset = 0) {
  const span = Math.max(0, to - from) / HOUR_MS;
  const light = daylightFraction(from, to, offset) * span;
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
 * How far the weather wanders off the curve, and how long it takes to wander.
 *
 * Without this the temperature is a cosine on a cosine — a perfect wave, identical every
 * day, which reads as a diagram of weather rather than as weather. Real air does not
 * repeat itself.
 *
 * **Smooth noise, not jitter.** A fresh random number each hour would make a sawtooth,
 * which is a different kind of wrong and a worse-looking one. Values are drawn at anchors
 * eight hours apart and interpolated with a smoothstep between them, so the line wanders
 * over half a day the way a warm spell does.
 *
 * Seeded from the anchor index alone, so it is a fact about the world rather than about
 * the camp reading it: two settlements asking about the same hour get the same answer,
 * for ever, with nothing stored. The same property `eventForSlot` has and for the same
 * reason.
 */
const DRIFT_C = 2.6;
const DRIFT_ANCHOR_HOURS = 8;
const DRIFT_SEED = 8675309;

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
  return seasonalMean(at) + warmthOf(active) + driftAt(at);
}

/**
 * What the thermometer reads: the climate plus wherever the day has got to.
 *
 * Coldest a little before dawn, hottest in the middle of the afternoon. This is the glass's
 * readout and nothing else reads it — the mechanical work is all done by `climateAt`.
 */
export function temperatureAt(at, active, offset = 0) {
  requireInstant(at, 'temperatureAt');
  const hour = hourAt(at, offset);
  const diurnal = DIURNAL_SWING_C * Math.cos((2 * Math.PI * (hour - HOTTEST_HOUR)) / 24);
  return climateAt(at, active) + diurnal;
}

function seasonalMean(at) {
  return ANNUAL_MEAN_C - ANNUAL_SWING_C * Math.cos(2 * Math.PI * yearPhase(at));
}

/** One anchor's value, in [-1, 1], from the anchor's index and nothing else. */
function driftAnchor(index) {
  return makeRandom(DRIFT_SEED + index * 7919)() * 2 - 1;
}

/** How far off the curve the air is at `at`, in degrees. */
function driftAt(at) {
  const anchors = at / (DRIFT_ANCHOR_HOURS * HOUR_MS);
  const index = Math.floor(anchors);
  const t = anchors - index;

  // Smoothstep rather than a straight line: a linear blend between anchors leaves a
  // visible corner at every one of them, which on a chart reads as a data glitch.
  const eased = t * t * (3 - 2 * t);

  return DRIFT_C * (driftAnchor(index) * (1 - eased) + driftAnchor(index + 1) * eased);
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
export function sunFactors(events, from, to, offset = 0) {
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

    const lean = 2 * daylightFraction(cursor, next, offset) - 1;

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
export function travelFactors(events, from, to, offset = 0) {
  const sky = integrateFactors(events, from, to);
  const sun = sunFactors(events, from, to, offset);

  return {
    loot: sky.loot,
    radiation: sky.radiation * sun.radiation,
    finds: sun.finds,
  };
}

// ---------------------------------------------------------------------------
// The forecast: what the glass is actually for.
// ---------------------------------------------------------------------------

/**
 * The window the glass draws: the world day `at` falls in, midnight to midnight.
 *
 * **A fixed window rather than a rolling one, and that is the whole reason the marker
 * moves.** Plotting "now to now plus a day" would pin the present to the left edge for
 * ever; against a day that stands still, the line for the current hour walks across it and
 * rolls over at midnight, which is what a clock face does and what a chart of a day should.
 *
 * **The horizon is a design decision, not a limit of the arithmetic.** World events derive
 * from the world seed, so the temperature a year from Tuesday is as computable as this
 * afternoon's — an instrument that printed it would end planning rather than serve it.
 *
 * Sampled every fifteen minutes: a day at hourly resolution is twenty-five points, and the
 * corners show.
 */
export function dayWindow(at, days = 0, offset = 0) {
  requireInstant(at, 'dayWindow');
  // Two different offsets meet here and they are not the same thing: `days` is how many
  // days the chart has been paged forward or back, and `offset` is the camp's clock. The
  // window is returned in real instants, so the shift is taken off again at the end.
  const shift = (Number(offset) || 0) * 60_000;
  const from = (Math.floor(local(at, offset) / DAY_MS) + days) * DAY_MS - shift;
  return { from, to: from + DAY_MS };
}

/**
 * How far either side of today the glass will look.
 *
 * A week of forecast, which is the horizon a real glass has and the one already argued
 * for above, and a week of record behind it so "was yesterday hotter" is answerable. The
 * limit forward is the design; the limit back is only tidiness — the seed would answer
 * for any day the world has ever had.
 */
export const DAY_REACH = 6;

export const FORECAST_STEP_MS = 15 * 60 * 1000;

/**
 * The temperature across a window, hour by hour, with the light and the sky beside it.
 *
 * Pure like the rest of this file: hand it the events covering the window and it will not
 * reach for anything. `lit` rides along because the chart's night shading and its line are
 * the same reading — a forecast that drew the dark from one source and the temperature
 * from another could disagree with itself.
 */
export function forecastSeries(events, from, to, step = FORECAST_STEP_MS, offset = 0) {
  requireInstant(from, 'forecastSeries');
  requireInstant(to, 'forecastSeries');

  const series = [];
  for (let at = from; at <= to; at += step) {
    series.push({
      at,
      degrees: temperatureAt(at, activeAt(events, at), offset),
      lit: isLit(at, offset),
    });
  }

  return series;
}

/**
 * The stretches of darkness inside a window, as spans rather than as flags.
 *
 * Derived from the sun rather than from the sampled series, so a band lands on the true
 * minute the light turns instead of on whichever sample happened to straddle it. A chart
 * whose shading is a step function of its own resolution looks like a rendering fault.
 */
export function darkSpansBetween(from, to, offset = 0) {
  requireInstant(from, 'darkSpansBetween');
  requireInstant(to, 'darkSpansBetween');

  // Returned in real instants so the chart can plot them against real instants, but
  // reckoned in the camp's day so a band lands where the camp's sun actually sets.
  const shift = (Number(offset) || 0) * 60_000;
  const spans = [];
  const firstDay = Math.floor((from + shift) / DAY_MS);
  const lastDay = Math.floor((to + shift) / DAY_MS);

  for (let day = firstDay - 1; day <= lastDay + 1; day += 1) {
    const midnight = day * DAY_MS;
    const { sunrise, sunset } = sunAt(midnight);

    // Dark runs from this day's sunset to the next day's sunrise. Taking it as one span
    // rather than two half-nights is what stops a band being cut at midnight.
    const darkFrom = midnight + sunset * HOUR_MS;
    const darkTo = midnight + DAY_MS + sunAt(midnight + DAY_MS).sunrise * HOUR_MS;

    const start = Math.max(from, darkFrom - shift);
    const end = Math.min(to, darkTo - shift);
    if (end > start) spans.push({ from: start, to: end });
  }

  return spans;
}
