/**
 * What does answering a moment actually buy?
 *
 * Phase 6 added the first thing in this game that pays an attentive player more than
 * an absent one, and every number behind it was written by hand and never checked.
 * The plan commits to three figures. This measures all three against what shipped.
 *
 *   1. Attending everything is worth at most one region step of loot.
 *   2. No moment comes round twice within five trips to the same region.
 *   3. No option is right in more than about 60% of realistic states.
 *
 * Regions come from the database rather than being restated here, so this measures the
 * game rather than a copy of it. Everything else is pure, so ninety thousand trips run
 * in a second.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/moment-balance.mjs
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { momentsFor } from '../src/game/moments.js';
import { ORDINARY } from '../src/game/wanderers.js';

const SEEDS = 4000;

const { rows: dbRegions } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by danger, travel_hours`,
);
await pool.end();

const regions = dbRegions.map((row) => ({
  slug: row.slug,
  name: row.name,
  danger: row.danger,
  travelHours: Number(row.travel_hours),
  loot: row.loot,
  finds: row.finds,
  radiationPerTrip: Number(row.radiation_per_trip),
}));

const survivor = (health = 100, radiation = 0) => ({
  health,
  radiation,
  skillScavenging: ORDINARY,
  inventory: [],
});
const haul = (loot) => Object.values(loot).reduce((sum, value) => sum + value, 0);

/**
 * What a trip was worth, in units of scrap.
 *
 * Measuring loot alone was the first version of this file and it was useless: most
 * moments do not touch loot at all — they trade hours for a dose, or a risk for a find
 * — so a loot-only metric scored them all identically and then reported whichever
 * option happened to be listed first as "always right". The conversions below are
 * derived from the game rather than chosen, so they can be argued with:
 *
 * - **A rad costs 0.3.** The first version of this priced a rad at the 1.25 hours it
 *   takes to decay, times 3.3 units an hour — and reported the Deep Zone as *net
 *   negative*, which contradicts the game's own measured finding that danger pays. The
 *   error was treating every rad as forced waiting. It is not: nothing is gated below
 *   60 rads, and an eighteen-hour trip decays 14 of the 25 it doses while the survivor
 *   is still walking. Back-to-back Deep Zone runs net about 10 rads a trip, so the
 *   threshold arrives every sixth trip and costs roughly 13 hours of waiting out of
 *   108 — about 12% of the time, or 7 units against 25 rads.
 * - **A point of damage costs 1.** Regeneration is 2/h, and the same "only when it
 *   actually gates you" argument applies, so this is deliberately below the 1.65 that
 *   treating it as forced waiting would give.
 * - **A find is worth 20.** Roughly what the crafting inputs it feeds are worth against
 *   the scrap those recipes also want.
 * - **Death is worth minus everything.** A dead survivor brings nothing home and costs
 *   a day or two of camp production on top.
 *
 * These are contestable and the headline figures move with them, which is the honest
 * position: they are written here as constants rather than buried, so an argument about
 * the conclusion can be had as an argument about the number.
 */
const RAD = 0.3;
const DAMAGE = 1;
const FIND = 20;
/**
 * What burning one thing out of the pack costs, by what it is.
 *
 * A flat price treated a tin of stew and a dose of chelation as the same sacrifice,
 * which made eating look wasteful and medicating look cheap. Food is common and
 * craftable from a surplus you could not store; meds are the scarcer thing.
 */
const ITEM_COST = { preserved_meal: 12, tinned_stew: 10, rad_scrubber: 28, rad_x: 22 };
const priceOf = (slugs) => Math.min(...slugs.map((slug) => ITEM_COST[slug] ?? 20));

/**
 * Past 60 rads the survivor takes 4 damage an hour until it decays. A dose that crosses
 * that line is a different thing from one that does not, and pricing every rad the same
 * was hiding it: with a flat rate, sitting out a storm was either always right (rads
 * dear) or never right (rads cheap), and never a judgement about the survivor in front
 * of you. Which is the entire point of a moment keyed to the radiation axis.
 */
const OVER_THRESHOLD = 6;

function worth(outcome, who) {
  if (outcome.died) return -Infinity;

  const ends = Number(who?.radiation ?? 0) + outcome.radiation;
  const excess = Math.max(0, ends - 60) - Math.max(0, Number(who?.radiation ?? 0) - 60);

  return (
    haul(outcome.loot) +
    outcome.finds.reduce((sum, find) => sum + find.qty, 0) * FIND -
    outcome.radiation * RAD -
    excess * OVER_THRESHOLD -
    Math.max(0, outcome.damage - (outcome.healed ?? 0)) * DAMAGE
  );
}

/**
 * What the answers cost in time, priced at what the region pays for an hour.
 *
 * Left out of the first three versions of this file, and it mattered more than anything
 * else in it: an expedition is priced in hours, so an option that buys something for
 * "+90 minutes" was being scored as pure upside. Sitting out a rad storm went from
 * looking like a reasonable 52% answer to being right 94% of the time — not because the
 * game changed, but because the instrument was not charging for the one thing the
 * player is actually spending.
 */
