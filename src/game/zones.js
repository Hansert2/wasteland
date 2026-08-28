/**
 * Where the sun sits, worked out from where the browser says it is.
 *
 * Migration `016` gave the camp a solar noon and left the player to set it. That is one
 * number too many to ask for, and it is a number nobody knows about themselves: "how far
 * are you from your timezone's meridian" is not a question a person can answer.
 *
 * The camp's UTC offset cannot answer it either, which is worth being explicit about
 * because it is the obvious thing to try. An offset is quantised to whole zones and has
 * summer time folded into it, so it loses longitude entirely. Amsterdam and Athens are
 * both UTC+2 in August and their solar noons are 13:40 and 12:25 — seventy-five minutes
 * apart on an identical clock. Deriving the sun from the offset would put one of them an
 * hour and a quarter wrong to get the other right.
 *
 * The camp's *zone* does answer it. `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * gives `Europe/Amsterdam`, needs no permission, and every browser has it. A zone is a
 * place, and a place has a longitude.
 *
 * ### The arithmetic
 *
 * One degree of longitude is four minutes of time, and the offset already carries the
 * meridian the clock is cut from — a camp at UTC+2 is keeping the clock of 30°E. So the
 * whole derivation is:
 *
 *     solar noon = 12:00 + (meridian − longitude) × 4 min/degree
 *                = 720 + offsetMinutes − 4 × longitude
 *
 * Amsterdam: 720 + 120 − 4(4.90) = 820, which is 13:40 and matches the sky.
 * Athens:    720 + 120 − 4(23.73) = 745, which is 12:25.
 * Denver:    720 − 360 − 4(−104.99) = 780, which is 13:00.
 *
 * ### What it deliberately leaves out
 *
 * **The equation of time**, which swings true solar noon by up to ±16 minutes across the
 * year — the reason a sundial and a clock disagree in November. Including it would make
 * solar noon a function of the date rather than a property of the camp, and the column is
 * a property of the camp on purpose: stored once, so an expedition replays exactly. The
 * error is under a minute around the equinoxes and worst in early November, which is
 * smaller than the difference this whole module exists to fix.
 *
 * **Summer time is folded in and then frozen**, exactly as the clock offset is. A camp
 * founded in July keeps July's offset *and* July's solar noon, so the two drift together
 * and the sun stays where it was against the camp's own clock. That coherence is the
 * point: freezing one and not the other would be worse than freezing neither.
 *
 * ### Why a curated table
 *
 * IANA ships coordinates for every zone on earth in `zone1970.tab`, and vendoring it would
 * be about 350 rows nobody reads. This is the set a real player is plausibly in, kept by
 * hand and short enough to review in a diff. **An unlisted zone returns `null`**, and the
 * caller leaves the column at its 720 default — the idealised sky the game has always had,
 * which is a correct sky rather than a wrong one. Adding a row is the whole fix.
 */

/*
 * Degrees east of Greenwich, at the city the zone is named for. Two decimal places is
 * about a kilometre, and a kilometre is a quarter of a second of solar time — far below
 * the minute this is stored in. More precision would be false.
 *
 * `null` prototype: this is looked up with a string that came off the wire, and a plain
 * object literal would happily answer for `__proto__` and `constructor`.
 */
