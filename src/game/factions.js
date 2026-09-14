import { makeRandom, intBetween } from './random.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Three crews who all trade and all raid.
 *
 * All of them doing both is load-bearing: if one faction were the traders and another the
 * raiders, everyone would befriend the shopkeeper and the choice would collapse.
 * Because each does both, siding with one buys better prices and calmer raids from
 * that crew at the cost of worse terms and nastier visits from the others. There is no
 * correct answer, only a preference — which is the standard a mechanic has to meet.
 *
 * **Three, since Phase 17, and the third is what makes standing a position rather than a
 * slider.** Two crews is one axis: every point with one is a point against the other, and a
 * camp has nowhere to stand that is not on the line between them. With three there is no
 * line — you can be well in with two and hated by one, which is a *stance*, and it is the
 * smallest number of crews at which that sentence can be said.
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
  /*
   * Phase 17's third crew, and they were already in the map before they were a faction.
   *
   * *"The wheel still turns. Somebody kept it turning for a long time."* — the Millrace.
   * *"Pumps the size of houses, and something still drawing power to them."* — the Waterworks.
   * *"Sixteen shafts, and the water in them has never seen the sky."* Three region
   * descriptions written years apart all imply the same people, and the doc's own rule is
   * that a third faction is developed out of existing places rather than introduced. These
   * are the people those sentences are about.
   *
   * **They maintain rather than scavenge**, which is the necessity neither other crew holds.
   * The Junction Crews take machines apart and sell the pieces; these keep machines running,
   * and what that buys them is the one thing on this map that is clean.
   *
   * ## Three offers, not four, and the third one is the character
   *
   * Padding a crew to four with somebody else's goods is what makes three factions read as
   * one faction painted three colours. A crew whose whole holding is water has water, what
   * makes water safe to drink, and nothing else — so that is what is in the wagon.
   *
   * Bulk water is theirs alone: nothing else in the game sells it, and the Provisioners'
   * bulk-food offer is the shape it is priced against. The chelation is the interesting one —
   * two for 45 scrap against Green River's one for 20 and five fuel — because it is the same
   * good at a different *kind* of price, no danger money, which is exactly the choice a third
   * crew exists to create.
   *
   * They visit like the others. The temptation was to make them territorial — the crew you go
   * to rather than the one that comes to you — and Phase 5 already refused that shape for a
   * good reason: *even the crew that hates you shows up, because trading with them is the
   * only way back.* A crew with no caravan is a crew whose standing can only be recovered by
   * chance. What is territorial about them belongs in 17c's effects, on the roads they hold.
   */
  wellkeepers: {
    name: 'The Wellkeepers',
    description:
      'Shaft, wheel and pump, kept turning longer than anybody has been counting. Their ' +
      'caravans smell of rust and cold water, and their raiders know how a purifier comes ' +
      'apart.',
    offers: [
      { resource: 'water', qty: 90, costs: { scrap: 20 } },
      { item: 'rad_scrubber', qty: 2, costs: { scrap: 45 } },
      { item: 'rad_x', qty: 1, costs: { scrap: 10, fuel: 2 } },
    ],
  },
};

const SLUGS = Object.keys(FACTIONS);

/**
 * Everyone else, which is what replaced `rivalOf` when there stopped being one of them.
 *
 * A `rival` field is a fact about a world with exactly two crews in it, and it was read in two
 * places — both of them asking "who takes this badly?" With three crews that question has two
 * answers and the field had one, so the field went rather than being made to lie.
 *
 * The order is the declaration order, which is stable because `FACTIONS` is a literal.
 */
export function othersOf(slug) {
  return SLUGS.filter((other) => other !== slug);
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

/**
 * An offer's costs at a given standing. Rounded up: the caravan does not do change.
 *
 * `politics` is Phase 17c's factor and arrives as a number rather than as a relation, which
 * keeps the dependency pointing one way: `relations.js` reads `FACTIONS` to know who the pairs
 * are, so this file must not read `relations.js` back. The caller composes the two, and both
 * the page and `trade.js` compose them identically because a quote the service will not honour
 * is the one bug a shop must not have.
 */
export function priceAt(offer, standing, politics = 1) {
  const factor = priceMultiplier(standing) * (Number(politics) || 1);
  const costs = {};
  for (const [kind, amount] of Object.entries(offer.costs ?? {})) {
    costs[kind] = Math.ceil(amount * factor);
  }
  return costs;
}

/**
 * How much one trade moves the needle: up with the seller, half as far down among everybody
 * else. Deliberately not zero-sum — a camp that trades all round drifts warmer with the world
 * overall, which reads right.
 *
 * **Half, split between them, rather than half each.** That is the one line of arithmetic the
 * third crew forced, and getting it wrong would have quietly deleted a stated property: at
 * half each, a camp trading evenly with all three ends exactly where it started, and the
 * warming drift — the thing that makes trading with everyone a strategy rather than a wash —
 * is gone. Split, the round trip pays +6 −1.5 −1.5 = +3 to each, which is what two crews paid.
 * At two factions the split is by one and this is the old rule unchanged.
 */
export const TRADE_STANDING_GAIN = 6;

export function standingsAfterTrade(standings, slug) {
  const next = { ...standings };
  next[slug] = clamp(standingOf(standings, slug) + TRADE_STANDING_GAIN, -100, 100);

  const others = othersOf(slug);
  const share = others.length > 0 ? TRADE_STANDING_GAIN / 2 / others.length : 0;
  for (const other of others) {
    next[other] = clamp(standingOf(standings, other) - share, -100, 100);
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
export function raidTempo(standing, politics = 1) {
  const s = clamp(standing, -100, 100);
  const own = s >= 0 ? 1 + s / 100 : 1 / (1 - s / 200);
  /* Phase 17c: and what else that crew has on. Multiplied rather than added, so a friendly
     crew at war with its neighbours is calmer still rather than capped by whichever of the
     two happens to be larger. See `tempoFactor`. */
  return own * (Number(politics) || 1);
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
