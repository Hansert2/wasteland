import { CONFIG } from './constants.js';
import { resolveExpedition } from './expeditions.js';
import {
  FACTIONS,
  caravanVisit,
  raidFaction,
  raidTempo,
  raidTemper,
  standingOf,
} from './factions.js';
import { nextRaidAt, resolveRaid } from './raids.js';
import { activeAt, nextBoundaryAfter, productionFactors } from './world-events.js';
import { travelFactors } from './daylight.js';
import {
  campDefence,
  campWealth,
  productionRates,
  radDecayMultiplier,
  storageCap,
} from './structures.js';
import { radThresholdFor } from './wanderers.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * @typedef {{ amount: number, ratePerHour: number, cap: number }} Resource
 * @typedef {{ id: string, kind: 'ration' | 'antirad' | 'weapon' | 'armour' | 'material',
 *             potency: number, qty: number }} Item
 *
 * @typedef {object} State
 * @property {number} lastTickAt            epoch ms of the last resolved tick
 * @property {{ resources: Record<string, Resource> }} settlement
 * @property {object|null} survivor         null once nobody is holding the camp
 * @property {object|null} expedition       in-flight expedition, if any
 * @property {object|null} craft            in-flight workshop order, if any
 * @property {object|null} fitting          structure upgrade being fitted, if any
 *
 * The settlement also carries raid bookkeeping (raidSeed/raidCount/nextRaidAt),
 * caravan bookkeeping (caravanSeed/caravanCount/nextCaravanAt), and `standings` —
 * faction standing by slug, read-only here: only trades and successions move it,
 * and both happen outside the tick, which is what makes it slice-stable.
 */

/**
 * Advance the world from `state.lastTickAt` to `now`.
 *
 * Pure: no clock, no I/O, no mutation of the input. `now` is a parameter so tests can
 * fast-forward weeks without waiting, and so a route handler and a replay harness get
 * identical results from identical inputs.
 *
 * The interval is walked in slices rather than resolved with a single multiply, because
 * death has to land at a *timestamp*, not merely be detected. A 40-hour absence in which
 * the survivor died at hour 12 must resolve as 12h of survivor simulation, then death,
 * then 28h of settlement-only accrual — the camp outlives its people, so resources keep
 * coming in while the body cools.
 *
 * @param {State} state
 * @param {number} now epoch ms
 * @param {typeof CONFIG} [config]
 * @returns {{ state: State, events: object[] }} new state plus a log to show on login
 */
export function applyTick(state, now, config = CONFIG) {
  if (!Number.isFinite(now)) {
    throw new TypeError('applyTick: `now` must be an epoch-ms number');
  }

  const next = structuredClone(state);
  const events = [];

  // Clock skew or a replayed request: never run the simulation backwards.
  if (now <= next.lastTickAt) return { state: next, events };

  // A camp with no raid on the books gets one put on them now, from the wealth it has
  // at this instant. Deciding it here — once, before the walk — rather than inside a
  // slice is what keeps it off the moving-target list: a schedule that drifted with
  // the stores would make the outcome depend on how the interval was divided.
  if (next.settlement.nextRaidAt == null) {
    next.settlement.nextRaidAt = nextRaidAt(
      next.lastTickAt,
      visibleWealth(next.settlement),
      next.settlement.raidSeed ?? 0,
      next.settlement.raidCount ?? 0,
      raidTempo(standingWithRaiders(next.settlement, next.settlement.raidCount ?? 0)),
    );
  }

  // Likewise a camp with no caravan on the books. The first visit is scheduled from
  // this instant, so a brand-new camp meets a trader within a couple of days.
  if (next.settlement.nextCaravanAt == null) {
    const visit = caravanVisit(next.settlement.caravanSeed ?? 0, next.settlement.caravanCount ?? 0);
    next.settlement.nextCaravanAt = next.lastTickAt + visit.gapHours * HOUR_MS;
  }

  let cursor = next.lastTickAt;
  while (cursor < now) {
    // Slices are cut exactly at pending event timestamps (build completions,
    // expedition returns), so a rate change lands at its true hour and the result
    // cannot depend on how the interval happens to be divided.
    const at = Math.min(cursor + config.stepMs, now, nextEventAfter(next, cursor));
    advance(next, cursor, at, events, config);
    cursor = at;
  }

  next.lastTickAt = now;
  return { state: next, events };
}

