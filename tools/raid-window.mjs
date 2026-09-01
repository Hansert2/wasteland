/**
 * How long should a raid stay open, and who would ever meet one?
 *
 * Phase 12 turns a raid into a decision: it opens a window, the player picks who stands,
 * and no answer means everybody hid and the raiders take more. The user's range for that
 * window is two to four hours. This is what picks the number inside it.
 *
 * **The question is not "how long is a raid" — it is what fraction of raids a real person
 * is standing there for.** Two numbers decide that and only one of them is the window:
 *
 *     catch rate  ~  window / the gap between check-ins
 *
 * so a three-hour window on a twice-a-day player is one raid in four, and the same window
 * on somebody who looks five times an evening is nearly all of them. The window is chosen
 * against a cadence or it is chosen against nothing.
 *
 * ## Why this matters more than it looks
 *
 * The hidden share is *harsher* than a raid costs today — the user's call, made against the
 * objection that a week away must not be punished. That trade is only affordable while
 * hiding is the exception. **If the catch rate is low, the harsher outcome is not the
 * penalty for missing a decision; it is simply what raids now cost**, and the decision is a
 * rare bonus rather than the mechanic. So this number and that one are the same argument,
 * and the plan's stated aim is roughly one raid in three.
 *
 * ## What is modelled, and what is real
 *
 * Raid hours come from `nextRaidAt` itself, at three wealth levels, so the intervals are the
 * game's own — 48 hours at the floor for a rich camp, up to ten days for a poor one. Nothing
 * here reimplements the schedule.
 *
 * The cadences are models, and deliberately named after people rather than after
 * distributions. The one thing they all share is the fact that decides the answer: **nobody
 * checks in at four in the morning.** A raid at 03:00 is uncatchable at any window a sane
 * design would pick, and that is a property of sleeping humans, not of the window.
 *
 *   node tools/raid-window.mjs
 */
import { nextRaidAt } from '../src/game/raids.js';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 3, 1);
const DAYS = 3000; // long enough that the wide intervals still give hundreds of raids

/**
 * A day's check-ins, as hours past midnight in the camp's own clock.
 *
 * The camp clock is set from the browser that founded it, so a game hour is the player's
 * hour: 03:00 in here is three in the morning for them, and that is why these are wall
 * times rather than a period.
 */
const CADENCES = [
  ['once a day, evening', [19.5]],
  ['morning and evening', [8, 20]],
  ['three times', [8, 13, 21]],
  ['five times, an evening player', [8, 12.5, 18, 20, 22]],
  ['the soak metronome, every 12h', [7, 19]],
];

/** Wealth decides the interval: the floor is 48h, a poor camp waits ten days. */
const WEALTH = [
  ['a young camp', 5],
  ['an established one', 20],
  ['a hoard, at the floor', 100],
];

const WINDOWS = [1, 2, 3, 4, 6];

/** Every raid hour the scheduler produces across the run, for one wealth level. */
function raidsFor(wealth, seed) {
  const at = [];
  let cursor = T0;
  for (let index = 0; cursor < T0 + DAYS * DAY; index += 1) {
    cursor = nextRaidAt(cursor, wealth, seed, index);
    at.push(cursor);
  }
  return at;
}

/**
 * Every check-in across the run, in epoch ms.
 *
 * Jittered by up to half an hour either side, because a player who arrives at 20:00:00 every
 * evening would meet or miss raids on a resonance rather than on a rate — the same aliasing
 * that made the soak see nine trips in ninety days.
 */
function checkInsFor(hoursOfDay, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const at = [];
  for (let day = 0; day < DAYS; day += 1) {
    for (const hour of hoursOfDay) {
      at.push(T0 + day * DAY + (hour + (random() - 0.5)) * HOUR);
    }
  }
  return at;
}

/** Was anybody looking between the raid and the moment the window shuts? */
function caught(raids, checkIns, windowHours) {
  let hit = 0;
  let cursor = 0;
  for (const raid of raids) {
    while (cursor < checkIns.length && checkIns[cursor] < raid) cursor += 1;
    if (cursor < checkIns.length && checkIns[cursor] < raid + windowHours * HOUR) hit += 1;
  }
  return hit / Math.max(1, raids.length);
}

const pct = (x) => `${(100 * x).toFixed(0)}%`;

console.log(`\n${DAYS} days per row, raid hours from nextRaidAt itself.\n`);

for (const [wealthName, wealth] of WEALTH) {
  const raids = raidsFor(wealth, 20260401);
  const gapHours = ((raids[raids.length - 1] - raids[0]) / HOUR / (raids.length - 1)).toFixed(0);
  console.log(`${wealthName} — ${raids.length} raids, one every ${gapHours}h on average`);
  console.log(
    `  ${'cadence'.padEnd(30)}${WINDOWS.map((w) => `${w}h`.padStart(7)).join('')}`,
  );
  console.log('  ' + '-'.repeat(30 + WINDOWS.length * 7));

  for (const [cadenceName, hoursOfDay] of CADENCES) {
    const checkIns = checkInsFor(hoursOfDay, 7919);
    const cells = WINDOWS.map((w) => pct(caught(raids, checkIns, w)).padStart(7)).join('');
    console.log(`  ${cadenceName.padEnd(30)}${cells}`);
  }
  console.log();
}

/*
 * And the ceiling nothing can lift, which is the point worth taking away: a raid that lands
 * while the player is asleep is uncatchable however wide the window, unless the window is
 * wide enough to reach breakfast — at which point it is not a window, it is a pending job.
 */
const nightRaids = (raids, from, to) =>
  raids.filter((at) => {
    const hour = ((at - T0) / HOUR) % 24;
    return hour >= from || hour < to;
  }).length / raids.length;

const sample = raidsFor(20, 20260401);
console.log(`raids arriving between 23:00 and 07:00: ${pct(nightRaids(sample, 23, 7))}`);
console.log('which no window under eight hours can reach, and which is why the ceiling');
console.log('on any of the columns above sits well under a hundred.\n');
