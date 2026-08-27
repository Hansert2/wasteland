/**
 * Tuning constants for the simulation tick.
 *
 * The plan's tuning guard: death should be the price of neglect, not of a weekend
 * away. With the defaults below, a survivor at full health takes 53.5 hours to die
 * once stores hit zero — ~17h for hunger to climb into the starvation band, then
 * ~37h of drain. Stack several days of stored food on top of that and a well-run
 * camp survives about a week of absence.
 *
 * `test/unit/tick.test.js` asserts that window stays between 36h and 72h, so a balance
 * pass that accidentally makes the game punish real life will fail the suite.
 *
 * Everything here is data, not logic. Balance passes edit this file only.
 */
export const CONFIG = {
  /**
   * Simulation slice. The tick walks the elapsed interval in steps of this size so
   * that thresholds (starvation onset, death, auto-consume) land in the right order
   * instead of being smeared across one giant closed-form multiply.
   *
   * 15 minutes keeps a month-long absence under 3000 iterations of plain arithmetic
   * while being far finer than any threshold we care about.
   */
  stepMs: 15 * 60 * 1000,

  /** Survivor consumption, drawn from settlement storage. */
  foodPerHour: 0.5,
  waterPerHour: 0.75,

  /** Hunger is 0 (fed) to 100 (starving). Unfed, it fills in ~24h. */
  hungerRisePerHour: 4.2,
  hungerFallPerHour: 12,
  starvationThreshold: 70,

  /** Radiation is 0 to 100. It decays on its own; meds decay it faster. */
  radDecayPerHour: 0.8,
  /*
   * The dose at which the curve reaches its full bite, and what medicine still measures
   * itself against.
   *
   * It was a hard threshold until 2026-08-27: nothing below sixty, a ramp above it. That
   * made radiation the most decision-moving number in the game and simultaneously a
   * decision only inside a narrow band — measured, a further 25 rads was *free* at eight
   * starting levels out of eleven, because below the line a dose cost nothing at all.
   *
   * Damage is now `radDamagePerHour * (rads / 100) ^ radDamageExponent`, so every dose
   * costs something and the cost accelerates. This constant survives as the reference
   * point medicine shifts: a better medic carries their dose as though it were smaller.
   */
  radThreshold: 60,

  /*
   * How sharply the cost of a dose accelerates.
   *
   * Four, and chosen so the top of the scale — where the game is already balanced — stays
   * near where the old ramp put it, while the flat nothing below sixty becomes a slope.
   * At ninety rads a survivor loses about sixty health getting clean, which is what the
   * threshold model already charged; at thirty they lose one, where they used to lose
   * nothing. A cube would charge eighty-three at ninety, which is a death sentence on a
   * survivor who also arrives carrying up to forty-five hazard damage.
   */
  radDamageExponent: 4,

  /** Health is 0 to 100. Damage rates apply at the top of each band. */
  starvationDamagePerHour: 3,
  radDamagePerHour: 4,

  /** Regeneration, only while fed and not badly irradiated. */
  /*
   * Health regained per hour by somebody who is fed and clean.
   *
   * Scaled down by the dose rather than switched off past a line — see `regenRadCeiling`,
   * which is now the number that scaling is written against rather than a gate.
   */
  regenPerHour: 2,
  regenHungerCeiling: 25,
  /*
   * Retired as a gate on 2026-08-27, kept as the shape of one.
   *
   * Health used to regenerate only below this dose and not at all above it, which put a
   * second cliff on the same axis as the damage threshold and left forty points of the
   * scale — twenty rads to sixty — where a survivor neither healed nor suffered. A player
   * had no way to tell whether thirty was better than fifty, because it was not.
   *
   * Healing now fades with the dose instead: `regenPerHour * (1 - rads/100)`. Nothing
   * reads this as a limit any more. It stays because `regenHungerCeiling` beside it is
   * still a real gate and a lone constant would read as an oversight, and because the
   * tests that pinned the old behaviour name it.
   */
  regenRadCeiling: 20,
};