/** The earliest scheduled event strictly after `cursor`, or Infinity. */
function nextEventAfter(state, cursor) {
  let next = Infinity;

  for (const structure of state.settlement.structures ?? []) {
    if (structure.buildCompletesAt != null && structure.buildCompletesAt > cursor) {
      next = Math.min(next, structure.buildCompletesAt);
    }
  }

  if (state.expedition?.status === 'active' && state.expedition.returnsAt > cursor) {
    next = Math.min(next, state.expedition.returnsAt);
  }

  if (state.craft?.status === 'active' && state.craft.completesAt > cursor) {
    next = Math.min(next, state.craft.completesAt);
  }

  if (state.fitting && state.fitting.installedAt == null && state.fitting.completesAt > cursor) {
    next = Math.min(next, state.fitting.completesAt);
  }

  if (state.settlement.nextRaidAt != null && state.settlement.nextRaidAt > cursor) {
    next = Math.min(next, state.settlement.nextRaidAt);
  }

  // A caravan has two timestamps, and both are boundaries: production during the
  // visit is no different, but the arrival and departure events must land at their
  // hours, and the departure is where the next visit gets booked.
  if (state.settlement.nextCaravanAt != null) {
    const arrival = state.settlement.nextCaravanAt;
    if (arrival > cursor) next = Math.min(next, arrival);
    const visit = caravanVisit(state.settlement.caravanSeed ?? 0, state.settlement.caravanCount ?? 0);
    const departure = arrival + visit.stayHours * HOUR_MS;
    if (departure > cursor) next = Math.min(next, departure);
  }

  // Weather changes are event timestamps like any other: a blight that begins at
  // hour 10 of a 20-hour absence must halve the garden from hour 10, not from login.
  next = Math.min(next, nextBoundaryAfter(state.worldEvents, cursor));

  return next;
}

/** One simulation slice, applied in a fixed order. */
function advance(state, from, at, events, config) {
  const hours = (at - from) / HOUR_MS;

  // What the sky is doing across this slice, sampled at its start. Slices are cut at
  // weather boundaries, so the answer holds for the whole slice rather than being an
  // approximation of it — and an event beginning exactly at `at` belongs to the next
  // slice, not this one.
  const weather = activeAt(state.worldEvents, from);

  accrueResources(state, hours, productionFactors(weather));

  // Builds finish before anything else looks at the camp: production for the slice
  // just accrued used the old rates, and everything after this instant uses the new.
  completeBuilds(state, at, events);

  // Raiders arrive before the hour is simulated, so a camp stripped of food starves
  // from that hour rather than from the next one.
  raid(state, at, events);

  // Coming home happens before the hour's hunger is applied, so a survivor who
  // returns carrying food is fed by it rather than starving on the doorstep.
  if (isDueBack(state, at)) {
    returnExpedition(state, at, events);
  }

  if (state.survivor?.alive) {
    simulateSurvivor(state, hours, at, events, config);
  }

  // Last, because delivery is the one part of crafting that needs hands, and whether
  // there are any is only settled once the slice's hunger and radiation have landed.
  completeCraft(state, at, events);

  completeFitting(state, at, events);

  caravan(state, from, at, events);
}

/**
 * Announce caravan arrivals and departures whose hour falls inside this slice, and
 * book the next visit when one leaves.
 *
 * Nothing else happens here — a caravan changes no numbers by existing. Trading is a
 * player action taken while the window is open, handled by a service; the tick's
 * whole job is to know when the window opened and closed, which is why both
 * timestamps are slice boundaries.
 */
