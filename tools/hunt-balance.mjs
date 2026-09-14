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
import {
  BOLTS_AT, MAX_TURNS, QUARRY, STAMINA, WITHIN_REACH, alarmCostOf, movesFor, quarryFor,
  shotOf, startOf, takeTurn, toleranceFor, yieldOf,
} from '../src/game/hunting.js';
import { ORDINARY } from '../src/game/wanderers.js';

const SEEDS = 4000;
const FOOD_PER_POINT = 0.5;
const SPENT = STAMINA * FOOD_PER_POINT;

const hunter = (potency, { armour = 0, skill = ORDINARY } = {}) => ({
  skillScavenging: skill,
  inventory: [
    ...(potency ? [{ slug: 'w', kind: 'weapon', potency }] : []),
    ...(armour ? [{ slug: 'a', kind: 'armour', potency: armour }] : []),
  ],
});

/**
 * Four ways to play it, and they are strategies rather than move lists.
 *
 * `greedy` closes and swings the moment it can. `patient` settles the animal first and only
 * closes when it is calm. `careful` is patient and walks away the moment anything turns — the
 * line a player takes when they cannot afford an injury.
 */
const LINES = {
  /* Presses on regardless: the line a player takes before they have read the board. */
  greedy: (state) => (state.closeness >= WITHIN_REACH ? 'strike' : 'close'),

  /*
   * Reads the two tells and nothing else: close when it is cheap, otherwise wait. No sense of
   * the press budget at all, which is the mistake this rebuild is meant to make *possible* —
   * under the old dice there was no such thing as playing it wrong on purpose.
   */
  'reads the beat': (state) => {
    if (state.turning) return 'leave';
    if (state.closeness >= WITHIN_REACH) {
      return shotOf(state, LINE_SURVIVOR).lands ? 'strike' : 'still';
    }
    return alarmCostOf(state) === 0 ? 'close' : 'still';
  },

  /*
   * And the same, but counting the presses it has left: it will pay for a close it cannot
   * afford to wait for. This is the line the mode is designed to reward.
   */
  'plays the clock': (state) => {
    if (state.turning) return 'leave';
    const left = MAX_TURNS - state.turn;
    const shot = shotOf(state, LINE_SURVIVOR);
    if (state.closeness >= WITHIN_REACH) {
      if (shot.lands) return 'strike';
      // Only wait if there is time to settle and still swing.
      return shot.shortBy < left ? 'still' : 'strike';
    }
    const needed = WITHIN_REACH - state.closeness;
    const spare = left - needed - 1;
    if (alarmCostOf(state) === 0) return 'close';
    return spare > 0 ? 'still' : 'close';
  },
};

/*
 * The survivor the heuristic lines are reading against.
 *
 * A wart, and an honest one: the lines are plain functions of state and the tolerance they are
 * playing toward belongs to the hunter. Set per run below.
 */
let LINE_SURVIVOR = { inventory: [] };

/**
 * And the ceiling: is there a winning line at all?
 *
 * Brute-forces every sequence of presses — three moves, five deep, 243 of them — and asks
 * whether ANY of them takes the animal. **This is the figure that says whether the mode is
 * skill or luck.** A hunt nobody could have won is a hunt the player lost to the deal; one
 * that a perfect line takes and a real line misses is a hunt they lost to themselves, which is
 * the only kind worth having.
 */
function solvable(seed, survivor) {
  const moves = ['close', 'still', 'strike'];
  const walk = (state, depth) => {
    if (state.status === 'taken') return true;
    if (state.status !== 'active' || depth >= MAX_TURNS) return false;
    return moves.some((move) => {
      if (!movesFor(state).some((one) => one.key === move)) return false;
      return walk(takeTurn(state, move, { seed, survivor }), depth + 1);
    });
  };
  return walk(startOf(seed), 0);
}

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

const KIT = [
  ['bare hands', 0, 0],
  ['scrap spear', 25, 0],
  ['hunting bow', 35, 0],
  ['bow and hide coat', 35, 18],
  ['bow and plate vest', 35, 30],
];

for (const [what, potency, armour] of KIT) {
  console.log(`  ${what}`);
  console.log(
    '    line            taken  bolted   lost    left  mauled     food     hide    sinew   damage',
  );
  LINE_SURVIVOR = hunter(potency, { armour });
  let winnable = 0;
  for (let seed = 1; seed <= SEEDS; seed += 1) if (solvable(seed, LINE_SURVIVOR)) winnable += 1;
  console.log(`    a perfect line takes it in ${pct(winnable).trim()} of them`);

  for (const [name, line] of Object.entries(LINES)) {
    const r = run(line, hunter(potency, { armour }));
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
