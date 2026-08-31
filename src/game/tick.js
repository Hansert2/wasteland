import { CONFIG } from './constants.js';
import { resolveExpedition } from './expeditions.js';
import { stateAt, timelineOf } from './timeline.js';
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

  // Resolved before the walk and not inside it: every slice asks the same trip the same
  // question, and asking it once is what guarantees they all get the same answer.
  /*
   * One resolved trip per trip in flight, worked out before the walk and carried.
   *
   * Resolving inside the loop would ask the same question on every slice and invite two
   * answers; resolving one trip when a camp can run several would settle the first and
   * accrue nothing for the rest.
   */
  const inFlight = next.expeditions ?? (next.expedition ? [next.expedition] : []);
  const flights = new Map();
  for (const trip of inFlight) {
    const flight = flightOf(next, trip);
    if (flight) flights.set(trip, flight);
  }

  let cursor = next.lastTickAt;
  while (cursor < now) {
    // Slices are cut exactly at pending event timestamps (build completions,
    // expedition returns), so a rate change lands at its true hour and the result
    // cannot depend on how the interval happens to be divided.
    const at = Math.min(cursor + config.stepMs, now, nextEventAfter(next, cursor));
    advance(next, cursor, at, events, config, flights);
    cursor = at;
  }

  next.lastTickAt = now;
  return { state: next, events };
}

/**
 * The trip in flight, resolved once for the whole walk.
 *
 * A trip's damage, dose and healing are settled across its hours now rather than at the
 * gate, which means every slice needs to know what the whole trip is worth. Resolved once
 * and carried, because `resolveExpedition` is not cheap and because resolving it per slice
 * would invite the two answers to differ.
 *
 * The totals are deterministic — the seed, the region, the survivor's skills and a sky that
 * is a pure function of the world seed — so this is the same outcome the gate would have
 * computed, worked out earlier. `travelFactors` integrates the *whole* trip, which is why
 * `advanceSettlement` now derives the weather forward to `returns_at`: without those hours
 * the integral would run short and a trip would be worth less the earlier it was asked
 * about.
 *
 * Null when nobody is out.
 */
function flightOf(state, expedition) {
  if (!expedition || expedition.status !== 'active' || !state.survivor) return null;

  /*
   * Both ends and a region, or there is nothing to settle across.
   *
   * `integrateFactors` refuses a missing `departedAt` rather than quietly treating it as
   * zero, which is right and which this has to answer for: the walk asks about the trip on
   * every slice now, where the gate only asked on the one slice a trip came home. A row
   * that cannot be resolved is simply not accrued — it is not a real row, because
   * `loadWorld` supplies all three.
   */
  if (
    !Number.isFinite(expedition.departedAt) ||
    !Number.isFinite(expedition.returnsAt) ||
    typeof expedition.region !== 'object'
  ) {
    return null;
  }

  const outcome = resolveExpedition({
    region: expedition.region,
    survivor: state.survivor,
    seed: expedition.seed,
    weather: travelFactors(
      state.worldEvents,
      expedition.departedAt,
      expedition.returnsAt,
      expedition.clockOffset ?? state.settlement.clockOffset ?? 0,
      expedition.solarNoon ?? state.settlement.solarNoon ?? 12,
    ),
    choices: expedition.choices,
    standings: state.settlement.standings,
  });

  /*
   * The timeline spans the trip the survivor is actually walking, measured off the two
   * timestamps the accrual is measured against, rather than off the region's advertised
   * length.
   *
   * They agree in production — `returns_at` is `now + travel_hours` at dispatch — and when
   * they do not, elapsed hours and the timeline's total are two different clocks. A region
   * with no `travelHours` at all spans zero hours, and a zero-length timeline reports the
   * entire trip as already over at elapsed zero: the first reading equals the last, every
   * delta is nothing, and a trip settles for exactly none of what it rolled.
   */
  const travelHours = (expedition.returnsAt - expedition.departedAt) / HOUR_MS;

  return {
    outcome,
    timeline: timelineOf({ outcome, travelHours, seed: expedition.seed }),
  };
}

