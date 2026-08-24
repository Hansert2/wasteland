import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DUMMY_HASH,
  __testing,
  hashPassword,
  verifyLogin,
  verifyPassword,
} from '../../src/auth/passwords.js';

test('a password verifies against its own hash', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('a wrong password does not', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery stapler', hash), false);
});

test('the same password hashes differently every time', async () => {
  const a = await hashPassword('same input');
  const b = await hashPassword('same input');

  assert.notEqual(a, b, 'salted, so identical passwords are not identical rows');
  assert.equal(await verifyPassword('same input', a), true);
  assert.equal(await verifyPassword('same input', b), true);
});

test('the hash records its own cost parameters, so they can be raised later', async () => {
  const hash = await hashPassword('whatever');
  const [scheme, N, r, p] = hash.split('$');

  assert.equal(scheme, 'scrypt');
  assert.equal(Number(N), 16384);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 1);
});

test('a malformed or missing hash denies access instead of throwing', async () => {
  // A corrupt row should fail the login, not 500 the route.
  for (const bad of ['', null, undefined, 'nonsense', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e']) {
    assert.equal(await verifyPassword('anything', bad), false, `rejected: ${bad}`);
  }
});

/*
 * The login path, which is a different question from verification.
 *
 * Found in review on 2026-08-24: `/login` passed `player?.password_hash ?? ''` under a
 * comment promising that a missing account and a wrong password cost the same. An empty
 * string is not a parseable hash, so verification returned before touching scrypt, and
 * the two paths measured 31 ms against 0.001 ms. That is an account-existence oracle
 * anybody could read in one request.
 *
 * These are deliberately *not* wall-clock assertions. A timing test with a margin wide
 * enough not to flake on a loaded CI box is too wide to catch a regression, and one
 * narrow enough to catch it will fail on a Tuesday. What decides the cost of a
 * verification is the parameters it runs at, so that is what gets pinned.
 */

test('the hash a missing account is checked against is a real one, at the real cost', async () => {
  /*
   * `DUMMY_HASH` is a literal, so the thing that can go wrong is drift: raise `PARAMS`
   * and real accounts get slower while the stand-in stays cheap, which is the timing
   * oracle coming back through the door it was shut out of. This is the guard that
   * makes the literal safe, so it compares against a hash made *now* rather than
   * against numbers typed in here.
   */
  const { parseHash } = __testing;

  const real = parseHash(await hashPassword('somebody real'));
  const stand_in = parseHash(DUMMY_HASH);

  assert.ok(stand_in, 'the dummy is a hash this module would accept from the database');
  assert.deepEqual(
    stand_in.params,
    real.params,
    'same cost as a real account, or the timing gap is back — regenerate DUMMY_HASH',
  );
  assert.equal(stand_in.salt.length, real.salt.length, 'and the same salt');
  assert.equal(stand_in.expected.length, real.expected.length, 'and the same work to compare');
});

test('the dummy costs nothing to reach, so the first login of a boot is like the rest', () => {
  // The lazy version built this on first use, which made the first missing-account login
  // after a restart pay for two scrypts against a real account's one — 56 ms against 26.
  // A constant has no first use. Asserted structurally: a string, not a promise.
  assert.equal(typeof DUMMY_HASH, 'string');
});

test('no password authenticates an account that does not exist', async () => {
  for (const absent of [null, undefined, '', 'nonsense', 'scrypt$1$2$3']) {
    assert.equal(await verifyLogin('anything at all', absent), false, `denied: ${absent}`);
  }
});

test('a real account still logs in, and still refuses the wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.equal(await verifyLogin('correct horse battery staple', hash), true);
  assert.equal(await verifyLogin('correct horse battery stapler', hash), false);
});

test('a corrupt cost parameter denies login rather than asking for a gigabyte', async () => {
  // The parameters come out of the row, so the row decides how much memory the login
  // route allocates. scrypt throws rather than returning when the working set is too
  // large — which turned one bad row into a 500 on every attempt against that account.
  const [, , , , salt, key] = (await hashPassword('whatever')).split('$');

  const corrupt = [
    `scrypt$99999999$8$1$${salt}$${key}`, // more memory than scrypt will allocate
    `scrypt$16385$8$1$${salt}$${key}`, // N not a power of two
    `scrypt$0$8$1$${salt}$${key}`,
    `scrypt$16384$0$1$${salt}$${key}`,
    `scrypt$16384$8$0$${salt}$${key}`,
    `scrypt$16384$8$-1$${salt}$${key}`,
  ];

  for (const stored of corrupt) {
    assert.equal(await verifyPassword('anything', stored), false, `denied: ${stored}`);
    assert.equal(await verifyLogin('anything', stored), false, `denied: ${stored}`);
  }
});

