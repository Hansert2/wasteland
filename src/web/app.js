import express from 'express';

import { pool, withTransaction } from '../db/pool.js';
import { settlementIdForPlayer } from '../db/world.js';
import { verifyPassword } from '../auth/passwords.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  findSession,
} from '../auth/sessions.js';
import { foundSettlement, raiseSuccessor, InputError } from '../services/settlement-lifecycle.js';
import { advanceSettlement } from '../services/advance-settlement.js';
import { viewCamp } from '../services/view-camp.js';
import { campPage, landingPage, layout, escape } from './render.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Bodies here are short forms; a small cap keeps a stray large POST cheap to reject.
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(readCookies);
  app.use(loadSession);

  app.get('/', (req, res) => {
    if (req.playerId) return res.redirect('/camp');
    res.send(landingPage());
  });

  app.post('/register', async (req, res) => {
    const { playerId } = await withTransaction((client) =>
      foundSettlement(client, {
        email: req.body.email,
        password: req.body.password,
        settlementName: req.body.settlementName,
        survivorName: req.body.survivorName,
        now: Date.now(),
      }),
    );

    await startSession(res, playerId);
    res.redirect('/camp');
  });

  app.post('/login', async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();

    const { rows } = await pool.query(
      'select id, password_hash from players where lower(email) = $1',
      [email],
    );
    const player = rows[0];

    // Verify against a dummy hash when the account does not exist, so a missing
    // account and a wrong password take the same time and give the same answer.
    const ok = await verifyPassword(String(req.body.password ?? ''), player?.password_hash ?? '');
    if (!player || !ok) {
      return res.status(401).send(landingPage({ error: 'Those details do not match a camp.' }));
    }

    await startSession(res, player.id);
    res.redirect('/camp');
  });

  app.post('/logout', async (req, res) => {
    await destroySession(pool, req.cookies[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.redirect('/');
  });

  app.get('/camp', requireAuth, async (req, res) => {
    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');
      return viewCamp(client, settlementId, Date.now());
    });

    res.send(campPage(view));
  });

  app.post('/successor', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Bank whatever the empty camp produced before the successor's clock starts —
      // raiseSuccessor resets last_tick_at, so anything not ticked first is lost.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await raiseSuccessor(client, settlementId, { name: req.body.name, now });
    });

    res.redirect('/camp');
  });

  app.use((req, res) => {
    res.status(404).send(layout('Not found', '<h1>Nothing here</h1><p><a href="/">Back</a></p>'));
  });

  app.use(errorHandler);

  return app;
}

/** Minimal cookie parsing — one small function is cheaper than a dependency. */
function readCookies(req, _res, next) {
  const cookies = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  req.cookies = cookies;
  next();
}

async function loadSession(req, _res, next) {
  const session = await findSession(pool, req.cookies[SESSION_COOKIE]);
  req.playerId = session?.playerId ?? null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.playerId) return res.redirect('/');
  next();
}

async function startSession(res, playerId) {
  const { token, maxAgeMs } = await createSession(pool, playerId);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // Strict is what stands in for CSRF tokens here: a cross-site form post arrives
    // without the cookie, so every state-changing POST is same-origin by construction.
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeMs,
    path: '/',
  });
}

function errorHandler(error, _req, res, _next) {
  const status = error.status ?? 500;

  if (status >= 500) {
    console.error(error);
    return res
      .status(500)
      .send(layout('Error', '<h1>Something went wrong</h1><p><a href="/">Back</a></p>'));
  }

  res.status(status).send(landingPage({ error: error.message }));
}
