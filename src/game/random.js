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