function hoursCost(region, seed, choices, rate) {
  const moments = momentsFor(region, seed);
  let hours = 0;

  for (const choice of choices ?? []) {
    const moment = moments.find((candidate) => candidate.index === choice.index);
    const option = moment?.options.find((candidate) => candidate.key === choice.option);
    hours += Number(option?.hours ?? 0);
  }

  return hours * rate;
}

/** What an hour in this region is worth, measured rather than assumed. */
function hourlyRate(region) {
  let loot = 0;
  for (let seed = 0; seed < 500; seed += 1) {
    loot += haul(resolveExpedition({ region, survivor: survivor(), seed }).loot);
  }
  return loot / 500 / region.travelHours;
}

/**
 * The greediest reading of every moment: whichever option leaves the most in the pack.
 *
 * This is an upper bound rather than a likely player. It ignores what a spend costs —
 * the pure resolution does not check the pack, the service does — and it will happily
 * confront something for a find. If the bound holds against *this*, it holds.
 */
function greedy(region, seed, who, rate = rateFor(region)) {
  const choices = [];

  for (const moment of momentsFor(region, seed)) {
    choices.push({
      index: moment.index,
      option: bestAt(region, seed, who, choices, moment, rate),
    });
  }

  return choices;
}

const rates = new Map();
const rateFor = (region) => {
  if (!rates.has(region.slug)) rates.set(region.slug, hourlyRate(region));
  return rates.get(region.slug);
};

/**
 * The option that leaves the trip worth most, given what has already been answered.
 *
 * Starts from the default rather than from nothing, because when every branch ends in
 * death they are all worth -Infinity and nothing is strictly better than anything —
 * which used to leave this returning null and reporting a phantom option.
 *
 * A spend is charged for what it spends. Without that, tablets are almost always right,
 * which says more about the metric than the game: the pure resolution does not know
 * what a pack costs, so the tool has to.
 */
function bestAt(region, seed, who, choices, moment, rate) {
  let best = moment.options.find((option) => option.verb === 'default').key;
  let bestValue = -Infinity;

  for (const option of moment.options) {
    const trial = [...choices, { index: moment.index, option: option.key }];
    const outcome = resolveExpedition({ region, survivor: who, seed, choices: trial });
    // Only this option's hours matter to the comparison — whatever earlier answers
    // already cost is the same across every branch here.
    const value =
      worth(outcome, who) - (option.consumes ? priceOf(option.consumes) : 0) - Number(option.hours ?? 0) * rate;

    if (value > bestValue) {
      bestValue = value;
      best = option.key;
    }
  }

  return best;
}

function run(region, who, policy) {
  let loot = 0;
  let value = 0;
  let rads = 0;
  let deaths = 0;
  let trips = 0;

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const choices = policy ? policy(region, seed, who) : undefined;
    const outcome = resolveExpedition({ region, survivor: who, seed, choices });

    if (outcome.died) {
      deaths += 1;
      continue;
    }
    loot += haul(outcome.loot);
    value += worth(outcome, who) - hoursCost(region, seed, choices, rateFor(region));
    rads += outcome.radiation;
    trips += 1;
  }

  return {
    loot: loot / trips,
    value: value / trips,
    rads: rads / trips,
    deathRate: deaths / SEEDS,
  };
}

const long = regions.filter((region) => momentsFor(region, 1).length > 0);

console.log('\n=== 1. What attending is worth ===\n');
console.log(`  Value counts loot, plus finds at ${FIND}, less rads at ${RAD} and damage at ${DAMAGE}.`);
console.log('  Those conversions are derived at the top of this file, and arguable.\n');
/**
 * One list of widths for the heading and the rows, so a clearer word cannot silently
 * push a column off its numbers — which is exactly what happened the first time these
 * were renamed by hand.
 */
const COLS = [
  ['region', 22, 'end'],
  ['moments', 9, 'start'],
  ['left alone', 13, 'start'],
  ['answered', 11, 'start'],
  ['answering adds', 16, 'start'],
  ['a better region adds', 22, 'start'],
];

const row = (values) =>
  '  ' +
  values
    .map((value, i) =>
      COLS[i][2] === 'end'
        ? String(value).padEnd(COLS[i][1])
        : String(value).padStart(COLS[i][1]),
    )
    .join('');

console.log(row(COLS.map(([label]) => label)));

const unattended = new Map();
for (const region of long) unattended.set(region.slug, run(region, survivor()));

/**
 * The next *rung*, not the next row.
 *
 * This compared each region to whichever one happened to sit beside it in the sorted
 * list, which was the same thing back when every region had a tier to itself. Phase 8
 * opened four more, deliberately priced alongside existing ones rather than above them
 * — "other, not stronger" — and the map became five rungs with two places on most of
 * them. Read the old way, every one of those pairs failed the bound by a mile while
 * saying nothing at all about the game: a sideways move is not the progression the
 * bound is about, and a step of 1% to a region of equal value is not a step.
 *
 * So a rung is anything within SAME_RUNG of this value, and the step is to the first
 * place actually worth graduating to. The bound itself is unchanged. What changed is
 * that the map now has choices on it, which is what Phase 8 was for.
 */
