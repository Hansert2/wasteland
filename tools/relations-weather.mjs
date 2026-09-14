/**
 * Is the crews' politics a season or a flicker?
 *
 * `src/game/relations.js` claims three things and this measures all three, because each of
 * them is the sort of claim that reads as obviously true and is worth about as much as the
 * measurement behind it:
 *
 * 1. **The shares land.** The cut points between the five states are derived from declared
 *    shares by inverting an Irwin-Hall quantile, which is the kind of arithmetic that is either
 *    exactly right or silently out by a third. Nothing about the page would show it.
 * 2. **A step is bounded.** The moving average was chosen over a random walk so two crews
 *    cannot go from hostile to working together in one season. That is a claim about the
 *    *largest* jump, so an average is no evidence at all -- the worst is the whole answer.
 * 3. **A state lasts.** `ERA_HOURS` is four weeks, priced against the 8.2-day mean wait for a
 *    particular crew's caravan. If a state's median run is one era the pricing was wasted,
 *    because nothing a camp can reach would outlive the relation it was reaching about.
 *
 * Run over many worlds rather than the one the game uses: the real world seed is a single
 * sample, and a single sample of a slow process is how a mechanic ships looking fine.
 *
 *   node tools/relations-weather.mjs
 */
import {
  ERA_HOURS,
  PAIRS,
  RELATIONS,
  STATES,
  stateOf,
  temperatureOf,
} from '../src/game/relations.js';
import { WORLD_SEED } from '../src/game/world-events.js';

const WORLDS = 300;
const ERAS = 200;

const seen = Object.fromEntries(STATES.map((state) => [state, 0]));
const runs = Object.fromEntries(STATES.map((state) => [state, []]));
const jumps = [];
let changes = 0;
let observations = 0;

for (let world = 1; world <= WORLDS; world += 1) {
  for (const [a, b] of PAIRS) {
    let run = 0;
    let previous = null;

    for (let era = 0; era < ERAS; era += 1) {
      const state = stateOf(temperatureOf(world * 7717, a, b, era));
      seen[state] += 1;
      observations += 1;

      if (previous === null || state === previous) {
        run += 1;
      } else {
        changes += 1;
        jumps.push(Math.abs(STATES.indexOf(state) - STATES.indexOf(previous)));
        runs[previous].push(run);
        run = 1;
      }
      previous = state;
    }
  }
}

const stat = (list) => {
  if (list.length === 0) return null;
  const sorted = [...list].sort((x, y) => x - y);
  return {
    mean: sorted.reduce((sum, one) => sum + one, 0) / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    worst: sorted.at(-1),
  };
};

const weeks = (eras) => `${((eras * ERA_HOURS) / 24 / 7).toFixed(0)}w`;

console.log(`${WORLDS} worlds, ${PAIRS.length} pairs, ${ERAS} eras each — one era is ${ERA_HOURS / 24} days\n`);
console.log('  state       share   wanted   median run   9 in 10 under   longest');
for (const state of STATES) {
  const s = stat(runs[state]) ?? { p50: 0, p90: 0, worst: 0 };
  console.log(
    `  ${state.padEnd(10)}  ${`${((seen[state] / observations) * 100).toFixed(1)}%`.padStart(5)}` +
      `   ${`${RELATIONS[state].share}%`.padStart(6)}` +
      `   ${weeks(s.p50).padStart(10)}   ${weeks(s.p90).padStart(13)}   ${weeks(s.worst).padStart(7)}`,
  );
}

const jump = stat(jumps);
console.log(
  `\n  ${changes} changes in ${observations} pair-eras — the world hears something` +
    ` every ${((observations / changes) * (ERA_HOURS / 24) / PAIRS.length).toFixed(0)} days.`,
);
console.log(
  `  A change moves ${jump.mean.toFixed(2)} states on average and never more than ${jump.worst}.` +
    (jump.worst <= 2 ? ' Bounded, as the moving average promised.' : ' THE BOUND IS NOT HOLDING.'),
);

/* And what the world the game actually runs looks like right now, which is one sample. */
console.log(`\n  world ${WORLD_SEED}, this era:`);
const era = Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / (ERA_HOURS * 3600_000));
for (const [a, b] of PAIRS) {
  const state = stateOf(temperatureOf(WORLD_SEED, a, b, era));
  console.log(`  ${a} / ${b}`.padEnd(46) + `${RELATIONS[state].name}`);
}