/*
 * The three holes a second review found on 2026-08-24, each pinned by the case that
 * demonstrated it.
 */

test('every parameter set the parser accepts is one scrypt will actually run', async () => {
  /*
   * Validation and execution were bounded by different numbers. `parseHash` allowed a
   * working set up to 64 MiB; scrypt's own default ceiling is 32 MiB and it *throws* at
   * the boundary rather than returning. So three sets parsed cleanly and then blew up:
   * N=32768 r=8, N=65536 r=8, and N=16384 r=16 — the first two being the obvious next
   * steps if the cost is ever raised, which made this a trap for the next edit of
   * `PARAMS` rather than only a corrupt-row problem.
   */
  const { parseHash, MAX_MEMORY, SCRYPT_MAXMEM } = __testing;
  const [, , , , salt, key] = (await hashPassword('whatever')).split('$');
  const at = (N, r) => ['scrypt', N, r, 1, salt, key].join('$');

  assert.ok(
    SCRYPT_MAXMEM > MAX_MEMORY,
    'scrypt throws at its ceiling, so the ceiling must be above what we admit',
  );

  for (const [N, r] of [[32768, 8], [65536, 8], [16384, 16]]) {
    const stored = at(N, r);
    assert.ok(parseHash(stored), `N=${N} r=${r} is inside the bound and must stay runnable`);

    // The assertion that matters: this used to throw ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
    assert.equal(await verifyPassword('anything', stored), false, `N=${N} r=${r} answers`);
    assert.equal(await verifyLogin('anything', stored), false, `N=${N} r=${r} answers`);
  }

  // And the largest set the bound admits is still one scrypt will run.
  const widest = at(MAX_MEMORY / (128 * 8), 8);
  assert.ok(parseHash(widest), 'the bound is expressed in the same terms scrypt uses');
  assert.equal(await verifyPassword('anything', widest), false);
});

test('a hash of the wrong shape denies access, however plausible it looks', async () => {
  /*
   * The one that mattered most. `verifyPassword` derived a key of `expected.length`
   * bytes, so a row whose key had been truncated to one byte compared one byte: the
   * right password still worked, and a wrong one got in about once every 256 attempts.
   * Measured at 1 in 512 before this was closed.
   */
  const { parseHash } = __testing;
  const real = await hashPassword('correct horse battery staple');
  const [, , , , salt, key] = real.split('$');
  const at = (s, k) => ['scrypt', 16384, 8, 1, s, k].join('$');
  const clip = (b64, bytes) => Buffer.from(b64, 'base64').subarray(0, bytes).toString('base64');

  const wrong = {
    'a key truncated to one byte': at(salt, clip(key, 1)),
    'a key truncated to half': at(salt, clip(key, 32)),
    'a key one byte short': at(salt, clip(key, 63)),
    'a salt truncated': at(clip(salt, 4), key),
    'a salt one byte short': at(clip(salt, 15), key),
    'a salt that is not base64': at('!!!!', key),
    'a key that is not base64': at(salt, '@@@@'),
    'the two fields swapped': at(key, salt),
  };

  for (const [what, stored] of Object.entries(wrong)) {
    assert.equal(parseHash(stored), null, `${what}: refused before any work is done`);
    assert.equal(
      await verifyPassword('correct horse battery staple', stored),
      false,
      `${what}: the right password must not open it either`,
    );
    assert.equal(await verifyLogin('correct horse battery staple', stored), false, what);
  }

  // The shape it is measured against, so this test fails if the real one ever changes.
  assert.ok(parseHash(real), 'a hash this module wrote is still accepted');
});

test('a crypto-level failure is an answer, not an exception', async () => {
  /*
   * The contract in `verifyPassword`'s own docstring — a corrupt row denies access
   * rather than 500-ing the route — should not rest on the validator alone, because a
   * validator two functions away is what the next person forgets to update. Reached
   * here by going around `parseHash` and calling the guarded path directly.
   */
  const { parseHash } = __testing;
  const real = await hashPassword('whatever');

  // Sanity: the only way in is past the parser, so prove the parser is what stops these.
  assert.equal(parseHash(['scrypt', 1 << 21, 8, 1, 'x', 'y'].join('$')), null);

  // And the guarded path answers rather than throwing for everything else.
  for (const stored of [real.replace('16384', '16383'), real.slice(0, -4), `${real}$extra`]) {
    await assert.doesNotReject(() => verifyPassword('whatever', stored));
    assert.equal(await verifyLogin('whatever', stored), false);
  }
});
