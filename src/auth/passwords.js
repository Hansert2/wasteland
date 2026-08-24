import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/**
 * scrypt from Node's own crypto — no native build step, no dependency, and memory-hard
 * in a way plain SHA is not. Cost parameters are stored inside the hash string rather
 * than hardcoded at the comparison site, so they can be raised later without
 * invalidating existing passwords.
 */
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export const MIN_PASSWORD_LENGTH = 8;

/**
 * The most memory a stored hash is allowed to ask for, and why there is a limit at all.
 *
 * The cost parameters live in the row, which is the right design — it is what lets them
 * be raised later — and it means the row decides how much memory the login route
 * allocates. `Number(N)` from a corrupt or hostile row went straight to scrypt, and
 * scrypt *throws* rather than returning when `128 * N * r` exceeds its memory ceiling.
 * So a single bad row turned every login attempt against that account into a 500,
 * which is exactly what this module's contract says it does not do.
 *
 * 64 MiB is four times what the current parameters need (16 MiB at N=16384, r=8), so it
 * leaves room for two doublings of N before anyone has to think about this line again.
 */
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * The ceiling handed to scrypt itself, and the reason it is not the same number.
 *
 * Bounding the parsed parameters was only half of it. Node's own `maxmem` defaults to
 * 32 MiB and it *throws* rather than returning when the working set reaches it — so a
 * bound of 64 MiB admitted three parameter sets that parsed cleanly and then blew up on
 * the way to scrypt: N=32768 r=8, N=65536 r=8, and N=16384 r=16. Two of them are the
 * obvious next steps if the cost is ever raised, which made this a trap laid for the
 * next person to edit `PARAMS` rather than only a corrupt-row problem.
 *
 * Doubled rather than equal, because the throw happens at the boundary and not past it.
 * The invariant to keep: every parameter set `parseHash` accepts must be one scrypt will
 * run, and `test/unit/passwords.test.js` checks the two limits against each other rather
 * than trusting this comment.
 */
const SCRYPT_MAXMEM = MAX_MEMORY * 2;

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH, PARAMS);

  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * A stored hash, taken apart and checked, or null if it is not one.
 *
 * Every rejection here is a row that cannot authenticate anybody, so they are all the
 * same answer — but they are not all the same *kind* of problem, and the parameter
 * bounds are the ones worth naming. scrypt requires N to be a power of two greater than
 * one and will throw otherwise, and it will throw again if the working set is larger
 * than its memory ceiling. Checking here means a corrupt row is refused by this module
 * rather than by an exception three frames up.
 */
function parseHash(stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const [, rawN, rawR, rawP, saltB64, keyB64] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || N < 2 || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > 32) return null;
  if (!Number.isInteger(p) || p < 1 || p > 16) return null;
  if (128 * N * r > MAX_MEMORY) return null;

  /*
   * Exact lengths, not "not empty", and the difference is a real hole rather than
   * tidiness. `verifyPassword` derived a key of `expected.length` bytes and compared
   * that many — so a row whose key had been truncated to a single byte still let the
   * right password through *and* accepted a wrong one about once in every 256 tries.
   * Measured before this line existed: 1 in 512 attempts on a one-byte key.
   *
   * Lenient base64 is the other half of the same check. `Buffer.from(x, 'base64')`
   * ignores characters it does not recognise rather than failing, so a mangled field
   * decodes to a short buffer and nothing upstream ever hears about it. Length is where
   * that becomes visible.
   *
   * The forward cost, stated because it is easy to walk into: raising `KEY_LENGTH` or
   * `SALT_LENGTH` now invalidates every stored row rather than only slowing it down —
   * unlike the cost parameters, which live in the string. Changing either means
   * re-hashing on next login, and that path does not exist yet.
   */
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return null;

  return { params: { N, r, p }, salt, expected };
}

