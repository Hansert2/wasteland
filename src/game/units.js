/**
 * What the stores are actually counting.
 *
 * Phase 18, and the user's ask from 2026-09-02: a camp holding "340 food" is not holding a
 * quantity of anything. The finding that made it cheap is that **the rates were already
 * realistic and only the label was missing** — `foodPerHour` is 0.5 and `waterPerHour` is
 * 0.75, which is 12 and 18 a day. Name a unit and that is 1,500 g and 3.6 L per survivor per
 * day: a working adult in heat, and the right ratio between the two. Nothing about the
 * simulation was unrealistic; it had simply never said what it was counting.
 *
 * ## This converts at the edge; it does not re-denominate
 *
 * The plan's first shape was to multiply every stored number, every seeded loot range, every
 * recipe cost and every cap by the conversion, with a migration to scale live saves. Two
 * things turned up when that was enumerated, and the user's call on 2026-09-14 was to convert
 * at the display edge instead:
 *
 * - **Water goes fractional everywhere.** A loot range of `[2, 8]` becomes `[0.4, 1.6]` litres
 *   and `rollLoot` draws integers, so the draw would have needed a per-resource quantum to
 *   stay exact — a machine whose only effect is that a column holds 750 instead of 6.
 * - **The storage cap is one shared number.** `shelter.storagePerLevel` caps all four stores
 *   at once, so grams would have forced a per-resource cap: a real design change carried in
 *   by a re-labelling.
 *
 * Against that, the migration would have rescaled a live save — the one part of the phase that
 * can go wrong badly. Converting at the edge buys the whole visible win for none of it.
 *
 * **The cost is recorded rather than hidden: two vocabularies.** A recipe reads `food: 20` in
 * source and "2.5 kg" on the page, and somebody tuning content is thinking in points while
 * somebody reading the game is thinking in kilograms. That is the drift this module's
 * existence is meant to make obvious — the conversion is *here*, once, and every figure a
 * player reads goes through it.
 *
 * ## Only the stores. Never carry weight.
 *
 * **Confirmed by the user on 2026-09-02, and it is the trap this sets for the next reader:
 * only items have weight. Food, water, scrap and fuel do not.** Phase 13 weighs carried items
 * and leaves the haul alone, because weighing the haul would cap fuel per day — the axis every
 * balance figure in `docs/PLAN.md` is measured against. Writing food in grams makes that look
 * like an oversight rather than a decision. It is not, and the shape of the game depends on it
 * staying that way.
 *
 * The two meet in exactly one place and it is legitimate: a ration item weighs what the same
 * relief would weigh eaten out of the larder, which is where Tinned Stew's 417 g comes from.
 * That borrows the conversion; it does not give the resource a mass.
 */

/** One point of food, in grams. See the header for where this comes from. */
export const GRAMS_PER_FOOD = 125;

/** One point of water, in litres. */
export const LITRES_PER_WATER = 0.2;

/**
 * How each store is written, in one table so that nothing has to remember a rule.
 *
 * `perHour` is a different unit from `stock` for food, and that is derived rather than a
 * matter of taste: at two decimals in kilograms a survivor eating 62.5 g/h reads "0.06 kg/h",
 * and a *net* rate of thirty grams an hour — 0.7 kg a day, which is half a person — rounds to
 * "0.00 kg/h". A figure that says nothing is happening while the larder empties is the one
 * thing this table must not print. Grams per hour cannot round away.
 *
 * The rule it looks like it is breaking — one unit, never switched — is about a *column read
 * down*, which is where the pack table settled it. A stock and a rate are two quantities in
 * two places, and neither is ever read against the other.
 *
 * `dp` is one for every stock, which is the decimals the stores rail has always shown. Not a
 * detail: the figure ticks up between page loads, and a width that changes as it does makes
 * the whole rail shuffle. `saysWeight` trims for the pack table because those are static rows;
 * this does not, because these are not.
 */
export const UNITS = {
  food: { stock: { per: GRAMS_PER_FOOD / 1000, unit: 'kg', dp: 1 },
          rate: { per: GRAMS_PER_FOOD, unit: 'g', dp: 0 } },
  water: { stock: { per: LITRES_PER_WATER, unit: 'L', dp: 1 },
           rate: { per: LITRES_PER_WATER, unit: 'L', dp: 2 } },
  scrap: { stock: { per: 1, unit: '', dp: 1 }, rate: { per: 1, unit: '', dp: 1 } },
  fuel: { stock: { per: 1, unit: '', dp: 1 }, rate: { per: 1, unit: '', dp: 1 } },
};

/** The conversion for one store in one role, falling back to the identity. */
function scaleOf(kind, role) {
  return UNITS[kind]?.[role] ?? { per: 1, unit: '', dp: 1 };
}

/** Points converted to the unit the page writes that store in. */
export function inUnits(points, kind, role = 'stock') {
  return (Number(points) || 0) * scaleOf(kind, role).per;
}

/**
 * A quantity with its unit, trailing zeroes trimmed.
 *
 * Trimmed because a store is read at a glance and "42.50 kg" spends two characters saying
 * nothing — the same reason `saysWeight` trims. Scrap and fuel have no unit and come back as
 * a bare number, so this is safe to call on any store without asking which it is.
 */
export function says(points, kind, role = 'stock') {
  const scale = scaleOf(kind, role);
  const value = Number(((Number(points) || 0) * scale.per).toFixed(scale.dp));
  return scale.unit ? `${value} ${scale.unit}` : String(value);
}

/**
 * A rate, signed, in the store's own rate unit: `+225 g/h`, `-0.15 L/h`.
 *
 * Zero comes back as null rather than as "0 g/h", so the caller can print the dash the stores
 * table already prints — a mark reports something acting on a number, never a non-effect.
 */
export function saysRate(points, kind) {
  const value = Number(points) || 0;
  if (value === 0) return null;
  const scale = scaleOf(kind, 'rate');
  const shown = Number((value * scale.per).toFixed(scale.dp));
  if (shown === 0) return null;
  return `${shown > 0 ? '+' : ''}${shown}${scale.unit ? ` ${scale.unit}` : ''}/h`;
}

/**
 * A range, for the loot a place pays: `0.75–2.25 kg`.
 *
 * One unit at the end rather than on both ends, the same reading `saysLoad` settled: two
 * figures and one unit are a single quantity, and saying the unit twice describes two.
 */
export function saysRange(low, high, kind) {
  const scale = scaleOf(kind, 'stock');
  const a = Number(((Number(low) || 0) * scale.per).toFixed(scale.dp));
  const b = Number(((Number(high) || 0) * scale.per).toFixed(scale.dp));
  return scale.unit ? `${a}–${b} ${scale.unit}` : `${a}–${b}`;
}
