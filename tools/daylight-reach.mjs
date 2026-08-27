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
 * The find count and the nominal dose are carried because they are the two levers a region
 * actually exposes. A region with an empty find table and no dose is indifferent to the
 * hour whatever the arithmetic says — which is the whole reason daylight pays in finds —
 * so the table marks it rather than printing a multiplier on nothing.
 *
 * A trip of T hours beginning anywhere in a day with L hours of light captures between
 * `max(0, L - (24 - R))` and `min(L, R)` of them, where R is the remainder after whole
 * days; whole days each contribute exactly L. That is the whole calculation.
 *
 *   node tools/daylight-reach.mjs [Kr] [Kf]
 */

const DAY_HOURS = 24;

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

/** Daylight window at the solstices and the equinox, in hours. */
const WINDOWS = [
  ['winter', 9],
  ['equinox', 12],
  ['summer', 15],
];

/** The range of daylight fractions a trip of `hours` can be aimed at. */
export function reach(hours, lightHours) {
  const wholeDays = Math.floor(hours / DAY_HOURS);
  const remainder = hours - wholeDays * DAY_HOURS;

  const least = wholeDays * lightHours + Math.max(0, lightHours - (DAY_HOURS - remainder));
  const most = wholeDays * lightHours + Math.min(lightHours, remainder);

  return { least: least / hours, most: most / hours };
}

const factor = (d, k) => 1 + k * (2 * d - 1);
const range = (low, high) => `${low.toFixed(2)}-${high.toFixed(2)}`;

const Kr = Number(process.argv[2] ?? 0.35);
const Kf = Number(process.argv[3] ?? 0.5);

console.log(`Kr=${Kr} (dose)  Kf=${Kf} (finds)\n`);

for (const [season, lightHours] of WINDOWS) {
  console.log(`--- ${season}: ${lightHours}h of light ---`);
  console.log('region                  T    d range      dose range    finds range   worst->best');

  for (const [name, hours, findCount, rads] of REGIONS) {
    const label = name.padEnd(20);
    const trip = String(hours).padStart(5);

    if (findCount === 0 && rads === 0) {
      console.log(`${label} ${trip}   no finds, no dose - indifferent to the hour`);
      continue;
    }

    const { least, most } = reach(hours, lightHours);
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
