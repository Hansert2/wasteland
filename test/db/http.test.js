import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/web/app.js';
import { pool } from '../../src/db/pool.js';
import { WANDERERS } from '../../src/game/wanderers.js';

/**
 * A real server on a real port against the real database.
 *
 * These cannot use the rollback isolation the other suites use, because the app takes
 * its own connections from the pool and commits — which is precisely the point, since
 * it is the wiring between cookie, transaction and render that is under test here.
 * Accounts are created with throwaway emails and deleted afterwards.
 */
const uniq = () => Math.random().toString(36).slice(2, 10);

let server;
let base;
const createdEmails = [];

/**
 * A different caller each time somebody signs up.
 *
 * Registration is limited by address alone — it has to be, because the caller chooses
 * the email and any key including it hands out a fresh bucket per request. A suite that
 * founds a dozen camps down one socket is one caller by that measure, and would spend
 * the whole allowance on itself.
 *
 * So the helper below says who it is, using the app's own mechanism for that: the
 * TRUST_PROXY switch and an X-Forwarded-For header. Deliberately not by loosening the
 * limit — a security control tuned until the tests pass is a control set by the tests.
 * TEST-NET-3, which exists for exactly this and is routable nowhere.
 */
let caller = 0;
const nextCaller = () => `203.0.113.${(caller++ % 250) + 1}`;

test.before(async () => {
  process.env.TRUST_PROXY = '1';
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (createdEmails.length > 0) {
    await pool.query('delete from players where lower(email) = any($1)', [createdEmails]);
  }
  await pool.end();
});

/** @returns {Promise<{email: string, cookie: string}>} */
async function register(overrides = {}) {
  const email = `${uniq()}@example.test`;
  createdEmails.push(email);

  const response = await fetch(`${base}/register`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'x-forwarded-for': nextCaller() },
    body: new URLSearchParams({
      email,
      password: 'correct horse battery staple',
      settlementName: 'Testcamp',
      ...overrides,
    }),
  });

  return { email, response, cookie: sessionCookie(response) };
}

/**
 * Registration founds a camp and stops there, so most tests need somebody to move in
 * before the camp can do anything. This is the same POST the page offers.
 */
async function registerAndMoveIn(overrides = {}) {
  const registered = await register(overrides);

  await fetch(`${base}/successor`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: registered.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    // No name to post: the camp gets whoever is at the gate.
    body: new URLSearchParams({}),
  });

  return registered;
}

function sessionCookie(response) {
  const header = response.headers.getSetCookie()[0] ?? '';
  return header.split(';')[0];
}

test('registering founds a camp and logs you straight into it', async () => {
  const { response, cookie } = await register();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/camp');
  assert.ok(cookie.startsWith('wasteland_session='), 'a session cookie was issued');

  const camp = await fetch(`${base}/camp`, { headers: { cookie } });
  assert.equal(camp.status, 200);

  const html = await camp.text();
  assert.match(html, /Testcamp/, 'the camp is yours');
  assert.match(html, /Stores/, 'and it is a real camp');

  // The account owns the camp and never a person, so nobody is in it yet — and the
  // page asks who is moving in rather than inventing someone.
  assert.match(html, /camp stands empty/i);
  assert.match(html, /Let them stay/);
  assert.doesNotMatch(html, /spoiled or been taken/, 'nothing has gone to ruin yet');
});

test('the first survivor moves in through the same door as every successor', async () => {
  const { cookie } = await registerAndMoveIn();

  const html = await (await fetch(`${base}/camp`, { headers: { cookie } })).text();

  // Whoever walked in — the camp gets one of the seven and the player names nobody.
  assert.ok(
    WANDERERS.some((w) => html.includes(w.name)),
    'the page names the wanderer who took the camp on',
  );
  assert.match(html, /Health/);
  assert.doesNotMatch(html, /camp stands empty/i);
});

test('the session cookie is httpOnly and same-site strict', async () => {
  const { response } = await register();
  const header = response.headers.getSetCookie()[0];

  // Script-readable or cross-site-sendable would each undo the reason it exists.
  assert.match(header, /HttpOnly/i);
  assert.match(header, /SameSite=Strict/i);
});

test('health answers without a session, a cookie or a body', async () => {
  // What a load balancer polls. It must answer while the app is too broken to serve
  // a page, and must not cost a session lookup on every probe.
  const health = await fetch(`${base}/health`);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('set-cookie'), null, 'a probe is not a visitor');
});

test('the camp is not visible without a session', async () => {
  const camp = await fetch(`${base}/camp`, { redirect: 'manual' });

  assert.equal(camp.status, 302);
  assert.equal(camp.headers.get('location'), '/');
});

test('another account cannot be founded on the same email', async () => {
  const { email } = await register();

  const duplicate = await fetch(`${base}/register`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ email, password: 'correct horse battery staple' }),
  });

  assert.equal(duplicate.status, 400);
  assert.match(await duplicate.text(), /already registered/i);
});

test('logging in with the wrong password gives nothing away', async () => {
  // The response half of "nothing away". The timing half was missing until 2026-08-24 —
  // a missing account skipped scrypt entirely and answered in a thousandth of the time,
  // so the two were trivially distinguishable however identical the page was. That half
  // is pinned in `test/unit/passwords.test.js`, where the cost can be asserted without
  // a wall clock; this one stays about what the caller is told.
  const { email } = await register();

  const wrongPassword = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ email, password: 'not the password' }),
  });
  const noSuchAccount = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ email: 'nobody@example.test', password: 'not the password' }),
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchAccount.status, 401);
  assert.equal(
    await wrongPassword.text(),
    await noSuchAccount.text(),
    'a wrong password and a missing account are indistinguishable',
  );
});

