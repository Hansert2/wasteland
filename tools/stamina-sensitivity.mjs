/**
 * Would stamina be a decision, or queue discipline with a gauge attached?
 *
 * Phase 10 asked one question before anything was built, and this answers it:
 *
 *   **Does stamina ever make the right answer "send the tired one anyway"?**
 *
 * `skill-sensitivity.mjs` cannot answer it. That instrument asks whether a survivor's
 * numbers change which *moment option* wins, and stamina does not act on moments — it
 * acts on which person leaves the gate. So the question has to be asked about dispatch.
 *
 * ## What is actually being measured
 *
 * A camp with a roster picks somebody to send. What that choice is worth is not the haul,
 * because the haul comes back whoever carries it. It is the haul divided by **how long
 * that person is then unavailable**, which is the currency the whole fuel economy already
 * turns out to trade in — see `fuel-balance.mjs`.
 *
 * With one gauge the answer is trivial: you send whoever is in better shape. Adding stamina
 * is only worth doing if the two gauges *disagree* often enough that a player has something
 * to weigh. So the value of sending someone is `yield / (travel + downtime)`, where
 *
 *     downtime = max(hours until fit to travel, hours until rested enough to)
 *
 * **The max is the whole mechanic.** If stamina always refills faster than the dose clears,
 * stamina never binds and it is scenery for the third time. If it sometimes binds and
 * sometimes does not, there is a decision.
 *
 * ## The three answers this prints
 *
 * - **contested** — how often the survivor in better shape and the most rested one are
 *   *different people*. Only there is a choice being made at all; everywhere else both
 *   gauges point at the same person and any policy gets it right.
 * - **healthiest wrong / rested wrong** — inside those contested states, how often each
 *   single-gauge policy is the worse call. Both have to be substantial or there is no
 *   weighing: one near zero means the other gauge already decides and this one is either
 *   agreeing with it or has replaced it.
 * - **survivor idle** — the share of a cycle spent waiting rather than playing, because a
 *   contest bought with idleness is not a bargain. It is already what makes danger 4
 *   out-earn danger 5.
 *
 * A first version of this counted states where the best pick was *neither* the healthiest
 * nor the most rested, and reported a flat zero at every shape. That was not a finding —
 * with two survivors and two gauges the winner is always better on at least one of them,
 * so the column could not have been anything else. It measured the arithmetic, not the
 * game, and it is recorded here because it looked exactly like a result.
 *
 * Regions come from the database and the health arithmetic is imported from `tick.js`, so
 * this measures the game that shipped rather than a model of it. Nothing here writes.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/stamina-sensitivity.mjs
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';
import { CONFIG } from '../src/game/constants.js';
import { radDamagePerHourAt } from '../src/game/tick.js';
import { ORDINARY } from '../src/game/wanderers.js';

const SEEDS = 400;
const STATES = 4000;

/**
 * How much better one pick has to be before the choice counts as a choice.
 *
 * Five percent of the rate. Below that the two survivors deliver the same trip and which
 * one goes is a matter of taste, so counting it as a disagreement would measure the
 * tiebreak rather than the mechanic.
 */
const MATERIAL = 0.05;

/**
 * The candidate shapes for stamina, since none of them exists yet.
 *
 * `cost` is stamina spent per hour of travel and `regen` is points recovered per hour at
 * rest. Their ratio is what decides whether stamina ever binds: a trip costs
 * `cost x hours` and takes `cost x hours / regen` hours to pay back, so the payback is
 * `hours x cost / regen` — and radiation's payback at the Deep Zone is about 31 hours
 * against an 18-hour trip. Anything much under that and stamina is invisible.
 */
const SHAPES = [
  ['gentle  ', { cost: 1.5, regen: 2.0 }],
  ['moderate', { cost: 3.0, regen: 1.5 }],
  ['steep   ', { cost: 4.5, regen: 1.0 }],
  ['brutal  ', { cost: 6.0, regen: 0.75 }],
  // Derived rather than guessed: 100 / 26h, the longest walk on the map (Harrow End). At
  // anything dearer a rested survivor cannot reach the far end of the world at all.
  ['reach   ', { cost: 3.8, regen: 1.0 }],
];