/**
 * What the trip did to them between two instants.
 *
 * The whole of the change: a hazard at hour eleven lands at hour eleven, the dose creeps up
 * across the walk, and a ration eaten at hour six is in them before either. `stateAt` is
 * monotone and exact at the end, so the deltas over a whole trip sum to precisely the
 * outcome that was rolled — this decides *when*, never *how much*.
 *
 * Healing before damage inside the slice, which is the rule the gate used to get for free by
 * applying both at once.
 */
function accrueTrip(state, expedition, from, at, events, config, flight) {
  if (!flight) return;
  if (!expedition || expedition.status !== 'active') return;

  /*
   * The person actually walking, not the first name in the camp.
   *
   * This read `state.survivor`, which was the same person while a camp held one. With a
   * roster it charged a trip's hazard and dose to whoever happened to be listed first — so
   * somebody standing in the camp took the damage from a trip they were not on, and if it
   * killed them the walker's haul was forfeit as well.
   *
   * `characterId` is null on a state built by hand, and a fixture with one survivor and one
   * trip means the trip is theirs.
   */
  const roster = state.survivors ?? (state.survivor ? [state.survivor] : []);
  const survivor =
    expedition.characterId == null
      ? state.survivor
      : roster.find((one) => one.id === expedition.characterId);

  if (!survivor?.alive) return;
  const was = stateAt(flight.timeline, (from - expedition.departedAt) / HOUR_MS);
  const is = stateAt(flight.timeline, (at - expedition.departedAt) / HOUR_MS);

  const healed = is.healed - was.healed;
  if (healed > 0) survivor.health = clamp(survivor.health + healed, 0, 100);

  const dose = is.radiation - was.radiation;
  if (dose > 0) survivor.radiation = clamp(survivor.radiation + dose, 0, 100);

  const damage = is.damage - was.damage;
  if (damage <= 0) return;

  survivor.health = clamp(survivor.health - damage, 0, 100);

  /*
   * And if that was the end of them, they die of what happened out there rather than of
   * whatever the camp's food happened to be that hour — which is why the cause travels with
   * the hazard on the timeline.
   *
   * `kill` marks the expedition lost and forfeits the haul, exactly as it has since a
   * survivor could starve mid-trip. The log goes with the event so the camp learns what
   * happened up to the hour it stopped.
   */
  if (survivor.health <= 0) {
    events.push({
      at,
      type: 'expedition_lost',
      expeditionId: expedition.id,
      log: flight.outcome.log,
    });
    kill(state, survivor, at, is.cause ?? flight.outcome.cause ?? 'the road', events);
  }
}

