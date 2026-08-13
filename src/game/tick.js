import { CONFIG } from './constants.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * @typedef {{ amount: number, ratePerHour: number, cap: number }} Resource
 * @typedef {{ id: string, kind: 'ration' | 'antirad', potency: number, qty: number }} Item
 *
 * @typedef {object} State
 * @property {number} lastTickAt            epoch ms of the last resolved tick
 * @property {{ resources: Record<string, Resource> }} settlement
 * @property {object|null} survivor         null once nobody is holding the camp
 * @property {object|null} expedition       in-flight expedition, if any
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

  let cursor = next.lastTickAt;
  while (cursor < now) {
    const dtMs = Math.min(config.stepMs, now - cursor);
    const at = cursor + dtMs;
    advance(next, dtMs, at, events, config);
    cursor = at;
  }

  next.lastTickAt = now;
  return { state: next, events };
}

/** One simulation slice, applied in a fixed order. */
function advance(state, dtMs, at, events, config) {
  const hours = dtMs / HOUR_MS;

  accrueResources(state, hours);

  if (state.survivor?.alive) {
    simulateSurvivor(state, hours, at, events, config);
  }
}

/**
 * Settlement production. Runs whether or not anyone is alive to see it — structures
 * keep working, which is the mechanical expression of "the settlement outlives its
 * people". Rates are per-hour here; the DB column's unit is converted at load.
 */
function accrueResources(state, hours) {
  for (const resource of Object.values(state.settlement.resources)) {
    resource.amount = clamp(resource.amount + resource.ratePerHour * hours, 0, resource.cap);
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
  survivor.radiation = clamp(survivor.radiation - config.radDecayPerHour * hours, 0, 100);

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
function healthDelta(survivor, hours, config) {
  let delta = 0;

  if (survivor.hunger >= config.starvationThreshold) {
    const severity = band(survivor.hunger, config.starvationThreshold);
    delta -= config.starvationDamagePerHour * severity * hours;
  }

  if (survivor.radiation >= config.radThreshold) {
    const severity = band(survivor.radiation, config.radThreshold);
    delta -= config.radDamagePerHour * severity * hours;
  }

  const comfortable =
    survivor.hunger < config.regenHungerCeiling && survivor.radiation < config.regenRadCeiling;
  if (comfortable && delta === 0) {
    delta += config.regenPerHour * hours;
  }

  return delta;
}

/**
 * Consume an emergency item to remove the cause of imminent death.
 * @returns {boolean} whether anything was consumed
 */
function rescue(survivor, at, events, config) {
  const needed =
    survivor.hunger >= config.starvationThreshold
      ? 'ration'
      : survivor.radiation >= config.radThreshold
        ? 'antirad'
        : null;
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
    events.push({ at, type: 'expedition_lost', expeditionId: state.expedition.id });
  }

  events.push({
    at,
    type: 'survivor_died',
    cause,
    // character_history.days_survived wants the real elapsed time, not time-since-login.
    daysSurvived: (at - survivor.bornAt) / (24 * HOUR_MS),
  });
}

function causeOf(survivor, config) {
  if (survivor.radiation >= config.radThreshold && survivor.hunger < config.starvationThreshold) {
    return 'radiation';
  }
  if (survivor.radiation >= config.radThreshold) return 'starvation_and_radiation';
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