const SAME_RUNG = 0.1;

for (const [index, region] of long.entries()) {
  const base = unattended.get(region.slug).value;
  const best = run(region, survivor(), greedy).value;

  const next = long
    .slice(index + 1)
    .find((other) => unattended.get(other.slug).value > base * (1 + SAME_RUNG));
  const step = next ? (unattended.get(next.slug).value - base) / base : null;

  // A peer at the same tier is worth naming: it is a choice rather than a ladder, and
  // the pairs read as a mistake without it.
  const peers = long.filter(
    (other) =>
      other.slug !== region.slug &&
      Math.abs(unattended.get(other.slug).value - base) <= base * SAME_RUNG,
  );

  console.log(
    row([
      region.name,
      momentsFor(region, 1).length,
      base.toFixed(1),
      best.toFixed(1),
      `${((best / base - 1) * 100).toFixed(1)}%`,
      step === null ? '—' : `${(step * 100).toFixed(0)}%`,
    ]) + (peers.length > 0 ? `   or ${peers.map((p) => p.name).join(', ')}, worth the same` : ''),
  );
}

console.log('\n  Read it as: a trip here is worth this much left alone, this much if');
console.log('  somebody answers its moments, and answering is worth this much more.');
console.log('  The last column is what going somewhere better would be worth instead.');
console.log('\n  Answering must stay worth less than moving on, or the map stops');
console.log('  mattering and the best play is to grind one region carefully. Regions');
console.log(`  within ${SAME_RUNG * 100}% of each other share a rung — a choice, not a step.\n`);

console.log('=== 2. Does a healthy survivor still come home? ===\n');
console.log('  region                 at 100 hp        at 35 hp');
console.log('                       unatt   greedy   unatt   greedy');

for (const region of long) {
  const cells = [survivor(100), survivor(35)].flatMap((who) => [
    run(region, who).deathRate,
    run(region, who, greedy).deathRate,
  ]);

  console.log(
    '  ' + region.name.padEnd(20) + cells.map((rate) => `${(rate * 100).toFixed(1)}%`.padStart(8)).join(''),
  );
}

console.log('\n  Greedy play at full health must stay at 0.0%: a healthy survivor');
console.log('  cannot die on an expedition, however badly they answer.\n');

console.log('=== 3. How often the same moments come round ===\n');
console.log('  region                 eligible   distinct in 5 trips   repeat within 5');

for (const region of long) {
  const slots = momentsFor(region, 1).length * 5;
  const eligible = new Set();
  let distinctTotal = 0;
  let repeats = 0;
  const runs = 800;

  for (let sample = 0; sample < runs; sample += 1) {
    const seen = [];
    for (let trip = 0; trip < 5; trip += 1) {
      for (const moment of momentsFor(region, sample * 5 + trip + 1)) {
        seen.push(moment.key);
        eligible.add(moment.key);
      }
    }
    distinctTotal += new Set(seen).size;
    if (new Set(seen).size < seen.length) repeats += 1;
  }

  console.log(
    '  ' +
      region.name.padEnd(22) +
      String(eligible.size).padStart(6) +
      `${(distinctTotal / runs).toFixed(1)} of ${slots}`.padStart(18) +
      `${((repeats / runs) * 100).toFixed(0)}%`.padStart(18),
  );
}

console.log('\n  Target: no moment twice within five trips. The six exemplars cannot');
console.log('  meet this and are not meant to — the figure says how much content will.\n');

console.log('=== 4. Is any option simply the right answer? ===\n');

// Measured across a range of states, because "is this the right answer" depends on the
// survivor in front of you — which is the entire point of keying moments off different
// axes. Judged at full health and no rads only, turning back would never win anything
// and sitting out a storm would never be worth ninety minutes.
const STATES = [
  [100, 0], [100, 35], [100, 55],
  [60, 0], [60, 35], [60, 55],
  [30, 0], [30, 35], [30, 55],
];

const wins = new Map();
for (const region of long) {
  for (let seed = 0; seed < 900; seed += 1) {
    const who = survivor(...STATES[seed % STATES.length]);
    const choices = [];

    for (const moment of momentsFor(region, seed)) {
      const best = bestAt(region, seed, who, choices, moment, rateFor(region));

      wins.set(`${moment.key}/${best}`, (wins.get(`${moment.key}/${best}`) ?? 0) + 1);
      wins.set(moment.key, (wins.get(moment.key) ?? 0) + 1);
      choices.push({ index: moment.index, option: best });
    }
  }
}

console.log('  moment           option          wins');
for (const [key, count] of [...wins.entries()].filter(([key]) => key.includes('/')).sort()) {
  const [moment] = key.split('/');
  const share = count / wins.get(moment);
  console.log(
    '  ' +
      key.padEnd(32) +
      `${(share * 100).toFixed(0)}%`.padStart(5) +
      (share > 0.6 ? '   <-- a tax on attention, not a decision' : ''),
  );
}

console.log('\n  Target: nothing over ~60%. An option that is always right is not a');
console.log('  choice, and the prose around it is decoration.\n');
