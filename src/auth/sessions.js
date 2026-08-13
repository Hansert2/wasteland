import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'wasteland_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** 256 bits of randomness; the client's only copy of the credential. */
function newToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Only the hash is ever stored. A leaked `sessions` table therefore yields nothing
 * replayable — the same reasoning as password hashing, applied to bearer tokens.
 */
function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(client, playerId, now = Date.now()) {
  const token = newToken();
  await client.query(
    'insert into sessions (token_hash, player_id, expires_at) values ($1, $2, $3)',
    [hashToken(token), playerId, new Date(now + TTL_MS)],
  );
  return { token, maxAgeMs: TTL_MS };
}

/** @returns {Promise<{playerId: number}|null>} */
export async function findSession(client, token) {
  if (!token) return null;

  const { rows } = await client.query(
    'select player_id, expires_at from sessions where token_hash = $1',
    [hashToken(token)],
  );
  const session = rows[0];
  if (!session) return null;

  // Expiry is enforced on read as well as by cleanup, so a stale row is never
  // honoured even if the sweep has not run.
  if (session.expires_at.getTime() <= Date.now()) {
    await destroySession(client, token);
    return null;
  }

  return { playerId: session.player_id };
}

export async function destroySession(client, token) {
  if (!token) return;
  await client.query('delete from sessions where token_hash = $1', [hashToken(token)]);
}

/** Opportunistic cleanup; correctness does not depend on it running. */
export async function purgeExpiredSessions(client) {
  const { rowCount } = await client.query('delete from sessions where expires_at <= now()');
  return rowCount;
}
