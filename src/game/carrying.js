/**
 * What a person can carry.
 *
 * Pure arithmetic over a list of carried items. No database, no clock, and no opinion about
 * where the list came from — a pack and the camp box are the same shape, and only one of
 * them has a ceiling.
 *
 * ### The cap is derived, and here is the derivation
 *
 * The rule is about the map rather than about a sweep:
 *
 *   > A survivor can carry their kit, what they will need on the longest walk, and what that
 *   > walk is likely to find.
 *
 * Measured by `tools/carry-balance.mjs` on 2026-09-02, against the real region rows:
 *
 *     kit          a spear and a plate vest                 11,000 g
 *     supplies     two rations and a tablet for Harrow End      854 g
 *     finds        the 90th percentile of that walk's haul    3,000 g
 *     ------------------------------------------------------------
 *                                                           14,854 g
 *
 * Rounded to **15,000 g**, and the rounding is the only part of it that was chosen.
 *
 * The 90th percentile rather than the mean, deliberately: a cap set at the average makes the
 * better half of all trips drop something, and a cap nothing ever reaches is a column nobody
 * reads. Re-run the instrument after any change to item weights or region find tables — it
 * prints this sum, and it prints how many trips a pack lasts before it has to be emptied.
 *
 * ### Worn gear counts
 *
 * Decided by the user on 2026-09-02, once the measurement showed the kit is three quarters of
 * the cap. A survivor in a plate vest has about 4 kg of pack left, so one long trip roughly
 * fills it — armour costs haul, which is the trade that makes the number interesting. It also
 * agrees with the rest of the game: `equipmentOf` and `standFor` already read what is
 * *carried*, so gear is on your back rather than in a slot beside it.
 *
 * There is no "equipped" flag anywhere in the schema, and this is why one is not being added.
 */

/**
 * The flat cap, in grams, for everybody.
 *
 * One number rather than a per-survivor one: the user's call, and it keeps the roster a set
 * of people who differ in what they are good at rather than in how much they are worth
 * sending. See the derivation above before changing it.
 */
export const CARRY_CAP_GRAMS = 15000;

/**
 * What a list of carried things weighs.
 *
 * Takes anything with `weightGrams` and `qty` — a stack weighs `qty × weight`, which is the
 * one line of this that had to be said out loud. Missing weights count as nothing, so a
 * database that has migrated but not re-seeded behaves exactly as it did before this phase.
 */
export function weighPack(items = []) {
  return items.reduce((total, item) => total + (item.weightGrams ?? 0) * (item.qty ?? 0), 0);
}

/** What is left, in grams. Never negative: an over-full pack has no room, not anti-room. */
export function roomLeft(items = [], cap = CARRY_CAP_GRAMS) {
  return Math.max(0, cap - weighPack(items));
}

/**
 * How many of `slug` actually fit, out of `qty` wanted.
 *
 * The answer to "a full pack meets a find", and it is a number rather than a yes: half a
 * stack going in and half being left on the ground is the honest outcome, and it is what the
 * returning log has to be able to describe.
 *
 * A weightless item always fits — every item was weightless before this phase, and a camp
 * mid-deploy must not start refusing things.
 */
export function howManyFit(items, weightGrams, qty, cap = CARRY_CAP_GRAMS) {
  if (!weightGrams) return qty;
  return Math.max(0, Math.min(qty, Math.floor(roomLeft(items, cap) / weightGrams)));
}

/**
 * Grams displayed consistently as kilograms, to two decimals, without trailing zeroes.
 *
 * Two rather than three: a gram is not a quantity anybody weighs a pack in, and the third
 * decimal was printing the arithmetic rather than the answer — four tins read 1.668 kg,
 * which is a number nobody wants to that precision and which made a column of weights hard
 * to compare at a glance.
 *
 * Nothing in the game weighs less than 5 g, so nothing rounds away to zero. An item lighter
 * than that would need a floor here rather than a third decimal.
 */
export function saysWeight(grams) {
  const kg = Number((grams / 1000).toFixed(2));
  return `${kg} kg`;
}