function caravan(state, from, at, events) {
  const settlement = state.settlement;
  if (settlement.nextCaravanAt == null) return;

  const visit = caravanVisit(settlement.caravanSeed ?? 0, settlement.caravanCount ?? 0);
  const arrival = settlement.nextCaravanAt;
  const departure = arrival + visit.stayHours * HOUR_MS;

  // Half-open on both checks, matching the slice walk: a boundary belongs to the
  // slice that ends on it.
  if (from < arrival && arrival <= at) {
    events.push({
      at: arrival,
      type: 'caravan_arrived',
      faction: visit.faction,
      name: FACTIONS[visit.faction]?.name ?? visit.faction,
      until: departure,
    });
  }

  if (from < departure && departure <= at) {
    events.push({
      at: departure,
      type: 'caravan_departed',
      faction: visit.faction,
      name: FACTIONS[visit.faction]?.name ?? visit.faction,
    });

    settlement.caravanCount = (settlement.caravanCount ?? 0) + 1;
    const nextVisit = caravanVisit(settlement.caravanSeed ?? 0, settlement.caravanCount);
    settlement.nextCaravanAt = departure + nextVisit.gapHours * HOUR_MS;
  }
}

/** Standing with whichever crew the nth raid belongs to. */
function standingWithRaiders(settlement, index) {
  return standingOf(settlement.standings, raidFaction(settlement.raidSeed ?? 0, index));
}

/**
 * Finish fitting a structure upgrade.
 *
 * Fitting is building work, so it follows the build rule: starting needed living
 * hands, finishing does not, and an upgrade half-fitted when the survivor died is
 * completed by nobody in particular the way a scaffolded watchtower is.
 *
 * Placed after the survivor has been simulated so the slice *ending* at the
 * completion hour is still simulated at the old rate, and everything after it at the
 * new one. That is the same treatment production gets from `completeBuilds`, which
 * runs after `accrueResources` for exactly the same reason.
 */
function completeFitting(state, at, events) {
  const fitting = state.fitting;
  if (!fitting || fitting.installedAt != null || fitting.completesAt > at) return;

  fitting.installedAt = at;
  state.settlement.upgrades = [...(state.settlement.upgrades ?? []), fitting.upgrade];

  events.push({
    at,
    type: 'upgrade_fitted',
    kind: fitting.kind,
    upgrade: fitting.upgrade,
    name: fitting.name,
  });
}

/**
 * Deliver a finished workshop order — or fail to.
 *
 * Starting an order needs a living survivor and finishing it does not, the same rule
 * builds follow: the bench keeps working while the camp stands empty. Delivery is
 * where the two part company. A finished spear has to come off the bench into
 * somebody's pack, and a camp with nobody left in it has no pack to put it in, so the
 * order is forfeit exactly as an expedition's haul is when its survivor dies.
 */
function completeCraft(state, at, events) {
  const craft = state.craft;
  if (!craft || craft.status !== 'active' || craft.completesAt > at) return;

  craft.resolvedAt = at;

  if (!state.survivor?.alive) {
    craft.status = 'lost';
    events.push({ at, type: 'craft_lost', craftId: craft.id, name: craft.name });
    return;
  }

  craft.status = 'delivered';

  // The goods are granted by the caller, for the same reason expedition finds are:
  // the tick deals in slugs and has no idea what an item id is.
  events.push({
    at,
    type: 'craft_delivered',
    craftId: craft.id,
    name: craft.name,
    slug: craft.output.slug,
    qty: craft.output.qty,
  });
}

/**
 * Finish any builds whose hour has come. Runs whether or not anyone is alive — a
 * scaffolded structure gets finished the way a garden keeps growing; only *starting*
 * work needs hands.
 */
function completeBuilds(state, at, events) {
  const structures = state.settlement.structures;
  if (!structures) return;

  let changed = false;
  for (const structure of structures) {
    if (structure.buildCompletesAt != null && structure.buildCompletesAt <= at) {
      structure.level += 1;
      structure.buildCompletesAt = null;
      changed = true;
      events.push({ at, type: 'build_completed', kind: structure.kind, level: structure.level });
    }
  }
  if (!changed) return;

  // Rates and caps are derived values; a finished build changes them from this
  // instant on. The cap only grows here, so nothing needs clamping.
  const rates = productionRates(structures);
  const cap = storageCap(structures);
  for (const [kind, resource] of Object.entries(state.settlement.resources)) {
    resource.ratePerHour = rates[kind] ?? 0;
    resource.cap = cap;
  }
}

