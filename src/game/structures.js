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
  shelter: {
    storagePerLevel: 250,
    baseCost: 6,
    baseMinutes: 0.75,
    summary: 'Storage, shared across every resource. Anything over the cap is lost.',
  },
  garden: {
    produces: 'food',
    perLevel: 1.2,
    baseCost: 4,
    baseMinutes: 0.5,
    summary: 'Grows food. One level already outpaces what a survivor eats.',
  },
  water_purifier: {
    produces: 'water',
    perLevel: 2.5,
    baseCost: 5,
    baseMinutes: 0.6,
    summary: 'Cleans water, the other thing they cannot go without.',
  },
  workshop: {
    produces: 'scrap',
    perLevel: 1,
    baseCost: 5,
    baseMinutes: 0.6,
    summary: 'Salvages scrap, and its level is what unlocks recipes at the bench.',
  },
  watchtower: {
    defencePerLevel: 8,
    baseCost: 8,
    baseMinutes: 1,
    // The only structure that does nothing for you while things are going well. Its
    // levels feed campDefence, which decides how often raiders turn back at the fence
    // and how much the rest leave with.
    summary: 'Turns raiders away, and blunts the ones it cannot. Costs you nothing to look at.',
  },
};

/** The storage a camp has before any shelter is built. */
const BASE_STORAGE = 100;

/**
 * The fuel track.
 *
 * Scrap makes a structure bigger; fuel makes it do something new. The split is not
 * arbitrary — fuel is the one resource nothing in the camp produces, so it can only
 * be earned by sending someone somewhere unpleasant. Scrap is patience, fuel is
 * danger money, and the two therefore buy different kinds of thing.
 *
 * An upgrade has no levels. The camp either has the capability or it does not, which
 * keeps this a genuine fork — fit filtration *or* upgrade the garden — instead of a
 * second grind running alongside the first.
 *
 * Three more branches are designed but deliberately unbuilt, because they modify
 * mechanics that do not exist yet: a reinforced shelter and a watchtower radio want
 * raids, and a greenhouse wants world events. See docs/PLAN.md.
 */
export const UPGRADES = {
  filtration: {
    kind: 'water_purifier',
    name: 'Filtration',
    fuel: 60,
    hours: 1,
    requiresLevel: 2,
    // Radiation is the real limiter on going back to the Deep Zone: a trip is worth
    // ~30 rads and they decay at 0.8/h, so a survivor spends nearly two days waiting
    // to be able to leave again. This is the camp buying that time back.
    radDecayMultiplier: 2.5,
    summary: 'Scrubs radiation out of whoever is standing in the camp, hour by hour.',
  },
  machine_shop: {
    kind: 'workshop',
    name: 'Machine Shop',
    fuel: 75,
    hours: 1.25,
    requiresLevel: 2,
    craftHoursMultiplier: 2 / 3,
    summary: 'Powered tools at the bench: every craft takes a third less time.',
  },
  radio: {
    kind: 'watchtower',
    name: 'Radio',
    fuel: 55,
    hours: 1,
    requiresLevel: 2,
    // The only upgrade that changes nothing in the simulation. It buys the hour the
    // next raid falls due, and nothing else — see `viewCamp`.
    //
    // That makes the watchtower's two jobs genuinely different purchases rather than
    // two readings of one number: its scrap levels turn raiders away while you are
    // gone, and this tells you when they are coming while you are here. Stores are
    // all a raid can take, so a warned player spends them — on a build, on the bench
    // — and turns a hoard into something nobody can carry off.
    summary: 'Chatter on the wire: you learn when the next raid is due.',
  },
};

/** The upgrade a given structure can be fitted with, if any. */
export function upgradeFor(kind) {
  const found = Object.entries(UPGRADES).find(([, spec]) => spec.kind === kind);
  return found ? { slug: found[0], ...found[1] } : null;
}

/**
 * How much faster radiation leaves a survivor standing in this camp.
 * @param {string[]} [installed] slugs of fitted upgrades
 */
export function radDecayMultiplier(installed) {
  return multiplierOf(installed, 'radDecayMultiplier');
}

/** How much of a recipe's stated hours the bench actually takes. */
export function craftHoursMultiplier(installed) {
  return multiplierOf(installed, 'craftHoursMultiplier');
}

function multiplierOf(installed, field) {
  let total = 1;
  for (const slug of installed ?? []) {
    total *= UPGRADES[slug]?.[field] ?? 1;
  }
  return total;
}

