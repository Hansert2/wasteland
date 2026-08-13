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
 * Constant-time verification. Returns false rather than throwing on a malformed or
 * unknown hash, so a corrupt row denies access instead of 500-ing the login route.
 */
export async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });

  return timingSafeEqual(actual, expected);
}
