/**
 * What is left of a pack by the time anybody gets to it.
 *
 * Phase 16, and one arithmetic with two callers — which is the whole reason it is a module
 * rather than two constants in two services.
 *
 * **A death inside the wire reads this at zero hours.** The user's call on 2026-09-14 was that
 * a camp should not watch a dead survivor's rations sit unreachable twenty feet from the shelf,
 * *and* that death should still cost something when it happens at home. Both are true if the
 * home case is simply the decay curve read at its first point: nothing special about it, no
 * second figure to justify, and the two cases cannot drift apart because they are one call.
 *
 * **A recovery trip reads it at however long they have lain out there.** That is what gives
 * going back its urgency, and it does it without a countdown on the page — the number is a fact
 * about a date rather than a timer ticking at somebody.
 *
 * ## What the curve is, and what it is not
 *
 * Half-life, not a straight line to zero. A straight line needs an end — a day on which the
 * pack becomes exactly nothing — and every such day is a number nothing derives. A half-life
 * has no end and needs one figure: **how long until half of it is gone.**
 *
 * `HALF_LIFE_HOURS` is 72. Derived rather than picked: the longest walk on the map is 26 hours,
 * so a camp that hears about a death and turns a trip straight round is inside the first half,
 * and one that finishes what it was doing first is not. That is the decision the number exists
 * to create — go now, or go when it suits you — and it is priced against the map rather than
 * against a feeling.
 *
 * `AT_ONCE` is what survives even with no time at all: 0.7. Not everything on somebody survives
 * what killed them, and a pack recovered from the room next door should not be a pack that
 * merely changed hands. It is also what a home death keeps, which is the one figure this phase
 * adds to the game's balance and the one to measure first.
 */

/** What survives when they are reached immediately. Nothing is ever wholly recoverable. */
export const AT_ONCE = 0.7;

/** Hours until half of what was left is gone. See the header for why this is 72. */
export const HALF_LIFE_HOURS = 72;

/**
 * The share of a pack that comes back, for somebody who has lain out `hours`.
 *
 * Clamped at both ends so a clock that has gone backwards — a fixture, a corrected `now` —
 * cannot return more than was ever there.
 */
export function shareLeft(hours) {
  const lain = Math.max(0, Number(hours) || 0);
  return Math.max(0, Math.min(AT_ONCE, AT_ONCE * 0.5 ** (lain / HALF_LIFE_HOURS)));
}

/**
 * How many of a stack survive, given that share.
 *
 * Rounded rather than floored, and that matters at the small end: a pack holding one of
 * something is the ordinary case, and flooring would make every single item in the game
 * unrecoverable no matter how quickly anybody got there. Rounding means one spear comes home
 * from a fresh death and does not from a fortnight-old one, which is the sentence this rule is
 * supposed to be able to say.
 */
export function survives(qty, share) {
  const had = Math.max(0, Math.floor(Number(qty) || 0));
  if (had === 0) return 0;
  return Math.min(had, Math.round(had * share));
}

/**
 * What a whole pack comes back as: the same rows, thinned.
 *
 * Rows that survive at nothing are dropped rather than returned at zero, so a caller writing
 * this into a box never has to think about an empty stack.
 */
export function whatIsLeft(pack, hours) {
  const share = shareLeft(hours);

  return (pack ?? [])
    .map((item) => ({ ...item, qty: survives(item.qty, share) }))
    .filter((item) => item.qty > 0);
}
