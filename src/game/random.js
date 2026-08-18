/**
 * A small deterministic PRNG (mulberry32).
 *
 * Game outcomes are rolled from a seed stored on the row rather than from
 * Math.random(), so resolution stays a pure function of its inputs. That makes a
 * retried request produce the same result as the first attempt, and lets a test pin
 * an exact outcome by choosing a seed instead of stubbing global randomness.
 */
export function makeRandom(seed) {
  let state = Number(seed) >>> 0;

  return function random() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive on both ends. */
export function intBetween(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

export function chance(random, probability) {
  return random() < probability;
}

/** A seed for a new roll. Not cryptographic — it only needs to be unpredictable. */
export function newSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

/**
 * A second seed derived from a first, so one stored number can drive several
 * independent streams.
 *
 * An expedition stores one seed and its outcome is rolled from it. Anything added
 * later that also wants randomness — where the loot fell across the hours, which
 * moments the trip offers — must not draw from that same generator, or it shifts every
 * roll after it and the trip silently becomes a different trip. Salting instead gives
 * each concern its own stream, and makes that separation structural rather than a
 * thing somebody has to remember.
 *
 * FNV-1a over the salt, folded into the seed, then avalanched. Not cryptography; it
 * only has to decorrelate.
 *
 * ═══ THIS FUNCTION IS FROZEN ═══
 *
 * Seeds are stored on rows and replayed at resolution, so this arithmetic *is* the
 * trip a player is currently on. Changing it — tightening it, tidying the constants,
 * "improving" it — silently re-rolls every expedition in flight and every outcome any
 * test has pinned. Treat it exactly like an applied migration: it cannot be edited,
 * only replaced by something new alongside it. `test/unit/random.test.js` pins its
 * output to fixed values for that reason.
 */
export function mix(seed, salt) {
  let h = 0x811c9dc5;
  const text = String(salt);

  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }

  h ^= Math.imul(Number(seed) >>> 0, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;

  return h >>> 0;
}
