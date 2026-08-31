import { fileURLToPath } from 'node:url';

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
import { setCampClock } from '../services/set-camp-clock.js';
import { useItem } from '../services/use-item.js';
import { takeInWanderer } from '../services/take-in-wanderer.js';
import { startUpgrade } from '../services/start-upgrade.js';
import { commitToRoad } from '../services/commit-to-road.js';
import { tradeWithCaravan } from '../services/trade.js';
import { viewCamp } from '../services/view-camp.js';
import { viewGraveyard } from '../services/view-graveyard.js';
import { campPage, graveyardPage, landingPage, layout, escape, PANE_NAMES } from './render.js';
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

  /*
   * The region plates, and the only static files this app has.
   *
   * Ahead of the session middleware deliberately: a picture of a place is not a secret,
   * and making every one of them cost a cookie read and a session lookup would be a
   * database round trip per image. `fallthrough: false` so a slug with no plate is a
   * plain 404 rather than dropping through to the page router and answering an image
   * request with a login page.
   *
   * An hour of cache with etags, not a year: the filenames are slugs rather than
   * content hashes, so a replaced plate has to be able to reach people who have already
   * seen the old one.
   */
  app.use(
    '/img',
    express.static(fileURLToPath(new URL('../../public/img', import.meta.url)), {
      maxAge: '1h',
      fallthrough: false,
      index: false,
      redirect: false,
    }),
  );

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
    /*
     * The second copy of the password, and why a form this small has one.
     *
     * Nothing in this game can reset a password. A typo at the gate does not cost a
     * second attempt at logging in — it permanently destroys a camp that has not been
     * founded yet and will accumulate weeks of history nobody can get back. That is a
     * bad enough failure to be worth a field that modern advice is against.
     *
     * It catches a typo in one box and not a typo made identically in both, which is
     * the honest limit of the technique. **The real fix is password recovery, and this
     * comes out the day that lands.**
     *
     * Checked here rather than in `foundSettlement` because a repeated password is a
     * property of this form and not of founding a camp: the service takes one password,
     * and the tools and tests that call it directly have no business supplying two.
     */
    if (String(req.body.password ?? '') !== String(req.body.passwordAgain ?? '')) {
      throw new InputError('Those passwords do not match.');
    }

    /*
     * The camp's clock, from the browser that founded it.
     *
     * Clamped rather than validated, and defaulted rather than required: this decides
     * what hour a page prints, not what the camp may do, so a missing or absurd value
     * should land the camp at Greenwich rather than refuse to found it. Fourteen hours
     * either side covers every real offset with room to spare.
     */
    const clockOffset = Math.max(
      -840,
      Math.min(840, Math.trunc(Number(req.body.clockOffset)) || 0),
    );

    /*
     * And where the sun sits against it, which the offset cannot say — Madrid and
     * Warsaw share CEST and their solar noons are ninety-nine minutes apart. Passed
     * raw; `zones.js` validates the shape and answers `null` for anything it does not
     * recognise, which lands the camp on the idealised sky rather than a wrong one.
     */
    const zone = String(req.body.timeZone ?? '').slice(0, 64);

    const { playerId } = await withTransaction((client) =>
      foundSettlement(client, {
        email: req.body.email,
        password: req.body.password,
        settlementName: req.body.settlementName,
        clockOffset,
        zone,
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

  /**
   * The camp, and the four views of it.
   *
   * One handler and one render: every view sends the same sections in the same order
   * and differs only in which of them the CSS reveals. That is not a shortcut — it is
   * what keeps `docs/DESIGN-BRIEF.md` §7.3's two constraints satisfied for free. The
   * client script fetches `location.pathname`, so an expiring countdown comes back to
   * the view the player is on rather than dumping them on Camp; and every timer on the
   * page is armed whichever view is showing, so a build finishing while somebody reads
   * Trade still fetches and still swaps.
   *
   * An unknown pane falls through to the 404 rather than being coerced to Camp, so a
   * typo in a link is visible instead of silently landing somewhere plausible.
   */
  const showCamp = (pane) => async (req, res) => {
    // Which day the glass is showing, as an offset from today. A query parameter rather
    // than a path because it is a reading of one block and not a view of its own: the
    // rail's active marker still has exactly one thing to be right about, and a link to
    // `/camp` is still a link to today. Nonsense is clamped rather than refused — this
    // decides what a chart draws, not what the camp does.
    const day = Number.parseInt(req.query?.day, 10) || 0;

    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');
      return viewCamp(client, settlementId, Date.now(), { day });
    });

    res.send(campPage(view, { pane }));
  };

  // One route per view rather than one route with a parameter, so an unknown view is a
  // 404 by not matching rather than by being checked — and so `/camp/camp` is not a
  // second address for the default. One view, one URL, or the rail's active marker has
  // two things to be right about.
  app.get('/camp', requireAuth, showCamp('camp'));
  for (const pane of PANE_NAMES.filter((name) => name !== 'camp')) {
    app.get(`/camp/${pane}`, requireAuth, showCamp(pane));
  }

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

    res.redirect(backToCamp(req));
  });

  app.post('/gate', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      /*
       * Advance first, as every verb that spends something does. Here what is being spent is
       * a bed, and a bed can stop being free while the page sits there — a survivor comes
       * home, or another tab takes somebody in. The service checks the ceiling again for the
       * same reason the moment options do: the page is a render of a moment ago.
       */
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await takeInWanderer(client, settlementId, { now });
    });

    res.redirect(backToCamp(req));
  });

  app.post('/expedition', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first: if the survivor starved an hour ago, they cannot be sent
      // anywhere, and the tick is what establishes that.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      // Who goes, from the selector above the dispatch table. Absent means the first free
      // survivor, which is what every caller meant before there was a roster to choose from.
      await dispatchExpedition(client, settlementId, req.body.region, now, req.body.who || null);
    });

    res.redirect(backToCamp(req));
  });

  app.post('/build', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first so the scrap being spent is the current balance, and so a
      // build that just finished frees the queue before this one is refused.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await startBuild(client, settlementId, req.body.kind, now, req.body.who || null);
    });

    res.redirect(backToCamp(req));
  });

  app.post('/upgrade', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      // Advance first, as with builds: the fuel being spent must be the current
      // balance, and a fitting that just finished has to free the crew first.
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await startUpgrade(client, settlementId, req.body.upgrade, now, req.body.who || null);
    });

    res.redirect(backToCamp(req));
  });

  app.post('/clock', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      /*
       * No `advanceSettlement` first, unlike the routes around it. Those spend or free
       * resources and need the balance current; this touches nothing the simulation reads
       * mid-flight, because a trip already out carries its own sky (migration 017). Ticking
       * here would only mean the clock change and the tick disagreed about which sky the
       * moment between them belonged to.
       */
      await setCampClock(client, settlementId, {
        zone: req.body.zone,
        now: Date.now(),
      });
    });

    res.redirect(backToCamp(req));
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

    res.redirect(backToCamp(req));
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

    res.redirect(backToCamp(req));
  });

  app.post('/use', requireAuth, async (req, res) => {
    await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) throw new InputError('This account has no camp.');

      /*
       * Advance first, as every spend does. It matters more here than most: the gauges this
       * acts on are the two the tick moves every slice, and a trip in flight is adding to
       * one of them as the page sits there. Taking a tablet against the dose the page was
       * drawn with would scrub a number that had already moved.
       */
      const now = Date.now();
      await advanceSettlement(client, settlementId, now);
      await useItem(client, settlementId, req.body.slug);
    });

    res.redirect(backToCamp(req));
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

    res.redirect(backToCamp(req));
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
      await startCraft(client, settlementId, req.body.recipe, now, req.body.who || null);
    });

    res.redirect(backToCamp(req));
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
/**
 * Which view a camp action returns to.
 *
 * Only reached without JavaScript: a form inside a section posts by `fetch` and the
 * response is applied in place, so the ordinary path never navigates and never sees
 * this. The fallback path does, and dropping somebody on Camp because they bought
 * something on Trade is the tab hazard `docs/DESIGN-BRIEF.md` §7.3 names.
 *
 * The referer is matched against the known paths and anything else becomes `/camp`,
 * which is the whole of the safety argument: this only ever emits a string from a
 * fixed list, so a crafted header cannot turn a redirect into somewhere else.
 */
