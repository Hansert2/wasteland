import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

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
    if (name === 'opening') continue; // its own page, with its own contract below
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
    's-gate', 's-direction', 's-expedition', 's-stores', 's-structures', 's-road',
    's-workshop', 's-caravan', 's-post', 's-standings', 's-roster',
  ];

  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'opening') continue; // its own page, with its own contract below
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
    if (name === 'opening') continue; // its own page, with its own contract below
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
    if (name === 'opening') continue; // its own page, with its own contract below
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
    if (name === 'opening') continue; // its own page, with its own contract below
    const attrs = [...html.matchAll(/\s[a-z-]+="([^"]*)"/g)].map((m) => m[1]);
    for (const value of attrs) {
      assert.ok(!value.includes('<'), `${name}: a raw < inside an attribute`);
    }
  }
});

test('every block on the page belongs to a view that can show it', async () => {
  /*
   * The failure this closes is the one the split introduces, and it is silent in
   * exactly the way the rest of this file is about.
   *
   * The five views are a CSS filter over one stream of sections: `main > section` is
   * `display: none`, and each view turns its own blocks back on by id. A block added
   * later and not listed in `PANES` therefore renders perfectly, validates perfectly,
   * carries all its data attributes — and is on no view. Nothing throws, nothing logs,
   * and the feature is simply invisible until somebody notices it missing.
   *
   * `s-head` and `s-stores` are exempt because they live in the rail rather than in the
   * stream — outside `main`, and so outside the filter entirely. That is the mechanism
   * for "on every view" and it is a stronger one than listing an id five times: a sixth
   * view cannot be added without them. `s-error` is exempt in the other direction: it
   * is in the stream and turned on for every view by hand, because a refused action
   * that renders into a hidden section is a button that appears to have done nothing.
   */
  const camp = STATES.home;
  const ids = [...new Set([...camp.matchAll(/<section id="(s-[a-z]+)">/g)].map((m) => m[1]))];
  const revealed = new Set(
    [...camp.matchAll(/body\[data-pane="[a-z]+"\] #(s-[a-z]+)/g)].map((m) => m[1]),
  );

  for (const id of ids) {
    if (id === 's-head' || id === 's-stores') continue;

    if (id === 's-error') {
      assert.ok(
        camp.includes('main #s-error { display: block; }'),
        'the error box must be on every view, not on one of them',
      );
      continue;
    }

    if (id === 's-hour') {
      assert.ok(
        camp.includes('main #s-hour { display: block; }'),
        'the hour must be on every view, not on one of them',
      );
      continue;
    }

    if (id === 's-moment') {
      assert.ok(
        camp.includes('main #s-moment { display: block; }'),
        'Contact must be on every view, not on one of them',
      );
      continue;
    }

    assert.ok(revealed.has(id), `${id} is rendered but no view reveals it`);
  }
});

test('each view has something on it, and Contact is on all of them', async () => {
  /*
   * Contact is the strongest placement claim in `docs/DESIGN-BRIEF.md` §7.3: a window
   * measured in tens of minutes, gone if you do not answer it, arriving without warning.
   * A player who has to click through to find it will find it closed.
   *
   * That used to be asserted here as "the default view and nowhere else", which is a
   * stronger claim than the brief makes and was wrong in a way the brief could not have
   * foreseen: the alarm that fetches an arriving moment is armed on every view, so a
   * player watching the trip from the Survivor view was sent the box and shown a hidden
   * section. It is now revealed by a blanket rule instead, so what this pins is that no
   * view can be defined that leaves Contact out.
   */
  const camp = STATES.home;
  const shown = {};

  for (const match of camp.matchAll(/body\[data-pane="([a-z]+)"\] #(s-[a-z]+)/g)) {
    (shown[match[1]] ??= new Set()).add(match[2]);
  }

  for (const pane of ['camp', 'survivor', 'road', 'trade']) {
    assert.ok(shown[pane]?.size > 0, `the ${pane} view shows nothing at all`);
  }

  assert.ok(
    camp.includes('main #s-moment { display: block; }'),
    'Contact is revealed for every view, not listed per view',
  );

  // And the other half of it, which is the half that can regress quietly. The box is
  // everywhere; the "Nobody is on the wire" placeholder is not, because on Trade that
  // is a line about the absence of something nobody asked about. Lose this rule and
  // every view grows a permanent line saying nothing is happening; write it wrong and
  // the arriving box is hidden on four views out of five, which is what this whole
  // change was about.
  assert.ok(
    camp.includes('body:not([data-pane="camp"]) main #s-moment:not(:has(.contact)) { display: none; }'),
    'the empty Contact line belongs to the check-in view alone',
  );
});

test('Records is a view of the camp, not a page beside it', async () => {
  /*
   * Records had its own `layout()` call and grew none of the shell: no stores, no hour,
   * and no Contact box. The first two are a rail that stops climbing; the third is the
   * one that matters, because a moment's window is measured in tens of minutes and is
   * gone if nobody answers it. A player who wandered in at the wrong time was never shown
   * the box at all — and the test above this one could not see it, because it reads the
   * camp page and Records is not one of its panes.
   *
   * Pinned by id rather than by looks: these are what the client script finds its work
   * with, so a Records page that renders them under different ids is the same failure
   * wearing a different mask.
   */
  const records = STATES.graveyard;

  for (const id of ['s-head', 's-stores', 's-hour', 's-moment', 's-error', 's-records']) {
    assert.match(records, new RegExp(`<section id="${id}">`), `Records is missing ${id}`);
  }

  // The stores climb here as anywhere, which is the whole of what they are for.
  assert.ok(
    [...records.matchAll(/data-amount="[^"]*"/g)].length >= 4,
    'the rail on Records does not carry live stores',
  );

  // And the shell is the shared one rather than a second copy that happens to match
  // today: the camp page's own blocks must not have followed it in.
  assert.ok(!records.includes('id="s-structures"'), 'Records grew the camp page with it');
  assert.ok(!records.includes('id="s-forecast"'), 'Records grew the camp page with it');
});

test('every gauge says what its number counts, in a place the note script can find', async () => {
  /*
   * Played on 2026-08-24: the Survivor block read `HUNGER 0.0` and `RADIATION 0.7` and
   * left the player to guess the scale, the direction and what moves either figure —
   * and 0.0 hunger, which is a survivor who has just eaten, reads most naturally as a
   * survivor with nothing to eat.
   *
   * Two silent failures here, and this file exists for exactly that class. The prose
   * only reaches a mouse if its gauge carries `noted`, because that is what the
   * pointer handler queries for; and it only reaches a screen reader or a phone if it
   * is a `note` in the document rather than a `title` attribute. Either half alone
   * renders a page that looks perfectly correct and explains nothing.
   */
  /*
   * Every one of the four has to turn up somewhere across the fixtures.
   *
   * With gauges droppable, a suite of healthy camps would render none of them and every
   * assertion in this loop would pass by never running — the exact shape of green that this
   * file exists to refuse. So the states are read together and the four are accounted for
   * at the end.
   */
  const seenSlots = [];

  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'opening') continue; // its own page, with its own contract below
    // Cut on the opening tag rather than matching a balanced one: a gauge holds nested
    // divs, and a regex that walks them is a second parser to get wrong.
    const gauges = html.split('<div class="gauge ').slice(1);
    if (gauges.length === 0) continue;

    /*
     * However many are live, and no more than the four that exist.
     *
     * A gauge with nothing acting on it is not rendered at all since 2026-08-31, so a camp
     * whose survivor is whole and fed and clean and rested shows none — which is the point
     * of it and makes a fixed count the wrong assertion. What must not slip is the other
     * direction: a gauge appearing twice, or a fifth arriving without a slot in the grid to
     * stand in, both of which a length check on its own would miss.
     */
    const slots = [...html.matchAll(/class="gauge noted g-(\w+)"/g)].map((m) => m[1]);
    assert.ok(slots.length <= 4, `${name}: ${slots.length} gauges, and there are only four`);
    assert.equal(
      new Set(slots).size,
      slots.length,
      `${name}: the same gauge rendered twice`,
    );
    for (const slot of slots) {
      assert.ok(
        ['health', 'hunger', 'radiation', 'stamina'].includes(slot),
        `${name}: a "${slot}" gauge, which has no column to stand in`,
      );
    }

    for (const gauge of gauges) {
      /*
       * Carries `noted`, whatever else it carries. Pinned as exactly `noted"` until a gauge
       * with nothing acting on it grew a second class to step back with — and the claim
       * being made here is that the pointer handler can find it, not that the attribute has
       * one word in it.
       */
      assert.match(
        gauge.slice(0, 30),
        /^noted[ "]/,
        `${name}: a gauge no pointer will ever ask about`,
      );
      assert.ok(
        gauge.includes('<span class="note">'),
        `${name}: a gauge with a number and no account of what it counts`,
      );
      // A scale and at least two rates. A note that is only a heading explains the
      // units and nothing about what moves them, which is half the question.
      assert.ok(gauge.includes('class="stat-head"'), `${name}: a note with no scale on it`);
      const rows = [...gauge.matchAll(/class="stat-row"/g)].length;
      assert.ok(rows >= 3, `${name}: ${rows} rates under the scale, expected at least three`);
    }

    seenSlots.push(...slots);

    /*
     * And a mark on a gauge carries its own note, in its own `.noted`.
     *
     * The marks say what is acting on a gauge *now* where the note says what the scale
     * *is*, so they nest — a `.noted` inside a `.noted`. That only reads correctly because
     * the pointer handler takes a host's own note rather than the first one beneath it, and
     * unscoped it would show a gauge's mark where the gauge's scale belongs. Silent, and
     * exactly the class of failure this file exists for.
     */
    /*
     * A pointer gets one glyph an effect beside the gauge's name; a finger gets the same
     * effects as words underneath, because a symbol with no hover is a rune. Both are
     * rendered and `@media (hover: hover)` shows one — so both have to be checkable, and
     * the pairing has to hold or one device gets a mark the other does not.
     */
    const signs = [...html.matchAll(/<span class="sign noted" aria-label="([^"]*)">([^<]*)</g)];
    const words = [...html.matchAll(/<span class="driver noted">([^<]*)</g)].map((m) => m[1]);
    assert.deepEqual(
      signs.map((m) => m[1]),
      words,
      `${name}: the glyphs and the words are not the same list of effects`,
    );
    for (const [, label, glyph] of signs) {
      assert.ok(glyph.trim().length > 0, `${name}: an effect with no glyph on it`);
      assert.ok(label.trim().length > 0, `${name}: a glyph with nothing to call it`);
    }

    for (const mark of html.split('<span class="driver noted">').slice(1)) {
      const own = mark.slice(0, mark.indexOf('</span>') + 7);
      assert.ok(
        mark.includes('<span class="note">'),
        `${name}: a mark on a gauge with nothing to say when asked`,
      );
      assert.ok(own.length > 0, `${name}: a mark with no word on it`);
    }
    if (html.includes('class="driver noted"')) {
      // The client script is inlined in the page, so this is checkable from here.
      assert.ok(
        html.includes("querySelector(':scope > .note')"),
        `${name}: marks nest inside gauges, but the handler still takes the first note under a host`,
      );
    }
  }

  assert.deepEqual(
    [...new Set(seenSlots)].sort(),
    ['health', 'hunger', 'radiation', 'stamina'],
    'some gauge is never rendered by any fixture, so nothing above was checked on it',
  );
});

test('every plate the page asks for is a file that exists', async () => {
  /*
   * The failure this closes is the one that already happened once, before any of this
   * was on the page: the generator names its output however it was prompted, and five
   * of the first eleven files differed from the region's slug only by whether the
   * article was on the front. A page that asks for `/img/the_ruined_city.webp` when the
   * file is `ruined_city.webp` renders perfectly, logs nothing, and quietly 404s
   * eleven times per visit.
   *
   * The client script hides a plate whose file is missing, which is the right runtime
   * behaviour and exactly why this has to be a test — the page looks correct in the
   * browser either way, and a region simply stops having a picture with nobody told.
   */
  const dir = fileURLToPath(new URL('../../public/img', import.meta.url));
  const have = new Set(await readdir(dir));

  // Both forms it can take: the <img> in the Away block, and the url() a dispatch row
  // carries to stand on. A background that 404s paints nothing at all, so that half is
  // the more silent of the two and the more worth pinning.
  const wanted = /(?:src="\/img\/([^"]+)"|url\(\/img\/([^)]+)\))/g;

  let asked = 0;
  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'opening') continue; // its own page, with its own contract below
    for (const match of html.matchAll(wanted)) {
      const file = match[1] ?? match[2];
      asked += 1;
      assert.ok(have.has(file), `${name}: asks for /img/${file}, which is not in public/img`);
    }
  }

  assert.ok(asked > 0, 'no page asks for a plate at all, which cannot be right');
});