/**
 * Raiders, if their hour has come. Possibly several, if you have been away a while:
 * each one schedules the next before the walk moves on, so a month offline resolves
 * the whole sequence in order rather than collapsing it into one visit.
 *
 * The survivor is held at 1 health rather than killed. That is the settled rule, and
 * it is the difference between harsh and unfair — a raid can leave someone a wreck in
 * an empty camp, and the tick may finish them off an hour later, but that death is
 * then something the player could have prevented.
 */
function raid(state, at, events) {
  const settlement = state.settlement;
  if (settlement.nextRaidAt == null || settlement.nextRaidAt > at) return;

  const wealth = campWealth(settlement.structures, settlement.resources);
  const defence = campDefence(settlement.structures);

  // Raiders answer to somebody, and standing with that somebody matters — at the
  // fence, alongside the watchtower. Standing is constant across a tick (only trades
  // and successions move it, and both happen outside), so this is slice-stable.
  const faction = raidFaction(settlement.raidSeed ?? 0, settlement.raidCount ?? 0);
  const standing = standingOf(settlement.standings, faction);

  const outcome = resolveRaid({
    wealth,
    defence,
    resources: settlement.resources,
    survivor: state.survivor,
    seed: Number(settlement.raidSeed ?? 0) + (settlement.raidCount ?? 0),
    crew: FACTIONS[faction]?.name,
    temper: raidTemper(standing),
  });

  for (const [kind, amount] of Object.entries(outcome.taken)) {
    const resource = settlement.resources[kind];
    if (resource) resource.amount = clamp(resource.amount - amount, 0, resource.cap);
  }

  if (outcome.damage > 0 && state.survivor?.alive) {
    state.survivor.health = Math.max(1, state.survivor.health - outcome.damage);
  }

  settlement.raidCount = (settlement.raidCount ?? 0) + 1;
  settlement.nextRaidAt = nextRaidAt(
    at,
    visibleWealth(settlement),
    settlement.raidSeed ?? 0,
    settlement.raidCount,
    // The *next* raid's crew sets the pace: a camp in good odour with one side still
    // hears from the other on the other side's schedule.
    raidTempo(standingWithRaiders(settlement, settlement.raidCount)),
  );

  events.push({
    at,
    type: outcome.repelled ? 'raid_repelled' : 'raid',
    faction,
    taken: outcome.taken,
    damage: outcome.damage,
    log: outcome.log,
  });
}

/**
 * The wealth a raid schedule is allowed to depend on: structures, never stores.
 *
 * Stores accrue continuously, so their exact value at a given instant differs in the
 * last few decimal places depending on how the interval was sliced. Scheduling from
 * that made the next raid's hour drift by fractions of a second between a one-minute
 * walk and a seven-hour one, and the drift compounded across a month. Structure levels
 * are integers that change only at build completions, which are themselves slice
 * boundaries — so this is stable by construction.
 *
 * It reads better too: what raiders notice from outside is the buildings. What they
 * carry off depends on the stores, and `resolveRaid` still sees those in full.
 */
function visibleWealth(settlement) {
  return campWealth(settlement.structures);
}

function isDueBack(state, at) {
  return (
    state.survivor?.alive &&
    state.expedition?.status === 'active' &&
    at >= state.expedition.returnsAt
  );
}

/**
 * Resolve a returning expedition. The outcome is rolled from the seed stored at
 * dispatch, so this is deterministic: replaying the same interval replays the same
 * trip rather than re-rolling it.
 */
