/**
 * When, during a trip, the things that happened to it happened.
 *
 * `resolveExpedition` rolls a whole expedition in one go and the tick applies it at
 * `returns_at`. That is enough to say what came home and useless for saying anything
 * while the survivor is still out there — and a mid-trip report that cannot say what
 * they are carrying is not worth reading.
 *
 * So this attributes an already-rolled outcome across the hours. **It adds no
 * randomness to the trip and changes no total.** The draws it needs come from a
 * generator salted off the same seed (`mix(seed, 'timeline')`), never from the one
 * `resolveExpedition` opens, so an expedition rolls exactly what it rolled before this
 * module existed — roll for roll — and the distribution in time is simply never
 * observed on a trip nobody attends.
 *
 * **This is a reporting projection, not a simulation.** A hazard placed at hour eleven
 * is *reported* as having happened at hour eleven and is still *applied* at
 * `returns_at`, exactly as it is today. Nothing here decides when anybody dies. Making
 * the timeline authoritative would mean a survivor who dies out there stops eating
 * hours earlier than they currently do, which would quietly change what an unattended
 * trip costs a camp — the one thing all of this is arranged to prevent.
 */
import { makeRandom, mix } from './random.js';

/** The salt. Changing it re-rolls every timeline; see the note on `mix`. */
export const TIMELINE_SALT = 'timeline';

/** Where in the trip a hazard and a find may fall, as fractions of it. */
const HAZARD_WINDOW = [0.15, 0.9];
const FIND_WINDOW = [0.1, 0.95];

/**
 * How much of a trip's haul is in the pack by a given fraction of it.
 *
 * Smoothstep: little on the way out, most through the middle, little on the walk home.
 * Any monotone curve anchored at 0 and 1 would be safe — this one is shaped like the
 * trip it describes, and being symmetric it makes turning back at the halfway point
 * worth about half the haul, which is the intuition a player will bring anyway.
 *
 * The two anchors are what everything else leans on: `progress(1)` must be exactly 1,
 * or the totals do not land, and it must never decrease, or a report goes backwards.
 */
export function progress(fraction) {
  const f = Math.min(1, Math.max(0, Number(fraction) || 0));
  return f * f * (3 - 2 * f);
}

/**
 * Attribute an outcome across the hours of the trip that produced it.
 *
 * The generator is drawn from in a fixed order — loot jitters by sorted resource kind,
 * then the hazard's hour, then each find's — because the order *is* the derivation. A
 * new draw inserted in the middle shifts everything after it and every timeline in
 * flight changes shape. Append, or salt again.
 *
 * The hazard's hour is drawn whether or not there was a hazard, so that the number of
 * draws depends only on the shape of the outcome and not on how it went.
 */
export function timelineOf({ outcome, travelHours, seed }) {
  const random = makeRandom(mix(seed, TIMELINE_SALT));
  const hours = Math.max(0, Number(travelHours) || 0);

  const loot = { ...(outcome.loot ?? {}) };
  const jitter = {};
  for (const kind of Object.keys(loot).sort()) {
    // In [0, 1), which is what keeps the total exact: floor(total + jitter) === total
    // for a whole total. Without it, `floor` would hold a haul of one scrap back until
    // the final instant of the trip and show nothing at all before then.
    jitter[kind] = random();
  }

  const hazardHour = at(random, HAZARD_WINDOW, hours);
  const damage = Number(outcome.damage ?? 0);

  return {
    travelHours: hours,
    loot,
    jitter,
    radiation: Number(outcome.radiation ?? 0),
    hazard: damage > 0 ? { damage, cause: outcome.cause ?? null, atHour: hazardHour } : null,
    finds: (outcome.finds ?? []).map((find) => ({
      slug: find.slug,
      qty: find.qty,
      atHour: at(random, FIND_WINDOW, hours),
    })),
  };
}

/**
 * What is true of the trip at a given hour — the honest mid-trip report.
 *
 * Monotone in `hours` and exact at the end: `stateAt(t, t.travelHours).carrying`
 * deep-equals the outcome's loot, and its radiation equals the outcome's. Those two
 * properties are the whole contract, and both are pinned by tests.
 */
export function stateAt(timeline, hours) {
  const total = timeline.travelHours;
  const elapsed = Math.min(total, Math.max(0, Number(hours) || 0));
  const p = total === 0 ? 1 : progress(elapsed / total);

  const carrying = {};
  for (const [kind, amount] of Object.entries(timeline.loot)) {
    // floor, never round: nothing is reported that has not been picked up yet, and
    // turning back at nine tenths of the way brings home nine tenths rather than
    // being rounded up a parting gift.
    const carried = Math.floor(amount * p + (timeline.jitter[kind] ?? 0));
    if (carried > 0) carrying[kind] = carried;
  }

  const hazardReached = timeline.hazard !== null && elapsed >= timeline.hazard.atHour;

  return {
    hours: elapsed,
    carrying,
    // One decimal, as the roll itself is, so the last step lands on the exact total.
    radiation: Math.round(timeline.radiation * p * 10) / 10,
    // Reported, not applied. The tick still settles this at returns_at.
    damage: hazardReached ? timeline.hazard.damage : 0,
    cause: hazardReached ? timeline.hazard.cause : null,
    finds: timeline.finds
      .filter((find) => elapsed >= find.atHour)
      .map((find) => ({ slug: find.slug, qty: find.qty })),
  };
}

function at(random, [lo, hi], hours) {
  return (lo + random() * (hi - lo)) * hours;
}