/** How fast the two curves climb. Time doubles a level; cost is a little gentler. */
const TIME_GROWTH = 2;
const COST_GROWTH = 1.7;

/**
 * Cost and duration to build the *next* level.
 *
 * Exponential growth is what gives an Ogame-style game its long tail, and this curve
 * runs the whole span: half a minute and four scrap for a first garden, a quarter of
 * an hour by level five, hours by level nine, days past twelve.
 *
 * It used to start at four *hours* for that first garden, which meant a new player's
 * opening move was to wait half a working day to watch one number become another.
 * The exponent does the same job from a base low enough that the first hour of the
 * game contains a game.
 *
 * The reason the base could be dropped this far is that time was never the binding
 * constraint early — scrap was, and still is. Nothing in a new camp produces scrap,
 * so the short regions added alongside this are what actually make the fast levels
 * reachable. A cheap build you cannot afford is not an improvement.
 *
 * Both formulas live here so a balance pass edits one file.
 */
export function upgradeCost(kind, currentLevel) {
  const spec = STRUCTURES[kind];
  if (!spec) return null;
  return {
    scrap: Math.round(spec.baseCost * COST_GROWTH ** currentLevel),
    // Rounded to the second rather than the tenth of an hour, or every early level
    // would round to the same "0.0h" and the curve would be invisible.
    hours: Math.round((spec.baseMinutes / 60) * TIME_GROWTH ** currentLevel * 3600) / 3600,
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
  return BASE_STORAGE + (shelter ? STRUCTURES.shelter.storagePerLevel * shelter.level : 0);
}

/**
 * What a structure contributes at a given level, in words.
 *
 * Lives here rather than in the renderer because it is derived from the very numbers
 * above: a balance pass that changes `perLevel` changes what the page says in the
 * same edit, instead of leaving a description somewhere else to quietly go stale.
 *
 * @returns {string} empty when the structure contributes nothing at that level
 */
export function structureEffect(kind, level) {
  const spec = STRUCTURES[kind];
  if (!spec || level < 0) return '';

  if (spec.produces) {
    if (level === 0) return '';
    return `+${round(spec.perLevel * level)} ${spec.produces}/h`;
  }

  if (spec.storagePerLevel) {
    return `${round(BASE_STORAGE + spec.storagePerLevel * level)} storage`;
  }

  if (spec.defencePerLevel) {
    if (level === 0) return '';
    return `${round(spec.defencePerLevel * level)} defence`;
  }

  return '';
}

/** Rates are floats; 1.2 × 3 should read as 3.6, not 3.5999999999999996. */
function round(value) {
  return Math.round(value * 10) / 10;
}

/** How much of a camp's stores counts as one point of visible wealth. */
const STORES_PER_WEALTH = 100;

/**
 * What draws raiders, and what blunts them — two numbers, deliberately.
 *
 * These replace a single `campStrength` that added levels and defence together, which
 * could not work the moment anything read it. Defence was weighted eight per level,
 * so one watchtower took a starting camp from 3 to 12 while a camp with sixteen
 * levels of infrastructure and no defence scored 16. Any raid frequency driven by
 * that number would have made the one building meant to protect you the one that most
 * invited attack — a cheap watchtower drawing four times the attention of the stores
 * it was built to guard.
 *
 * So: wealth is what a raider wants, defence is what stops them having it. Nothing
 * should ever add them together again.
 *
 * Both stay derived rather than stored, for the reason production is: a column would
 * drift the moment a structure changed or a store was spent, and drift silently.
 */
export function campWealth(structures, resources) {
  let wealth = 0;

  for (const { kind, level } of structures ?? []) {
    const spec = STRUCTURES[kind] ?? {};
    // A watchtower is not loot. Counting it here is what created the trap.
    if (spec.defencePerLevel) continue;
    wealth += level;
  }

  // Stores are the part a raider can see the point of, and the part they can carry
  // away — which means a raided camp is a less interesting camp next time.
  for (const resource of Object.values(resources ?? {})) {
    wealth += (Number(resource?.amount) || 0) / STORES_PER_WEALTH;
  }

  return round(wealth);
}

/** What the camp can put between raiders and the stores. Watchtower only. */
export function campDefence(structures) {
  return (structures ?? []).reduce(
    (total, { kind, level }) => total + (STRUCTURES[kind]?.defencePerLevel ?? 0) * level,
    0,
  );
}
