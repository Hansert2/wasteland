/**
 * What an hour of work costs a survivor, named before `CONFIG` so that sleep can be the
 * same figure rather than a copy of it. See `staminaPerHourWorked` below for where 3.8
 * comes from, and `staminaSleepPerHour` for why the two are one number.
 */
const WORK_PER_HOUR = 3.8;

/**
 * How fast hunger fills with nothing to eat, named before `CONFIG` because the price of
 * recovery is derived from it. See `staminaRecoveryHungerPerPoint`.
 */
const HUNGER_RISE_PER_HOUR = 4.2;

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
  hungerRisePerHour: HUNGER_RISE_PER_HOUR,
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
  staminaPerHourWorked: WORK_PER_HOUR,
  staminaRegenPerHour: 1,

  /*
   * Sleep, and it is the same number as work on purpose.
   *
   * Phase 10's fifth decision: sleep is an accelerator and never a requirement. Recovery
   * happens anyway at `staminaRegenPerHour`, so what somebody asleep is buying is not the
   * points — they were coming — but the hours. What it costs is that they cannot be asked
   * to do anything until they wake, and there is no waking them early.
   *
   * ### Where the rate comes from, which is not the sensitivity table
   *
   * The table measures *which survivor to send*, and sleep does not act on that question at
   * all: it acts on how long the answer is unavailable. So the rate is derived the way
   * `staminaPerHourWorked` was — from a rule rather than from a sweep:
   *
   * > **An hour asleep undoes an hour of work.**
   *
   * Which makes the longest walk on the map — Harrow End, 26 hours, a whole gauge — cost a
   * whole day under, and makes the arithmetic something a player can do in their head
   * instead of reading off a note. It moves with `staminaPerHourWorked` because it *is*
   * `staminaPerHourWorked`, so the coupling to the map recorded there covers both.
   *
   * Passive rest stays at 1/h and is now 3.8 times slower, which is what makes this a
   * decision rather than a formality: a camp that never sleeps anybody still recovers, just
   * across four days instead of one.
   *
   * The obvious alternative — a free-standing multiplier tuned to taste — was refused for
   * the reason the rest of this file exists: a second dial nothing derives is a second dial
   * nobody can check.
   */
  staminaSleepPerHour: WORK_PER_HOUR,

  /*
   * How long a survivor can be put under in one go.
   *
   * A nap, a night, and a long night. Three rather than a free number because the page is a
   * form and a free number is a validation problem in exchange for a granularity nobody
   * needs — and three because at 3.8 an hour they are worth 15, 30 and 46 points, which
   * covers a short errand, an ordinary trip and most of a long one.
   *
   * The longest is deliberately shorter than the longest walk: a 26-hour region cannot be
   * slept off in one commitment, so the deepest hole a player can dig themselves into still
   * takes two decisions to climb out of.
   */
  sleepHours: [4, 8, 12],

  /*
   * **Nothing draws on the stores but a mouth.** There is no recovery multiplier any more,
   * and what it was for is worth keeping.
   *
   * It was 6, and it was called load-bearing: food is not otherwise a constraint — every camp
   * measured sits at its storage cap throwing it away, and a garden outgrows a mouth at level
   * two — so recovery drawing six times a mouth was what made production limit labour, and
   * what quietly turned a shelter's storage cap into a reserve of working hours.
   *
   * It bought that with an arithmetic nobody could believe. A survivor recovering drew six
   * mouths an hour and a sleeper drew twenty-three, while the same page said they were asleep;
   * the stores fell by a hundred and thirty food across a night nobody ate anything during.
   *
   * **The user's rule, 2026-08-31: only hunger may draw on the stores.** Recovery is paid for
   * in hunger and hunger is paid for in rations, so the chain is
   *
   *     stores -> hunger -> stamina -> work
   *
   * and each arrow is the only way to cross it. Production still limits labour; it does so
   * one step further away, through a belly, which is the way it works everywhere else.
   *
   * **Read the note in `docs/PLAN.md` before tuning food again.** The chain is much cheaper
   * than the multiplier was — eating is efficient, half a unit of food buys twelve points of
   * hunger — so a full gauge that used to cost 300 food now costs about five. If food should
   * bite again, the lever is `foodPerHour` against `hungerFallPerHour`, which is what decides
   * what a point of hunger costs. It is not this.
   */

  /*
   * What a point of stamina costs in hunger, and it is one price for everybody.
   *
   * Derived rather than picked: an hour asleep recovers `staminaSleepPerHour` and costs
   * `hungerRisePerHour` — the rate a survivor with nothing to eat climbs at, which is what
   * somebody asleep is. Divide the one by the other and a point of stamina costs about 1.1
   * hunger, and that is now charged to everybody who recovers, awake or not.
   *
   * So sleeping is not a special case in the arithmetic any more; it is the same price paid
   * faster, by somebody who is not eating it back. Awake, recovery adds 1.1 an hour against
   * twelve an hour of eating, which is a cost the stores absorb rather than one the player
   * has to manage — and that is right: **resting is meant to be the thing that always works,
   * and sleeping the thing you choose.**
   *
   * A sleeper is charged this and *not* the ordinary unfed rise, because the two are the same
   * physical fact counted twice — their body is running on reserves either way — and charging
   * both puts a twelve-hour sleep into the starvation band.
   */
  staminaRecoveryHungerPerPoint: HUNGER_RISE_PER_HOUR / WORK_PER_HOUR,

  /*
   * **Nobody eats in their sleep**, and that is the other half of what sleep costs.
   *
   * There is no constant here any more, and the two that were tried are worth recording
   * because the third answer is better than both.
   *
   * The first was a *taper*, guarding against recovery pushing hunger past
   * `regenHungerCeiling`. It guarded a cost that did not exist: recovery scaled the ration
   * draw and nothing else, so ten hours idle, ten recovering and ten asleep all ended at the
   * same hunger. The second was `staminaRecoveryHungerPerPoint`, a hunger charge per point
   * paid back, derived to make a long sleep cost the healing ceiling.
   *
   * Both were answering "how do we make recovery cost the survivor something" with a new
   * dial. The user's answer on 2026-08-31 needed no dial: **a sleeping survivor cannot eat.**
   * So a sleeper draws nothing from the stores and is fed by nothing, which is already a
   * state this simulation models — `fedFraction` of zero — and hunger climbs at
   * `hungerRisePerHour` exactly as it does for anybody with nothing to eat.
   *
   * The arithmetic lands where the derived constant was aiming, out of numbers that were
   * already there:
   *
   *      4h asleep   +16.8 hunger   under the ceiling; a nap is free of the tension
   *      8h asleep   +33.6 hunger   healing has stopped
   *     12h asleep   +50.4 hunger   and starvation is still twenty away
   *
   * So sleeping is the same price as any other recovery, paid faster by somebody who is not
   * eating it back. Awake, the charge loses to eating twelvefold and the stores absorb it;
   * asleep, there is nothing to absorb it and it lands on the gauge.
   *
   * `test/unit/tick.test.js` guards the two bounds — a nap stays under the healing ceiling
   * and the longest sleep stays out of the starvation band — because they are now a
   * consequence of `sleepHours`, `hungerRisePerHour` and `regenHungerCeiling` rather than of
   * anything named.
   */
};
