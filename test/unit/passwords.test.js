import test from 'node:test';
import assert from 'node:assert/strict';

import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';

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
