import test from 'node:test';
import assert from 'node:assert/strict';

import { isDatabaseUnreachable } from '../../src/db/errors.js';

test('a dual-stack connection failure is recognised through the AggregateError', () => {
  // This is the exact shape Node produces when localhost resolves to both ::1 and
  // 127.0.0.1 and neither answers — the real failure when WSL shuts its VM down.
  const error = new AggregateError(
    [
      Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
    ],
    '',
  );
  error.code = 'ECONNREFUSED';

  assert.equal(isDatabaseUnreachable(error), true);
});

test('a plain connection error is recognised too', () => {
  assert.equal(isDatabaseUnreachable(Object.assign(new Error(), { code: 'ENOTFOUND' })), true);
});

test('ordinary errors are not mistaken for an outage', () => {
  assert.equal(isDatabaseUnreachable(new Error('boom')), false);
  // A constraint violation is a bug in the game and must not be reported as one.
  assert.equal(isDatabaseUnreachable(Object.assign(new Error(), { code: '23505' })), false);
  assert.equal(isDatabaseUnreachable(null), false);
  assert.equal(isDatabaseUnreachable(undefined), false);
});