/**
 * Constant-time verification. Returns false rather than throwing on a malformed or
 * unknown hash, so a corrupt row denies access instead of 500-ing the login route.
 *
 * "Constant-time" is about the *comparison* and nothing else: a hash this cannot parse
 * returns immediately, and that is correct here but is not enough for a login route,
 * where returning immediately is itself an answer. See `verifyLogin`.
 */
export async function verifyPassword(password, stored) {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  try {
    const actual = await scryptAsync(password, parsed.salt, KEY_LENGTH, {
      ...parsed.params,
      maxmem: SCRYPT_MAXMEM,
    });

    return timingSafeEqual(actual, parsed.expected);
  } catch (error) {
    /*
     * Belt as well as braces, and deliberately so. `parseHash` is supposed to have
     * refused anything that could get here, but "a corrupt row denies access instead of
     * 500-ing the login route" is a promise this function makes in its own docstring,
     * and a promise kept only by a validator two functions away is one broken by the
     * next person to add a parameter. Logged rather than swallowed: a row reaching this
     * line is a bug in the validation, not a bad password.
     */
    console.error('scrypt refused a stored hash that parsed:', error.code ?? error.message);
    return false;
  }
}

/**
 * A hash that belongs to nobody, so that a login against nobody costs what a login costs.
 *
 * Written down rather than generated, and that is the second version of this. The first
 * built it lazily on first use, on the reasoning that a literal is a copy of `PARAMS`
 * nothing keeps in step. The reasoning was right and the cure was worse: the *first*
 * login against a missing account after a restart paid for two scrypts — one to make
 * this and one to check against it — while a real account paid for one. Measured at
 * 56 ms against 26 ms, which is the same oracle the lazy dummy was written to close,
 * surviving exactly one request per boot.
 *
 * So it is a constant, and the drift it risks is handled by a test instead: the params
 * and both field lengths are compared against a hash generated from the current
 * `PARAMS`, so raising the cost fails the suite here rather than quietly restoring the
 * timing gap. That is the right place for it — a fact that must not drift is better
 * pinned by something that runs than by something that hopes.
 *
 * The password behind it is not a secret and does not need to be: `verifyLogin` returns
 * `real && ok`, so even knowing it authenticates nothing. Its only job is to make the
 * work real.
 */
export const DUMMY_HASH =
  'scrypt$16384$8$1$EHMgM7ztJu7KBPwyu1fS6Q==$' +
  'ASMsJLcJmB98JTClVf4wmUtqxm9LBzK+RnojnWJb3at0f1XzR1NYMRaYuK8OoJSBaaQHD92vbhlf9OXhfDyqBw==';

/**
 * Verify a login attempt against a row that may not exist, at the same cost either way.
 *
 * The bug this exists to close, found in review on 2026-08-24 and measured before it was
 * fixed: the login route passed `player?.password_hash ?? ''` and a comment saying a
 * missing account and a wrong password take the same time. They did not. An empty string
 * is unparseable, `verifyPassword` returned before touching scrypt, and the two paths
 * came out at **31 ms and 0.001 ms** — a factor of twenty thousand, readable over the
 * network in a single request. Anyone could ask this server whether an address had a
 * camp behind it.
 *
 * The fix is to do the work rather than to skip it, so an unparseable or absent row is
 * checked against `DUMMY_HASH` instead. It also covers the row that is corrupt rather
 * than missing, which the naive fix does not: without this, "no such account" and "this
 * account exists but its hash is broken" are again two different durations.
 *
 * The `real &&` is not redundancy for its own sake. It makes "a row that is not a usable
 * hash can never authenticate" a property of the control flow rather than a consequence
 * of the dummy password being unguessable.
 */
export async function verifyLogin(password, stored) {
  const real = parseHash(stored) !== null;
  const ok = await verifyPassword(password, real ? stored : DUMMY_HASH);

  return real && ok;
}

/** Exported for the tests that pin what this module will and will not accept. */
export const __testing = { parseHash, MAX_MEMORY, SCRYPT_MAXMEM, KEY_LENGTH, SALT_LENGTH };