const { rows } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions where radiation_per_trip > 0 order by danger, travel_hours`,
);

const regions = rows.map((row) => ({
  slug: row.slug,
  name: row.name,
  danger: row.danger,
  travelHours: Number(row.travel_hours),
  loot: row.loot,
  finds: row.finds,
  radiationPerTrip: Number(row.radiation_per_trip),
}));

/**
 * What a trip is worth, averaged over seeds.
 *
 * Scrap and fuel only, and weighted the way the road prices them: fuel is the one nothing
 * in the camp makes, so a unit of it is worth several of scrap. The exact weight is
 * arguable; what matters here is that it is the same for every survivor, because this
 * instrument compares *who to send*, not *where*.
 */
function tripValue(region) {
  let value = 0;
  let dose = 0;
  let trips = 0;

  for (let seed = 0; seed < SEEDS; seed += 1) {
    const out = resolveExpedition({
      region,
      survivor: { health: 100, skillScavenging: ORDINARY, inventory: [] },
      seed,
    });
    if (out.died) continue;
    value += (out.loot.scrap ?? 0) + 4 * (out.loot.fuel ?? 0);
    dose += out.radiation;
    trips += 1;
  }

  return { value: value / trips, dose: dose / trips, hours: region.travelHours };
}

const priced = regions.map((region) => ({ region, ...tripValue(region) }));

// --------------------------------------------------- the question, against the game

/*
 * Radiation has no cliff, and costs health on a curve.
 *
 * ### Two tables were cut from here on 2026-08-31, and why
 *
 * This file used to open with two passes that modelled radiation as a *threshold* — a
 * `radWait` that is zero until the dose crosses sixty — because that is what the game had
 * when the question was first asked. It stopped being true on 2026-08-27, when the cliff
 * shipped out and damage became a curve, and the plan recorded the debt at the time: half
 * this instrument's output described a game that did not exist and would be read as current
 * by whoever picked it up next. Phase 10 is built, so it is paid.
 *
 * **The finding they produced is kept, because it is why the game changed.** Slowing the
 * decay from 0.8 to 0.3 moved almost nothing, since a slower decay only sharpens a gauge
 * dormant in most states. Stamina as modelled is linear. **A threshold gauge and a linear
 * gauge cannot contest each other across a range**: below the line stamina decides alone,
 * above it radiation swamps everything, and only a stamina small enough to lose to the rare
 * bite looks like a decision. That is what sent the cliff away, and it is a fact about a
 * shape rather than about a constant — so it survives its instrument.
 *
 * So the shapes have to match. Either radiation becomes continuous or stamina becomes a
 * threshold, and the first is the one worth measuring: it also removes a cliff a player
 * has to learn rather than feel, where 59 rads is free and 61 is burning.
 *
 * Modelled as `radDamagePerHour * (rads/100)^4` — chosen because it leaves the top of the
 * scale, where the game is already balanced, almost where it is today, and replaces the
 * flat nothing below sixty with a slope. Under it there is no threshold to wait under at
 * all: what makes somebody unavailable is health, because they bleed while irradiated and
 * only heal once the dose is nearly gone.
 */
/*
 * The game's own arithmetic, imported rather than modelled.
 *
 * Both halves of it. When this was a proposal it carried its own copy of the curve and a
 * healing rule that switched off past `regenRadCeiling`, which is the thing measuring
 * *changed*: what shipped fades healing in proportion to the dose instead. A tool holding
 * a private copy of a rule the game has moved on from is exactly the fault the two cut
 * tables were, arriving by the other door — so there is no copy left here to drift.
 */
const damageAt = (rads) => radDamagePerHourAt({ radiation: rads }, CONFIG);
const healingAt = (rads) => CONFIG.regenPerHour * (1 - Math.min(100, Math.max(0, rads)) / 100);

/** Hours until this survivor is fit to send again, bleeding the whole way down. */
function recover(rads, health) {
  let r = rads;
  let hp = health;
  let hours = 0;

  while ((hp < 85 || r > CONFIG.regenRadCeiling) && hours < 600) {
    hp = Math.min(100, hp - damageAt(r) + healingAt(r));
    r = Math.max(0, r - CONFIG.radDecayPerHour);
    hours += 1;
    if (hp <= 0) return { hours: Infinity, dead: true };
  }

  return { hours, dead: false };
}

console.log();
console.log(`=== damage on a curve: (rads/100)^${CONFIG.radDamageExponent}, as the game charges it ===`);
console.log();
console.log('no threshold to wait under, so the gauges are health and stamina.');
console.log();
console.log('shape      contested   healthiest wrong   rested wrong   survivor idle');
console.log('  ' + '-'.repeat(70));

for (const [label, shape] of SHAPES) {
  let contested = 0;
  let fitWrong = 0;
  let restedWrong = 0;
  let occasions = 0;
  let idle = 0;
  let n = 0;

  for (const trip of priced) {
    for (let i = 0; i < STATES; i += 1) {
      n += 1;
      const a = { rads: (n * 37) % 55, stamina: 20 + ((n * 53) % 81), health: 60 + ((n * 17) % 41) };
      const b = { rads: (n * 71) % 55, stamina: 20 + ((n * 29) % 81), health: 60 + ((n * 23) % 41) };

      const rate = (s) => {
        if (s.stamina < shape.cost * trip.hours) return null;
        const after = recover(s.rads + trip.dose, s.health - (trip.hurt ?? 0));
        if (after.dead) return null;
        const left = s.stamina - shape.cost * trip.hours;
        const staminaWait = Math.max(0, (shape.cost * trip.hours - left) / shape.regen);
        const wait = Math.max(after.hours, staminaWait);
        return { rate: trip.value / (trip.hours + wait), wait };
      };

      const ra = rate(a);
      const rb = rate(b);
      if (!ra || !rb) continue;
      occasions += 1;
      // The share of the whole cycle spent waiting, not the wait against the trip: the
      // first version divided by `trip.hours` alone and printed 188%, which is a ratio
      // pretending to be a percentage.
      const chosen = ra.rate >= rb.rate ? ra : rb;
      idle += chosen.wait / (trip.hours + chosen.wait);

      if (Math.abs(ra.rate - rb.rate) / Math.max(ra.rate, rb.rate) < MATERIAL) continue;

      const best = ra.rate >= rb.rate ? 'a' : 'b';
      // "Best placed" on the radiation axis is now health net of the dose carried, since
      // the two are one gauge once the cliff is gone.
      const fit = a.health - a.rads >= b.health - b.rads ? 'a' : 'b';
      const rested = a.stamina >= b.stamina ? 'a' : 'b';
      if (fit === rested) continue;

      contested += 1;
      if (best !== fit) fitWrong += 1;
      if (best !== rested) restedWrong += 1;
    }
  }

  const ofC = (x) => `${((100 * x) / Math.max(1, contested)).toFixed(0)}%`;
  console.log(
    [
      `  ${label}`,
      `${((100 * contested) / occasions).toFixed(0)}%`.padStart(11),
      ofC(fitWrong).padStart(18),
      ofC(restedWrong).padStart(15),
      `${((100 * idle) / occasions).toFixed(0)}%`.padStart(15),
    ].join(' '),
  );
}

console.log();
console.log('A continuous gauge always has something to say, so nearly half of all');
console.log('dispatches are contested — and it is the *harsh* stamina shapes that hold');
console.log('their own, because a radiation that is no longer dormant out-argues a gentle');
console.log('one. Two gauges contest when they are the same shape and the same size.');
console.log();
console.log('"reach" is the shape the game shipped: 3.8 a worked hour, which is a hundred');
console.log('points over the longest walk on the map rather than a figure off this table.');
console.log('It sits where steep does and costs two points less idleness.');
console.log();
console.log('Two tables were cut from above this one on 2026-08-31 — see the note in the');
console.log('source. They modelled a radiation that had a cliff, which the game stopped');
console.log('having on 2026-08-27, and the figures here moved when the healing rule came');
console.log('from tick.js instead of from a copy: healing now fades with the dose rather');
console.log('than switching off under a ceiling, so recovery is slower low down and every');
console.log('"healthiest wrong" figure is a few points higher than the plan records.');

await pool.end();