function backToCamp(req) {
  const paths = new Set(['/camp', ...PANE_NAMES.map((pane) => `/camp/${pane}`)]);

  try {
    const { pathname } = new URL(req.get('referer') ?? '', 'http://camp.invalid');
    if (paths.has(pathname)) return pathname;
  } catch {
    // A referer that is not a URL is not a view; fall through to the default.
  }

  return '/camp';
}

/**
 * The pane a request was made from, so an error renders onto the page the player is
 * actually looking at rather than onto Camp.
 */
function paneOf(req) {
  // A GET knows its own view from the path it was asked for. A POST does not — it goes
  // to `/trade` or `/build` from wherever the player was — so it asks the referer the
  // same way the redirect does.
  const path = req.path?.startsWith('/camp') ? req.path : backToCamp(req);
  const pane = path.replace(/^\/camp\/?/, '');
  return PANE_NAMES.includes(pane) ? pane : 'camp';
}

async function renderErrorForPlayer(req, res, message, status = 400) {
  if (!req.playerId) {
    // Which of the gate's two doors complained. Without this a refused registration
    // renders the reason above a collapsed panel — the message would be about a form
    // the player can no longer see.
    return res.status(status).send(
      landingPage({ error: message, signUp: req.path === '/register' }),
    );
  }

  try {
    const view = await withTransaction(async (client) => {
      const settlementId = await settlementIdForPlayer(client, req.playerId);
      if (!settlementId) return null;
      return viewCamp(client, settlementId, Date.now());
    });

    if (view) {
      return res.status(status).send(campPage(view, { error: message, pane: paneOf(req) }));
    }
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
