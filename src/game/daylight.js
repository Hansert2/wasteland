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
