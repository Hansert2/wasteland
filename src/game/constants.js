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
  radThreshold: 60,

  /** Health is 0 to 100. Damage rates apply at the top of each band. */
  starvationDamagePerHour: 3,
  radDamagePerHour: 4,

  /** Regeneration, only while fed and not badly irradiated. */
  regenPerHour: 2,
  regenHungerCeiling: 25,
  regenRadCeiling: 20,
};
