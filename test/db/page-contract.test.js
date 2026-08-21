import test from 'node:test';
import assert from 'node:assert/strict';

import { pool } from '../../src/db/pool.js';
import { buildStates } from '../../tools/page-states.mjs';
import { clock } from '../../src/web/render.js';

/**
 * The contract a redesign must not drop, asserted rather than described.
 *
 * `docs/PLAN.md` has carried a section called *The page contract, and what a redesign
 * must not drop* since before there was anything to redesign, and it ends by asking for
 * exactly this file: *"a redesign that hand-rolls markup and drops an attribute… One
 * test closes it."*
 *
 * **Every failure this guards against is silent.** The client script finds its work by
 * querying for data attributes. Render a deadline as its own markup — perfectly
 * reasonable-looking HTML — and the script stops finding it, the page sits on *now*
 * forever, and the game appears to have stopped with nothing erroring and nothing in a
 * log. There is no runtime complaint to notice and no user-visible error to report.
 *
 * Run against every state in `tools/page-states.mjs` rather than one fixture, because
 * the attributes live in blocks that only exist sometimes: the hidden timer that makes a
 * Contact box arrive by itself is in the Away report, and the Away report is only there
 * while somebody is out.
 */
let STATES;

test('build every page state once', async () => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    STATES = await buildStates(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
  assert.ok(Object.keys(STATES).length >= 6, 'the states worth checking are all built');
});

test('a page with a deadline on it is a page the script can swap', async () => {
  // The graveyard has no sections, and that is correct rather than an oversight: it is
  // static, it carries no countdown, and `apply()` treats a response with no sections as
  // a real navigation and falls back to a reload. Harmless for a page that never
  // changes under you.
  //
  // **What must never happen is the combination.** A deadline on an unsectioned page
  // arms a timer whose expiry fetches a document the swap cannot use, so every tick
  // throws the whole page away and reloads it — which on the camp page would mean losing
  // scroll position and any view state every time a build finished.
  for (const [name, html] of Object.entries(STATES)) {
    const sections = [...html.matchAll(/<section id="(s-[a-z]+)">/g)].map((m) => m[1]);
    const deadlines = [...html.matchAll(/data-until="\d+"/g)].length;

    assert.equal(new Set(sections).size, sections.length, `${name}: a duplicated section id`);
    assert.ok(
      sections.length > 0 || deadlines === 0,
      `${name}: ${deadlines} deadlines on a page with no sections to swap`,
    );
  }
});

test('the camp page renders every block, including the ones with nothing to say', async () => {
  // The swap matches ids in the response against ids in the document, so a block that
  // renders nothing must still render its wrapper — or a caravan arriving mid-visit has
  // nowhere to appear and simply never shows up until the player reloads.
  const always = [
    's-head', 's-error', 's-moment', 's-raid', 's-sky', 's-events', 's-survivor',
    's-inventory', 's-direction', 's-expedition', 's-stores', 's-structures', 's-road',
    's-workshop', 's-caravan', 's-post', 's-standings', 's-roster',
  ];

  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'graveyard') continue;
    for (const id of always) {
      assert.ok(html.includes(`<section id="${id}">`), `${name}: ${id} is missing entirely`);
    }
  }
});

test('every deadline on the page is a live countdown, not rendered text', async () => {
  // The one that turns the silent failure loud. A hand-rolled timer — a formatted string
  // where countdown() used to be — passes every other test in this suite.
  let armed = 0;

  for (const [name, html] of Object.entries(STATES)) {
    for (const match of html.matchAll(/data-until="(\d+)"/g)) {
      armed += 1;
      const at = Number(match[1]);
      assert.ok(Number.isFinite(at) && at > 0, `${name}: data-until is not an instant`);
    }

    // Both halves or neither: the script writes data-done into the element when the
    // timer expires, and an element without one goes blank at zero.
    const untils = [...html.matchAll(/data-until="\d+"/g)].length;
    const dones = [...html.matchAll(/data-done="[^"]*"/g)].length;
    assert.equal(untils, dones, `${name}: ${untils} timers but ${dones} carry data-done`);
  }

  assert.ok(armed > 0, 'no state on this page has a deadline, which cannot be right');
});

test('a trip with a window still ahead arms a timer nothing can see', async () => {
  // The most deletable thing on the page: a hidden span with no text, in the Away
  // block, whose entire job is to fetch fresh state at the instant a Contact box
  // becomes answerable. Remove it and the box only appears if the player reloads.
  const away = STATES.away;
  assert.match(away, /<span hidden><span data-until="\d+"/, 'the moment alarm is armed');
});

test('every store carries the three attributes that let it climb between loads', async () => {
  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'graveyard') continue;

    const amounts = [...html.matchAll(/data-amount="[^"]*"/g)].length;
    assert.ok(amounts >= 4, `${name}: ${amounts} stores, expected at least four`);

    for (const attr of ['data-rate', 'data-cap']) {
      assert.equal(
        [...html.matchAll(new RegExp(`${attr}="[^"]*"`, 'g'))].length,
        amounts,
        `${name}: ${attr} does not appear on every store`,
      );
    }
  }
});

test('the browser and the server format a duration with the same function', async () => {
  // clock() is interpolated into the client script rather than copied, and that is only
  // safe while it closes over nothing. A redesign that reaches for a helper from the
  // module scope inside it would produce a page that throws on its first tick.
  const isolated = new Function(`return (${clock.toString()});`)();

  for (const seconds of [0, 1, 59, 60, 3599, 3600, 86399, 86400, 172800]) {
    assert.equal(isolated(seconds), clock(seconds), `clock(${seconds}) needs its scope`);
  }
});

test('nothing interpolated into the page escapes its quotes', async () => {
  // Content is authored prose full of apostrophes, and every one of them passes through
  // escape() on the way to an attribute. A redesign that adds an attribute carrying
  // content without it produces markup that breaks on a wanderer called Nim.
  for (const [name, html] of Object.entries(STATES)) {
    const attrs = [...html.matchAll(/\s[a-z-]+="([^"]*)"/g)].map((m) => m[1]);
    for (const value of attrs) {
      assert.ok(!value.includes('<'), `${name}: a raw < inside an attribute`);
    }
  }
});
