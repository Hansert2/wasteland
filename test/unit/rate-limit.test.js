import test from 'node:test';
import assert from 'node:assert/strict';

import { addressKey, credentialKey, rateLimit } from '../../src/web/rate-limit.js';

/** A request/response pair thin enough to drive the middleware directly. */
function call(limit, { ip = '1.2.3.4', body } = {}) {
  const req = { ip, body };
  const headers = {};
  const res = { set: (k, v) => (headers[k] = v) };

  let refusal = null;
  limit(req, res, (error) => {
    if (error) refusal = error;
  });

  return { refusal, headers };
}

test('attempts pass until the window is full, then are refused', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 3 });

  for (let i = 0; i < 3; i++) {
    assert.equal(call(limit).refusal, null, `attempt ${i + 1} should pass`);
  }

  const { refusal } = call(limit);
  assert.ok(refusal, 'the fourth is refused');
  assert.equal(refusal.status, 429, 'as a 429, not a generic error');
});

test('a refusal says when to come back, and it is not a lie', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 1 });
  call(limit);

  const { headers } = call(limit);
  const retry = Number(headers['Retry-After']);
  assert.ok(retry > 0 && retry <= 60, `Retry-After was ${retry}`);
});

test('the window slides rather than resetting on a schedule', async () => {
  const limit = rateLimit({ windowMs: 60, max: 2 });

  call(limit);
  call(limit);
  assert.ok(call(limit).refusal, 'full');

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(call(limit).refusal, null, 'the old attempts aged out');
});

test('callers are counted separately, so one attacker cannot lock out a stranger', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 1 });

  call(limit, { ip: '10.0.0.1' });
  assert.ok(call(limit, { ip: '10.0.0.1' }).refusal, 'the noisy one is stopped');
  assert.equal(call(limit, { ip: '10.0.0.2' }).refusal, null, 'the quiet one is not');
});

test('the credential key is address *and* account, which is the point', () => {
  // Address alone lets one attacker behind a shared address lock out everyone on it.
  // Account alone lets an attacker lock a known victim out of their own camp by
  // failing at their door on purpose. Both together limits only the pair.
  const limit = rateLimit({ windowMs: 60_000, max: 1, key: credentialKey });
  const victim = { ip: '10.0.0.9', body: { email: 'vera@example.test' } };

  call(limit, { ip: '10.0.0.1', body: { email: 'vera@example.test' } });
  assert.ok(
    call(limit, { ip: '10.0.0.1', body: { email: 'vera@example.test' } }).refusal,
    'the attacker is stopped at that door',
  );

  assert.equal(call(limit, victim).refusal, null, 'the victim can still get in from home');
  assert.equal(
    call(limit, { ip: '10.0.0.1', body: { email: 'someone@example.test' } }).refusal,
    null,
    'and the attacker is not locked out of the whole site',
  );
});

test('the key normalises the address of an email, so case is not a way around it', () => {
  assert.equal(
    credentialKey({ ip: '1.1.1.1', body: { email: '  VERA@Example.test ' } }),
    credentialKey({ ip: '1.1.1.1', body: { email: 'vera@example.test' } }),
  );
  assert.equal(credentialKey({ body: {} }), 'unknown|', 'and a bodyless request is still a key');
});

/*
 * Signing up, which is counted differently from signing in and has to be.
 *
 * Found in review on 2026-08-24: both routes shared the login limiter, whose key is the
 * address *and* the account. At a login that is right. At a registration the caller
 * chooses the account, so a fresh address in the form is a fresh bucket and the limiter
 * never fills — while every accepted request pays a full scrypt and writes a camp.
 */

test('the registration key is the address alone, because the caller picks the account', () => {
  assert.equal(
    addressKey({ ip: '10.0.0.1', body: { email: 'one@example.test' } }),
    addressKey({ ip: '10.0.0.1', body: { email: 'two@example.test' } }),
  );
  assert.equal(addressKey({}), 'unknown', 'a request with no address is still a key');
});

test('a new email in the form does not buy a new registration allowance', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 3, key: addressKey });
  const from = (email) => call(limit, { ip: '10.0.0.1', body: { email } });

  assert.equal(from('one@example.test').refusal, null);
  assert.equal(from('two@example.test').refusal, null);
  assert.equal(from('three@example.test').refusal, null);

  const { refusal } = from('four@example.test');
  assert.ok(refusal, 'the fourth address from the same caller is refused');
  assert.equal(refusal.status, 429);
});

test('and a different address is unaffected, so one signup does not close the door', () => {
  const limit = rateLimit({ windowMs: 60_000, max: 1, key: addressKey });

  call(limit, { ip: '10.0.0.1', body: { email: 'one@example.test' } });
  assert.ok(call(limit, { ip: '10.0.0.1', body: { email: 'two@example.test' } }).refusal);
  assert.equal(
    call(limit, { ip: '10.0.0.2', body: { email: 'three@example.test' } }).refusal,
    null,
    'somebody else signing up is somebody else',
  );
});
