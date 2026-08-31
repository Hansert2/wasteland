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

  /* ---- stamina: what a survivor's day is worth ---------------------------------- */

  /*
   * Phase 10, and the shape was chosen by measurement rather than by taste.
   *
   * `tools/stamina-sensitivity.mjs` reads four candidate shapes over eight dosing regions
   * and four thousand states each, and asks the only question that decides whether a
   * second gauge is a mechanic at all: **does it ever make the right answer "send the
   * tired one anyway"?** In the states where the healthiest survivor and the most rested
   * one are different people — 45% of dispatches — neither single-gauge policy is right
   * often enough to be a rule.
   *
   *     shape        contested   healthiest wrong   rested wrong   survivor idle
   *     gentle             47%                 9%            91%             39%
   *     moderate           46%                15%            85%             50%
   *     steep              45%                36%            64%             60%
   *     brutal             45%                43%            57%             63%
   *
   * Gentle loses at 91%: a radiation that is no longer a threshold simply out-argues it.
   * Brutal costs three more points of idleness than steep and buys nothing — it was the
   * better shape until Phase 11 settled trips across their hours, and re-measuring on
   * 2026-08-30 flipped it. **Steep, and not past it.**
   *
   * ### Why 3.8 rather than steep's 4.5, measured 2026-08-31
   *
   * Steep makes a region unreachable. Harrow End is a 26-hour walk, so at 4.5 it costs 117
   * of a hundred-point gauge and no survivor can ever be sent — and Harrow End is the
   * danger-5 region the balance work of 2026-08-27 lifted to 20.2 fuel/day, the best earner
   * on the map. A constant that deletes content is the wrong constant however well it
   * measures on the axis it was chosen for.
   *
   * So the cost is **derived from the map instead of picked from the table**: a hundred
   * points divided by the longest walk in `regions`, which is the rule "a rested survivor
   * can reach anywhere in the world, once". Re-measured at that value it is steep in
   * everything but name, and slightly cheaper:
   *
   *     shape        contested   healthiest wrong   rested wrong   survivor idle
   *     steep              45%                36%            64%             60%
   *     3.8 (this)         44%                37%            63%             58%
   *
   * **If a longer region is ever added this number has to move with it**, or that region
   * ships unreachable and nothing will say so. That is a real coupling and it is the honest
   * one: the scale of a day's walking is a fact about how far the places are.
   *
   * The units are points of a hundred, per hour of work or of rest.
   */
  staminaPerHourWorked: 3.8,
  staminaRegenPerHour: 1,

  /*
   * What recovery drinks, and this is the load-bearing number.
   *
   * Food is not a constraint in this game — measured 2026-08-27, every camp sits at its
   * storage cap throwing food away hourly, and a garden outgrows a mouth at level two. So
   * "recovery costs food" at any ordinary rate costs *nothing*, and stamina would be
   * scenery for a third time. It has to drink several times what a survivor eats before
   * the store notices.
   *
   *     garden   grows   2 mouths   one recovering   total draw
   *       L2       1.2        1.0            +3.0          4.0   store falls
   *       L6       3.6        1.0            +3.0          4.0   about even
   *       L8       4.8        1.0            +3.0          4.0   store climbs
   *
   * Which is the loop the game does not otherwise have: **production limits labour, and
   * labour builds production.** The garden has had one interesting level and seven
   * decorative ones; this gives it a track, and it quietly makes a shelter's storage cap
   * into a reserve of working hours.
   */
  staminaRecoveryFoodMultiplier: 6,

  /*
   * Recovery makes a survivor hungry, and yields to healing rather than blocking it.
   *
   * Resting hard is work of a kind and it should show on the same gauge eating does. But
   * `regenHungerCeiling` is a real gate — health regenerates only below 25 — so a recovery
   * that pushed hunger past it would stop an injured survivor healing, and the thing
   * keeping them hurt would be the thing meant to make them useful. The plan flagged that
   * as "either a tension worth having or an accident that makes injury unrecoverable, and
   * it has to be chosen rather than discovered".
   *
   * Chosen 2026-08-31: recovery tapers to nothing as hunger approaches the ceiling. The
   * tension is kept — a hungry camp recovers slowly — and the trap is not: healing always
   * wins the room, because a gauge that can lock a survivor out of healing is a bug with a
   * design document.
   */
  staminaRecoveryHungerTaper: 5,
};
