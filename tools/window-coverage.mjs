/**
 * Who the encounter windows actually serve.
 *
 * The open question left by Phase 6: the divisor in `windowHours()` is the coverage
 * dial, it was moved from 1.75 (~58% of a trip answerable) to 3 (~33%), and the soak
 * measured a twice-daily automaton catching nine moments in ninety days before the
 * change and four after. That looked like the dial punishing the absent player.
 *
 * It is the wrong reading, and this is the instrument that says so. The soak's
 * automaton spends five rotation slots in eight on regions under an hour, so it almost
 * never has a trip in flight when it next looks — its itinerary, not the window width,
 * is what it is short of. Coverage is a statement about *a trip*; moments met is a
 * statement about *a schedule*, and the two are only loosely connected.
 *
 * So: sweep the divisor across several player profiles and see who each setting is
 * actually buying anything for. Pure — no database, no server, regions inline the way
 * the moments unit test carries them.
 *
 *   node tools/window-coverage.mjs
 */
import { isOpen, momentCount, momentsFor } from '../src/game/moments.js';
import { makeRandom } from '../src/game/random.js';

/** The seeded world, as `src/db/seed.js` has it. */
const REGIONS = {
  the_fence_line: 0.17,
  the_service_road: 0.75,
  ruined_city: 4,
  irradiated_farmland: 6,
  underground_bunkers: 9,
  coastal_wreckage: 12,
  the_deep_zone: 18,
};

/**
 * How the player spends their trips. This is the variable the soak accidentally held
 * fixed, and it turns out to matter more than the dial does.
 */
const ITINERARIES = {
  // The soak's own rotation, kept so this can be checked against a number that exists.
  soak: [
    'the_fence_line', 'the_service_road', 'the_fence_line', 'ruined_city',
    'the_service_road', 'underground_bunkers', 'the_fence_line', 'the_deep_zone',
  ],
  // What somebody who checks in twice a day would actually send: the longest trip that
  // is still in flight when they next look, because a trip that lands while they are
  // asleep is hours of nothing.
  overnight: ['the_deep_zone'],
  // The click-heavy player, who sends what finishes while they are still here.
  short: ['the_fence_line', 'the_service_road', 'the_fence_line', 'ruined_city'],
  // Everything, evenly, as a control.
  mixed: Object.keys(REGIONS),
};

/** How often they look. */
const PROFILES = {
  'every 10 min': 1 / 6,
  hourly: 1,
  'every 3 h': 3,
  'twice daily': 12,
};

const DIVISORS = [1.75, 2.5, 3, 4, 6];

/** `windowHours`, with the dial pulled out so it can be swept. */
function windowFor(travelHours, divisor, count = momentCount(travelHours)) {
  if (count <= 0) return 0;
  return Math.max(0.2, travelHours / (count * divisor));
}

/**
 * Ninety days of checking in, counting the moments met.
 *
 * A trip is dispatched at the first check-in that finds the survivor home, which is the
 * rule that couples itinerary to cadence: a twice-daily player sending ten-minute trips
 * has an empty field 99% of the time, and no window setting can reach them.
 */
function play({ cadence, itinerary, divisor, seed }) {
  const random = makeRandom(seed);
  const days = 90;
  const slots = Math.floor((days * 24) / cadence);

  let trip = null;
  let sent = 0;
  let offered = 0;
  let caught = 0;
  const answered = new Set();

  for (let slot = 0; slot < slots; slot++) {
    // Jittered, or a cadence that divides the trip length resonates with the windows
    // and measures the arithmetic rather than the game.
    const now = slot * cadence + random() * cadence;

    if (trip && now >= trip.departedAt + trip.travelHours) trip = null;

    if (!trip) {
      const slug = itinerary[sent % itinerary.length];
      const travelHours = REGIONS[slug];
      trip = {
        slug,
        travelHours,
        departedAt: now,
        moments: momentsFor({ slug, travelHours }, Math.floor(random() * 2 ** 31)),
      };
      offered += trip.moments.length;
      answered.clear();
      sent += 1;
      continue;
    }

    const elapsed = now - trip.departedAt;
    for (const moment of trip.moments) {
      if (answered.has(moment.index)) continue;
      // The window as this divisor would have drawn it, clamped to the trip the same
      // way `momentsFor` clamps it.
      const closesAt = Math.min(
        trip.travelHours,
        moment.atHour + windowFor(trip.travelHours, divisor),
      );
      if (isOpen({ atHour: moment.atHour, closesAt }, elapsed)) {
        answered.add(moment.index);
        caught += 1;
      }
    }
  }

  return { sent, offered, caught, days };
}

const pad = (value, width) => String(value).padStart(width);

for (const [name, itinerary] of Object.entries(ITINERARIES)) {
  console.log(`\n${name} — ${itinerary.length === 1 ? itinerary[0] : `${itinerary.length} slots`}`);
  console.log(`  ${'cadence'.padEnd(13)}${DIVISORS.map((d) => pad(`÷${d}`, 9)).join('')}   offered/90d`);

  for (const [profile, cadence] of Object.entries(PROFILES)) {
    const cells = [];
    let offered = 0;

    for (const divisor of DIVISORS) {
      // Averaged over ten worlds: one seed's placement is noise at this resolution.
      let caught = 0;
      let seen = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const run = play({ cadence, itinerary, divisor, seed });
        caught += run.caught;
        seen += run.offered;
      }
      cells.push(pad((caught / 10).toFixed(0), 9));
      offered = seen / 10;
    }

    console.log(`  ${profile.padEnd(13)}${cells.join('')}   ${offered.toFixed(0)}`);
  }
}

console.log('\nCaught moments per 90 days, averaged over ten worlds. ÷3 is what ships.');
