import { makeRandom, intBetween } from './random.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Two rival crews who both trade and raid.
 *
 * Both doing both is load-bearing: if one faction were the traders and the other the
 * raiders, everyone would befriend the shopkeeper and the choice would collapse.
 * Because both do both, siding with either buys better prices and calmer raids from
 * one crew at the cost of worse terms and nastier visits from the other. There is no
 * correct answer, only a preference — which is the standard a mechanic has to meet.
 *
 * Pure data plus pure functions, the STRUCTURES pattern: offers are content and get
 * balance-edited, so they live here rather than in a migration, and there is no
 * factions table for them to drift from.
 *
 * Two pricing constraints from the plan, enforced by tests rather than by memory:
 * - **No offer ever grants fuel.** Fuel is danger money — the one resource nothing
 *   in the camp produces — and a trader selling it would collapse the second
 *   currency into the first. Offers may *cost* fuel, which is the opposite and
 *   welcome: a fuel sink beyond the upgrade track.
 * - **Scrap prices are set against the fence, not the workshop.** An attentive
 *   player earns ~24 scrap/h at the Fence Line, so a scrap price divided by 24 is
 *   how many hours of fence-spam buys it. Everything gated by danger stays priced
 *   in fuel or parts.
 */
/**
 * Who keeps the post on a reconnected road.
 *
 * The road buys *reliability* — a caravan is missable by design and a post is not —
 * and the question of whose post it is gives standing a second job rather than
 * inventing a third party. It is whichever crew the camp stands better with, derived
 * rather than stored, so burning one does not close the post: the rival takes it over.
 * A road that could be talked out of trading with you would sell the one thing it has.
 *
 * Ties go to the first crew, which only happens at a fresh camp where both are zero.
 */
export function postKeeper(standings = {}) {
  return Object.keys(FACTIONS).reduce((best, slug) =>
    standingOf(standings, slug) > standingOf(standings, best) ? slug : best,
  );
}

export const FACTIONS = {
  junction_crews: {
    name: 'The Junction Crews',
    rival: 'green_river',
    description:
      'Salvage barons of the old interchange. Their caravans smell of diesel, and ' +
      'their raiders carry good boots.',
    // Gear and meds. The parts offer is deliberately priced in fuel alone: paying
    // danger-money for materials keeps crafting a recipe rather than a shop counter.
    offers: [
      { item: 'rad_x', qty: 2, costs: { scrap: 25 } },
      { item: 'scrap_spear', qty: 1, costs: { scrap: 35 } },
      { item: 'scavenged_parts', qty: 2, costs: { fuel: 15 } },
      { item: 'plate_vest', qty: 1, costs: { scrap: 50, fuel: 20 } },
    ],
  },
  green_river: {
    name: 'The Green River Provisioners',
    rival: 'junction_crews',
    description:
      'Farm collectives from up the valley. Their caravans smell of bread, and their ' +
      'raiders know exactly which storehouse is yours.',
    // Food and relief. The bulk-food offer converts scrap into stores directly,
    // which the garden already does for free — this is for the camp that just got
    // raided, not a production strategy.
    offers: [
      { item: 'tinned_stew', qty: 3, costs: { scrap: 30 } },
      { item: 'preserved_meal', qty: 2, costs: { scrap: 25 } },
      { resource: 'food', qty: 60, costs: { scrap: 18 } },
      { item: 'rad_scrubber', qty: 1, costs: { scrap: 20, fuel: 5 } },
    ],
  },
};

const SLUGS = Object.keys(FACTIONS);

export function rivalOf(slug) {
  return FACTIONS[slug]?.rival ?? null;
}

/** Standing with a faction, tolerant of a camp that has never met them. */
export function standingOf(standings, slug) {
  return Number(standings?.[slug] ?? 0);
}

/**
 * What standing does to a price: strangers pay a markup, friends get fair rates.
 * ×1.4 at -100 through ×1.0 at 0 to ×0.6 at +100 — enough to feel, never enough to
 * make the hostile crew pointless to trade with, because trading with them is the
 * only way back.
 */
export function priceMultiplier(standing) {
  return 1 - clamp(standing, -100, 100) / 250;
}

/** An offer's costs at a given standing. Rounded up: the caravan does not do change. */
export function priceAt(offer, standing) {
  const factor = priceMultiplier(standing);
  const costs = {};
  for (const [kind, amount] of Object.entries(offer.costs ?? {})) {
    costs[kind] = Math.ceil(amount * factor);
  }
  return costs;
}

/** How much one trade moves the needle: up with the seller, half as far down with
 * the rival. Deliberately not zero-sum — a camp that trades with both drifts warmer
 * with the world overall, which reads right. */
export const TRADE_STANDING_GAIN = 6;

export function standingsAfterTrade(standings, slug) {
  const next = { ...standings };
  next[slug] = clamp(standingOf(standings, slug) + TRADE_STANDING_GAIN, -100, 100);
  const rival = rivalOf(slug);
  if (rival) {
    next[rival] = clamp(standingOf(standings, rival) - TRADE_STANDING_GAIN / 2, -100, 100);
  }
  return next;
}

/**
 * The nth caravan visit this camp will ever get, derived from seed and count alone.
 *
 * Deliberately *not* tilted by standing, and this is a recorded departure from the
 * design's first draft. If a hostile faction stopped visiting, trading with them —
 * the only way to recover standing — would become impossible and the rivalry would
 * be a one-way ratchet with extra steps. So even the crew that hates you shows up:
 * they will take your money at forty percent over the odds, and that is the road
 * back. It also keeps the schedule derivable from two numbers, which is what lets a
 * month of missed visits replay identically however the interval is sliced.
 */
export function caravanVisit(seed, index) {
  const random = makeRandom(Number(seed) + index * 6971);

  return {
    faction: SLUGS[Math.floor(random() * SLUGS.length)],
    // How long they stay: most of a day, give or take. Long enough that a daily
    // check-in usually catches one; short enough that it can be missed.
    stayHours: intBetween(random, 8, 20),
    // The quiet stretch before this visit, measured from the previous departure.
    gapHours: intBetween(random, 30, 84),
  };
}

/** Which crew the nth raid belongs to. Same trick, the raid's own seed. */
export function raidFaction(seed, index) {
  const random = makeRandom(Number(seed) + index * 5039);
  return SLUGS[Math.floor(random() * SLUGS.length)];
}

/**
 * What standing does to a faction's raids, applied where raids already apply the
 * watchtower: to the schedule and to the outcome, never to the number of draws.
 */

/** Multiplier on the mean gap between that faction's visits-in-anger. Friendly
 * stretches it to double; hostile compresses it to about two thirds. */
export function raidTempo(standing) {
  const s = clamp(standing, -100, 100);
  if (s >= 0) return 1 + s / 100;
  return 1 / (1 - s / 200);
}

/** Adjustments folded into resolveRaid, alongside the watchtower's. */
export function raidTemper(standing) {
  const s = clamp(standing, -100, 100);
  return {
    // Friends knock and leave more often, and take less when they do not.
    repelBonus: Math.max(0, s) / 400,
    softening: Math.max(0, s) / 250,
    // Enemies take more. Capped well short of "everything".
    shareBoost: 1 + Math.max(0, -s) / 300,
  };
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
