/**
 * Is a hunt worth taking, and is it a decision?
 *
 * Phase 20 is the first content in this game with no clock on it, which means every other
 * instrument here is the wrong shape for it: there are no hours to price and no per-hour rate
 * to compare. What a hunt spends is `STAMINA` — a quarter of somebody's working day — and the
 * plan's measured figure is that a full gauge costs the camp 50 food, so a point of stamina is
 * about half a unit of food. **That is the only exchange rate this needs.**
 *
 * Three questions, and the third is the one that decides whether this is a mode or a button:
 *
 * 1. **Does the meat pay for the day?** It should not — not quite. Priced above the stamina it
 *    costs, sleeping and hunting is a camp that has solved food for ever, which is what a
 *    reverse arrow must never be. Priced far below, nobody would ever hunt for meat and the
 *    starving-camp case the design is built on never arrives.
 * 2. **Does the weapon matter?** The user's call was that it should, mirroring `standFor`.
 * 3. **Is there more than one right answer?** A mode where pressing "close, close, take it"
 *    always wins is a slot machine with three levers. What we want to see is that the patient
 *    line and the greedy line each win somewhere, and that backing off is sometimes the best
 *    of the three.
 *
 *   node tools/hunt-balance.mjs
 */
import { MAX_TURNS, QUARRY, STAMINA, WITHIN_REACH, movesFor, quarryFor, startOf, takeTurn, yieldOf }
  from '../src/game/hunting.js';
import { ORDINARY } from '../src/game/wanderers.js';

const SEEDS = 4000;
const FOOD_PER_POINT = 0.5;
const SPENT = STAMINA * FOOD_PER_POINT;

const hunter = (potency, skill = ORDINARY) => ({
  skillScavenging: skill,
  inventory: potency ? [{ slug: 'w', kind: 'weapon', potency }] : [],
});

/**
 * Four ways to play it, and they are strategies rather than move lists.
 *
 * `greedy` closes and swings the moment it can. `patient` settles the animal first and only
 * closes when it is calm. `careful` is patient and walks away the moment anything turns — the
 * line a player takes when they cannot afford an injury.
 */
const LINES = {
  greedy: (state) =>
    state.closeness >= WITHIN_REACH ? 'strike' : 'close',
  patient: (state) => {
    const spec = QUARRY[state.quarry];
    if (state.alarm >= spec.wary) return 'still';
    return state.closeness >= WITHIN_REACH ? 'strike' : 'close';
  },
  careful: (state) => {
    if (state.turning) return 'leave';
    const spec = QUARRY[state.quarry];
    if (state.alarm >= spec.wary) return 'still';
    return state.closeness >= WITHIN_REACH ? 'strike' : 'close';
  },
  'never close': () => 'still',
};

function run(line, survivor) {
  const tally = { taken: 0, bolted: 0, lost: 0, left: 0, mauled: 0 };
  let food = 0;
  let hide = 0;
  let sinew = 0;
  let damage = 0;

  for (let seed = 1; seed <= SEEDS; seed += 1) {
    let state = startOf(seed);
    for (let n = 0; n < MAX_TURNS + 2 && state.status === 'active'; n += 1) {
      const move = line(state);
      if (!movesFor(state).some((one) => one.key === move)) break;
      state = takeTurn(state, move, { seed, survivor });
    }

    tally[state.status] = (tally[state.status] ?? 0) + 1;
    damage += state.damage;
    if (state.status === 'taken') {
      const got = yieldOf(state, survivor);
      food += got.food;
      hide += got.raw_hide;
      sinew += got.sinew;
    }
  }

  return { tally, food: food / SEEDS, hide: hide / SEEDS, sinew: sinew / SEEDS, damage: damage / SEEDS };
}

const pct = (n) => `${((n / SEEDS) * 100).toFixed(0)}%`.padStart(5);

console.log(`\n${SEEDS} hunts a line. A hunt spends ${STAMINA} stamina, which is ${SPENT} food.\n`);

const quarry = { hare: 0, deer: 0, boar: 0 };
for (let seed = 1; seed <= SEEDS; seed += 1) quarry[quarryFor(seed)] += 1;
console.log(
  `  what is out there:  ${Object.entries(quarry)
    .map(([name, n]) => `${name} ${pct(n).trim()}`)
    .join('   ')}\n`,
);

for (const [what, potency] of [['bare hands', 0], ['scrap spear', 25], ['hunting bow', 35]]) {
  console.log(`  ${what}`);
  console.log(
    '    line            taken  bolted   lost    left  mauled     food     hide    sinew   damage',
  );
  for (const [name, line] of Object.entries(LINES)) {
    const r = run(line, hunter(potency));
    console.log(
      `    ${name.padEnd(14)}${pct(r.tally.taken)}${pct(r.tally.bolted)}${pct(r.tally.lost)}` +
        `${pct(r.tally.left)}${pct(r.tally.mauled)}` +
        `${r.food.toFixed(1).padStart(9)}${r.hide.toFixed(2).padStart(9)}` +
        `${r.sinew.toFixed(2).padStart(9)}${r.damage.toFixed(1).padStart(9)}`,
    );
  }
  console.log('');
}

console.log(
  `Read the food column against ${SPENT}, which is what the stamina cost the camp. Above it and\n` +
    `a camp can sleep and hunt its way out of hunger for ever; far below and nobody hunts when\n` +
    `the larder is empty, which is the case the whole design is built on.\n`,
);