test('every survivor tab has a panel, a rule that hides it, and a rule that shows it', () => {
  /*
   * Written after a near miss. The tabs began as a hand-written pair of CSS rules naming
   * `skills` and treating everything else as the default; adding Carrying as a third tab
   * left it with no rule of its own, which meant it never hid — it rendered permanently
   * underneath whichever panel was open — and clicking it fell through to Condition.
   *
   * Both suites were green through that, because nothing here executes CSS. So this checks
   * the generated stylesheet against the generated markup: for every tab button on the page
   * there must be a panel, a selector that reveals that panel, and a selector that lights
   * that button. `.tabbed { display: none }` supplies the hiding for all of them at once.
   */
  for (const [name, html] of Object.entries(STATES)) {
    if (name === 'opening' || name === 'graveyard') continue;

    const tabs = [...html.matchAll(/data-survivortab="([a-z]+)"[^>]*role="tab"/g)].map((m) => m[1]);
    if (tabs.length === 0) continue; // a camp with nobody in it has no survivor block

    assert.ok(
      html.includes('.tabbed { display: none; }'),
      `${name}: nothing hides the panels`,
    );

    for (const tab of tabs) {
      /*
       * A panel per person, and the ids are what say so.
       *
       * They were all "survivor-condition", which was one id on the page while a camp held
       * one survivor and four copies of it the moment a camp held four — invalid, and the
       * exact thing aria-controls resolves against. One tab strip now controls every
       * person's panel for its tab, so the ids carry whose panel it is.
       */
      const panels = [...html.matchAll(new RegExp(
        // [0-9] rather than a backslash-d: this pattern is built in a template literal, where a
        // lone backslash-d collapses to a bare d before RegExp ever sees it.
        `class="tabbed" id="(survivor-[0-9]+-${tab})" data-tab="${tab}"`, 'g'
      ))].map((m) => m[1]);
      assert.ok(panels.length > 0, `${name}: the ${tab} tab has no panel`);
      assert.equal(
        new Set(panels).size,
        panels.length,
        `${name}: two ${tab} panels share an id`,
      );

      // And the tab claims all of them, which is what makes one strip honest about a roster.
      const claimed = new RegExp(`data-survivortab="${tab}"[^>]*aria-controls="([^"]+)"`).exec(html);
      assert.ok(claimed, `${name}: the ${tab} tab controls nothing`);
      assert.deepEqual(
        claimed[1].split(' ').sort(),
        panels.slice().sort(),
        `${name}: the ${tab} tab does not name every panel it switches`,
      );
      assert.ok(
        html.includes(`body[data-survivor-tab="${tab}"] .tabbed[data-tab="${tab}"]`),
        `${name}: nothing reveals the ${tab} panel`,
      );
      assert.ok(
        html.includes(`body[data-survivor-tab="${tab}"] .tab[data-survivortab="${tab}"]`),
        `${name}: nothing lights the ${tab} tab`,
      );
    }

    // And exactly one of them is the default, shown to a body that has never been clicked.
    const defaults = [...html.matchAll(/body:not\(\[data-survivor-tab\]\) \.tabbed\[data-tab="([a-z]+)"\]/g)];
    assert.equal(defaults.length, 1, `${name}: there must be one default tab`);
    assert.equal(defaults[0][1], tabs[0], `${name}: the default is the first tab`);
  }
});

