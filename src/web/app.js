import express from 'express';

import { pool, withTransaction } from '../db/pool.js';
import { isDatabaseUnreachable } from '../db/errors.js';
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
import { dispatchExpedition } from '../services/dispatch-expedition.js';
import { startBuild } from '../services/start-build.js';
import { startCraft } from '../services/start-craft.js';
import { startUpgrade } from '../services/start-upgrade.js';
import { tradeWithCaravan } from '../services/trade.js';
import { viewCamp } from '../services/view-camp.js';
import { viewGraveyard } from '../services/view-graveyard.js';
import { campPage, graveyardPage, landingPage, layout, escape } from './render.js';

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

  app.get('/graveyard', requireAuth, async (req, res) => {
    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');
      // No tick: the dead do not change, so there is nothing to bring up to date.
      return viewGraveyard(client, settlementId);
    });

    res.send(graveyardPage(view));
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

  app.post('/expedition', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first: if the survivor starved an hour ago, they cannot be sent
      // anywhere, and the tick is what establishes that.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await dispatchExpedition(client, settlementId, req.body.region, now);
    });

    res.redirect('/camp');
  });

  app.post('/build', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first so the scrap being spent is the current balance, and so a
      // build that just finished frees the queue before this one is refused.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await startBuild(client, settlementId, req.body.kind, now);
    });

    res.redirect('/camp');
  });

  app.post('/upgrade', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first, as with builds: the fuel being spent must be the current
      // balance, and a fitting that just finished has to free the crew first.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await startUpgrade(client, settlementId, req.body.upgrade, now);
    });

    res.redirect('/camp');
  });

  app.post('/trade', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first: "is the caravan still here" is a question about the current
      // instant, and a stale clock would let a player trade through a closed window.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await tradeWithCaravan(
        client,
        settlementId,
        { faction: req.body.faction, offer: req.body.offer },
        now,
      );
    });

    res.redirect('/camp');
  });

  app.post('/craft', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first, as with builds: the stores and the pack being spent must be
      // the current ones, and an order that just came off the bench has to free it
      // before this one is refused.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await startCraft(client, settlementId, req.body.recipe, now);
    });

    res.redirect('/camp');
  });

  app.use((req, res) => {
    res.status(404).send(layout('Not found', '<h1>Nothing here</h1><p><a href="/">Back</a></p>'));
  });

  app.use(errorHandler);

  return app;
}

/**
 * Render a user error back onto the page they were on.
 *
 * A logged-in player who cannot afford a build must land back at their camp with the
 * reason, not at a login form — showing someone a login form while they are already
 * logged in reads as being signed out, which is a worse bug than the one they hit.
 */
async function renderErrorForPlayer(req, res, message) {
  if (!req.playerId) {
    return res.status(400).send(landingPage({ error: message }));
  }

  try {
    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) return null;
      return viewCamp(client, settlementId, Date.now());
    });

    if (view) return res.status(400).send(campPage(view, { error: message }));
  } catch (error) {
    // The camp could not be rendered; fall through rather than masking the original
    // problem with a second one.
    console.error('could not render camp for error page', error);
  }

  return res
    .status(400)
    .send(layout('Not possible', `<p class="error">${escape(message)}</p>
      <p><a href="/camp">Back to camp</a></p>`));
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

function errorHandler(error, req, res, next) {
  if (isDatabaseUnreachable(error)) {
    console.error('database unreachable — is the container up? `npm run db:up`');
    return res.status(503).send(
      layout(
        'Database unreachable',
        `<h1>The database is not answering</h1>
         <p>Postgres runs in a container inside WSL. If WSL has shut down, bring it
            back with <code>npm run db:up</code> and reload.</p>`,
      ),
    );
  }

  const status = error.status ?? 500;

  if (status >= 500) {
    console.error(error);
    return res
      .status(500)
      .send(layout('Error', '<h1>Something went wrong</h1><p><a href="/">Back</a></p>'));
  }

  renderErrorForPlayer(req, res, error.message).catch(next);
}
