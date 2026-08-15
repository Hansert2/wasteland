import test from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../../src/web/app.js';
import { pool } from '../../src/db/pool.js';

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

test.before(async () => {
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
    body: new URLSearchParams({ name: 'Vera' }),
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
  assert.match(html, /Move in/);
  assert.doesNotMatch(html, /spoiled or been taken/, 'nothing has gone to ruin yet');
});

test('the first survivor moves in through the same door as every successor', async () => {
  const { cookie } = await registerAndMoveIn();

  const html = await (await fetch(`${base}/camp`, { headers: { cookie } })).text();
  assert.match(html, /Vera/);
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