export const ZONE_LONGITUDE = Object.assign(Object.create(null), {
  // Europe
  'Atlantic/Reykjavik': -21.94,
  'Europe/Lisbon': -9.14,
  'Europe/Dublin': -6.25,
  'Europe/Madrid': -3.70,
  'Europe/London': -0.13,
  'Europe/Paris': 2.35,
  'Europe/Brussels': 4.35,
  'Europe/Amsterdam': 4.90,
  'Europe/Zurich': 8.54,
  'Europe/Oslo': 10.75,
  'Europe/Rome': 12.50,
  'Europe/Copenhagen': 12.57,
  'Europe/Berlin': 13.40,
  'Europe/Prague': 14.42,
  'Europe/Vienna': 16.37,
  'Europe/Stockholm': 18.07,
  'Europe/Budapest': 19.04,
  'Europe/Warsaw': 21.01,
  'Europe/Athens': 23.73,
  'Europe/Helsinki': 24.94,
  'Europe/Bucharest': 26.10,
  'Europe/Istanbul': 28.98,
  'Europe/Kyiv': 30.52,
  'Europe/Kiev': 30.52,
  'Europe/Moscow': 37.62,

  // The Americas
  'America/St_Johns': -52.71,
  'America/Sao_Paulo': -46.63,
  'America/Montevideo': -56.16,
  'America/Argentina/Buenos_Aires': -58.38,
  'America/Halifax': -63.57,
  'America/Puerto_Rico': -66.11,
  'America/Caracas': -66.90,
  'America/Santiago': -70.65,
  'America/New_York': -74.01,
  'America/Bogota': -74.07,
  'America/Jamaica': -76.79,
  'America/Lima': -77.03,
  'America/Toronto': -79.38,
  'America/Panama': -79.53,
  'America/Havana': -82.38,
  'America/Detroit': -83.05,
  'America/Costa_Rica': -84.08,
  'America/Chicago': -87.63,
  'America/Guatemala': -90.51,
  'America/Winnipeg': -97.14,
  'America/Mexico_City': -99.13,
  'America/Denver': -104.99,
  'America/Phoenix': -112.07,
  'America/Edmonton': -113.49,
  'America/Los_Angeles': -118.24,
  'America/Vancouver': -123.12,
  'America/Anchorage': -149.90,
  'Pacific/Honolulu': -157.86,

  // Africa and the Middle East
  'Africa/Casablanca': -7.59,
  'Africa/Abidjan': -4.03,
  'Africa/Accra': -0.20,
  'Africa/Algiers': 3.06,
  'Africa/Lagos': 3.38,
  'Africa/Tunis': 10.17,
  'Africa/Johannesburg': 28.05,
  'Africa/Cairo': 31.24,
  'Africa/Khartoum': 32.53,
  'Asia/Jerusalem': 35.21,
  'Asia/Beirut': 35.51,
  'Africa/Nairobi': 36.82,
  'Africa/Addis_Ababa': 38.74,
  'Asia/Baghdad': 44.36,
  'Asia/Riyadh': 46.72,
  'Asia/Tehran': 51.39,
  'Asia/Dubai': 55.27,

  // Asia and the Pacific
  'Asia/Yekaterinburg': 60.61,
  'Asia/Karachi': 67.01,
  'Asia/Tashkent': 69.24,
  'Asia/Almaty': 76.89,
  'Asia/Colombo': 79.86,
  'Asia/Novosibirsk': 82.93,
  'Asia/Kathmandu': 85.32,
  'Asia/Kolkata': 88.36,
  'Asia/Calcutta': 88.36,
  'Asia/Dhaka': 90.41,
  'Asia/Bangkok': 100.50,
  'Asia/Kuala_Lumpur': 101.69,
  'Asia/Singapore': 103.82,
  'Asia/Ho_Chi_Minh': 106.63,
  'Asia/Jakarta': 106.85,
  'Asia/Hong_Kong': 114.17,
  'Australia/Perth': 115.86,
  'Asia/Manila': 120.98,
  'Asia/Shanghai': 121.47,
  'Asia/Taipei': 121.56,
  'Asia/Seoul': 126.98,
  'Australia/Darwin': 130.84,
  'Asia/Vladivostok': 131.89,
  'Australia/Adelaide': 138.60,
  'Asia/Tokyo': 139.69,
  'Australia/Melbourne': 144.96,
  'Australia/Hobart': 147.33,
  'Australia/Sydney': 151.21,
  'Australia/Brisbane': 153.03,
  'Pacific/Auckland': 174.76,
  'Pacific/Fiji': 178.42,
});

/*
 * IANA zone names are `Area/Location`, occasionally with a third part, and use only these
 * characters. Checked before the lookup because the value arrives from a form field: the
 * table has a null prototype so a hostile key cannot reach `Object.prototype`, and this
 * keeps anything strange out of the lookup as well.
 */
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** Minutes of time per degree of longitude: the earth turns 360° in 24 × 60 minutes. */
const MINUTES_PER_DEGREE = 4;

/** Noon, in minutes past midnight — the sky of a camp standing on its own meridian. */
export const IDEALISED_SOLAR_NOON = 720;

/**
 * Minutes past midnight, on this camp's clock, at which the sun is highest.
 *
 * Returns `null` for a zone that is not in the table or does not look like a zone at all,
 * which the caller should read as "leave the column at its default" rather than as an
 * error. Not knowing where a camp is is an ordinary state, and the idealised sky is a
 * perfectly good answer to it.
 *
 * @param {string} zone           an IANA zone name, e.g. `Europe/Amsterdam`
 * @param {number} offsetMinutes  the camp's clock, minutes ahead of UTC
 * @returns {number|null}
 */
export function solarNoonFor(zone, offsetMinutes) {
  const name = String(zone ?? '').trim();
  if (!ZONE_SHAPE.test(name)) return null;
  if (!(name in ZONE_LONGITUDE)) return null;

  const offset = Number(offsetMinutes);
  if (!Number.isFinite(offset)) return null;

  const noon = IDEALISED_SOLAR_NOON + offset - MINUTES_PER_DEGREE * ZONE_LONGITUDE[name];

  /*
   * The column is `between 0 and 1439`. A camp keeping a clock wildly out of step with its
   * longitude can land outside a day, and wrapping it would put the sun on the wrong side
   * of midnight. Clamping keeps it in the same day, which is the lesser of the two wrongs,
   * and the check constraint is not there to be argued with from the application.
   */
  return Math.max(0, Math.min(1439, Math.round(noon)));
}
