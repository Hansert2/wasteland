/**
 * What structures contribute. Pure data plus pure functions — no database, no clock.
 *
 * Production is derived from structures every time it is needed rather than cached
 * on the resource row. A cached rate has to be resynced on every build, upgrade and
 * raid, and the failure mode is silent: production quietly wrong, discovered days
 * later. Deriving it costs one small join and cannot drift.
 *
 * Storage cap is the exception and stays a stored column: keeping it lets the
 * database enforce `amount <= storage_cap` as a real invariant, which is worth more
 * than the symmetry. It changes only when the shelter does.
 */

export const STRUCTURE_KINDS = [
  'shelter',
  'garden',
  'water_purifier',
  'workshop',
  'watchtower',
];

/**
 * Per-level contributions.
 *
 * The garden exists because the plan's structure list had no food producer, which
 * would have made starvation unavoidable rather than a consequence of neglect — and
 * the offline-death design rests on a camp being able to run food-positive.
 */
export const STRUCTURES = {
  shelter: { storagePerLevel: 250, baseCost: 30, baseHours: 6 },
  garden: { produces: 'food', perLevel: 1.2, baseCost: 20, baseHours: 4 },
  water_purifier: { produces: 'water', perLevel: 2.5, baseCost: 25, baseHours: 5 },
  workshop: { produces: 'scrap', perLevel: 1, baseCost: 25, baseHours: 5 },
  watchtower: { defencePerLevel: 8, baseCost: 40, baseHours: 8 },
};

/**
 * Cost and duration to build the *next* level. Exponential growth is what gives an
 * Ogame-style game its long tail: early levels are an evening, later ones a week.
 * Both formulas live here so a balance pass edits one file.
 */
export function upgradeCost(kind, currentLevel) {
  const spec = STRUCTURES[kind];
  if (!spec) return null;
  return {
    scrap: Math.round(spec.baseCost * 1.6 ** currentLevel),
    hours: Math.round(spec.baseHours * 1.4 ** currentLevel * 10) / 10,
  };
}

/**
 * Hourly production for a settlement, in the units the tick expects.
 * @param {{kind: string, level: number}[]} structures
 */
export function productionRates(structures) {
  const rates = { water: 0, food: 0, scrap: 0, fuel: 0 };

  for (const { kind, level } of structures) {
    const spec = STRUCTURES[kind];
    if (!spec?.produces || level <= 0) continue;
    rates[spec.produces] += spec.perLevel * level;
  }

  return rates;
}

/** Total storage available, shared across every resource kind. */
export function storageCap(structures) {
  const shelter = structures.find((s) => s.kind === 'shelter');
  return 100 + (shelter ? STRUCTURES.shelter.storagePerLevel * shelter.level : 0);
}

/**
 * Derived, never stored — a column would drift the moment a structure changed, and
 * this is the number that decides when NPC raiders take an interest in Phase 3.
 */
export function campStrength(structures) {
  return structures.reduce((total, { kind, level }) => {
    const spec = STRUCTURES[kind] ?? {};
    const defence = (spec.defencePerLevel ?? 0) * level;
    return total + level + defence;
  }, 0);
}