function returnExpedition(state, at, events) {
  const expedition = state.expedition;
  const survivor = state.survivor;

  // What the world did across the whole trip, not what it was doing at the hour they got
  // back: the sky and the sun both integrated between departure and return. See
  // `travelFactors`, which is one function precisely so that this and `reportOn` cannot
  // compose the same two things differently.
  //
  // `departedAt` rather than `at` less the region's travel hours: the same instant, and
  // the stored one cannot drift from the row the trip was dispatched with.
  const outcome = resolveExpedition({
    region: expedition.region,
    survivor,
    seed: expedition.seed,
    weather: travelFactors(
      state.worldEvents,
      expedition.departedAt,
      at,
      state.settlement.clockOffset ?? 0,
      state.settlement.solarNoon ?? 12,
    ),
    // Whatever the player answered while they were out. An empty list is the trip
    // exactly as it would have resolved before any of this existed.
    choices: expedition.choices,
    // Only a parley reads these, and only for the crew whose fire it was.
    standings: state.settlement.standings,
  });

  expedition.resolvedAt = at;
  expedition.log = outcome.log;

  // Dying out there means nothing comes home — not the survivor, and not the haul.
  if (outcome.died) {
    expedition.status = 'lost';
    events.push({ at, type: 'expedition_lost', expeditionId: expedition.id, log: outcome.log });
    kill(state, at, outcome.cause, events);
    return;
  }

  expedition.status = 'returned';

  for (const [kind, amount] of Object.entries(outcome.loot)) {
    const resource = state.settlement.resources[kind];
    if (!resource) continue;
    // Anything over the storage cap is simply lost; a bigger shelter is the fix.
    resource.amount = clamp(resource.amount + amount, 0, resource.cap);
  }

  survivor.radiation = clamp(survivor.radiation + outcome.radiation, 0, 100);
  // Healing before damage: a ration eaten at hour six was eaten before whatever
  // happened at hour eleven, and settling them the other way round would let the same
  // trip kill a survivor who ate in time.
  survivor.health = clamp(survivor.health + (outcome.healed ?? 0), 0, 100);
  survivor.health = clamp(survivor.health - outcome.damage, 0, 100);

  // Items are granted by the caller: the tick has no idea what an item id is, and
  // resolving a slug is a database concern.
  for (const find of outcome.finds) {
    events.push({ at, type: 'item_found', slug: find.slug, qty: find.qty });
  }

  events.push({
    at,
    type: 'expedition_returned',
    expeditionId: expedition.id,
    log: outcome.log,
  });

  if (survivor.health <= 0) {
    kill(state, at, outcome.cause ?? 'injuries', events);
  }
}

/**
 * Settlement production. Runs whether or not anyone is alive to see it — structures
 * keep working, which is the mechanical expression of "the settlement outlives its
 * people". Rates are per-hour here; the DB column's unit is converted at load.
 */
function accrueResources(state, hours, factors = {}) {
  for (const [kind, resource] of Object.entries(state.settlement.resources)) {
    // Weather scales the rate, never the stored rate itself: a blight halves what the
    // garden yields this week without the camp forgetting how big its garden is.
    const rate = resource.ratePerHour * (factors[kind] ?? 1);
    resource.amount = clamp(resource.amount + rate * hours, 0, resource.cap);
  }
}

function simulateSurvivor(state, hours, at, events, config) {
  const survivor = state.survivor;

  // Draw rations from storage. Partial supply gives partial relief, so a camp running
  // a small deficit degrades gradually instead of falling off a cliff.
  const fedFraction = Math.min(
    draw(state.settlement.resources.food, config.foodPerHour * hours),
    draw(state.settlement.resources.water, config.waterPerHour * hours),
  );

  survivor.hunger = clamp(
    survivor.hunger +
      (1 - fedFraction) * config.hungerRisePerHour * hours -
      fedFraction * config.hungerFallPerHour * hours,
    0,
    100,
  );
  // Filtration multiplies this, but only for somebody actually standing in the camp.
  // The filter is bolted to the water purifier; it does not follow anyone into the
  // Deep Zone.
  //
  // This is load-bearing rather than flavour. An 18-hour trip doses 25 rads, and
  // filtration left running while away scrubs 36 of them — so a survivor came home
  // cleaner than they left, radiation stopped being a constraint at all, and going
  // out recklessly became safer than waiting. Keeping it to the camp means the
  // upgrade shortens the wait without deleting it.
  const inCamp = state.expedition?.status !== 'active';
  const radDecay =
    config.radDecayPerHour * (inCamp ? radDecayMultiplier(state.settlement.upgrades) : 1);
  survivor.radiation = clamp(survivor.radiation - radDecay * hours, 0, 100);

  let delta = healthDelta(survivor, hours, config);

  // The safety valve: the survivor is not an idiot. Before lethal damage lands, they
  // reach for whatever is on hand. Only once the shelf is bare does the wasteland win.
  if (survivor.health + delta <= 0) {
    if (rescue(survivor, at, events, config)) {
      delta = healthDelta(survivor, hours, config);
    }
  }

  survivor.health = clamp(survivor.health + delta, 0, 100);

  if (survivor.health <= 0) {
    kill(state, at, causeOf(survivor, config), events);
  }
}

