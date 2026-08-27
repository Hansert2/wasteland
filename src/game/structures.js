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
    storagePerLevel: 125,
    baseCost: 6,
    baseMinutes: 0.75,
    summary: 'Storage, shared across every resource. Anything over the cap is lost.',
  },
  garden: {
    produces: 'food',
    perLevel: 0.6,
    baseCost: 4,
    baseMinutes: 0.5,
    summary: 'Grows food. One level already outpaces what a survivor eats.',
  },
  water_purifier: {
    produces: 'water',
    perLevel: 1.25,
    baseCost: 5,
    baseMinutes: 0.6,
    summary: 'Cleans water, the other thing they cannot go without.',
  },
  workshop: {
    produces: 'scrap',
    perLevel: 0.5,
    baseCost: 5,
    baseMinutes: 0.6,
    summary: 'Salvages scrap, and its level is what unlocks recipes at the bench.',
  },
  watchtower: {
    defencePerLevel: 4,
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
 * Two more branches are designed and not built — no longer because their mechanics
 * are missing (raids and world events both shipped), but by choice: a reinforced
 * shelter would double up on the watchtower's raid-softening job, and a greenhouse
 * is waiting on a balance question, not a feature. See docs/PLAN.md.
 */
export const UPGRADES = {
  filtration: {
    kind: 'water_purifier',
    name: 'Filtration',
    fuel: 60,
    hours: 1,
    requiresLevel: 4,
    // Radiation is the real limiter on going back to the Deep Zone: a trip doses
    // ~25 rads nominal and they decay at 0.8/h, so a survivor spends the better part
    // of a day and a half waiting to leave again. This is the camp buying that back.
    radDecayMultiplier: 2.5,
    summary: 'Scrubs radiation out of whoever is standing in the camp, hour by hour.',
  },
  machine_shop: {
    kind: 'workshop',
    name: 'Machine Shop',
    fuel: 75,
    hours: 1.25,
    requiresLevel: 4,
    craftHoursMultiplier: 2 / 3,
    summary: 'Powered tools at the bench: every craft takes a third less time.',
  },
  clock: {
    kind: 'shelter',
    name: 'The Clock',
    // The cheapest thing on the fuel track by a wide margin, and low enough on the
    // shelter that a camp meets it in its first day. The sun is a decision the game
    // starts asking immediately, so the instrument that sharpens it cannot sit behind
    // sixty fuel and a level-four build — that would be a mechanic the early game has
    // and cannot see.
    fuel: 12,
    hours: 0.4,
    requiresLevel: 1,
    // Changes nothing in the simulation, like the radio. It sells the hour: the exact
    // time instead of the band, and sunrise and sunset instead of "hours yet before
    // dark". What the sun *does* is never hidden — only how precisely you can read it.
    summary: 'A clock on the wall, running again: you know the hour and when the light goes.',
  },
  glass: {
    kind: 'watchtower',
    name: 'The Glass',
    // The second thing the tower sells, and the reason `upgradesFor` returns a list.
    // Priced with the radio rather than with the clock: a forecast is worth more than a
    // reading, because it is the one that lets you send somebody out into weather that
    // has not arrived yet.
    fuel: 50,
    hours: 1,
    requiresLevel: 4,
    summary: 'Instruments on the tower: the temperature, and what the next few hours hold.',
  },
  radio: {
    kind: 'watchtower',
    name: 'Radio',
    fuel: 55,
    hours: 1,
    requiresLevel: 4,
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

/**
 * The upgrades a given structure can be fitted with, in declaration order.
 *
 * A list rather than the single branch this used to return. The singular was never a
 * decision — it was an accident of there having been three structures with an upgrade
 * each — and the watchtower is the first to want two: the radio sells the hour of the
 * next raid, and the glass sells the sky. Both are things the tower learns, and neither
 * is a level of the other.
 *
 * Order is `UPGRADES` key order, so the page renders them in the order they are written
 * rather than in whatever order an object happens to iterate. Empty for a structure with
 * no branch, which the shelter still is.
 */
export function upgradesFor(kind) {
  return Object.entries(UPGRADES)
    .filter(([, spec]) => spec.kind === kind)
    .map(([slug, spec]) => ({ slug, ...spec }));
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

/**
 * How fast the two curves climb.
 *
 * **Cost** is the square root of the old growth, because a level is now worth half
 * what it used to be: output per level was halved and the level count doubled, so
 * the growth per level has to be the square root for the curve to keep its shape.
 * Without that, doubling the levels under the old exponent would have put a garden
 * of twelve food an hour at two hundred and thirty thousand scrap instead of two and
 * a half thousand.
 *
 * **Time is deliberately steeper than that square root**, and this is the one number
 * here chosen from measurement rather than derived. Time and cost growing together
 * left the build crew idle: builds finished so far inside the time it took to earn
 * the next one that the queue of one stopped being a constraint at all, and with it
 * went "choosing what to build next is the game" — not because the queue got longer
 * but because it became instant. Scrap was the only thing anyone ever waited for.
 *
 * At 1.5 the crew is busy 8% of the time at level 6, 29% by 16, and 50% by level 20,
 * where a garden reaches twelve food an hour. Early play stays click-heavy, which is
 * what the onboarding needs; mid-play is a real coin-toss between waiting for scrap
 * and waiting for the crew; and the deep game is time-gated the way the original
 * curve was. Anything steeper (1.55, 1.6) put a single late level at thirty to
 * seventy days, which is the same failure wearing the other hat.
 */
const TIME_GROWTH = 1.5;
const COST_GROWTH = Math.sqrt(1.7);

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
    // Half a point a level, because a level is half what it was: halving output per
    // level doubled the level count, and counting them whole would have doubled every
    // camp's apparent wealth and with it how often raiders call.
    wealth += level / 2;
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
