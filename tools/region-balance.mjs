/**
 * Does danger pay?
 *
 * The core loop is choosing where to send someone. That choice is only interesting if
 * the dangerous places are worth the danger — and only fair if the safe ones are
 * worth walking to. Regions are read from the database rather than restated here, so
 * this measures what actually shipped.
 */
import { pool } from '../src/db/pool.js';
import { resolveExpedition } from '../src/game/expeditions.js';

const SEEDS = 3000;

const { rows: regions } = await pool.query(
  `select slug, name, danger, travel_hours, loot, finds, radiation_per_trip
     from regions order by danger, travel_hours`,
);

const survivor = (o = {}) => ({ health: 100, skillScavenging: 1, inventory: [], ...o });

function measure(region, who) {
  let units = 0;
  let rads = 0;
  let deaths = 0;
  let hurt = 0;
  let finds = 0;

  for (let seed = 0; seed < SEEDS; seed++) {
    const out = resolveExpedition({
      region: {
        name: region.name,
        danger: region.danger,
        loot: region.loot,
        finds: region.finds,
        radiationPerTrip: Number(region.radiation_per_trip),
      },
      survivor: who,
      seed,
    });

    if (out.died) {
      deaths += 1;
      continue; // nothing comes home
    }
    units += Object.values(out.loot).reduce((a, b) => a + b, 0);
    rads += out.radiation;
    finds += out.finds.reduce((a, f) => a + f.qty, 0);
    if (out.damage > 0) hurt += 1;
  }

  const trips = SEEDS - deaths;
  const h = Number(region.travel_hours);
  return {
    perHour: units / trips / h,
    radsPerHour: rads / trips / h,
    findsPerTrip: finds / trips,
    hurtRate: hurt / trips,
    deathRate: deaths / SEEDS,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;

for (const [label, who] of [
  ['a healthy survivor (100 hp)', survivor()],
  ['a wounded one (35 hp)', survivor({ health: 35 })],
]) {
  console.log(`\n=== ${label} ===`);
  console.log('  region                 d   h   loot/h  rads/h  finds  hurt    died');
  console.log('  ' + '-'.repeat(68));

  for (const region of regions) {
    const m = measure(region, who);
    console.log(
      `  ${region.name.padEnd(22)}${region.danger}  ${String(Number(region.travel_hours)).padStart(2)}` +
        `  ${m.perHour.toFixed(2).padStart(7)}` +
        `  ${m.radsPerHour.toFixed(2).padStart(6)}` +
        `  ${m.findsPerTrip.toFixed(2).padStart(5)}` +
        `  ${pct(m.hurtRate).padStart(6)}  ${pct(m.deathRate).padStart(6)}`,
    );
  }
}

await pool.end();