test('somebody out there is shown the place they are in', () => {
  /*
   * The plate is the one placement where a region photograph is a picture rather than
   * ground: the Away block carried an <img> because there the place is the subject.
   *
   * Written because it was silently lost once. When the trip reports moved out of the Away
   * block and onto the survivors the image did not come with them — "plate()" stayed
   * defined, its CSS stayed in the sheet, and nothing called either for days. Both suites
   * were green throughout, because nothing here had ever asserted that a traveller is shown
   * where they went.
   */
  const html = STATES.away;
  assert.ok(html, 'there is a page with somebody out on it');

  const shown = /class="afield plated" style="--plate:url\(\/img\/([a-z0-9_]+)\.webp\)"/.exec(html);
  assert.ok(shown, 'the trip stands on the region plate');
  assert.equal(shown[1], 'the_deep_zone', 'and it is the place they actually went');

  // Inside the roster row, which is what makes it theirs rather than the page's.
  assert.match(html, /<div class="person">[^]*?afield plated/, 'the plate is in a survivor row');

  // And the place names itself on it, rather than in a line beside the survivor's name.
  assert.match(
    html,
    /class="afield plated"[^]*?<span class="tag">away &middot; The Deep Zone<\/span>/,
    'the field is headed by where they are',
  );

  /*
   * And it is a ground, not a picture — the whole of what the restraint list allows.
   *
   * Asserted as an absence because that is how it went wrong before: the <img> band was
   * the Away block's shape, the block became a row, and for a while the file carried a
   * plate() nobody called and a stylesheet rule for a tag nobody rendered.
   */
  assert.doesNotMatch(html, /<img[^>]*class="plate/, 'no region is rendered as a picture');
});
