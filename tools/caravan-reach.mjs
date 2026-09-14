/**
 * How long a camp waits for one particular crew — and what a third crew did to that.
 *
 * Phase 5 wrote down a rule and protected it with a test: **the crew that hates you still
 * shows up**, because trading with them is the only way standing recovers, and a faction that
 * stopped visiting would make the rivalry a one-way ratchet. `caravanVisit` takes a seed and
 * an index and no standing at all, precisely so that cannot drift.
 *
 * Phase 17 did not touch that function and still weakened the rule. The crew is drawn
 * uniformly from `Object.keys(FACTIONS)`, so a third crew makes any *particular* crew turn up
 * two visits in six instead of three — **the road back from a grudge got half again as long,
 * and nothing in the diff says so.** That is the kind of consequence this file exists to put a
 * number on before it is discovered in play.
 *
 * Measured, not reasoned: the visit sequence is the game's own, walked over many seeds. The
 * two-crew figure is the one thing here that is stated rather than run — the draw is uniform,
 * so the expected gap scales exactly with the number of crews, and the ratio is arithmetic.
 *
 *   node tools/caravan-reach.mjs
 */
import { caravanVisit, FACTIONS } from '../src/game/factions.js';

const SLUGS = Object.keys(FACTIONS);
const SEEDS = 400;
const VISITS = 300;

/** The wall-clock timeline of one camp's visits: when each crew is at the gate, and for how long. */
function timeline(seed) {
  const visits = [];
  let at = 0;
  for (let index = 0; index < VISITS; index += 1) {
    const visit = caravanVisit(seed, index);
    at += visit.gapHours;
    visits.push({ faction: visit.faction, from: at, to: at + visit.stayHours });
    at += visit.stayHours;
  }
  return visits;
}

const gaps = Object.fromEntries(SLUGS.map((slug) => [slug, []]));
const openHours = Object.fromEntries(SLUGS.map((slug) => [slug, 0]));
let spanHours = 0;

for (let seed = 1; seed <= SEEDS; seed += 1) {
  const visits = timeline(seed);
  spanHours += visits.at(-1).to;

  for (const slug of SLUGS) {
    const mine = visits.filter((visit) => visit.faction === slug);
    for (const visit of mine) openHours[slug] += visit.to - visit.from;
    /*
     * Gate to gate: the wait between one chance to trade with them and the next, which is the
     * quantity the rule is about. Measured from the *end* of a visit, because a camp that
     * caught one is not waiting during it.
     */
    for (let i = 1; i < mine.length; i += 1) gaps[slug].push(mine[i].from - mine[i - 1].to);
  }
}

const stat = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return {
    mean: sorted.reduce((sum, one) => sum + one, 0) / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p90: sorted[Math.floor(sorted.length * 0.9)],
    worst: sorted.at(-1),
  };
};

console.log(`${SLUGS.length} crews, ${SEEDS} camps, ${VISITS} visits each\n`);
console.log('  crew                 mean wait   median      9 in 10 under   worst    at the gate');
for (const slug of SLUGS) {
  const s = stat(gaps[slug]);
  const d = (h) => `${(h / 24).toFixed(1)}d`;
  console.log(
    `  ${slug.padEnd(18)}   ${d(s.mean).padStart(9)}   ${d(s.p50).padStart(6)}   ${d(s.p90).padStart(13)}` +
      `   ${d(s.worst).padStart(5)}   ${((openHours[slug] / spanHours) * 100).toFixed(1)}% of hours`,
  );
}

/*
 * And the comparison the phase owes. The draw is uniform over the crews, so a camp's wait for
 * any one of them is proportional to how many there are; the two-crew world is this one scaled
 * by 2/3, and that is arithmetic rather than a second simulation.
 */
const all = stat(SLUGS.flatMap((slug) => gaps[slug]));
console.log(
  `\n  across all crews the mean wait is ${(all.mean / 24).toFixed(1)}d.` +
    ` At two crews it was ${((all.mean * 2) / 3 / 24).toFixed(1)}d.`,
);
console.log(
  `  A camp that has burned one crew waits ${((all.mean - (all.mean * 2) / 3) / 24).toFixed(1)}d` +
    ' longer for its chance to buy its way back.',
);
