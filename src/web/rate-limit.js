/**
 * A small sliding-window limiter, in memory.
 *
 * In memory deliberately, and the tradeoff is worth stating plainly: counters reset
 * when the process restarts and are not shared between instances. For a game with a
 * handful of players on one box that is the right call — it costs nothing, adds no
 * dependency, and the thing it defends against is somebody grinding a password list,
 * which a per-process window still makes hopeless. If this ever runs on more than one
 * instance, move the counter into Postgres beside `sessions` rather than reaching for
 * a library; the shape below will not have to change.
 *
 * The same reasoning as the cookie parser: one small function is cheaper than a
 * dependency, right up until it isn't.
 */

/** How often to sweep stale keys, in requests. Cheap amortisation over a small map. */
const SWEEP_EVERY = 500;

/**
 * @param {object} options
 * @param {number} options.windowMs how far back the window reaches
 * @param {number} options.max      attempts allowed inside it
 * @param {(req: object) => string} [options.key] what counts as "the same caller"
 * @param {string} [options.message] what the caller is told when refused
 */
export function rateLimit({ windowMs, max, key = (req) => req.ip ?? 'unknown', message }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  let since = 0;

  function sweep(now) {
    for (const [k, times] of hits) {
      const live = times.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
  }

  return function limit(req, res, next) {
    const now = Date.now();

    if (++since >= SWEEP_EVERY) {
      since = 0;
      sweep(now);
    }

    const id = key(req);
    const times = (hits.get(id) ?? []).filter((t) => now - t < windowMs);

    if (times.length >= max) {
      // Retry-After is the honest answer to "when can I try again": the oldest
      // attempt in the window is the one that has to age out first.
      const retryMs = windowMs - (now - times[0]);
      res.set('Retry-After', String(Math.ceil(retryMs / 1000)));

      // Handed to the app's error handler rather than answered here, so a refusal
      // lands on the same page every other refusal does. `next('route')` would have
      // skipped to the 404 handler, which tells the caller something untrue.
      const error = new Error(message ?? 'Too many attempts. Try again shortly.');
      error.status = 429;
      return next(error);
    }

    times.push(now);
    hits.set(id, times);
    next();
  };
}

/**
 * The key for credential endpoints: the caller's address *and* the account they are
 * reaching for.
 *
 * Address alone would let one attacker behind a shared address lock out everyone
 * else on it; the account alone would let an attacker lock a known victim out of
 * their own camp by failing at their door on purpose. Both together limits the thing
 * actually being attacked — this address trying this account — and leaves the
 * victim's own attempts from their own address unaffected.
 */
export function credentialKey(req) {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  return `${req.ip ?? 'unknown'}|${email}`;
}
