/**
 * How much of a trip's daylight fraction the player can actually choose.
 *
 * Phase 9 weights an expedition by `d`, the share of its hours that fell in daylight.
 * A player picks a region and a departure hour, and those two together fix how much of
 * `d` is theirs to move: a trip shorter than the night can be sent wholly into it, and a
 * trip longer than a day cannot be sent anywhere at all.
 *
 * This answers only the *reach* question — the range of `d` a region admits, and what that
 * is worth at a given `Kr`. It deliberately does not simulate a camp: fuel per day
 * including bench time is the number that decides whether the mechanic is worth having,
 * and that belongs in `daylight-balance.mjs` beside the real resolver. The plan's table of
 * achievable ranges comes from here, so the table has something behind it.
 *
 * **The sun comes from `src/game/daylight.js`, not from arithmetic repeated here.** The
 * first version of this file worked the range out analytically from an assumed daylight
 * length, which was right and was still the wrong shape: a table in the plan derived from
 * a tool's private copy of a formula stops describing the game the moment the game's copy
 * is retuned. The range is swept against the shipped function instead, so if the seasonal
 * swing changes this moves with it.
 *
 * The find count and the nominal dose are carried because they are the two levers a region
 * actually exposes. A region with an empty find table and no dose is indifferent to the
 * hour whatever the arithmetic says — which is the whole reason daylight pays in finds —
 * so the table marks it rather than printing a multiplier on nothing.
 *
 *   node tools/daylight-reach.mjs [Kr] [Kf]
 */
import { daylightFraction, daylightHoursAt } from '../src/game/daylight.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Regions as seeded, in dispatch-table order. Kept here rather than read from the database
 * so this runs without one: the trip length, the size of the find table and the nominal
 * dose are the three facts the reach question turns on.
 *
 * name, travel_hours, finds in the table, radiation_per_trip
 */
const REGIONS = [
  ['The Fence Line', 0.17, 0, 0],
  ['The Old Service Road', 0.75, 1, 0],
  ['The Ruined City', 4, 1, 0],
  ['Irradiated Farmland', 6, 1, 8],
  ['The Millrace', 8, 2, 1],
  ['Underground Bunkers', 9, 3, 2],
  ['Coastal Wreckage', 12, 2, 4],
  ['Sixteen Wells', 14, 3, 6],
  ['The Deep Zone', 18, 2, 25],
  ['The Waterworks', 20, 2, 30],
  ['Harrow End', 26, 2, 40],
];

/** One world day at each turn of the year, named for what the sun is doing. */
const SEASONS = [
  ['midwinter', Date.UTC(2025, 11, 21)],
  ['equinox', Date.UTC(2026, 2, 21)],
  ['midsummer', Date.UTC(2026, 5, 21)],
];

/** Departure hours swept per day. Quarter-hours: fine enough that the ends are the ends. */
const STEPS = 96;

/** The range of daylight fractions a trip of `hours` can be aimed at on a given day. */
export function reach(day, hours) {
  let least = Infinity;
  let most = -Infinity;

  for (let step = 0; step < STEPS; step += 1) {
    const from = day + (step / STEPS) * 24 * HOUR_MS;
    const d = daylightFraction(from, from + hours * HOUR_MS);
    least = Math.min(least, d);
    most = Math.max(most, d);
  }

  return { least, most };
}

const factor = (d, k) => 1 + k * (2 * d - 1);
const range = (low, high) => `${low.toFixed(2)}-${high.toFixed(2)}`;

const Kr = Number(process.argv[2] ?? 0.35);
const Kf = Number(process.argv[3] ?? 0.5);

console.log(`Kr=${Kr} (dose)  Kf=${Kf} (finds)\n`);

for (const [season, day] of SEASONS) {
  console.log(`--- ${season}: ${daylightHoursAt(day).toFixed(1)}h of light ---`);
  console.log('region                  T    d range      dose range    finds range   worst->best');

  for (const [name, hours, findCount, rads] of REGIONS) {
    const label = name.padEnd(20);
    const trip = String(hours).padStart(5);

    if (findCount === 0 && rads === 0) {
      console.log(`${label} ${trip}   no finds, no dose - indifferent to the hour`);
      continue;
    }

    const { least, most } = reach(day, hours);
    const doseLow = factor(least, Kr);
    const doseHigh = factor(most, Kr);
    const findsLow = factor(least, Kf);
    const findsHigh = factor(most, Kf);

    // Measured on whichever lever the region actually exposes, so a zero-dose region
    // reports the spread on its finds rather than on a multiplier applied to nothing.
    const spread = (rads === 0 ? findsHigh / findsLow : doseHigh / doseLow) - 1;

    console.log(
      [
        label,
        trip,
        range(least, most).padStart(12),
        (rads === 0 ? '-' : range(doseLow, doseHigh)).padStart(13),
        (findCount === 0 ? '-' : range(findsLow, findsHigh)).padStart(13),
        `${(spread * 100).toFixed(0)}%`.padStart(12),
      ].join(' '),
    );
  }

  console.log('');
}