test('logging out revokes the session server-side, not just in the browser', async () => {
  const { cookie } = await register();

  await fetch(`${base}/logout`, { method: 'POST', redirect: 'manual', headers: { cookie } });

  // Replaying the old cookie must fail: the row is gone, so the token is worthless
  // even though the client still holds it.
  const replay = await fetch(`${base}/camp`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(replay.status, 302);
  assert.equal(replay.headers.get('location'), '/');
});

test('grinding a password list is refused, and the account still works from elsewhere', async () => {
  const { email } = await register();
  const wrong = () =>
    fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      body: new URLSearchParams({ email, password: 'not the password' }),
    });

  // Ten in the window are allowed; the eleventh is not.
  let last;
  for (let i = 0; i < 11; i++) last = await wrong();

  assert.equal(last.status, 429, 'the grinder is stopped');
  assert.ok(Number(last.headers.get('retry-after')) > 0, 'and told when to come back');
  assert.match(await last.text(), /Too many attempts/i);

  // The limiter keys on address *and* account, so a different account from the same
  // address is unaffected — being attacked must not lock out the rest of the site.
  const other = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ email: 'someone-else@example.test', password: 'whatever' }),
  });
  assert.equal(other.status, 401, 'a different door is still answered');
});

test('founding camps in a row is refused, whatever address is typed into the form', async () => {
  /*
   * Both credential routes shared one limiter until 2026-08-24, and its key is the
   * caller's address *and* the account. That is right for logging in and useless for
   * signing up, where the caller invents the account: a new email is a new bucket, and
   * every accepted request pays a full scrypt and writes a player, a settlement, its
   * structures and its stores — not a survivor, who arrives later through the same door
   * every successor uses. The unit tests pin the key; this pins the route using it.
   */
  const from = '203.0.113.251'; // outside the range `nextCaller` hands out
  const founded = async () => {
    const email = `${uniq()}@example.test`;
    createdEmails.push(email);
    return fetch(`${base}/register`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'x-forwarded-for': from },
      body: new URLSearchParams({
        email,
        password: 'correct horse battery staple',
        settlementName: 'Testcamp',
      }),
    });
  };

  // Five in the window are allowed, each with an address nobody has used before.
  let last;
  for (let i = 0; i < 6; i += 1) last = await founded();

  assert.equal(last.status, 429, 'the sixth camp from one caller is refused');
  assert.ok(Number(last.headers.get('retry-after')) > 0, 'and told when to come back');
  assert.match(await last.text(), /Too many camps/i);
});

test('a malformed cookie is not a 500, and does not need a session to send', async () => {
  // `decodeURIComponent` throws on invalid percent-encoding, and cookie parsing runs in
  // middleware ahead of authentication — so one byte of nonsense in the header was an
  // unauthenticated 500 on any route. Found in review on 2026-08-24.
  for (const cookie of ['wl_session=%', 'wl_session=%zz', 'a=%E0%A4%A', 'x=%; y=fine']) {
    const response = await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' });
    assert.ok(response.status < 500, `${cookie} answered ${response.status}`);
  }
});

test('a forged session token is not accepted', async () => {
  const camp = await fetch(`${base}/camp`, {
    headers: { cookie: 'wasteland_session=totally-made-up' },
    redirect: 'manual',
  });

  assert.equal(camp.status, 302);
});

test('a refused action returns you to your camp, not to a login form', async () => {
  const { cookie, email } = await registerAndMoveIn();

  // A fresh camp used to be too poor for any build at all, which made this easy to
  // set up. Since the pacing rescale its ten scrap covers the first few levels, so
  // the camp has to be emptied deliberately to get a refusal to test.
  await pool.query(
    `update resources set amount = 0
      where kind = 'scrap' and settlement_id in (
        select s.id from settlements s join players p on p.id = s.player_id
         where lower(p.email) = $1)`,
    [email],
  );

  const refused = await fetch(`${base}/build`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ kind: 'workshop' }),
  });

  assert.equal(refused.status, 400);
  const html = await refused.text();

  assert.match(html, /Not enough scrap/, 'says why');
  assert.match(html, /Testcamp/, 'still shows the camp');
  assert.match(html, /Stores/, 'with its state intact');
  // The original bug: a logged-in player was shown a login form, which reads as
  // having been signed out.
  assert.doesNotMatch(html, /Found a new camp/, 'no registration form');
  assert.doesNotMatch(html, /name="password"/, 'no password field');
});

test('a refused expedition behaves the same way', async () => {
  const { cookie } = await registerAndMoveIn();

  const refused = await fetch(`${base}/expedition`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ region: 'nowhere_at_all' }),
  });

  assert.equal(refused.status, 400);
  const html = await refused.text();
  assert.match(html, /no such place/i);
  assert.doesNotMatch(html, /name="password"/);
});

test('a logged-out visitor still gets the login page on a bad request', async () => {
  const refused = await fetch(`${base}/register`, {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ email: 'not-an-email', password: 'correct horse battery' }),
  });

  assert.equal(refused.status, 400);
  assert.match(await refused.text(), /Found a new camp/, 'landing page is right when signed out');
});

test('camp names are escaped rather than rendered as markup', async () => {
  const { cookie } = await register({ settlementName: '<script>alert(1)</script>' });

  const html = await (await fetch(`${base}/camp`, { headers: { cookie } })).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});
