/**
 * What the survivor is carrying, reduced to the two numbers an expedition cares about.
 *
 * There is no equip step and no equipment-slot table. The survivor carries the best
 * weapon and the best armour they own and uses them, which is the same assumption the
 * tick already makes when it reaches for a ration before dying. An equip screen would
 * add a decision whose right answer is always "wear the better one".
 *
 * Pure, and tolerant of a survivor with no `inventory` at all: an unarmed survivor
 * gets multipliers of exactly 1, so every outcome that existed before gear did is
 * unchanged, roll for roll.
 */

/** Beyond this, more armour stops helping. Nothing makes the Deep Zone safe. */
const MAX_DAMAGE_REDUCTION = 0.6;

/** Likewise for avoiding trouble in the first place. */
const MAX_HAZARD_AVOIDANCE = 0.5;

export function bestOfKind(inventory, kind) {
  let best = null;
  for (const item of inventory ?? []) {
    if (item.kind !== kind || item.qty <= 0) continue;
    if (best === null || Number(item.potency) > Number(best.potency)) best = item;
  }
  return best;
}

/**
 * @param {{inventory?: {kind: string, potency: number, qty: number}[]}} survivor
 * @returns {{weapon: object|null, armour: object|null, hazardMultiplier: number, damageMultiplier: number}}
 */
export function equipmentOf(survivor) {
  const weapon = bestOfKind(survivor?.inventory, 'weapon');
  const armour = bestOfKind(survivor?.inventory, 'armour');

  return {
    weapon,
    armour,
    // Potency reads as a percentage here. A spear at 25 means one trip in four that
    // would have gone wrong instead does not.
    hazardMultiplier: 1 - capped(weapon, MAX_HAZARD_AVOIDANCE),
    damageMultiplier: 1 - capped(armour, MAX_DAMAGE_REDUCTION),
  };
}

function capped(item, ceiling) {
  if (!item) return 0;
  return Math.min(ceiling, Math.max(0, Number(item.potency) / 100));
}
