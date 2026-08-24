import express from 'express';

import { pool, withTransaction } from '../db/pool.js';
import { isDatabaseUnreachable } from '../db/errors.js';
import { settlementIdForPlayer } from '../db/world.js';
import { verifyLogin } from '../auth/passwords.js';
import {
  SESSION_COOKIE,
  createSession,
  destroySession,
  findSession,
} from '../auth/sessions.js';
import { foundSettlement, raiseSuccessor, InputError } from '../services/settlement-lifecycle.js';
import { advanceSettlement } from '../services/advance-settlement.js';
import { answerMoment } from '../services/answer-moment.js';
import { dispatchExpedition } from '../services/dispatch-expedition.js';
import { startBuild } from '../services/start-build.js';
import { startCraft } from '../services/start-craft.js';
import { startUpgrade } from '../services/start-upgrade.js';
import { commitToRoad } from '../services/commit-to-road.js';
import { tradeWithCaravan } from '../services/trade.js';
import { viewCamp } from '../services/view-camp.js';
import { viewGraveyard } from '../services/view-graveyard.js';
import { campPage, graveyardPage, landingPage, layout, escape } from './render.js';
import { addressKey, credentialKey, rateLimit } from './rate-limit.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');

  // Off unless told otherwise, and that is the safe default rather than a shrug:
  // trusting X-Forwarded-For when nothing sets it lets any caller claim any address
  // and walk straight through the rate limiter. Set TRUST_PROXY to the number of
  // proxies in front of this app — 1 behind a single reverse proxy — and leave it
  // unset when the process is reachable directly.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
  }

  // Ahead of everything else on purpose: a readiness probe should not parse a body,
  // read a cookie or cost a session lookup, and it must answer while the app is too
  // broken to serve a page. The one thing it does check is the thing that actually
  // fails — whether Postgres is reachable — because an app that cannot reach its
  // database has nothing to offer and should be taken out of rotation.
  app.get('/health', async (req, res) => {
    try {
      await pool.query('select 1');
      res.json({ status: 'ok' });
    } catch (error) {
      res.status(503).json({ status: 'no database', error: error.code ?? 'unknown' });
    }
  });

  // Bodies here are short forms; a small cap keeps a stray large POST cheap to reject.
  // Ahead of the body parser: a request that is refused for where it came from should
  // not have its body read first, and this check needs nothing out of it.
  app.use(sameOrigin);
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(readCookies);
  app.use(loadSession);

  // Credential endpoints only. Everything else is behind a session cookie, and a
  // logged-in player hammering their own camp page costs a tick they already own.
  //
  // Two of them, because logging in and signing up are attacked differently. At a login
  // the account already exists, so counting the address *and* the account limits the
  // guessing without letting one caller lock a stranger out of their own camp. At a
  // registration the caller invents the account, so that same key is no limit at all —
  // a new address in the form is a new bucket. See `addressKey`.
  const credentialLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: credentialKey,
    message: 'Too many attempts for that account. Wait a few minutes and try again.',
  });

  // An hour rather than fifteen minutes, and five rather than ten, because this one
  // counts a whole address: a household or an office behind one of them shares the
  // allowance, and five camps in an hour from one address is already more than this
  // game has ever needed.
  const registerLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    key: addressKey,
    message: 'Too many camps founded from here. Wait an hour and try again.',
  });

  app.get('/', (req, res) => {
    if (req.playerId) return res.redirect('/camp');
    res.send(landingPage());
  });

  app.post('/register', registerLimit, async (req, res) => {
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

  app.post('/login', credentialLimit, async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();

    const { rows } = await pool.query(
      'select id, password_hash from players where lower(email) = $1',
      [email],
    );
    const player = rows[0];

    // A missing account and a wrong password take the same time and give the same
    // answer, which `verifyLogin` is responsible for rather than this line: passing a
    // placeholder from here is what went wrong before, because '' is not a hash and
    // verification returned without doing any work.
    const ok = await verifyLogin(String(req.body.password ?? ''), player?.password_hash);
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
      // No name from the form: who turns up is the camp's business, not the player's.
      await raiseSuccessor(client, settlementId, { now });
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

  app.post('/road', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first, as with every other spend: the fuel going up the road has to be
      // the balance as of now, not as of whenever the page was last drawn.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await commitToRoad(client, settlementId, req.body.fuel, now);
    });

    res.redirect('/camp');
  });

  app.post('/moment', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first, for the same reason trading does: "is that window still open" is
      // a question about the current instant. Unlike a caravan, a moment's window closes
      // on its own while the page sits there, so a stale answer is the ordinary case
      // rather than an edge one.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await answerMoment(
        client,
        settlementId,
        { index: req.body.index, option: req.body.option },
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
async function renderErrorForPlayer(req, res, message, status = 400) {
  if (!req.playerId) {
    return res.status(status).send(landingPage({ error: message }));
  }

  try {
    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) return null;
      return viewCamp(client, settlementId, Date.now());
    });

    if (view) return res.status(status).send(campPage(view, { error: message }));
  } catch (error) {
    // The camp could not be rendered; fall through rather than masking the original
    // problem with a second one.
    console.error('could not render camp for error page', error);
  }

  return res
    .status(status)
    .send(layout('Not possible', `<p class="error">${escape(message)}</p>
      <p><a href="/camp">Back to camp</a></p>`));
}