/** The earliest scheduled event strictly after `cursor`, or Infinity. */
function nextEventAfter(state, cursor) {
  let next = Infinity;

  for (const structure of state.settlement.structures ?? []) {
    if (structure.buildCompletesAt != null && structure.buildCompletesAt > cursor) {
      next = Math.min(next, structure.buildCompletesAt);
    }
  }

  /*
   * Every trip's return, not the first one's.
   *
   * A slice is cut at each so the last instalment of a trip's dose and damage lands on its
   * exact hour rather than at whatever boundary happened to be next. With one trip this read
   * `state.expedition`; with two, the second one's arrival would have been rounded to the
   * step and its final accrual delivered late.
   */
  for (const trip of state.expeditions ?? (state.expedition ? [state.expedition] : [])) {
    if (trip?.status === 'active' && trip.returnsAt > cursor) {
      next = Math.min(next, trip.returnsAt);
    }
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
function advance(state, from, at, events, config, flights) {
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

  /*
   * Every trip in flight, in the order they left.
   *
   * What the road did to them in this slice comes before they can walk in the gate with it,
   * and the slice ending exactly at `returns_at` is what makes the last instalment land in
   * full. Coming home comes before the hour's hunger, so a survivor who returns carrying
   * food is fed by it rather than starving on the doorstep.
   *
   * A copy of the list, because `returnExpedition` and `kill` both write to it.
   */
  for (const trip of [...(state.expeditions ?? (state.expedition ? [state.expedition] : []))]) {
    const flight = flights?.get(trip);
    accrueTrip(state, trip, from, at, events, config, flight);
    if (isDueBack(state, trip, at)) {
      returnExpedition(state, trip, at, events, flight);
    }
  }

  /*
   * Everybody in the camp, not the first of them.
   *
   * `simulateSurvivor` read `state.survivor` and is handed the person now, because with a
   * roster the question is who this hour happened to. The order is arrival order, which
   * matters for one thing only and matters a great deal for it: the stores are drawn down as
   * the walk goes, so on a camp that cannot feed everybody the earlier arrivals eat and the
   * later ones go short, rather than everybody starving equally.
   *
   * That is a decision rather than an accident of iteration, and it is the kinder of the
   * two: a camp one ration short loses nobody, where an even split starves the whole roster
   * at once.
   */
  for (const person of state.survivors ?? (state.survivor ? [state.survivor] : [])) {
    if (person.alive) simulateSurvivor(state, person, hours, at, events, config);
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

function isDueBack(state, expedition, at) {
  if (expedition?.status !== 'active' || at < expedition.returnsAt) return false;

  // Somebody has to be alive to come home, and it has to be *them*: a camp where one
  // survivor is still standing must not walk a dead one through the gate.
  const walker = walkerOf(state, expedition);
  return Boolean(walker?.alive);
}

/**
 * Whoever is on this trip.
 *
 * `characterId` is null on a state built by hand, and a fixture with one survivor and one
 * trip means the trip is theirs — which is most of what the tick is tested against.
 */
/**
 * What this survivor is spending the hour on, or null if the hour is theirs.
 *
 * Phase 10 charges stamina for work and pays it back for rest, so the tick has to know
 * which of the two an hour was. It is the same question `who-is-free.js` answers for the
 * services, off the same three columns — but that one runs a query and this one may not:
 * `applyTick` is a pure function of the state it is handed. So `loadWorld` carries the
 * owners in, and this reads them.
 *
 * A job with no owner occupies nobody and therefore costs nobody, which is the reading
 * migration 019 wrote down: those rows were started when there was one pair of hands and
 * nobody needed naming, and inventing a worker for them would be inventing a fact.
 *
 * Every one of these is a slice boundary in `nextEventAfter` — a build's completion, a
 * trip's return, a craft's, a fitting's — so within one slice a survivor is working for
 * the whole of it or none of it, and charging the whole slice is exact rather than nearly.
 */
function workingAt(state, survivor) {
  if (tripOf(state, survivor) !== null) return 'away';

  for (const structure of state.settlement.structures ?? []) {
    if (structure.buildCompletesAt != null && structure.builtBy === survivor.id) return 'building';
  }
  if (state.fitting?.installedAt == null && state.fitting?.fittedBy === survivor.id) {
    return 'fitting';
  }
  if (state.craft?.status === 'active' && state.craft?.craftedBy === survivor.id) {
    return 'crafting';
  }
  return null;
}

/**
 * The trip this survivor is on, or null if they are standing in the camp.
 *
 * The inverse of `walkerOf`, and it exists because the thing it replaces was wrong. That
 * read `state.expedition?.status !== 'active'` — one trip, asked about every survivor — and
 * with a roster it answers about the wrong person in both directions:
 *
 * - **Somebody else is out**, so a survivor sitting in the camp is told they are on the
 *   road and their dose stops decaying. Measured before the fix: two survivors at 50 rads,
 *   one away, six hours — the one at home came out of it still at 50 instead of 44.2.
 * - **The first trip has resolved**, so a survivor who is genuinely out there is told they
 *   are home and scrubs on the road. That is the exact hole the road-does-not-scrub change
 *   closed on 2026-08-30, reopened by a different door: going out would once again be safer
 *   than waiting.
 *
 * Neither could happen while a camp held one person, which is why it survived the roster
 * work. Whose trip it is has to be asked per survivor, because it is a fact about them.
 */
function tripOf(state, survivor) {
  const trips = state.expeditions ?? (state.expedition ? [state.expedition] : []);
  return (
    trips.find(
      (trip) =>
        trip.status === 'active' &&
        (trip.characterId == null || trip.characterId === survivor.id),
    ) ?? null
  );
}

function walkerOf(state, expedition) {
  const roster = state.survivors ?? (state.survivor ? [state.survivor] : []);
  if (expedition?.characterId == null) return state.survivor ?? roster[0] ?? null;
  return roster.find((one) => one.id === expedition.characterId) ?? null;
}

/**
 * Resolve a returning expedition. The outcome is rolled from the seed stored at
 * dispatch, so this is deterministic: replaying the same interval replays the same
 * trip rather than re-rolling it.
 */
function returnExpedition(state, expedition, at, events, flight) {
  // Whoever walked it, which is who the haul and the wounds belong to.
  const survivor = walkerOf(state, expedition);
  if (!survivor) return;

  /*
   * The outcome was resolved before the walk began — see `flightOf` — and settled across the
   * hours by `accrueTrip`. The gate no longer rolls anything; it hands over the haul and
   * writes the log.
   *
   * Resolving here as well would be two answers to one question, and the sky is integrated
   * over the whole trip either way, so they would agree only for as long as nobody edited
   * one of them.
   */
  const settled = flight ?? flightOf(state, expedition);
  const outcome = settled ? settled.outcome : null;
  if (!outcome) return;

  expedition.resolvedAt = at;
  expedition.log = outcome.log;

  /*
   * No death check here any more. A trip that kills its survivor kills them at the hour it
   * happens, in `accrueTrip`, and `kill` marks the expedition lost — so anybody still alive
   * on the doorstep walked the whole way and is home.
   *
   * `outcome.died` still exists and is still what the log's last line was written from; it
   * is now a statement about the roll rather than a decision about the survivor. The two can
   * differ, and where they do the walk is right: it settled the damage against the health
   * they actually had at that hour, rather than against the health they would have finished
   * the trip with.
   */
  expedition.status = 'returned';

  for (const [kind, amount] of Object.entries(outcome.loot)) {
    const resource = state.settlement.resources[kind];
    if (!resource) continue;
    // Anything over the storage cap is simply lost; a bigger shelter is the fix.
    resource.amount = clamp(resource.amount + amount, 0, resource.cap);
  }

  /*
   * The dose, the damage and whatever they ate are already in them: each landed in the slice
   * it belonged to, and the last instalment landed in the slice that ends here, because the
   * walk cuts a slice exactly at `returns_at`.
   *
   * Healing before damage still holds, and now holds for a better reason — a ration eaten at
   * hour six was applied at hour six, four hours before the thing at hour ten, rather than
   * being sorted into the right order at the gate.
   */

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
    kill(state, survivor, at, outcome.cause ?? 'injuries', events);
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

function simulateSurvivor(state, survivor, hours, at, events, config) {

  /*
   * What this hour was, which decides whether stamina is spent or paid back.
   *
   * Read before the rations, because a survivor recovering eats several times what a
   * survivor idling eats and the draw has to know that before it takes it.
   */
  const working = workingAt(state, survivor);
  const stamina = Number.isFinite(survivor.stamina) ? survivor.stamina : 100;
  const recovering = working === null && stamina < 100;

  /*
   * Draw rations from storage. Partial supply gives partial relief, so a camp running
   * a small deficit degrades gradually instead of falling off a cliff.
   *
   * **Recovery drinks, and this is the load-bearing part of Phase 10.** Food is not a
   * constraint in this game — every camp measured sits at its storage cap throwing food
   * away hourly, and a garden outgrows a mouth at level two — so a recovery priced at any
   * ordinary rate costs nothing and stamina would be scenery for a third time. At six times
   * a mouth the store notices, and a shelter's cap quietly becomes a reserve of working
   * hours: production limits labour, and labour builds production.
   *
   * It scales the *demand* rather than subtracting separately, so the partial-supply
   * arithmetic that was already here does the rest of the work. A camp that cannot meet the
   * larger draw feeds the survivor a smaller fraction of it, and the fraction is what both
   * hunger and the recovery below are then scaled by — a hungry camp recovers slowly, and a
   * camp with nothing recovers not at all. That last is what keeps the 36-to-72-hour
   * starvation window intact: on empty stores the fraction is zero either way, so a
   * recovering survivor starves at exactly the rate they always did.
   */
  const appetite = recovering ? config.staminaRecoveryFoodMultiplier : 1;
  const fedFraction = Math.min(
    draw(state.settlement.resources.food, config.foodPerHour * appetite * hours),
    draw(state.settlement.resources.water, config.waterPerHour * hours),
  );

  survivor.hunger = clamp(
    survivor.hunger +
      (1 - fedFraction) * config.hungerRisePerHour * hours -
      fedFraction * config.hungerFallPerHour * hours,
    0,
    100,
  );
  /*
   * A dose decays in the camp and not on the road.
   *
   * Filtration was already camp-only, and load-bearing for it: an 18-hour trip doses 25
   * rads and filtration left running while away scrubs 36 of them, so a survivor came home
   * cleaner than they left and going out recklessly became safer than waiting.
   *
   * The *base* rate had the same fault at a smaller size, and it was invisible because the
   * dispatch table never showed what actually arrived. Measured 2026-08-30: at 0.8/h a
   * twelve-hour walk scrubbed 9.6 rads against Coastal Wreckage's listed 4, so four regions
   * advertised a dose and delivered a mean of nothing — Millrace 1 → 0.0, Bunkers 2 → 0.0,
   * Coastal 4 → 0.1, Sixteen Wells 6 → 0.8. The listed number was not a number.
   *
   * So the road does not scrub. What a region says it doses is what it doses, and the
   * region figures were divided down to keep the net exactly where it was — see the note in
   * `seed.js`. A survivor recovers where there is water and shelter to recover in.
   */
  const inCamp = tripOf(state, survivor) === null;
  const radDecay =
    config.radDecayPerHour * (inCamp ? radDecayMultiplier(state.settlement.upgrades) : 0);
  survivor.radiation = clamp(survivor.radiation - radDecay * hours, 0, 100);

  /*
   * Stamina: spent by working, paid back by resting, and it never blocks healing.
   *
   * Spent at a flat rate by every kind of work — travelling, building, fitting, the bench —
   * because the question it asks is "what did this person spend the day on", which is the
   * one question the game has never asked. Deliberately *not* spent by danger, which is
   * radiation's job, nor by the passage of time, which is nobody's. Two gauges doing one
   * job means the player only ever meets the tighter of them.
   *
   * Paid back passively rather than only through scheduled sleep. A player away for three
   * days would otherwise come back to a survivor who had been exhausted for sixty hours and
   * done nothing, which is the punish-a-weekend-away failure the starvation window exists
   * to prevent. Sleep is an accelerator, and it is a later commit.
   *
   * The taper is the decision of 2026-08-31. `regenHungerCeiling` is a real gate — health
   * regenerates only below it — so a recovery that pushed hunger past it would stop an
   * injured survivor healing, and the thing keeping them hurt would be the thing meant to
   * make them useful. Recovery yields instead: full rate until five points short of the
   * ceiling, nothing at it. The tension is kept, the trap is not.
   */
  const roomToEat = clamp(
    (config.regenHungerCeiling - survivor.hunger) / config.staminaRecoveryHungerTaper,
    0,
    1,
  );
  survivor.stamina = clamp(
    stamina +
      (working === null
        ? config.staminaRegenPerHour * hours * roomToEat * fedFraction
        : -config.staminaPerHourWorked * hours),
    0,
    100,
  );

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
    kill(state, survivor, at, causeOf(survivor, config), events);
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

function kill(state, survivor, at, cause, events) {
  survivor.alive = false;
  survivor.health = 0;
  survivor.diedAt = at;
  survivor.causeOfDeath = cause;

  // An expedition in flight has nobody to come home. Loot and story beats are forfeit;
  // the settlement never learns what happened out there.
  /*
   * Their trip, and only theirs.
   *
   * This read "the expedition" because a camp had one survivor and so at most one trip. With
   * a roster it has to be the dead person's own, or one survivor dying at home would forfeit
   * the haul of another who is halfway to Harrow End.
   *
   * `characterId` is null on a state built by hand, and a fixture with one survivor and one
   * trip means the trip is theirs — so an unowned expedition still belongs to whoever died.
   */
  const inFlight = state.expeditions ?? (state.expedition ? [state.expedition] : []);
  const theirs = inFlight.find(
    (trip) =>
      trip.status === 'active' &&
      (trip.characterId == null || trip.characterId === survivor.id),
  );

  if (theirs) {
    theirs.status = 'lost';
    // A resolved expedition must record when — the schema refuses the row otherwise.
    theirs.resolvedAt = at;
    events.push({ at, type: 'expedition_lost', expeditionId: theirs.id });
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
