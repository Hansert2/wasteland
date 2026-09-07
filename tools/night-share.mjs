/**
 * How much of a trip is actually dark, per region — the sweep Phase 14 asks for first.
 *
 * The phase's own note: *"Measure before designing: what share of trips crosses a dark hour
 * at all? Per region, against the real dispatch table and a real spread of check-in times.
 * If almost every long trip already spans both, night is weather the player walks through
 * rather than a thing they choose, and the phase is really about the short trips."*
 *
 * That question decides what night content is *for*. If the long roads are always half dark
 * whatever time you leave, a night table attached to them is not a choice the player makes —
 * it is scenery they cannot avoid, and the phase's real subject is the short trips, where
 * leaving at four or at nine is the difference between all light and all dark.
 *
 * Two views, because they answer different halves of it:
 *
 * - **Any hour** sweeps every departure minute of every week of the year. It is the honest
 *   statement about a *road*, independent of who is playing.
 * - **Check-ins** restricts departures to the hours a person actually dispatches at. A road
 *   that is half dark across all departures can still be reliably light for somebody who
 *   only ever plays at nine in the morning, and that is the player the content meets.
 *
 * Pure — no database, no server, regions inline the way `window-coverage.mjs` carries them.
 * Base travel hours, so this is the table as a camp without shortcuts reads it; a link-opened
 * shortcut makes a walk shorter and can only move a trip toward the light it left in.
 *
 *   node tools/night-share.mjs
 */
import { daylightHoursAt, splitOf } from '../src/game/daylight.js';

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** The seeded world, as `src/db/seed.js` has it: slug -> base travel hours. */
const REGIONS = {
  the_fence_line: 0.17,
  the_service_road: 0.75,
  ruined_city: 4,
  irradiated_farmland: 6,
  the_millrace: 8,
  underground_bunkers: 9,
  coastal_wreckage: 12,
  sixteen_wells: 14,
  the_deep_zone: 18,
  the_waterworks: 20,
  harrow_end: 26,
};

/**
 * A year of departures, so the seasons are in the answer rather than averaged out of it.
 *
 * Daylight swings three hours either side of twelve, so midsummer and midwinter are not the
 * same question for a six-hour walk. Every 30 minutes of the day, every 7 days of the year.
 */
const YEAR_START = Date.UTC(2026, 0, 1);
const DAY_STEP = 7;
const MINUTE_STEP = 30;

/** When somebody who checks in twice a day actually presses Send. */
const PROFILES = {
  'any hour': null,
  'morning + evening': [8, 21],
  'evening only': [21],
  'lunch + late': [12, 23],
};

function sweep(hours, atHours) {
  let trips = 0;
  let touchedDark = 0;
  let allDark = 0;
  let allLight = 0;
  let darkShareTotal = 0;
  let minShare = Infinity;
  let maxShare = -Infinity;

  for (let day = 0; day < 365; day += DAY_STEP) {
    const midnight = YEAR_START + day * DAY_MS;
    for (let minute = 0; minute < 24 * 60; minute += MINUTE_STEP) {
      if (atHours && !atHours.includes(Math.floor(minute / 60))) continue;
      const from = midnight + minute * 60_000;
      const { dark } = splitOf(from, from + hours * HOUR_MS);
      const share = dark / hours;

      trips += 1;
      darkShareTotal += share;
      if (share > 0.005) touchedDark += 1;
      if (share > 0.995) allDark += 1;
      if (share < 0.005) allLight += 1;
      minShare = Math.min(minShare, share);
      maxShare = Math.max(maxShare, share);
    }
  }

  return {
    trips,
    touchedDark: touchedDark / trips,
    allDark: allDark / trips,
    allLight: allLight / trips,
    meanShare: darkShareTotal / trips,
    minShare,
    maxShare,
  };
}

const pc = (v) => `${(v * 100).toFixed(0)}%`.padStart(5);
const name = (slug) => slug.replace(/_/g, ' ');
const WIDE = Math.max(...Object.keys(REGIONS).map((s) => name(s).length));

console.log('Daylight this year runs from '
  + `${daylightHoursAt(Date.UTC(2026, 11, 21)).toFixed(1)}h at the solstice `
  + `to ${daylightHoursAt(Date.UTC(2026, 5, 21)).toFixed(1)}h at midsummer.\n`);

for (const [label, atHours] of Object.entries(PROFILES)) {
  console.log(`=== departures: ${label} ===`);
  console.log(
    `  ${'region'.padEnd(WIDE)}  hours   any dark   all dark  all light   mean dark   range`,
  );
  console.log(`  ${'-'.repeat(WIDE + 62)}`);
  for (const [slug, hours] of Object.entries(REGIONS)) {
    const r = sweep(hours, atHours);
    const range = `${pc(r.minShare).trim()}-${pc(r.maxShare).trim()}`;
    console.log(
      `  ${name(slug).padEnd(WIDE)}  ${String(hours).padStart(5)}   ${pc(r.touchedDark)}      `
      + `${pc(r.allDark)}      ${pc(r.allLight)}       ${pc(r.meanShare)}   ${range.padStart(9)}`,
    );
  }
  console.log('');
}