/**
 * Refuse a state-changing request that says it came from somewhere else.
 *
 * `SameSite=Strict` was carrying this on its own, and it is scoped to the registrable
 * site rather than to the origin — so a page on an untrusted sibling subdomain is
 * same-site, and its forged post arrives with the session cookie attached. Raised in
 * review on 2026-08-24, where the comment on the cookie claimed a stronger guarantee
 * than the setting gives.
 *
 * The rule is deliberately "refuse a mismatch" rather than "require a match":
 *
 * - **A browser doing CSRF always sends `Origin` on a POST**, and it names the attacking
 *   page rather than this site, so a mismatch is the whole of the attack and refusing it
 *   is the whole of the defence.
 * - **A missing `Origin` is not evidence of anything.** `fetch` from a script, curl, and
 *   the test suite all omit it, and none of them are riding a session they did not earn
 *   — a cross-site attack needs the browser to attach the cookie, and a browser attaches
 *   the header at the same time. Requiring it would refuse every non-browser caller to
 *   defend against a case that cannot arise, so those fall back to SameSite as before.
 *
 * `ORIGIN` pins the expected value where the deployment knows it. Without it the check
 * compares against the request's own host, which is what the browser resolved to get
 * here — enough to tell this site from another one, and the reason `trust proxy` has to
 * be set correctly for `req.protocol` to be true behind the tunnel.
 */
function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origin = req.get('origin');
  if (!origin) return next();

  // `||`, not `??`, and the difference is a deployment away rather than academic.
  // `docker-compose.prod.yml` passes `ORIGIN: ${ORIGIN:-}`, so a stack brought up
  // without one in `.env.prod` hands this an empty string rather than nothing at all —
  // and `??` only falls back on null. The expected origin would have been '', which
  // matches nothing, and every POST including login would have been refused.
  const expected = process.env.ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin === expected) return next();

  // The same shape as every other refusal: an error the app's handler renders, rather
  // than a bare status nobody has written a page for.
  const error = new Error('That request did not come from this camp.');
  error.status = 403;
  return next(error);
}

/** Minimal cookie parsing — one small function is cheaper than a dependency. */
function readCookies(req, _res, next) {
  const cookies = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = decodeCookie(part.slice(eq + 1).trim());
  }
  req.cookies = cookies;
  next();
}

/**
 * A cookie value, decoded where it can be and left alone where it cannot.
 *
 * `decodeURIComponent` throws on invalid percent-encoding, and this runs in middleware
 * ahead of authentication — so before this, one byte of nonsense in a `Cookie` header
 * was a 500 on any route, from anybody, without a session. Found in review on
 * 2026-08-24.
 *
 * Undecoded rather than dropped, because the two answers differ for a value that was
 * never encoded in the first place and dropping one would be inventing an absence. It
 * costs nothing here either way: a session token is `base64url`, which has no percent
 * in it, so a value this branch returns is one no session will ever match — and an
 * unmatched token is already handled as no session at all.
 */
function decodeCookie(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
    /*
     * Strict, and it is most of the CSRF story rather than all of it. A cross-site form
     * post arrives without this cookie, so it arrives as a stranger and is refused.
     *
     * What it is not, and the comment here used to claim it was: a guarantee that every
     * state-changing POST is same-*origin*. SameSite is scoped to the registrable site,
     * so a page on any sibling subdomain is same-site and its posts carry this cookie.
     * That is not hypothetical here. This deploys to a subdomain, so the registrable
     * site is shared with every other host under it, and SameSite will call all of them
     * same-site — one of them with an XSS in it, or one nobody is watching, is a post to
     * this game carrying this cookie. `sameOrigin` above is what actually closes that,
     * by checking the header rather than trusting the shape of the DNS.
     */
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

  // Status carried through rather than flattened to 400: a rate-limited caller
  // must see a 429, or the Retry-After header above it is a lie.
  renderErrorForPlayer(req, res, error.message, status).catch(next);
}