/** Health change for one slice. Damage ramps across each band rather than snapping on. */
/**
 * The dose this survivor is *effectively* carrying, after what they know about medicine.
 *
 * Medicine used to lift a threshold: `radThresholdFor` gave a better medic five more
 * points of tolerance per level, and below that line a dose cost nothing. With the line
 * gone the same idea has to act on the same axis, so it shifts the dose down instead — a
 * survivor with a good medic carries thirty rads as though they were twenty-five. The
 * translation is exact: five points a level, in the direction that helps.
 *
 * It acts here, on the dose, rather than on damage taken, and that is deliberate and
 * measured. Softening hits is the obvious first idea and `tools/skill-sensitivity.mjs`
 * found it to be scenery — health at 60 changes the right answer on 0 of 34,800
 * occasions, because a healthy survivor already cannot die on a trip. Radiation moves it
 * on 44%.
 *
 * Read at every site that asks, so a survivor cannot be judged mending by one clause and
 * irradiated by another. Ordinary medicine returns the dose unchanged, which is what
 * makes this free for a camp that has not met a wanderer yet.
 */
function effectiveRads(survivor, config) {
  const relief = radThresholdFor(config.radThreshold, survivor?.skillMedicine) - config.radThreshold;
  return Math.max(0, (Number(survivor?.radiation) || 0) - relief);
}

/**
 * What a dose costs in health, per hour, on a curve rather than past a cliff.
 *
 * Every dose costs something and the cost accelerates, which is the whole change: under
 * the threshold a further 25 rads was free at eight starting levels out of eleven, so the
 * decision radiation offered existed only in a narrow band near sixty and was a foregone
 * conclusion everywhere else.
 *
 * Exported because the page has to say the same thing the tick does. That is not a
 * courtesy — `strainOf` read a flat threshold while the tick read a medicine-adjusted one
 * for months, and told a camp with a good medic it was burning while the simulation had it
 * merely stalled.
 */
export function radDamagePerHourAt(survivor, config = CONFIG) {
  const rads = effectiveRads(survivor, config);
  return config.radDamagePerHour * (rads / 100) ** config.radDamageExponent;
}

function healthDelta(survivor, hours, config) {
  let delta = 0;

  if (survivor.hunger >= config.starvationThreshold) {
    const severity = band(survivor.hunger, config.starvationThreshold);
    delta -= config.starvationDamagePerHour * severity * hours;
  }

  delta -= radDamagePerHourAt(survivor, config) * hours;

  /*
   * Healing fades with the dose rather than switching off past a line.
   *
   * Both halves of radiation now act on one axis and continuously: it damages on a curve,
   * and it smothers recovery in proportion. Health per hour is simply the difference, and
   * the point where that crosses zero lands at about sixty-five rads — within five of the
   * threshold the game was already tuned around, which is the whole reason this is safe to
   * do. The balance point is kept; the cliff is not.
   *
   * What it removes is a dead zone. Between twenty and sixty rads a survivor used to
   * neither heal nor suffer, so forty points of the scale were the same point and a player
   * had no way to tell whether thirty was better than fifty. It was not.
   *
   * Hunger keeps its gate, because starvation is a different kind of thing: you are fed or
   * you are not, and there is no partial credit for a half-empty stomach.
   */
  if (survivor.hunger < config.regenHungerCeiling) {
    const smothered = 1 - clamp(effectiveRads(survivor, config), 0, 100) / 100;
    delta += config.regenPerHour * smothered * hours;
  }

  return delta;
}

/**
 * Consume an emergency item to remove the cause of imminent death.
 * @returns {boolean} whether anything was consumed
 */
function rescue(survivor, at, events, config) {
  /*
   * Which of the two is killing them, now that radiation has no line to be over.
   *
   * Both are rates once the cliff is gone, so the question is simply which is taking more
   * health this hour — hunger only bites past its own threshold, and the dose always bites
   * a little. That reads correctly at both ends: a survivor starving with ten rads reaches
   * for food, and one at eighty rads with a full belly reaches for the Rad-X.
   *
   * The old test asked whether the dose was past a threshold, which under a curve would be
   * asking whether it was past a number that no longer means anything.
   */
  const starving =
    survivor.hunger >= config.starvationThreshold
      ? config.starvationDamagePerHour * band(survivor.hunger, config.starvationThreshold)
      : 0;
  const irradiated = radDamagePerHourAt(survivor, config);

  const needed = starving <= 0 && irradiated <= 0 ? null : starving >= irradiated ? 'ration' : 'antirad';
  if (!needed) return false;

  const item = survivor.inventory?.find((i) => i.kind === needed && i.qty > 0);
  if (!item) return false;

  item.qty -= 1;
  if (needed === 'ration') {
    survivor.hunger = clamp(survivor.hunger - item.potency, 0, 100);
  } else {
    survivor.radiation = clamp(survivor.radiation - item.potency, 0, 100);
  }

  events.push({ at, type: 'auto_consumed', item: item.id, kind: item.kind });
  return true;
}

function kill(state, at, cause, events) {
  const survivor = state.survivor;
  survivor.alive = false;
  survivor.health = 0;
  survivor.diedAt = at;
  survivor.causeOfDeath = cause;

  // An expedition in flight has nobody to come home. Loot and story beats are forfeit;
  // the settlement never learns what happened out there.
  if (state.expedition && state.expedition.status === 'active') {
    state.expedition.status = 'lost';
    // A resolved expedition must record when — the schema refuses the row otherwise.
    state.expedition.resolvedAt = at;
    events.push({ at, type: 'expedition_lost', expeditionId: state.expedition.id });
  }

  // A craft in flight is deliberately *not* cancelled here. The workshop is a bench
  // in the camp, not something the survivor carried away with them, so it keeps
  // working; the order is only forfeit if nobody is alive on the hour it finishes.
  events.push({
    at,
    type: 'survivor_died',
    cause,
    // character_history.days_survived wants the real elapsed time, not time-since-login.
    daysSurvived: (at - survivor.bornAt) / (24 * HOUR_MS),
  });
}

/**
 * What to write on the stone.
 *
 * With no threshold to be over, "was it the radiation" becomes "was the radiation doing
 * enough to matter". A survivor who starved carrying a trace of a dose died of hunger, and
 * saying otherwise would make `radiation` the cause of almost every death — the curve is
 * never quite zero.
 *
 * The bar is one health an hour: real damage rather than a rounding error, and about what
 * seventy rads costs. Below that the dose was weather, not the killer.
 */
function causeOf(survivor, config) {
  const irradiated = radDamagePerHourAt(survivor, config) >= 1;
  const starving = survivor.hunger >= config.starvationThreshold;

  if (irradiated && !starving) return 'radiation';
  if (irradiated) return 'starvation_and_radiation';
  return 'starvation';
}

/** Take up to `wanted` from a resource pool; returns the fraction actually supplied. */
function draw(resource, wanted) {
  if (wanted <= 0) return 1;
  if (!resource) return 0;
  const taken = Math.min(resource.amount, wanted);
  resource.amount -= taken;
  return taken / wanted;
}

/** Position within a damage band, 0 at the threshold rising to 1 at 100. */
function band(value, threshold) {
  return (value - threshold) / (100 - threshold);
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
