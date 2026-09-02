/**
 * Direction 2a, "cold instrument", applied from `HANDOFF.md` of the Claude Design
 * project *Wasteland Visual Identity*.
 *
 * Nothing structural moved. Every `<section id="s-…">` is still emitted in the order
 * `campPage` has always emitted it, still renders when empty, and still routes its
 * deadlines through `countdown()` and its stores through `renderResources()`. The
 * five views are a *grouping* of that one stream, done in CSS — see `PANES` — which is
 * why a build finishing while the player is reading Trade still fetches and still
 * swaps, and why the hidden alarm in `s-expedition` is armed on every view rather than
 * only on the one that happens to show it.
 *
 * The look itself: eight colours, three system faces, depth from border weight rather
 * than shade, and one accent that is only ever a clock, a price you cannot pay, or a
 * warning. Everything else is `docs/DESIGN-BRIEF.md` §2.1 and the handoff.
 */

/**
 * The five views, as the set of blocks each one shows.
 *
 * Read against `campPage`'s emission order this is a filter and nothing else: take the
 * sections in the order the server writes them, keep the ones named here, and the
 * result is the view. That is not a coincidence to be preserved by hand — the order was
 * already grouped by subject before there were views, so the grouping fell out of it.
 *
 * `s-head`, `s-stores`, `s-error` and `s-moment` are on every view deliberately and are
 * not listed. Two mechanisms, for two different reasons:
 *
 * - **Outside `main`.** The head is the camp's identity and the stores are its state;
 *   both live in the rail, which the filter does not reach. The stores moved out of
 *   this list rather than into every entry of it, because a view is a subject — the
 *   camp, the person, the road, the market — and how much food is left is not one of
 *   those; it is the number every one of those subjects is decided against. It also
 *   means a sixth view cannot be added without them.
 * - **In the stream, turned on by hand.** The error box, because a refusal that renders
 *   into a hidden section is a button that silently did nothing. And Contact, for the
 *   same reason with a worse ending: an error can be retried and a contact just closes.
 *
 * Contact was on the default view and nowhere else, on the argument in
 * `docs/DESIGN-BRIEF.md` §7.3 — tens of minutes to answer, gone if you do not, and a
 * player who has to click through to find it will find it closed. That argument says it
 * must be on the view a player lands on. It never said only there, and only there had a
 * cost the brief did not foresee: the alarm that fetches a moment is armed on every view
 * (see `momentAlarm`), so a player watching the trip on the Survivor view got the swap,
 * got the box, and could not see it. The page went and got the thing, then hid it.
 */
const PANES = {
  camp: [
    'raid', 'sky', 'forecast', 'events', 'direction', 'structures', 'workshop', 'caravan',
    'roster',
  ],
  survivor: ['gate', 'survivor', 'expedition', 'forecast'],
  road: ['road'],
  trade: ['caravan', 'post', 'standings'],
};

/**
 * The survivor block's tabs, in order. The first is the default.
 *
 * One list, and the buttons, the panel-switching CSS and the selected-tab styling are all
 * generated from it — the same rule `PANES` follows a few lines down, and for the same
 * reason. A tab added to a hand-written pair of CSS rules is a tab that renders, never
 * hides, and shows its panel underneath whichever one is open.
 */
const SURVIVOR_TABS = [
  ['condition', 'Condition'],
  ['skills', 'Skills'],
  ['carrying', 'Carrying'],
];

const DEFAULT_SURVIVOR_TAB = SURVIVOR_TABS[0][0];

/** Rail order, and the label each view answers to. `records` is the graveyard page. */
const RAIL = [
  ['camp', 'Camp', '/camp'],
  // "Survivors", because a camp holds more than one now. The pane key and the path stay
  // `survivor`: the key is what PANES and the page contract are written against, and the
  // path is what a player has bookmarked.
  ['survivor', 'Survivors', '/camp/survivor'],
  ['road', 'Road', '/camp/road'],
  ['trade', 'Trade', '/camp/trade'],
  ['records', 'Records', '/graveyard'],
];

/** Only these reach `campPage` as a pane; anything else is a 404 before it gets here. */
export const PANE_NAMES = Object.keys(PANES);

/**
 * Which sections each view reveals, written as CSS rather than as an attribute on the
 * section tag.
 *
 * The tag cannot carry it: `test/db/page-contract.test.js` matches `<section id="s-…">`
 * literally, and it is right to — an id is the interface the swap runs on, and pinning
 * the exact opening tag is what stops a redesign from decorating it into something the
 * client script no longer finds. So the view grouping is expressed by id from out here,
 * generated from `PANES` so there is one list rather than two.
 */
const PANE_CSS = Object.entries(PANES)
  .map(([pane, ids]) => {
    const selectors = ids.map((id) => `body[data-pane="${pane}"] #s-${id}`).join(',\n  ');
    return `  ${selectors} { display: block; }`;
  })
  .join('\n');

/**
 * Which survivor panel shows, and which tab is lit, generated from `SURVIVOR_TABS`.
 *
 * Hidden by default and revealed by name, rather than the reverse: a panel whose tab is not
 * in the list should disappear, not linger on top of the one that is. The default tab is
 * matched twice — once for a body that has never been clicked and carries no attribute, and
 * once for its own value — so returning to it is the same state as never having left.
 */
const SURVIVOR_TAB_CSS = [
  '  .tabbed { display: none; }',
  ...SURVIVOR_TABS.map(([id]) => {
    const shown =
      id === DEFAULT_SURVIVOR_TAB
        ? `  body:not([data-survivor-tab]) .tabbed[data-tab="${id}"],\n` +
          `  body[data-survivor-tab="${id}"] .tabbed[data-tab="${id}"]`
        : `  body[data-survivor-tab="${id}"] .tabbed[data-tab="${id}"]`;
    return `${shown} { display: block; }`;
  }),
  ...SURVIVOR_TABS.map(([id]) => {
    const lit =
      id === DEFAULT_SURVIVOR_TAB
        ? `  body:not([data-survivor-tab]) .tab[data-survivortab="${id}"],\n` +
          `  body[data-survivor-tab="${id}"] .tab[data-survivortab="${id}"]`
        : `  body[data-survivor-tab="${id}"] .tab[data-survivortab="${id}"]`;
    return `${lit} { color: var(--bone); border-bottom-color: var(--oxide); }`;
  }),
].join('\n');

const STYLE = `
  :root {
    /*
     * The page behind the camp, and the reason the palette has nine values now.
     *
     * The ground was doing two jobs: the fill the camp is drawn on, and the fill of the
     * browser window it floats in. On a laptop those are the same thing and nobody
     * notices. On a wide screen they are not — the camp ran to the left edge and
     * trailed off into an acre of identical dark, which is the one arrangement that
     * makes a deliberately quiet page read as an unstyled one.
     *
     * The artboards never had the problem because they never had a window: every board
     * is a fixed card at #171614 sitting on #0B0A08. That second value is what was
     * missing here, and once the camp has an edge and a floor to sit on, every border
     * inside it starts meaning something again.
     */
    --void: #0B0A08;
    --ground: #171614;
    /* The rail sits between the two: darker than the camp it is attached to, lighter
       than the floor the camp is standing on, so it reads as part of the card rather
       than as a hole cut in it. */
    --rail: #141311;
    --panel: #1E1D1A;
    --rule: #33312C;
    --edge: #4A463E;
    --bone: #E4E1D8;
    --prose: #CFCBC0;
    --dim: #999588;
    --faint: #6F6B62;
    --fainter: #5C584F;
    --oxide: #C2632C;
    --oxide-light: #DD8F4A;

    /*
     * Six more, all read off the artboards rather than the handoff's table, and each
     * of them is a *second* weight of something the eight already name. That is the
     * system working as stated: depth comes from border weight, so an outer rule and
     * an inner rule cannot be the same value, and a label strip cannot be the same
     * fill as the panel it labels or the strip disappears.
     */
    --rule-in: #26241F;   /* between cells; always lighter than the panel's own edge */
    /*
     * The label strip, and it is the "panel" fill rather than a value of its own.
     *
     * The artboards give it #1A1917, which is three steps off the ground and reads
     * perfectly there — because on the artboards the whole camp sits on a card at
     * #14120E and the page behind it is #0B0A08. Lifted onto the real page, where the
     * ground *is* #171614, three steps is nothing and the strip vanishes: the label
     * ends up looking like a heading floating above the box rather than a bar across
     * the top of it, which is the one thing the strip exists to stop.
     *
     * So the strip takes the fill the handoff already named for "inside of a bordered
     * panel", and the block body keeps the ground. Still two fills, still no shadow,
     * still no third grey invented to paper over it.
     */
    --strip: #1E1D1A;
    --value: #DCD8CD;     /* a figure, one step down from a heading */
    --quiet: #7A766C;     /* a figure or a sentence that is present but not the point */
    --control: #55504E;   /* the border of a button, which must out-rank a panel edge */

    --warn-edge: #7A4526;
    --warn-strip: #251C15;
    --warn-rule: #4A3226;
    --warn-prose: #E0C9B4;

    /* Prose and UI part on width and case, not on serifs. A string never crosses
       families: a structure's name is condensed, its description is prose, its cost
       is mono. 'Arial Narrow' is in the label stack because 'Roboto Condensed' is not
       resident on Windows, and Arial alone loses the condensing that is half of what
       makes a label read as a label. Still a system face; still nothing fetched. */
    --label: 'Roboto Condensed', 'Arial Narrow', Arial, sans-serif;
    /* The mark's own stack, and deliberately not "--label". The lockup is drawn in the
       narrowest face the machine has and falls back to the next narrowest; the label
       stack leads with Roboto Condensed, which is a different width and would relax
       the wordmark's tracking into something that is not the mark. */
    --mark: 'Arial Narrow', 'Helvetica Neue Condensed', 'Liberation Sans Narrow',
            'Roboto Condensed', sans-serif;
    --body: -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    --numer: ui-monospace, Menlo, Consolas, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; }

  /* Every corner in this design is square, and each of these defaults would put a
     radius back. Said once here rather than per control. */
  button, input, select, textarea { border-radius: 0; font: inherit; }

  body {
    margin: 0;
    background: var(--void);
    color: var(--prose);
    font-family: var(--body);
    font-size: 16.5px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- the shell ---- */

  /*
   * The camp, as a card on the floor rather than as the whole window.
   *
   * 1280px is the width the artboards are drawn at, and it is not arbitrary: the rail
   * is 198 of it and the rest is a content column wide enough for a structures table
   * with a description in it and no wider. Letting it grow with the window would make
   * the one measure the design controls — how long a line of prose is — a property of
   * the reader's monitor.
   */
  /*
   * Two columns, and the left one has a floor.
   *
   * A grid rather than a flex row because the way out has to sit at the bottom of the
   * left column while living outside the rail in the document — see EXIT. Row one
   * takes the slack ("1fr") and row two is the height of the button, so the rail fills
   * whatever is left and the way out is pinned under it however short the page is.
   */
  /*
   * The strip across the top of the content column. Sticky, and the only element on the
   * page that moves independently of the rest: the dispatch table runs past a screen and
   * the hour is what a row of it is read against, so a strip that scrolled away would
   * take the context with it exactly when the decision is being made.
   *
   * Negative margins cancel the column's own padding so it sits flush against the three
   * edges it meets, which is what makes it read as the top of the column rather than as
   * the first card in it.
   */
  main > #s-hour {
    position: sticky;
    top: 0;
    z-index: 20;
    margin: -20px -24px 0;
  }

  .hourbar {
    background: var(--rail);
    border-bottom: 1px solid var(--rule);
  }
  /*
   * Two gaps, not one. The strip is a row of small groups — an instrument and its
   * readings — and with a single gap the space between "13:46" and "to sunset" was the
   * same as the space between the clock and the glass, so five separate facts read as one
   * run of text. The parts of a group sit close; the groups stand apart.
   */
  .hourbar-in {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 8px 26px;
    padding: 10px 20px;
    font-size: 13px;
  }
  /*
   * The place control. Sits at the end of the strip and takes as little of it as a word,
   * because it is set once and then read never: an open select of a hundred zones would
   * be the largest thing on a panel meant to be glanced at.
   */
  .place { margin-left: auto; font-size: 12px; }
  .place > summary {
    cursor: pointer;
    color: var(--faint);
    font-variant-caps: all-small-caps;
    letter-spacing: .14em;
    list-style: none;
  }
  .place > summary::-webkit-details-marker { display: none; }
  .place > summary:hover { color: var(--prose); }
  .place-in {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    max-width: 260px;
  }
  /*
   * Every dropdown on the page, in the camp's own hand.
   *
   * A bare select renders as the operating system's control — rounded, pale, with a blue
   * focus ring and a chrome arrow — which on a page built out of rules, small caps and
   * three greys reads as a piece of somebody else's software. appearance: none takes the
   * chrome off and the arrow comes back as a caret drawn in the palette.
   *
   * Shaped like button, which is what it stands beside: the same condensed label face,
   * the same uppercase and letter-spacing, the same one-pixel border in --control that
   * out-ranks a panel edge. A select is a control, so it should look like the other one.
   *
   * The dark scheme is declared rather than assumed. Without color-scheme, the open
   * option list is drawn by the browser in its own light palette however the closed control
   * is styled — white rows on a dark page, and the one part of this that CSS cannot reach.
   */
  select {
    appearance: none;
    -webkit-appearance: none;
    color-scheme: dark;
    font-family: var(--label);
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: .12em;
    text-transform: uppercase;
    padding: 5px 26px 5px 9px;
    background-color: transparent;
    /* The caret, drawn rather than inherited: two strokes in --dim, kept clear of the edge. */
    background-image:
      linear-gradient(45deg, transparent 50%, var(--dim) 50%),
      linear-gradient(135deg, var(--dim) 50%, transparent 50%);
    background-position: right 12px center, right 7px center;
    background-size: 5px 5px, 5px 5px;
    background-repeat: no-repeat;
    color: var(--bone);
    border: 1px solid var(--control);
    border-radius: 0;
    cursor: pointer;
  }
  select:hover { border-color: var(--bone); }
  select:focus-visible { outline: 2px solid var(--oxide); outline-offset: 1px; }
  /* The open list, for the browsers that let a page reach it at all. */
  select option { background: var(--panel); color: var(--prose); }

  /*
   * In a label strip, where three of them live. Smaller and quieter than a button, because
   * a strip is a caption rather than a row of controls — the figure it sets is the point,
   * not the setting of it.
   */
  h2 select {
    font-size: 10px;
    padding: 3px 22px 3px 7px;
    background-position: right 10px center, right 5px center;
    border-color: var(--rule);
    color: var(--prose);
  }
  h2 select:hover { border-color: var(--edge); color: var(--bone); }

  .place-form { display: flex; gap: 6px; }
  .place-form select {
    flex: 1 1 auto;
    min-width: 0;
    /* The one that is a sentence rather than a label: a hundred place names in small caps
       would be unreadable, so this one keeps its own case and the page's prose face. */
    font-family: inherit;
    font-weight: 400;
    font-size: 12px;
    letter-spacing: 0;
    text-transform: none;
    color: var(--prose);
    border-color: var(--rule);
  }
  .hourbar .band {
    font-variant-caps: all-small-caps;
    letter-spacing: .16em;
    color: var(--bone);
  }
  .hourbar .val { color: var(--value); }
  /*
   * The oxide accent means "this is coming for you" — right for the raid clock, wrong for
   * a sunset, which was the loudest thing on a strip meant to be glanced at. The weather's
   * name keeps the accent; its countdown does not.
   */
  .hourbar .soft,
  .hourbar .clock,
  .hourbar .clock.deadline { color: var(--quiet); }
  .hourbar .from { display: inline-flex; gap: 8px; align-items: baseline; }
  .hourbar .from .tag,
  .hourbar .cost-row .tag { color: var(--faint); }
  .hourbar .sky-now { display: inline-flex; gap: 8px; align-items: baseline; }
  .hourbar .sky-now .name { color: var(--oxide-light); }

  /*
   * The band is the trigger. It is the one word on the strip that names what the hour is
   * doing, so it is where a reader already looks to ask what that costs.
   *
   * It keeps a dotted rule under it, which is the only thing left signalling that there
   * is anything to open. Without a cue the panel would be a fact the page holds and does
   * not offer, which is the failure the honesty pass exists to prevent — a cost a player
   * cannot find is a cost they cannot plan around.
   */
  .costs { position: relative; cursor: help; }
  .hourbar .costs .band { border-bottom: 1px dotted var(--edge); }

  /*
   * Opens on hover, on keyboard focus, and on tap.
   *
   * A focus-within rule on a focusable trigger is what makes the last two work: a phone
   * has no hover at all, and a panel that only answered to hover would put a real cost
   * somewhere a phone could never reach. Hidden by visibility rather than by display, so
   * the panel keeps its box and does not reflow the strip when it opens.
   */
  .costs-panel {
    position: absolute;
    z-index: 5;
    left: 0;
    top: calc(100% + 8px);
    visibility: hidden;
    opacity: 0;
    min-width: 300px;
    padding: 12px 14px;
    background: var(--panel);
    border: 1px solid var(--edge);
    box-shadow: 0 6px 20px rgb(0 0 0 / .35);
    display: grid;
    gap: 6px;
    text-align: left;
    transition: opacity .12s ease;
  }
  .costs:hover .costs-panel,
  .costs:focus-within .costs-panel,
  .costs:focus .costs-panel { visibility: visible; opacity: 1; }

  .costs-head {
    display: block;
    font-variant-caps: all-small-caps;
    letter-spacing: .16em;
    color: var(--quiet);
  }
  .cost-row { display: flex; gap: 8px; align-items: baseline; }

  /*
   * The stores' own copy of it. Narrower and pinned to the left edge because these sit in
   * the rail, which is a couple of hundred pixels wide — the strip's 300px panel would hang
   * off the side of the page. The rule above gives it the z-index it needs to sit over the
   * track below it.
   */
  /*
   * The opening. Narrow measure and a lot of air, because it is the only screen in the game
   * that is read rather than scanned — everything else is a control panel and is laid out
   * like one.
   */
  .opening { min-height: 100vh; display: flex; align-items: center; justify-content: center;
             padding: 40px 20px; }
  .opening-in { max-width: 34rem; display: grid; gap: 20px; }
  .opening-name { font-variant-caps: all-small-caps; letter-spacing: .2em;
                  color: var(--bone); font-size: 20px; font-weight: 400; margin: 0; }
  .opening p { margin: 0; color: var(--prose); line-height: 1.65; }
  .opening .known { color: var(--dim); font-size: 13px; }
  /* The turn before the button: the one line that says what the button is for. */
  .opening .opening-turn { color: var(--dim); }
  .opening form { margin-top: 8px; }

  /*
   * A survivor's two figures. A list rather than a table: two rows do not need a header,
   * and the level sits between the name and the effect so the eye reads "scavenging, 3,
   * and here is what 3 does" in one pass.
   */
  /*
   * The survivor block's two tabs. Which one shows is decided by an attribute on <body>,
   * the same way the five views are — see PANE_CSS. Condition is the default, so it is
   * selected by the *absence* of the attribute as well as by its own value; a body that has
   * never been clicked and one clicked back to condition must look the same.
   */
  /*
   * In the label strip, so the tabs sit on the bar that names the block rather than inside
   * the body they switch. No rule of their own: the strip already has a bottom border, and
   * the selected tab marks itself against it.
   */
  /* A tab that opens onto an empty pack still says so: a blank panel reads as a failure. */
  .none { color: var(--faint); margin: 0; }
  /*
   * The pack. Three columns on a rail that is two hundred pixels wide, which is the whole
   * constraint: the name takes what is left, the count and the button take exactly what
   * they need, and nothing wraps.
   */
  .carrying { width: 100%; border-collapse: collapse; table-layout: auto; }
  .carrying tr { border-bottom: 1px solid var(--rule); }
  .carrying tr:last-child { border-bottom: 0; }
  .carrying td { padding: 7px 0; vertical-align: middle; }
  .carrying .name { color: var(--prose); font-size: 13px; line-height: 1.25; }
  .carrying .qty {
    width: 1%;
    padding-left: 10px;
    color: var(--dim);
    font-family: var(--numer);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    text-align: right;
  }
  .carrying .use { width: 1%; padding-left: 10px; white-space: nowrap; text-align: right; }
  .carrying .use form { display: inline-block; margin: 0; }
  .carrying .use button {
    appearance: none;
    background: none;
    border: 1px solid var(--edge);
    color: var(--prose);
    font: inherit;
    font-size: 10.5px;
    font-variant-caps: all-small-caps;
    letter-spacing: .14em;
    padding: 1px 7px;
    cursor: pointer;
  }
  .carrying .use button:hover { border-color: var(--oxide); color: var(--bone); }
  /* The prose line in the note, which is the only place a description is shown at all. */
  .carrying .note .what { display: block; color: var(--prose); max-width: 30ch; }

  .tabs { display: flex; align-items: center; gap: 4px; }
  .tab {
    appearance: none;
    background: none;
    border: 0;
    /* Under the word rather than pulled down onto the strip's own border: aligning to that
       needs a magic offset that tracks the strip's padding, and the mark belongs to the tab
       either way. */
    border-bottom: 2px solid transparent;
    padding: 2px 4px 3px;
    font: inherit;
    font-size: 11px;
    font-variant-caps: all-small-caps;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: var(--faint);
    cursor: pointer;
  }
  .tab:hover { color: var(--prose); }

${SURVIVOR_TAB_CSS}

  /* Where they are: under the name, above the tabs. */
  /*
   * The card's own footing: who is going, on the person it would be.
   *
   * Below the body rather than inside a tab, and separated by the same hairline the block
   * uses everywhere else, because it is true of the whole survivor and not of whichever
   * panel happens to be open. A checked one lights its label, which is the whole readout —
   * there is no figure here, only a person picked or not picked.
   */
  .goes { border-top: 1px solid var(--rule); padding: 8px 18px; }
  .pick { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; }
  .pick .tag { color: var(--dim); font-size: 10px; letter-spacing: .18em; }
  /* The dark scheme declared, as the selects declare it and for the same reason: left to
     itself the browser draws an unchecked radio as a solid light disc, which on this page
     reads as the chosen one. Declared, it is a hollow ring, and only the picked one is
     filled — which is the entire readout here. */
  /*
   * And sized like a tick box, which it has to say out loud.
   *
   * The rule "label input" further down sets width 100% and display block for the login
   * form's text fields, and it reaches every input inside a label — including these. Seen in the browser
   * rather than reasoned about: the raid block's checkboxes were **892 pixels wide**, which
   * pushed every name to the far right of its row and made the list unreadable. It looked
   * survivable in the "sending" radio only because that label is shrink-to-fit, so the input
   * stretched to something small.
   */
  .pick input { accent-color: var(--oxide); color-scheme: dark; cursor: pointer;
                display: inline-block; width: auto; flex: none; margin: 0; }
  .pick:has(:checked) .tag { color: var(--bone); }
  /* Occupied: the control keeps its place and refuses, and does not repeat the reason —
     that is two lines up, under the name, on this same card. */
  .pick.off { cursor: default; }
  .pick.off .tag { color: var(--rule); }
  .pick.off input { cursor: default; }

  /* Who stands at the fence: a name to press and what pressing it saves. */
  /*
   * A raid, which is the one block on this page that is an instrument rather than a reading.
   *
   * The share is the hero because it is the only figure here the player moves: the track under
   * it is the same one the survivor gauges and the road's live link use, so a number that
   * fills up looks the same wherever it appears. What has gone sits under it as a line rather
   * than a stack, because it is the raid's business and not the player's.
   */
  .holding { margin-bottom: 16px; }
  .holding .val { font-size: 20px; }
  /*
   * Thicker than a survivor's gauge, and the only track on the page that is. Those are a
   * reading you glance at; this is the one figure in the game that moves because of something
   * the player just did, and a two-pixel hairline could not show it moving.
   */
  .holding .track { height: 5px; margin-top: 9px; }
  .holding .track i { height: 5px; background: var(--bone); }
  .raiding .gone { margin: 15px 0 10px; font-size: 15px; line-height: 1.5; color: var(--dim); }
  /*
   * The cells sit in the block rather than at its edge, so they need the border the Away
   * block's own frame gives them there.
   */
  .raiding .readout { border: 1px solid var(--rule-in); }

  /*
   * One row per survivor, ticked when they are out there. Three columns on a grid rather than
   * a flex row: the shares line up under each other and the tallies start in the same place,
   * so a list that is changing under you can still be read down.
   */
  .standers-foot b { font-weight: 400; color: var(--bone); }
  .fencers { list-style: none; margin: 18px 0 0; padding: 0; display: grid; gap: 10px; }
  /*
   * Name, share, tally — three columns so the shares line up under one another and the
   * tallies all start in the same place. A list that changes under you has to be readable
   * downwards, which a row of flexed pairs never is.
   */
  .fencer { display: grid; grid-template-columns: minmax(0, 15ch) 4ch minmax(0, 1fr);
            gap: 3px 18px; align-items: baseline; }
  /* A label is a form caption everywhere else on this page, with the margin to match. */
  .fencer .pick { justify-self: start; margin: 0; }
  .fencer .share { font-family: var(--numer); font-size: 12px; color: var(--dim);
                   font-variant-numeric: tabular-nums; text-align: right; }
  .fencer.off .share { color: var(--faint); font-size: 11px; text-align: left;
                       white-space: nowrap; grid-column: 2 / -1; }
  /*
   * Both halves at the same weight. The first cut had what somebody held back a step brighter
   * than what it cost them, which is the wrong way round for a control you press to *stop*
   * paying: the injury is the half of the trade being decided on.
   */
  .fencer .tally { display: flex; gap: 16px; font-family: var(--numer); font-size: 12px;
                   color: var(--dim); font-variant-numeric: tabular-nums; }
  /* Out there: the name takes the weight and the share takes the accent. */
  .fencer.outthere .tag { color: var(--bone); }
  .fencer.outthere .share { color: var(--oxide-light); }

  @media (max-width: 620px) {
    .fencer { grid-template-columns: minmax(0, 1fr) 4ch; }
    .fencer .tally { grid-column: 1 / -1; gap: 12px; }
  }

  /* What the fence is worth and the way to change it, on one line. */
  .standers-foot { display: flex; align-items: center; justify-content: space-between;
                   gap: 18px; flex-wrap: wrap; margin-top: 15px; }
  .standers-foot .keeps { font-family: var(--numer); font-size: 12px; color: var(--dim);
                          font-variant-numeric: tabular-nums; }

  /*
   * The road still to come. Greyed because none of it can be paid into yet — only the live
   * link takes fuel — and laid out on the same grid as the reached rows above so the whole
   * thing reads as one road rather than as a block and a list.
   */
  /*
   * The link's block on the ground of the place it opens.
   *
   * The .82 veil and the 72% crop are the dispatch rows' numbers, unchanged and deliberately
   * so: the veil opacity is a figure the *text* decides, and the quiet greys in here are the
   * same quiet greys that were measured against a white sky over there. No hover lift: a
   * dispatch row brightens because it is a row you are choosing between, and this is the one
   * link there is.
   *
   * The strip and the list below keep their own opaque grounds, so the picture stops where
   * the thing you can act on stops.
   */
  .next-link.plated {
    background-image: linear-gradient(rgba(23, 22, 20, .82), rgba(23, 22, 20, .82)),
                      var(--plate);
    background-size: cover;
    background-position: center 72%;
    background-repeat: no-repeat;
  }
  .next-link .ahead { background: var(--panel); }

  /* The live link's own gauge: the same track and figure the survivor blocks use. */
  .paying { margin-bottom: 13px; }
  .paying .val { font-size: 18px; }
  .next-link .stat-row { margin-top: 7px; }
  .next-link form.row { margin-top: 15px; }
  .next-link .road-note { margin-top: 13px; }

  .ahead { list-style: none; margin: 0; padding: 14px 18px 4px; display: grid; gap: 9px; }
  .ahead .link { display: grid; grid-template-columns: 2ch minmax(0, 1fr) auto; gap: 4px 12px;
                 align-items: baseline; }
  .ahead .idx { font-family: var(--numer); font-size: 11px; color: var(--rule);
                font-variant-numeric: tabular-nums; }
  .ahead .name { color: var(--faint); }
  .ahead .cost { font-family: var(--numer); font-size: 12px; color: var(--faint);
                 font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ahead .what { grid-column: 2 / -1; font-size: 13px; color: var(--fainter);
                 line-height: 1.45; }
  @media (max-width: 560px) {
    .ahead .link { grid-template-columns: 2ch minmax(0, 1fr); }
    .ahead .cost { grid-column: 2; }
  }

  .out { margin: 5px 0 0; color: var(--dim); font-size: 13px; }
  .out .short { color: var(--faint); }

  .skills { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
  .skill { display: grid; gap: 3px; }
  .skill-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .skill .val { font-family: var(--numer); color: var(--bone); font-size: 12px;
                font-variant-numeric: tabular-nums; }
  /* The scale, quieter than the level it qualifies: "1 / 7" should read as one figure. */
  .skill .val .of { color: var(--faint); }

  /*
   * Seven marks, not a fill. The gauges beside this are continuous and run to a hundred, so
   * a proportional track reads true; a skill is a small integer whose middle is the neutral
   * point, and a four-sevenths-full bar would read as "somewhat good" where the honest
   * reading is "buys nothing either way".
   */
  .pips { display: flex; gap: 3px; align-items: flex-end; }
  .pip { flex: 1 1 0; height: 6px; background: var(--rule); position: relative; }
  .pip.on { background: var(--dim); }
  /* Where nothing begins. Marked whether or not it is reached, since that is the point. */
  .pip.ord::after { content: ''; position: absolute; left: 0; right: 0; bottom: -4px;
                    height: 1px; background: var(--edge); }
  /* Against an ordinary survivor, not against zero. Oxide is the page's "this costs you". */
  .skill.up .pip.on { background: var(--value); }
  .skill.up .val { color: var(--value); }
  .skill.down .pip.on { background: var(--oxide-light); }
  .skill.down .val { color: var(--oxide-light); }

  .store { position: relative; }
  /*
   * Positioned against the cell, not against the rate span it hangs off. The strip has room
   * to anchor a panel to its trigger; the rail is a couple of hundred pixels wide, and a
   * fixed-width panel hung off a short number at the right-hand edge would leave the page.
   * Spanning the cell means it cannot, at any rail width.
   */
  .store .costs { position: static; }
  .store .costs-panel { min-width: 0; width: auto; left: 0; right: 0; top: calc(100% + 4px); }
  .store .cost-row { justify-content: space-between; gap: 10px; }
  .store .cost-row.net { border-top: 1px solid var(--rule); padding-top: 5px; }
  .store .cost-row .num { font-variant-numeric: tabular-nums; }
  .hourbar .cost-row .tag { min-width: 74px; flex: none; }
  .hourbar .cost-row.together { border-top: 1px solid var(--rule); padding-top: 6px; }
  /* No tag, so no column to indent past: the figures start where the heading does. */
  .hourbar .cost-row.bare { padding-left: 0; }
  .hourbar .cost-want {
    display: block;
    border-top: 1px solid var(--rule);
    padding-top: 6px;
    color: var(--faint);
    max-width: 40ch;
  }

  @media (max-width: 640px) {
    .hourbar-in { gap: 6px 16px; padding: 8px 14px; font-size: 12px; }
    .costs-panel { min-width: 0; width: min(88vw, 260px); }
  }

  .shell {
    display: grid;
    grid-template-columns: 198px minmax(0, 1fr);
    grid-template-rows: 1fr auto;
    max-width: 1280px;
    margin: 0 auto;
    min-height: 100vh;
    /* The rail's column, painted by the shell rather than by the rail — see the note on
       the rail below. Hard-edged rather than a blend: this is two fills meeting on a
       line, and the line is where the content column puts its own border. */
    background: linear-gradient(to right, var(--rail) 0 198px, var(--ground) 198px);
    border-left: 1px solid var(--rule);
    border-right: 1px solid var(--rule);
  }

  /* The foot of the left column, wearing the rail's own ground so the two read as one
     surface with a button resting on the bottom of it. */
  /*
   * The way out stays in view with the rest of the column.
   *
   * It spans both rows rather than sitting in the second one, for the reason the rail
   * needed align-self: start — a sticky box is confined to its grid area, and an
   * auto-sized row is exactly the height of the thing in it. Spanning gives it somewhere
   * to travel; end alignment keeps it where it has always been drawn, at the foot.
   *
   * Pinned to the bottom rather than under the rail, because the rail's height is not a
   * number this stylesheet knows: the stores are four rows or none, and the crest is one
   * line or two. Top and bottom is a layout that does not need to be told.
   */
  .exit {
    grid-column: 1;
    grid-row: 1 / 3;
    align-self: end;
    position: sticky;
    bottom: 0;
    background: var(--rail);
    padding: 20px;
  }

  /*
   * The divider between rail and content is on "main", not on the rail.
   *
   * Whichever of the two is taller has to carry it, or the line stops partway down the
   * card and reads as a rendering fault. "main" is the tall one on every view except an
   * empty Road — and it spans both grid rows, so the line now runs past the way out as
   * well and reaches the floor on every view, which is what it was always trying to do.
   */
  /*
   * The rail stays put, so the five views are always one click away.
   *
   * Two things had to change together. A grid item stretches to its area by default, so
   * the rail's box was exactly as tall as the column and sticky had nowhere to travel —
   * align-self: start gives it its own height back. And a rail that is only as tall as
   * its contents no longer paints the column it sits in, which is why the fill moved onto
   * the shell as a hard-edged gradient: a grid track cannot carry a background, and this
   * is the honest way to give one to a column rather than to the thing standing in it.
   *
   * The height cap is for a short window. Sticky pins the top of a box taller than the
   * viewport and leaves its bottom off-screen for good, which would put the nav — the
   * whole point of this — permanently out of reach on a laptop.
   */
  .rail {
    grid-column: 1;
    grid-row: 1;
    width: 198px;
    align-self: start;
    position: sticky;
    top: 0;
    max-height: 100vh;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  /* The mark at rail size, above the camp's own name.
   *
   * The design's short-form sheet sketches exactly this column — the small stacked
   * lockup over a set of stores with one warm countdown in it — so the rail is where
   * the mark was always going to live. Its ground is the rail's, not the page's, which
   * is what the knockout variable exists for.
   *
   * Not a link, deliberately. The nav three rows below already has Camp in it, and a
   * second control going to the same place is a second thing to tab through that
   * teaches the reader nothing.
   *
   * Sized to span the column's measure rather than to the design's 17px rail sample.
   * That sample was drawn against a rail with nothing else in it; ours opens with the
   * camp's own name at 24px directly underneath, and a wordmark smaller than the name
   * below it reads as a caption on the camp rather than as the masthead over it. At
   * 24px the wordmark comes to about 138px of the 158px available, which is a masthead
   * that spans its column without touching either edge.
   *
   * "overflow: hidden" is a guard and not a layout tool. Every width here comes from
   * whatever narrow face the machine resolved, and a client with none of the four —
   * falling all the way through to sans-serif, which may not condense at all — would
   * set the wordmark wide enough to reach across into main. Clipped at the rail's edge
   * is a bad-looking mark; spilling over the content beside it is a broken page. */
  .rail .crest { padding: 18px 20px 16px; border-bottom: 1px solid var(--rule);
                 overflow: hidden; }
  /* Centred in the column, by the same auto margins the gate uses — the box is already
     shrunk to the wordmark, so there is something for them to centre. */
  .rail .mark { font-size: 24px; --knockout: var(--rail); margin-inline: auto; }

  .rail .who { padding: 20px 20px 18px; border-bottom: 1px solid var(--rule); }
  .rail .who .tag { display: block; margin-bottom: 7px; letter-spacing: .2em; }
  .rail .who h1 {
    margin: 0;
    font-family: var(--label);
    font-weight: 700;
    font-size: 24px;
    line-height: 1.1;
    letter-spacing: .01em;
    color: var(--bone);
  }
  .rail .who p {
    margin: 12px 0 0;
    font-family: var(--numer);
    font-size: 12.5px;
    line-height: 1.6;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }

  .rail nav { display: flex; flex-direction: column; }
  .rail nav a {
    display: block;
    padding: 13px 20px;
    font-family: var(--label);
    font-weight: 700;
    font-size: 11.5px;
    line-height: 1;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--dim);
    text-decoration: none;
    border-bottom: 1px solid var(--rule-in);
  }
  .rail nav a:hover { color: var(--bone); }
  /* The one place oxide marks something that is not a clock, a price or a warning, and
     it is still not decoration: it is the answer to "which of these am I looking at".
     The lift in fill comes with it, so the marker is not carrying the state alone. */
  .rail nav a[aria-current] {
    color: var(--bone);
    background: var(--panel);
    box-shadow: inset 3px 0 0 var(--oxide);
  }
  .rail nav a:last-child { border-bottom-color: var(--rule); }


  /*
   * A flex column with a gap, and the gap is the reason rather than the layout.
   *
   * Margins between sections cannot work here: sections are hidden per view but stay
   * siblings in the DOM, so two blocks that are visibly adjacent can have three hidden
   * ones between them, and every '+' selector spacing them is guessing. Flex 'gap'
   * skips 'display: none' children entirely — they are not flex items — so the spacing
   * is right on every view without anything having to know which view is up.
   */
  main {
    grid-column: 2;
    grid-row: 1 / 3;
    min-width: 0;
    padding: 20px 24px 72px;
    border-left: 1px solid var(--rule);
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  /* ---- views ---- */

  /* The head is the camp's identity and lives in the rail, so it is never in this
     stream. The error box is, and is on every view: a refusal that renders into a
     hidden section is a button that silently did nothing. */
  /* Descendant, not child: four of these sit inside a lane on the Survivor view. */
  main section { display: none; margin: 0; }
  main #s-hour { display: block; }
  /* Records is not one of the camp's views, so it is revealed by name like the shell's
     own blocks rather than through PANES. */
  body[data-pane="records"] #s-records { display: block; }
  main #s-error { display: block; }
  /*
   * Contact, on every view, for the reason the error box is on every view.
   *
   * It has tens of minutes on it and it is gone if nobody answers, and the alarm that
   * goes and fetches it is armed everywhere — so camp-only meant a player watching the
   * trip from the Survivor view received the box and was shown a hidden section.
   *
   * The quiet line is a different question and stays where it was. "Nobody is on the
   * wire" is information on the check-in view, which is a view about what is and is not
   * happening; on Trade it is a line about the absence of something nobody asked about.
   * So: the box on every view, the placeholder only on the one it belongs to. ":has" is
   * the test rather than a class on the section, because the section's opening tag is
   * pinned by the page contract and must stay exactly "<section id=...>".
   */
  main #s-moment { display: block; }
  body:not([data-pane="camp"]) main #s-moment:not(:has(.contact)) { display: none; }
  /*
   * The one place an empty block is hidden, and deliberately not the blanket
   * ':empty { display: none }' the handoff forbids — that rule would take the slot away
   * from a caravan that has not arrived yet. This is scoped to the error box, which is
   * empty on every page that is working and must not spend a gap saying so. It is still
   * in the document, still found by id, and still swapped: the moment it has content it
   * stops matching ':empty' and comes back.
   */
  main #s-error:empty { display: none; }
${PANE_CSS}

  /*
   * The lanes, which are nothing at all until the Survivor view needs them.
   *
   * "display: contents" removes the wrapper from layout entirely — its sections become
   * flex items of the column, exactly as they were before the wrappers existed — so
   * four views out of five are unaffected by a structure that only one of them uses.
   */
  .lane { display: contents; }

  /* The column's own stack. Everything the views arrange lives here rather than on
     "main", so the strip above it is never a grid item — see the note in campPage. */
  .stream { display: flex; flex-direction: column; gap: 18px; min-width: 0; }

  /*
   * The roster is one block again, and it spans the view.
   *
   * It was a grid of cards for about a day: every survivor a block of their own, laid across
   * the top. That solved the 300px sidebar and bought a new problem in its place — four
   * headers all reading "Survivor", four copies of a tab strip that could never disagree,
   * four frames around what is really one list. The frame belongs to the list, so there is
   * one block now, the people are rows in it, and this view needs no arrangement at all: the
   * stream's own column is the whole of it.
   */

  /*
   * The Contact box repeats the trip's state on purpose — the decision needs those facts
   * beside it rather than a click away. On this view they are not a click away: the roster
   * is on the same screen saying the same sentence about the same trip. So the line goes
   * there and only there, and the box keeps it everywhere else.
   */
  body[data-pane="survivor"] #s-moment .state { display: none; }

  /* The away log beside Next, on the one view that has both. Unpicked when the log has
     a list in it rather than a line — half a column is not where you read the longest
     block on the page. */
  body[data-pane="camp"] .lane-pair {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    align-items: start;
  }
  body[data-pane="camp"] .lane-pair:has(#s-events .block) {
    display: flex;
    flex-direction: column;
  }
  /* Paired, the log keeps its rule but gives up the negative margin that closes it into
     the run above — it is standing beside something now, not stacked under it. */
  body[data-pane="camp"] .lane-pair:not(:has(#s-events .block)) #s-events { margin: 0; }
  @media (max-width: 760px) {
    body[data-pane="camp"] .lane-pair { display: contents; }
  }

  /* The caravan is on two views wearing two shapes: a pointer on Camp so the player
     never has to remember Trade exists, and the shopfront itself on Trade. Both are
     rendered, one is shown, and the section still swaps as a single unit. */
  body[data-pane="camp"] #s-caravan .as-block { display: none; }
  body[data-pane="trade"] #s-caravan .as-line { display: none; }

  main section:empty { margin-bottom: 0; }

  /* ---- type ---- */

  p { margin: 0 0 10px; max-width: 66ch; text-wrap: pretty; }
  p:last-child { margin-bottom: 0; }
  small { font-size: 15.5px; line-height: 1.55; color: var(--dim); }
  strong { color: var(--bone); font-weight: 600; }
  a { color: var(--bone); text-decoration: underline; text-underline-offset: 3px; }

  .num, [data-until], [data-amount] {
    font-family: var(--numer);
    font-variant-numeric: tabular-nums;
  }

  .tag {
    font-family: var(--label);
    font-weight: 700;
    font-size: 10px;
    line-height: 1.4;
    letter-spacing: .16em;
    text-transform: uppercase;
    color: var(--faint);
  }

  /* ---- blocks ---- */

  /*
   * A block that has something to say is a bordered box with its label in a strip
   * across the top — not a heading floating above loose content. The strip is what
   * makes a run of blocks read as instruments on one panel rather than as a document
   * with subheadings, and it is why the label can be 10px and still be found.
   */
  .block { border: 1px solid var(--rule); background: var(--ground); }
  /* Depth is border weight, not shade: a block that wants an answer says so with its
     edge. There is no third fill to reach for. */
  .block.wants { border-color: var(--edge); }
  .block > h2 {
    margin: 0;
    padding: 11px 18px;
    background: var(--strip);
    border-bottom: 1px solid var(--rule);
    font-family: var(--label);
    font-weight: 700;
    font-size: 10px;
    line-height: 1;
    letter-spacing: .18em;
    text-transform: uppercase;
    color: var(--dim);
  }
  /* Only a strip that has an aside becomes a row, so every other block's label keeps the
     exact box it has always had. */
  .block > h2:has(.f-nav),
  .block > h2:has(.tabs) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding-block: 8px;
  }

  .block-body { padding: 15px 18px; }
  .block-foot {
    display: flex;
    gap: 18px;
    align-items: baseline;
    padding: 13px 18px;
    background: var(--strip);
    border-top: 1px solid var(--rule);
  }
  .block-foot .val { font-family: var(--numer); font-size: 15px; line-height: 1.4;
                     color: var(--prose); font-variant-numeric: tabular-nums; }
  /* A table fills its block edge to edge; the cells carry the padding. */
  .block > table { margin: 0; }

  /* "Next" is the one block with no strip. It is one sentence and an edge, and a strip
     over a single line would be a label longer than the thing it labels. */
  .block.inline-label { padding: 14px 16px; }
  .block.inline-label > h2 {
    padding: 0;
    margin-bottom: 8px;
    background: none;
    border-bottom: 0;
  }
  .block.inline-label p { font-size: 17px; line-height: 1.55; color: #EAE7DD; }

  /* ---- the quiet rows ---- */

  /* A block with nothing to say is one line, not a box. It keeps its slot so a caravan
     arriving has somewhere to appear, and it is quiet enough that three clear visits in
     four read as calm rather than as a page full of holes. */
  .quiet {
    display: flex;
    gap: 16px;
    align-items: baseline;
    padding: 11px 0;
    border-bottom: 1px solid var(--rule-in);
  }
  .quiet .tag { min-width: 104px; flex: 0 0 104px; }
  .quiet p { margin: 0; max-width: 62ch; color: var(--quiet);
             font-size: 15px; line-height: 1.5; }
  .quiet a { color: var(--dim); }
  /*
   * Consecutive quiet rows stack into one ruled group rather than reading as a run of
   * free-floating lines: no gap between them, one hairline under each.
   *
   * A rule *under* each row rather than a rule above the first, and that is not a
   * stylistic preference — it is the only version that survives the views. Sections are
   * hidden per view but stay siblings in the DOM, so '+' between two visibly adjacent
   * quiet rows can have three hidden sections in between it knows nothing about. Any
   * "first of a run" selector would be guessing. A bottom rule on every row needs no
   * adjacency to be right.
   *
   * The negative margin does the same job for the spacing: it eats half the column's
   * 18px gap on each side, so two quiet rows meet with nothing between them and a quiet
   * row beside a panel keeps nine — which is the right answer anyway, since the quiet
   * rows are meant to sit closer together than the blocks that have something to say.
   */
  main section:has(.quiet) { margin: -9px 0; }

  /* ---- contact ---- */

  /* The brightest panel on the page, and that is all it is. Nothing here is red,
     nothing pulses, nothing is centred. */
  /* The brightest fill on the page belongs to the blocks that are counting something
     down, which is all "contact" means as a class here: contact itself, the raid hour,
     a trip that is due back, an order on the bench. Everything else sits on the
     ground. */
  .contact { background: var(--panel); border-color: var(--edge); }
  .block-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 20px;
    background: #231F18;
    border-bottom: 1px solid var(--rule);
  }
  .block-head .tag { color: var(--bone); font-size: 11px; letter-spacing: .18em; }
  .contact > .block-body { padding: 18px 20px 16px; }
  .contact .state { margin: 0; font-family: var(--numer); font-size: 13px; line-height: 1;
                    color: var(--quiet); font-variant-numeric: tabular-nums; }
  /* The name of the thing, in the one colour this page has. It is a chapter heading
     more than a title — the block already says "Contact", so this says which contact,
     and it is the same name the answer is filed under once the window has gone. */
  .contact .subject { margin: 13px 0 0; font-family: var(--label); font-size: 12px;
                      letter-spacing: .18em; text-transform: uppercase;
                      color: var(--oxide-light); }
  /* The scene: ordinary prose at ordinary size, because it is the part that is read
     rather than answered. Same measure as the turn so the two sit as one column. */
  .contact .scene { margin: 8px 0 0; font-size: 16px; line-height: 1.65;
                    max-width: 64ch; color: var(--prose); }
  /* The turn: the widest measure on the page and the only thing set above prose size,
     because it is the sentence the whole block exists to ask. */
  .contact .turn { margin: 11px 0 0; font-size: 20px; line-height: 1.5;
                   max-width: 64ch; color: #EAE7DD; }

  /* ---- the readout ---- */

  /* Cells across, hairline between, wrapping when the row runs out of width. Each one
     is its own column of label-over-figure, which is what makes a figure findable by
     its label rather than by counting commas.

     "flex: 1 1 auto" with a floor rather than equal columns: a trip carries three kinds
     on one visit and one on the next, and a grid of fixed columns would leave a hole
     where the missing kinds were. */
  .readout { display: flex; flex-wrap: wrap;
             border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
  .read { flex: 1 1 auto; min-width: 88px; padding: 11px 16px;
          border-right: 1px solid var(--rule-in); }
  .read:last-child { border-right: 0; }
  .read .tag { display: block; letter-spacing: .12em; color: var(--dim); }
  .read .fig { display: block; margin-top: 6px; font-family: var(--numer);
               font-size: 19px; line-height: 1; color: var(--value);
               font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* The same accent a draining store gets, for the same reason: it is the figure you
     would otherwise only discover by reading the sentence underneath. */
  .read.hurt .fig { color: var(--oxide-light); }
  /* A running clock, at the size the other clocks on the page are set rather than at
     the size of a figure. "1h 09m 01s" is eleven characters against a two-digit health,
     and matching them would make the one cell that changes every second the widest and
     loudest thing in the row — which is the opposite of what it is: a thing to notice,
     not a thing to watch. */
  .read.due .fig { font-size: 14px; margin-top: 8px; color: var(--oxide-light); }
  /* Same caption a clock carries, at the same weight and tracking, so the two read as
     one idiom rather than as a label that happens to be small. It stays --dim while the
     figure takes the accent: the deadline is the warm thing, not the words beside it. */
  .read .fig small { font-family: var(--label); font-weight: 700; font-size: 10px;
                     letter-spacing: .14em; text-transform: uppercase;
                     color: var(--dim); margin-left: 8px; }

  /* ---- what was answered out there ---- */

  /* Three columns rather than a sentence with a comma and a dash in it: which moment,
     when, and what was chosen. The choice is pushed to the far side because it is the
     column being scanned — the titles are already distinct, and the hours are context
     for them rather than the point. */
  .settled { border-top: 1px solid var(--rule); padding: 13px 20px 4px; }
  .settled > .tag { display: block; color: var(--dim); }
  .answered { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px;
              padding: 9px 0; border-bottom: 1px solid var(--rule-in); }
  .answered .what { font-family: var(--label); font-size: 14.5px; color: var(--bone); }
  .answered .when { font-family: var(--numer); font-size: 11.5px; color: var(--quiet);
                    font-variant-numeric: tabular-nums; }
  .answered .took { margin-left: auto; font-size: 14.5px; color: var(--dim); }
  .settled .footnote { margin: 0; padding: 9px 0 9px; font-size: 12.5px;
                       line-height: 1.4; color: var(--faint); }

  .choices { display: grid; grid-template-columns: repeat(3, 1fr);
             border-top: 1px solid var(--rule); }
  .choice { display: flex; flex-direction: column; gap: 11px;
            padding: 15px 20px; border-right: 1px solid var(--rule-in); }
  .choice:last-child { border-right: 0; }
  .choice .title { font-family: var(--label); font-weight: 400; font-size: 17px;
                   line-height: 1.3; color: var(--bone); }
  /* flex:1 on the consequence is what lines the buttons up across three columns of
     unequal prose. Three buttons at three heights would read as three kinds of thing. */
  .choice .detail { flex: 1; display: flex; gap: 9px; align-items: baseline;
                    font-size: 15.5px; line-height: 1.5; color: var(--dim); }
  .choice form, .choice button { width: 100%; }
  .choice button { padding: 10px 0; }
  .choice .short { align-self: flex-start; }

  /* The figures. Monospaced and tabular because they are read as numbers and compared
     down a row, not along a sentence — and boxed, because a chip has to survive sitting
     next to two other chips that say the opposite thing.

     There is no green in this game and there is not about to be one, so brightness is
     the ranking: a gain is bone, a cost is dim, the incidental is fainter still. Oxide
     is not a third tone on that scale — it is reserved for what can take health off the
     survivor, which is the same rule the warned option already follows. */
  .contact .effects { display: flex; flex-wrap: wrap; gap: 5px;
                      margin: 0; padding: 0; list-style: none; }
  .eff { font-family: var(--numer); font-size: 11.5px; line-height: 1.2;
         letter-spacing: .01em; padding: 4px 6px; white-space: nowrap;
         font-variant-numeric: tabular-nums;
         border: 1px solid var(--rule-in); background: #1A1917; color: var(--dim); }
  .eff.gain { color: var(--bone); border-color: var(--edge); }
  .eff.cost { color: var(--dim); }
  .eff.plain { color: var(--faint); }
  .eff.risk { color: var(--oxide-light); border-color: var(--warn-rule);
              background: var(--warn-strip); }

  /* The one thing the chips cannot fit inside themselves. Set below every other size on
     the block, because a reader who has understood "+55% haul" never needs to read it
     twice and a reader who has not needs it exactly once. */
  .contact .footnote { margin: 0; padding: 11px 20px 13px; font-size: 12.5px;
                       line-height: 1.4; color: var(--faint);
                       border-top: 1px solid var(--rule-in); }
  .contact.warned .footnote { padding-left: 24px; }

  /* Marking the card would tell the player the encounter is dangerous, which they can
     already see. Marking the option tells them which decision kills them, which is the
     true thing — so the panel gains an edge and a rail, and exactly one choice inside
     it is marked. The safe choices are untouched and one of them keeps the fill. */
  .contact.warned { border-color: var(--warn-edge); box-shadow: inset 4px 0 0 var(--oxide); }
  .contact.warned .block-head { background: var(--warn-strip);
                                  border-bottom-color: var(--warn-rule);
                                  padding-left: 24px; }
  .contact.warned > .block-body { padding-left: 24px; }
  .contact.warned .choice:first-child { padding-left: 24px; }
  /* The health figure is the point, so the state line is where the warning is felt. */
  .contact.warned .state { color: var(--oxide-light); }
  .choice.warned { background: #211A15; }
  .choice.warned .detail { color: var(--warn-prose); }
  .choice.warned .glyph { color: var(--oxide-light); font-family: var(--label);
                          font-size: 15px; line-height: 1.4; }
  .choice.warned button { border-color: var(--warn-edge); color: var(--warn-prose); }

  @media (max-width: 760px) {
    .choices { grid-template-columns: 1fr; }
    .choice { border-right: 0; border-top: 1px solid var(--rule-in); }
    .choice:first-child { border-top: 0; }
  }

  /* ---- the sky ---- */

  /* Two narrow columns beside the prose, and the labels repeat in every cell rather
     than sitting in a header row. A header row would be read once; these are read per
     event, which is the whole point of the grid — the player has to be able to see
     which event owns which number. */
  .sky-grid { display: grid; }
  .sky-grid > div { padding: 15px 18px; border-right: 1px solid var(--rule-in);
                    border-bottom: 1px solid var(--rule-in); }
  .sky-grid.cols-1 { grid-template-columns: 1fr; }
  .sky-grid.cols-2 { grid-template-columns: 1fr 250px; }
  .sky-grid.cols-3 { grid-template-columns: 1fr 220px 220px; }
  .sky-grid.cols-1 > div, .sky-grid.cols-2 > div:nth-child(2n),
  .sky-grid.cols-3 > div:nth-child(3n) { border-right: 0; }
  .sky-grid.cols-1 > div:nth-last-child(-n + 1),
  .sky-grid.cols-2 > div:nth-last-child(-n + 2),
  .sky-grid.cols-3 > div:nth-last-child(-n + 3) { border-bottom: 0; }

  .sky-what { display: flex; align-items: baseline; gap: 14px; }
  .sky-what .name { font-size: 15.5px; line-height: 1.2; }
  .sky-what .clock { font-size: 13px; }
  .sky-grid p { margin: 7px 0 0; max-width: 58ch; color: var(--prose); }
  .sky-side .tag { display: block; }
  .sky-side .val { display: block; margin-top: 6px; font-family: var(--numer);
                   font-size: 15px; line-height: 1.4; color: var(--prose);
                   font-variant-numeric: tabular-nums; }
  /* The accent that makes the grid worth reading: a multiplier wears oxide when it is
     costing the camp something and stays prose when it is paying. Nothing else in the
     block is coloured, so the eye finds the bad news without being told where it is. */
  .sky-side .val.costs { color: var(--oxide-light); }
  .sky-side .val.none { color: var(--fainter); }

  /* ---- stores ---- */

  /*
   * The stores live in the rail, so they are a column of four rather than a row of
   * four. Same cells, same attributes, one arrangement narrower.
   *
   * Divided by a rule between each rather than boxed: the rail is already a column of
   * things separated that way — the identity, the five views, the way out — and a
   * bordered panel dropped into it would read as a widget somebody bolted on.
   */
  .stores { display: flex; flex-direction: column;
            border-bottom: 1px solid var(--rule); }
  .store { padding: 11px 20px; }
  .store + .store { border-top: 1px solid var(--rule-in); }
  .store-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .store-top .tag { letter-spacing: .12em; color: var(--dim); }
  .rate { font-family: var(--numer); font-size: 11.5px; line-height: 1;
          color: var(--quiet); font-variant-numeric: tabular-nums; }
  /* The single most useful thing this block can say, so it is the one figure here that
     gets the accent: a store quietly draining. */
  .rate.down { color: var(--oxide-light); }
  .rate.none { color: var(--faint); }
  /* 19px, not the 23 this was across four wide cells: in a 200px column the figure is
     read against the camp's name rather than against the page, and it is the state of
     a store rather than the headline of a block. */
  .store-fig { margin-top: 6px; font-family: var(--numer); font-size: 19px; line-height: 1;
               color: var(--value); font-variant-numeric: tabular-nums; }
  .store-fig .cap { font-size: 11.5px; color: var(--faint); }
  /* A zero store shows an empty track rather than no track: the four cells are the same
     shape whatever is in them, or the eye has to re-find the layout each time. */
  .track { margin-top: 8px; height: 2px; background: #2C2A25; }
  .track i { display: block; height: 2px; background: var(--quiet); }
  .stores .track { margin-top: 7px; }

  /* ---- tables ---- */

  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 12px 18px;
           border-bottom: 1px solid var(--rule-in); }
  th { font-weight: 400; }
  tr:last-child > th, tr:last-child > td { border-bottom: 0; }

  /* A name is condensed and *not* bold. Weight is what the labels use, and a table of
     bold names against tracked uppercase labels is two things shouting at each other. */
  .name { font-family: var(--label); font-weight: 400; font-size: 16px; line-height: 1.2;
          color: var(--bone); }
  .name .qty { font-family: var(--numer); font-size: 13px; color: var(--quiet);
               margin-left: 6px; }
  /* The level sits under the name rather than beside it, so the first column is a name
     and a figure in two registers instead of one crowded string. */
  .lvl { display: block; margin-top: 6px; font-family: var(--numer); font-size: 12.5px;
         line-height: 1; color: var(--quiet); }
  .lede { color: var(--prose); }
  .lede small { display: block; margin-top: 5px; max-width: 70ch; }
  .effect { font-family: var(--numer); font-size: 15px; line-height: 1.3;
            color: var(--value); font-variant-numeric: tabular-nums; }
  .effect.nil { color: var(--faint); }
  td.right, th.right { text-align: right; }
  td.act { width: 96px; }
  td.cost-col { min-width: 140px; max-width: 240px; text-align: right; }
  td.cost-col .short, td.cost-col .needs { display: block; margin-top: 3px; }
  /* The name column is fixed only where there is a description beside it to give way
     to; a two-column table has nothing to hold apart. */
  .block > table tr:has(.lede) > td:first-child { width: 200px; }
  .lede > .effect { display: block; }
  .step { display: block; margin-top: 4px; font-family: var(--numer); font-size: 13.5px;
          line-height: 1.3; color: var(--quiet); font-variant-numeric: tabular-nums; }

  /*
   * The explanation, which is on the page and usually not on the screen.
   *
   * A structure's description is read once and then read fifty more times by accident,
   * and it was the tallest thing in every row — so the table said "Grows food. One
   * level already outpaces what a survivor eats." four lines above the number the
   * player was actually deciding on. It moves to a note that follows the cursor, and
   * the effect and the next level's effect stay where they were.
   *
   * Two things this must not do, and both are handled here rather than in the script:
   *
   * - **Lose the text on a device that cannot hover.** A phone has no cursor, so below
   *   the query the note is simply the paragraph it always was, inline, in place.
   * - **Lose it to a screen reader.** Clipped, never "display: none": it stays in the
   *   accessibility tree and is read in document order, in the row it belongs to.
   */
  .note { display: block; margin-top: 5px; max-width: 70ch;
          font-size: 15.5px; line-height: 1.55; color: var(--dim); text-wrap: pretty; }

  @media (hover: hover) and (pointer: fine) {
    .note {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .noted { cursor: help; }
  }

  /* Never under the pointer: a note that can be hovered flickers against the row it is
     describing, and the whole thing reads as broken. */
  .note-pop {
    position: fixed;
    z-index: 20;
    max-width: 34ch;
    padding: 10px 13px;
    background: var(--panel);
    border: 1px solid var(--edge);
    color: var(--prose);
    font-size: 15px;
    line-height: 1.5;
    text-wrap: pretty;
    pointer-events: none;
  }
  /* The clone the script drops in. Block, so a note made of rows sizes the pop to its
     widest row instead of laying blocks out inside an inline box. */
  .note-pop > .note-body { display: block; }
  .road-note { padding: 12px 18px; border-bottom: 1px solid var(--rule-in); max-width: 74ch; }
  .page-title { font-family: var(--label); font-weight: 700; font-size: 25px;
                line-height: 1.15; color: var(--bone); margin: 0 0 10px; }

  /*
   * The dispatch table is a grid, not four columns, and the arithmetic is why.
   *
   * It lives in the Survivor view's left lane — about 620px — and it was carrying a
   * 200px name column, a 140px minimum cost column and a 96px button. What was left for
   * the region's description was 176px: twenty-one characters, three words a line, four
   * lines to say "As far as the wire and back. Ten minutes, and never nothing." Every
   * other measure in this design is capped between 58 and 76ch.
   *
   * Four columns do not fit in 620px, so the row stops pretending they do. Name and its
   * numbers, the contact count and the button share the first line; the description gets
   * the second to itself and about 70ch to say it in. This is the same shape the narrow
   * breakpoint was already imposing on every table — promoted to always, for the one
   * table that never had the width for the other shape.
   */
  .dispatch, .dispatch tbody { display: block; }
  .dispatch td { display: block; padding: 0; border-bottom: 0; }

  /*
   * Scoped above the narrow breakpoint, and that is not tidiness — it is a bug I put in
   * and took out again. Below 560px every table becomes a two-column grid with its own
   * row assignments, and those rules override "grid-column" while leaving the explicit
   * "grid-row" below untouched. The name and the contact count both landed in row one,
   * column one, printed on top of each other. Placement has to be all-or-nothing per
   * breakpoint, so this half only exists where it is the only half.
   */
  @media (min-width: 561px) {
    .dispatch tr {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: start;
      gap: 6px 18px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--rule-in);
    }
    .dispatch tr:last-child { border-bottom: 0; }
    .dispatch td:first-child { grid-column: 1; grid-row: 1; width: auto; }
    .dispatch .contact-col { grid-column: 2; grid-row: 1; text-align: right; }
    .dispatch .act { grid-column: 3; grid-row: 1 / span 2; width: auto; }
    .dispatch .lede { grid-column: 1 / 3; grid-row: 2; }
    .dispatch .lede small { margin-top: 0; }
  }
  /* The contact count is four fixed phrases and never wraps. It was borrowing the cost
     column, whose 140px minimum exists for the workshop's long prices — which is what
     split "too short for contact" into two right-aligned fragments. */
  .contact-col .cost { white-space: nowrap; }

  /*
   * A fitting is a property of the structure above it, not a row of its own. It hangs
   * inside the description cell behind a 2px inset — which is the same claim the old
   * separate sub-row was trying to make and could not, because a sibling row in a table
   * is a sibling purchase however it is styled.
   */
  .fitting { display: flex; gap: 10px; align-items: baseline; margin-top: 9px;
             padding-left: 12px; box-shadow: inset 2px 0 0 var(--rule); }
  .fitting .tag { letter-spacing: .14em; color: var(--quiet); white-space: nowrap; }
  .fitting span:last-child { font-size: 15px; line-height: 1.5; color: var(--dim); }

  /*
   * The price and the button on one line.
   *
   * The inset is already a baseline row, but its last cell held both — and a form is
   * block-level, so the button dropped underneath the price and every fitting cost two
   * lines instead of one. On the watchtower, which now carries two branches, that was
   * four lines of mostly nothing.
   */
  .fitting > span:last-child {
    display: flex;
    gap: 10px;
    align-items: baseline;
    flex-wrap: wrap;
  }

  /*
   * A fitting is a second purchase inside a row that already has one. At the full button
   * size it read as loudly as the Build beside it, which is the opposite of what the
   * inset is claiming: scrap makes the thing bigger, fuel makes it do something new, and
   * only one of those is the row's headline.
   */
  .fitting button { padding: 5px 11px; font-size: 9.5px; }

  /* ---- the glass ---- */

  .forecast svg { display: block; width: 100%; height: auto; }

  /* Two grounds, a step either side of the block's own fill, so the pair reads before any
     line on top of it does. Night is a fill rather than an outline because it is a
     condition rather than an event. */
  .forecast .f-daylight { fill: var(--panel); }
  .forecast .f-night { fill: var(--void); }
  .forecast .f-turn { stroke: var(--edge); stroke-width: 1; }
  .forecast .f-grid { stroke: var(--rule-in); stroke-width: 1; }
  .forecast .f-day { stroke: var(--rule); stroke-width: 1; }

  /*
   * The wash under the line, warm at the top of the scale and cool at the bottom, so the
   * height of the line carries its own reading before any number is looked at.
   *
   * Kept to a wash rather than the saturated block the reference uses: this page states
   * figures and does not colour them in, and a poster-bright fill under a chart nobody is
   * meant to stare at would out-shout the stores beside it.
   */
  .forecast .f-hot { stop-color: var(--oxide); stop-opacity: .34; }
  .forecast .f-cold { stop-color: var(--dim); stop-opacity: .06; }
  .forecast .f-area { fill: url(#f-wash); }
  .forecast .f-line { fill: none; stroke: var(--oxide-light); stroke-width: 1.75;
                      stroke-linejoin: round; stroke-linecap: round; }

  .forecast .f-axis { fill: var(--faint); font-family: var(--numer); font-size: 10px; }
  /* The two hours the chart is read for, so a step up from the divisions around them. */
  .forecast .f-sun { fill: var(--value); font-family: var(--numer); font-size: 10px; }
  .forecast .f-mark { fill: var(--bone); }
  .forecast .f-extreme { fill: var(--value); font-family: var(--label);
                         font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
  .forecast .f-weather { fill: var(--oxide); }
  /* The present, and the only thing on this chart that is not a forecast. Bone rather
     than oxide: the accent already means weather here, and the current hour is not. */
  .forecast .f-now { stroke: var(--bone); stroke-width: 1; opacity: .65; }
  .forecast .f-now-dot { fill: var(--bone); }
  /*
   * Centred, not baselined.
   *
   * An inline-flex box takes its baseline from its first item, and the first item here is
   * a swatch — so with four swatches of four different heights, every label sat at a
   * different height too. Aligning the row by centre takes the swatches out of the
   * question entirely.
   */
  .forecast-foot {
    display: flex;
    gap: 8px 18px;
    align-items: center;
    flex-wrap: wrap;
    padding: 8px 16px 12px;
    font-size: 13px;
  }
  .forecast-foot .tag { color: var(--quiet); }
  /* In the label strip, so it inherits the strip's own case and tracking rather than
     bringing a second voice into a bar that has one. */
  .f-nav { display: inline-flex; align-items: center; gap: 4px; }
  .f-nav .tag { min-width: 9ch; text-align: center; color: var(--dim);
                font-size: 10px; letter-spacing: .18em; }
  .f-step { color: var(--faint); text-decoration: none; padding: 0 6px; font-size: 13px;
            letter-spacing: 0; line-height: 1; }
  .f-step:hover { color: var(--bone); }
  /* The end of the reach is a mark, not a control: a link that refuses is worse than a
     glyph that never claimed to be one. */
  .f-step.off { color: var(--rule); }
  /*
   * A strip that has nothing to offer says so quietly.
   *
   * "No survivor available" is not a control and not a figure — it is the absence of the
   * one that would have been here — so it takes the tag's size and tracking and the grey
   * the page keeps for a reach that has ended, rather than the strip's own speaking voice.
   * At full weight it pulled the eye to the corner of every block that had nothing to say.
   */
  .f-nav .short { color: var(--faint); font-size: 10px; letter-spacing: .18em; }

  /*
   * One box for every swatch, whatever shape the mark inside it is.
   *
   * A square, a bar and a hairline have nothing in common as boxes, so laying them out as
   * themselves gave four items of four heights and a row that would not line up however it
   * was aligned. They are all a 14px square now, and the mark is drawn inside it — which
   * is also why the bar and the line are centred rather than sitting on a baseline they
   * do not have.
   *
   * Each is drawn from the same custom property as the mark it stands for, so a retune of
   * the chart carries the key with it and the two cannot drift apart.
   */
  .f-key { display: inline-flex; align-items: center; gap: 7px; color: var(--faint); }
  .f-key i {
    width: 14px;
    height: 14px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .f-key .k-day { background: var(--panel); border: 1px solid var(--edge); }
  .f-key .k-night { background: var(--void); border: 1px solid var(--edge); }
  .f-key .k-weather::before { content: ''; display: block; width: 14px; height: 5px;
                              background: var(--oxide); }
  .f-key .k-now::before { content: ''; display: block; width: 2px; height: 14px;
                          background: var(--bone); }

  /*
   * ---- region plates ----
   *
   * Held down on purpose. §2.1 of the brief bans illustration because the atmosphere is
   * meant to live in the prose, and these earn their place only by staying a strip on
   * the edge of a row: sized in pixels rather than in columns, one step darker than the
   * page so the eye reaches the name first, and never the thing a row opens with.
   */
  /*
   * A dispatch row standing on the place it sends you to.
   *
   * The veil is the page's own ground colour, and its opacity is a number the text
   * decides rather than the picture: ".lvl" and ".cost" are set in the quiet greys, and
   * a photograph with a white sky in it lifts the floor those are read against.
   *
   * Two figures do that work together, and both were found on screen rather than
   * reasoned out. .82 is where the ships in Coastal Wreckage and the stair at the
   * bunkers become things you can recognise while the eleven-point line under the name
   * stays as easy as it was on a plain fill. And the crop sits at 72% rather than
   * centred, because the sky is the bright part of every one of these and the ground is
   * the half worth showing — it is a texture under the words, never a background image
   * with text laid on top of it.
   *
   * Hover thins it to .68. That is the whole interaction: the row a player is
   * considering shows them where they would be sending somebody, and nothing else moves.
   */
  .dispatch tr.plated {
    background-image: linear-gradient(rgba(23, 22, 20, .82), rgba(23, 22, 20, .82)),
                      var(--plate);
    background-size: cover;
    background-position: center 72%;
    background-repeat: no-repeat;
  }
  .dispatch tr.plated:hover {
    background-image: linear-gradient(rgba(23, 22, 20, .68), rgba(23, 22, 20, .68)),
                      var(--plate);
  }

  /*
   * And the trip's own figures, on the ground of the place they were taken in.
   *
   * The same treatment as a dispatch row and deliberately so: the readout and the table
   * below it are two views of one place, and a photograph that is a band in one and a
   * ground in the other makes them look like two different kinds of thing. No hover here —
   * a dispatch row lifts to .68 because it is a row you are considering, and this is a
   * report rather than a choice.
   */
  .afield.plated {
    background-image: linear-gradient(rgba(23, 22, 20, .82), rgba(23, 22, 20, .82)),
                      var(--plate);
    background-size: cover;
    background-position: center 72%;
    background-repeat: no-repeat;
    border: 1px solid var(--rule);
  }
  /*
   * The head: the place on the left, the clock hard right.
   *
   * Small caps for the place because it is a label — the same voice a block's own strip
   * uses — and the countdown in the numeral face, because it is the one thing here that
   * moves and the page sets every running clock the same way.
   */
  .afield-head { display: flex; align-items: baseline; justify-content: space-between;
                 gap: 12px; padding: 9px 16px; }
  .afield-head .tag { letter-spacing: .14em; color: var(--dim); }
  .afield-head .back { font-family: var(--numer); font-size: 12.5px; color: var(--prose);
                       font-variant-numeric: tabular-nums; white-space: nowrap; }
  .afield-head .back .short { font-family: var(--body); color: var(--faint); }
  /* Inside the field the rules belong to the field, so the readout keeps only the hairline
     that separates the head from the figures. */
  .afield .readout { border-bottom: 0; border-top-color: var(--rule-in); }

  ul.events { list-style: none; margin: 0; padding: 0; }
  ul.events li { padding: 11px 18px; border-bottom: 1px solid var(--rule-in);
                 max-width: 76ch; text-wrap: pretty; }
  ul.events li:last-child { border-bottom: 0; }
  .when { font-family: var(--numer); font-size: 12.5px; color: var(--faint);
          font-variant-numeric: tabular-nums; margin-right: 8px; white-space: nowrap; }

  /* ---- gauges ---- */

  /*
   * A survivor, as a row across the block.
   *
   * Who they are and what has them on the left in a fixed column so the names stack into a
   * readable edge; the open tab in the middle taking whatever is left; and whether they are
   * the one going at the right end, where the eye lands last and where the answer to "who
   * walks out of the gate" is the last thing read before the table below.
   */
  .person {
    display: grid;
    grid-template-columns: 190px minmax(0, 1fr) auto;
    gap: 0 26px;
    align-items: start;
    padding: 14px 18px;
    border-top: 1px solid var(--rule);
  }
  .person:first-child { border-top: 0; }
  /*
   * What is acting on a gauge, as small marks under its track.
   *
   * Deliberately not figures. The number is already the largest thing in the gauge and a
   * second one beside it competes with it — these say *what*, and the hover says how much.
   * Sized and tracked like a tag, in the grey the page keeps for something that is a label
   * rather than a reading, with a hairline box so a run of two reads as two.
   */
  /*
   * The glyphs, beside the name they qualify.
   *
   * Set at the label's own size and tracked with it so they read as part of the heading
   * rather than as decoration hung off it, and in "--dim" until asked — a mark that is the
   * brightest thing in a gauge is competing with the figure, which is the one thing in
   * there that has to win.
   *
   * Hidden by default and revealed only where there is a pointer to reveal them with. On a
   * phone the words below take over: see "marks".
   */
  .signs { display: none; }
  .sign { cursor: help; }
  .drivers { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }

  /* Placed after both, because it turns each of them off and a media query carries no
     extra weight — the plain rule below it would simply win. */
  @media (hover: hover) and (pointer: fine) {
    .signs { display: inline-flex; gap: 5px; margin-right: auto; padding-left: 7px;
             font-size: 10px; line-height: 1; color: var(--dim); }
    .sign:hover { color: var(--bone); }
    /* One or the other, never both. */
    .drivers { display: none; }
  }
  .driver {
    font-family: var(--label);
    font-weight: 700;
    font-size: 9.5px;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--dim);
    border: 1px solid var(--rule);
    padding: 2px 5px;
    cursor: help;
  }
  .driver:hover { color: var(--bone); border-color: var(--edge); }

  .who-head .out { margin-top: 4px; }
  .who-head .back { display: block; white-space: nowrap; }
  /* The sending control loses its own rule and padding in here: the row's border is already
     the line between people, and a second one inside the row divides nothing. */
  .person .goes { border-top: 0; padding: 2px 0 0; }
  /* Two controls in the column now, and they stack: what to do with this person is one
     question with two answers, not a row of buttons. Left-aligned rather than stretched,
     because a select as wide as the column reads as a field to fill in. */
  .goes { display: grid; gap: 9px; justify-items: start; }
  .rest { display: flex; align-items: stretch; gap: 6px; }
  /* Quieter and shorter than a form in a block: this is a footing, not a row of actions. */
  .rest select, .rest button { font-size: 9.5px; padding-top: 5px; padding-bottom: 5px; }
  .rest button { padding-left: 10px; padding-right: 10px; }

  @media (max-width: 760px) {
    .person { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  }

  /*
   * Side by side, now that there is width for it.
   *
   * Three gauges stacked is the shape a 300px column forces. Across a row they read as one
   * reading of one person — health against hunger against the dose, in a glance — which is
   * the comparison that decides whether this is somebody you send anywhere today.
   */
  /*
   * Four fixed slots, of which a gauge fills its own or none.
   *
   * A gauge with nothing acting on it is not rendered at all — a rested camp would
   * otherwise be twenty figures reading full, no, no, full, and what a player scans a
   * roster for is the one that is not saying that.
   *
   * A grid rather than a flex row is what makes that affordable. Under "flex: 1 1 0" the
   * survivors left standing would spread to fill the space and every row would put its
   * figures somewhere different, which costs the thing the row layout was for: health under
   * health and the dose under the dose, down a column, across four people. Named slots keep
   * every gauge in its own place whether or not its neighbours exist, and the gap where one
   * is missing is simply a gap.
   */
  .gauges { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 13px 26px; }
  .g-health { grid-column: 1; }
  .g-hunger { grid-column: 2; }
  .g-radiation { grid-column: 3; }
  .g-stamina { grid-column: 4; }
  /* Narrow enough and the slots stop being worth holding: two columns, then one, and a
     gauge takes whichever cell it lands in. */
  @media (max-width: 900px) {
    .gauges { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .g-health, .g-hunger, .g-radiation, .g-stamina { grid-column: auto; }
  }
  @media (max-width: 620px) {
    .gauges { grid-template-columns: minmax(0, 1fr); }
  }
  .gauge-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .gauge-top .tag { letter-spacing: .14em; color: var(--dim); }
  .gauge-top .val { font-family: var(--numer); font-size: 16px; line-height: 1;
                    color: var(--value); font-variant-numeric: tabular-nums; }
  .gauge .track { margin-top: 7px; }
  .gauge small { display: block; margin-top: 6px; font-size: 14px; line-height: 1.5; }
  /*
   * What the figure counts, and what moves it — see ".note", which is where this is
   * usually rendered rather than on the page.
   *
   * A stat block and not a paragraph, because every one of these facts is a label and
   * a figure: prose made a player read a sentence to find "-12/h" inside it. Same
   * arrangement as the gauge above it — name left, number right, in the numeric face
   * — so the note reads as more of the instrument rather than as a footnote about it.
   */
  .gauge .note { margin-top: 8px; }
  .stat-head { display: block; margin-bottom: 7px; padding-bottom: 6px;
               border-bottom: 1px solid var(--rule-in); font-family: var(--numer);
               font-size: 12.5px; line-height: 1.3; color: var(--faint); }
  .stat-row { display: flex; align-items: baseline; justify-content: space-between;
              gap: 20px; margin-top: 5px; }
  .stat-row .k { font-size: 13px; line-height: 1.3; color: var(--dim); }
  .stat-row .v { font-family: var(--numer); font-size: 13px; line-height: 1.3;
                 color: var(--value); font-variant-numeric: tabular-nums;
                 white-space: nowrap; }
  .who-name { display: block; font-family: var(--label); font-weight: 700; font-size: 22px;
              line-height: 1.1; color: var(--bone); }
  /*
   * The gap under the survivor's name belongs to the panel, not to whatever happens to be
   * first inside it.
   *
   * It used to be a margin-top on .gauges, which is Condition's first child and nothing
   * else's — so the name sat 18px above the gauges, hard against the skill bars, and hard
   * against the line about an empty pack. Three tabs, three different gaps, for no reason a
   * player could see. Held here, every tab opens the same distance below the name.
   */
  .tabbed { margin-top: 18px; }
  .known { margin: 7px 0 0; font-size: 15.5px; line-height: 1.55; color: var(--dim); }

  /* ---- controls ---- */

  button {
    font-family: var(--label);
    font-weight: 700;
    font-size: 10.5px;
    letter-spacing: .14em;
    text-transform: uppercase;
    padding: 9px 14px;
    background: transparent;
    color: var(--bone);
    border: 1px solid var(--control);
    cursor: pointer;
  }
  button:hover { border-color: var(--bone); }
  button[disabled] { color: var(--faint); border-color: var(--rule); cursor: default; }
  button.fill { background: var(--oxide); border-color: var(--oxide); color: #171614; }
  button.fill:hover { background: var(--oxide-light); border-color: var(--oxide-light); }
  form { margin: 0; }

  /* Everything the player can type into, named by what it is not.
   *
   * This used to enumerate the four types it expected, which meant an input was styled
   * only if somebody had remembered to write its type down — and "text" is the one type
   * you never have to write, because it is what an input already is. The camp name
   * field carried no type for that reason and rendered as a white browser default in
   * the middle of a dark form, on the first page anybody sees.
   *
   * Excluding hidden is the whole of the exception list: there are no checkboxes,
   * radios or submit inputs anywhere in the game, and if one ever arrives it should be
   * styled deliberately rather than have inherited a text field's border by default. */
  input:not([type="hidden"]) {
    background: #131211;
    border: 1px solid var(--rule);
    color: var(--bone);
    padding: 8px 10px;
    font-family: var(--numer);
  }
  input:focus-visible, button:focus-visible, a:focus-visible {
    outline: 2px solid var(--oxide-light);
    outline-offset: 2px;
  }

  /*
   * A clock, and whether it is a deadline.
   *
   * The artboards draw these two differently and the difference is the accent rule
   * doing its job. Contact's "to answer", the raid hour and the weather clearing are
   * oxide: they are windows, and something is lost if you are not there. A trip due
   * back, an order coming off the bench, a build finishing are the same digits in the
   * same face in bone — they are telling you when, not asking you for anything, and
   * colouring them would spend the one accent on news.
   */
  .clock { font-family: var(--numer); font-size: 18px; line-height: 1;
           color: var(--value); font-variant-numeric: tabular-nums;
           white-space: nowrap; }
  .clock.deadline { color: var(--oxide-light); }
  .clock small { font-family: var(--label); font-weight: 700; font-size: 10px;
                 letter-spacing: .14em; text-transform: uppercase;
                 color: var(--dim); margin-left: 9px; }
  /* A label written before the figure is finishing a sentence, so the space goes on
     the other side of it. */
  .clock small:first-child { margin-left: 0; margin-right: 9px; }

  .under { margin: 10px 0 0; font-size: 15.5px; line-height: 1.55; color: var(--quiet); }

  /* A price the camp cannot pay. The only other things wearing oxide are a clock, a
     multiplier that is costing you, and a warning. */
  .short { font-family: var(--numer); font-size: 13.5px; line-height: 1.4;
           color: var(--oxide-light); }
  /* A tier you have not reached yet is a goal, not a price — so it stays faint. */
  /* Inline by default — it rides at the end of a fitting's sentence — and only a
     block where it stacks under a price. */
  .needs { font-family: var(--numer); font-size: 12.5px; line-height: 1.4;
           color: var(--faint); }
  .cost { font-family: var(--numer); font-size: 13.5px; line-height: 1.4;
          color: var(--value); font-variant-numeric: tabular-nums; }

  .error {
    border: 1px solid var(--oxide);
    border-left-width: 4px;
    background: #211A15;
    color: var(--warn-prose);
    padding: 12px 16px;
  }
  /* The camp standing empty is the one thing on the graveyard that is not history. */
  .standing-empty { font-family: var(--numer); font-size: 15px; line-height: 1.5;
                    color: var(--oxide-light); padding: 10px 12px;
                    border: 1px solid var(--warn-rule); margin: 14px 0 0; }

  .state { font-family: var(--numer); font-size: 13.5px; color: var(--quiet);
           font-variant-numeric: tabular-nums; }

  form.row { display: flex; gap: 10px; align-items: stretch; margin-top: 12px; }
  form.row input { width: 8rem; }

  /* ---- the fallen ---- */

  .stones { border-top: 1px solid var(--rule); }
  .stone { padding: 16px 0 18px; border-bottom: 1px solid var(--rule-in); }
  .stone-head { display: flex; align-items: baseline; justify-content: space-between;
                gap: 16px; }
  .stone-head .who-name { font-size: 20px; }
  .stone p { margin: 10px 0 0; max-width: 60ch; }
  .stone .state { margin-top: 9px; font-size: 14px; }

  /* ---- the gate ---- */

  .gate { max-width: 30rem; margin: 0 auto; padding: 48px 20px 96px; }

  /* ---- the mark ---- */

  /* "Barred block": CAMP knocked out of a solid bar, sitting on WASTELANDIA. One ink,
     system faces, nothing drawn and nothing to load — which is why it can be the first
     thing on the first page without the page waiting on anything.

     The lockup is one "font-size" and two ratios of it, so every proportion the design
     specifies survives being resized. That is the whole reason it is not three fixed
     pixel values: a mark whose kicker is 24px is correct at one size and wrong at every
     other, and this page is read on a phone as often as not.

     "align-items: stretch" in a column is what makes the bar span the wordmark's exact
     measure — the bar has no width of its own and takes the widest child's. Nothing
     measures anything, and it stays true if the camp is ever called something else.

     Centring it over the column is the reason for "fit-content" rather than a
     "text-align" anywhere: the box has to shrink to the wordmark before auto margins
     have anything to centre, and it has to stay a stretch container while it does, or
     the bar collapses to the width of the word CAMP and the lockup comes apart.

     **Every measurement below is in em, including the paddings, and that is what lets
     the same three rules draw the mark at 56px on the gate and 24px in the rail.** The
     paddings were pixels first, which is fine at one size and wrong at the other: 5px
     of bar padding is a fifth of the kicker's height at display size and two thirds of
     it at rail size, so the rail mark came out as a word in a thick slab. The values
     are the design's own, divided by the size they were drawn at. */
  .mark { display: flex; flex-direction: column; align-items: stretch;
          width: fit-content; margin: 0;
          /* The hole in the bar is whatever ground the mark is standing on, so each
             placement states its own. A grey here instead of the real ground turns the
             knockout into a label printed on a bar, which is a different mark. */
          --knockout: var(--void);
          font-family: var(--mark); font-stretch: condensed; font-weight: 700;
          text-transform: uppercase; }
  /* On a dark ground the bar inverts and the wordmark takes the ground's light tone.
     Bar paddings are in the kicker's own em, so they are the design's 5px and 4px
     divided by the 24px kicker they were drawn against, not by the mark's size. */
  .mark .bar { background: var(--bone); color: var(--knockout);
               font-size: .43em; line-height: .9; padding: .208em 0 .167em;
               letter-spacing: .18em; text-indent: .18em; text-align: center; }
  .mark .word { color: var(--bone); font-size: 1em; line-height: .94;
                letter-spacing: -.012em; padding-top: .071em; }

  /* Clear space is the bar's own height on all four sides: the kicker's line box plus
     its two paddings, which comes to .55em of the mark at any size. */
  .gate .mark { font-size: clamp(38px, 11vw, 56px); margin: 0 auto .55em; }

  .gate .block { margin-bottom: 18px; }
  .gate .error { margin-bottom: 18px; }

  /* ---- the second door ---- */

  /* A summary styled as the button it is. The marker goes because the row is already a
     button by every other signal, and two affordances saying the same thing read as a
     button with a bullet in it. "list-style" covers Firefox, the pseudo-element covers
     WebKit; both are needed and neither is redundant. */
  .enlist { margin-bottom: 18px; }
  .enlist > summary { display: block; text-align: center; cursor: pointer;
                      font-family: var(--label); font-weight: 700; font-size: 10.5px;
                      letter-spacing: .14em; text-transform: uppercase;
                      padding: 12px 14px; color: var(--bone);
                      border: 1px solid var(--control); list-style: none; }
  .enlist > summary::-webkit-details-marker { display: none; }
  .enlist > summary:hover { border-color: var(--bone); }
  /* Open, the summary is the block's own head rather than a button floating above it:
     one object with a lid, not a control and a panel that happen to be adjacent. */
  .enlist[open] > summary { border-bottom-color: var(--rule); background: #231F18; }
  .enlist[open] > summary:hover { border-color: var(--control); border-bottom-color: var(--rule); }
  .enlist[open] .block { border-top: 0; margin-bottom: 0; }
  label { display: block; margin-bottom: 12px; font-family: var(--label);
          font-weight: 700; font-size: 10px; letter-spacing: .16em;
          text-transform: uppercase; color: var(--dim); }
  label input { display: block; width: 100%; margin-top: 5px; }

  /* ---- the change cue ---- */

  /* A warm wash rather than a grey one, so the cue belongs to the palette instead of
     sitting on top of it. Reduced motion keeps a static oxide edge: the information
     survives when the motion does not. The only animation here that is not a clock. */
  @keyframes changed {
    0%   { background-color: rgba(194, 99, 44, 0.16); }
    100% { background-color: transparent; }
  }
  section.changed { animation: changed 1.2s ease-out; }
  @media (prefers-reduced-motion: reduce) {
    section.changed { animation: none; box-shadow: inset 3px 0 0 var(--oxide); }
  }

  /* ---- narrow ---- */

  @media (max-width: 640px) {
    .sky-grid, .sky-grid.one { grid-template-columns: 1fr; }
    .sky-grid > div, .sky-grid.one > div { border-right: 0;
                                           border-bottom: 1px solid var(--rule-in); }
    .sky-side { display: flex; gap: 12px; align-items: baseline; }
    .sky-side .tag { min-width: 76px; }
    .sky-side .val { margin-top: 0; }
  }

  @media (max-width: 560px) {
    /* Edge to edge on a phone: a card with a floor either side of it is a card nobody
       can read, and there is no wide screen left to centre anything in. */
    .shell { display: block; border-left: 0; border-right: 0; background: var(--ground); }
    main { border-left: 0; }
    /* A band across the top rather than a column beside one: nothing to stick to, nothing
       to paint behind, and a header that followed the page down would cost a phone the
       one thing it has least of. */
    .rail {
      width: auto;
      position: static;
      max-height: none;
      overflow: visible;
      background: var(--rail);
      border-bottom: 1px solid var(--rule);
    }
    /* The crest loses its rule for the same reason .who does: the rail is one band
       across the top of a phone here, not a stack of panels, and every hairline inside
       it is a seam in something that should read as one thing. */
    /* Back to the left edge here. There is no column to centre in on a phone — the rail
       is the full width of the screen — so a centred mark would float in the middle of
       a band with the camp's name left-aligned underneath it. */
    .rail .crest { padding: 16px 16px 12px; border-bottom: 0; }
    .rail .mark { margin-inline: 0; }
    .rail .who { padding: 0 16px 14px; border-bottom: 0; }
    /* The rail is a header here rather than a column, so the four stores lie down and
       share its width. The cap goes: "40.0 / 350" in a quarter of a phone is two
       figures where the first is the one being watched. */
    .stores { flex-direction: row; border-bottom: 0;
              border-top: 1px solid var(--rule-in); }
    .store { flex: 1; min-width: 0; padding: 10px 12px 12px; }
    .store + .store { border-top: 0; border-left: 1px solid var(--rule-in); }
    .store-top .tag { letter-spacing: .1em; }
    .store-fig { font-size: 16px; }
    .store-fig .cap { display: none; }
    .rail nav {
      flex-direction: row;
      overflow-x: auto;
      scrollbar-width: none;
      border-top: 1px solid var(--rule-in);
    }
    .rail nav::-webkit-scrollbar { display: none; }
    .rail nav a {
      padding: 13px 14px;
      border-bottom: 2px solid transparent;
      white-space: nowrap;
    }
    .rail nav a[aria-current] {
      box-shadow: none;
      border-bottom-color: var(--oxide);
    }
    .rail nav a:last-child { border-bottom-color: transparent; }
    /* Block flow here, so this is the last thing on the page rather than the
       bottom of a column. It keeps the rail's ground and gains a rule, because
       on a phone it follows main instead of sitting beneath a nav. */
    /* Block flow on a phone, so it is simply the last thing on the page — which is what
       it was always trying to be, and what keeping it out of the rail buys. */
    .exit { position: static; padding: 14px 16px 18px; border-top: 1px solid var(--rule); }
    main { padding: 16px 16px 64px; }
    button { padding: 13px 16px; min-height: 44px; }
    .choice button { padding: 13px 0; }
    /* The inset's button is compact on a desktop and must not stay compact here: a
       class beats an element selector whatever the media query, so the 44px target has
       to be restated rather than inherited. */
    .fitting button { padding: 13px 16px; min-height: 44px; font-size: 10.5px; }
    .quiet .tag { min-width: 92px; flex-basis: 92px; }

    /* The structures table stops being a table: name, level and cost on the left, the
       button on the right, and nothing dropped. */
    .block > table, .block > table tbody, .block > table tr { display: block; }
    .block > table td { display: block; border-bottom: 0; padding: 0 16px; }
    .block > table tr { padding: 14px 0; border-bottom: 1px solid var(--rule-in);
                        display: grid; grid-template-columns: 1fr auto;
                        align-items: start; gap: 4px 12px; }
    .block > table tr > td:first-child { grid-column: 1; width: auto; }
    .block > table tr > td.lede { grid-column: 1 / -1; margin-top: 6px; }
    /* Higher specificity than the .dispatch rules on purpose: below this width the
       dispatch table wants exactly what every other table wants, and saying so once is
       better than a second narrow layout that has to be kept in step with this one. */
    .block > table td.cost-col, .block > table td.contact-col,
    .block > table td.right { grid-column: 1; text-align: left; width: auto; }
    .block > table td.act { grid-column: 2; grid-row: 1 / span 2; width: auto; }
    /* No plates on a phone. Under this width the row is a stack a full screen tall,
       and a photograph behind that much text is a photograph nobody can see and every
       line is read against. Dropping the image also means it is never fetched. The
       traveller's readout goes with it: same argument, same width, same place. */
    .dispatch tr.plated, .afield.plated { background-image: none; }
  }
`;

/** Every interpolation in this file goes through here. */
export function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * The document.
 *
 * `pane` is the only thing the shell needs to know about which view is up, and it is
 * written on `<body>` rather than baked into what gets rendered. That is the whole
 * mechanism: every section is always in the document, and the CSS generated from
 * `PANES` decides which of them the player is looking at.
 *
 * Two things fall out of it that are worth stating, because `docs/DESIGN-BRIEF.md`
 * §7.3 names both as hazards of splitting the page into tabs:
 *
 * - **The reload returns to the view you were on.** The client script fetches
 *   `location.pathname`, so the response is the same view, and the `<body>` attribute
 *   is not something the swap touches anyway.
 * - **Timers do not stop existing on other views.** A build finishing while the player
 *   is reading Trade still arms, still fires, still fetches. The brief was willing to
 *   accept that they would not; it costs nothing here not to accept it.
 */
/**
 * The mark's short form: the bar cropped to two letters.
 *
 * An inline SVG rather than a file, for the same reason the lockup is type rather than
 * artwork — nothing to serve, nothing to cache-bust, and no second copy of the brand to
 * keep in step with the first. It is the design's own favicon square: dark ground, two
 * condensed caps knocked out of it.
 *
 * `textLength` is the load-bearing attribute. A tab icon is drawn with whatever face
 * the machine resolves, and a browser that has never heard of Arial Narrow would set
 * "CW" in something wider and push it out of a 36px box. Pinning the measure makes the
 * two letters fit whatever they are drawn in, which is the whole job at 16 pixels.
 */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 36 36'%3E" +
  "%3Crect width='36' height='36' fill='%23201F1D'/%3E" +
  "%3Ctext x='18' y='25' text-anchor='middle' textLength='26' lengthAdjust='spacingAndGlyphs'" +
  " font-family='Arial Narrow,Helvetica Neue,sans-serif' font-weight='700' font-size='19'" +
  " fill='%23F3F2F2'%3ECW%3C/text%3E%3C/svg%3E";

export function layout(title, body, { pane } = {}) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><link rel="icon" href="${FAVICON}"><style>${STYLE}</style></head>
<body${pane ? ` data-pane="${escape(pane)}"` : ''}>${body}<script>${TIMERS}</script></body></html>`;
}

/**
 * The strip across the top: what hour it is, what the sky is doing, and what that costs.
 *
 * **Outside `main`, which is the mechanism for "on every view".** The five views are a
 * CSS filter over `main > section`; anything in that stream belongs to a pane. The rail
 * and the stores are on every view because they sit outside it, and this joins them for
 * the same reason and by the same means rather than by being listed five times. A sixth
 * view could not lose it.
 *
 * It is here because of a split nobody had noticed: the sky block is on the Camp view and
 * the dispatch table is on Survivor, so until now a player could not see what the weather
 * was doing while choosing where to send somebody — the one moment it decides anything.
 *
 * **Sticky**, and the only element on the page that moves independently of the rest. The
 * dispatch table is longer than a screen, and the hour is what a row of it is read
 * against; a strip that scrolls away takes the context with it exactly when the decision
 * is being made.
 *
 * The costs are behind a disclosure rather than printed, because the strip is glanced at
 * far more often than it is consulted, and a line of multipliers on every view would be
 * read once and then never again. It opens on hover, on keyboard focus and on tap — the
 * element is focusable and the panel answers to `:focus-within`, so a phone, which has no
 * hover at all, is not left with a fact it cannot reach.
 */
function hourBar(hour, place) {
  if (!hour) return '';

  const time = hour.clock
    ? `<span class="val" data-worldclock data-offset="${hour.offset}">${escape(at(hour.hour, hour.minute))}</span>`
    : '';

  /*
   * Every figure on this strip is named for the instrument that bought it, which is the
   * shape the radio already set: a fact the camp paid fuel for says so, and a fact it did
   * not is simply there. Without the tags a player who fits the clock sees the strip grow
   * two numbers and has to work out which purchase produced them — and a player who has
   * fitted nothing has no way to tell that anything is missing at all.
   */
  const from = (name, body) =>
    `<span class="from"><span class="tag">${escape(name)}</span>${body}</span>`;

  const sunValue = hour.sun
    ? `${factor({ what: 'dose', factor: round2(hour.sun.radiation) })}
       ${factor({ what: 'finds', factor: round2(hour.sun.finds) })}`
    : `<span class="soft">${escape(hour.lean)}</span>`;

  /*
   * When the light turns, as a time rather than as a countdown.
   *
   * A sunset is an hour you plan against — "is a nine-hour trip home before dark" is a
   * question about 18:38, not about how many seconds are left — and a ticking figure was
   * the most restless thing on a strip meant to be glanced at.
   *
   * The timer does not go away, it goes quiet. A hidden armed span keeps the strip
   * rewriting itself the moment the band turns, which is the same trick the Contact box
   * uses to arrive on its own: without it the strip would sit on a stale band until
   * something else on the page happened to refresh.
   */
  const light = hour.clock
    ? `<span class="soft">${escape(hour.turning)}</span>
       <span class="val">${escape(at(hour.turnsHour, hour.turnsMinute))}</span>`
    : `<span class="soft">${escape(hour.roughly)}</span>`;

  const turnAlarm = `<span hidden>${countdown(hour.refreshAt, '')}</span>`;

  const warmth =
    hour.temperature === null ? '' : `<span class="val">${escape(`${hour.temperature}°C`)}</span>`;

  const sky = hour.sky
    .map(
      (event) => `<span class="sky-now"><span class="name">${escape(event.name)}</span>
        <span class="clock deadline">${countdown(event.endsAt, 'clearing')}</span></span>`,
    )
    .join('');

  // Only what is actually costing something out there. The Blight halves the garden and
  // does nothing to a trip, so a row for it here would be a name beside a dash — and a
  // dash in a panel headed "Out there now" reads as a missing number rather than as an
  // absent one. The strip above still names it, which is where "what is happening" lives.
  const skyRows = hour.sky
    .filter((event) => event.effects.some((effect) => effect.where === 'road'))
    .map(
      (event) => `<span class="cost-row"><span class="tag">${escape(event.name)}</span>
        ${sideOf(event.effects, 'road')}</span>`,
    )
    .join('');

  /*
   * The hour's own line, and it is named only when something else is on the panel to
   * confuse it with.
   *
   * Under a clear sky it is the only row there is, and "Out there now — The hour — doses
   * harder" says the same thing three times. With weather in force the label is doing
   * real work: an unlabelled figure sitting under "Rad Storm" reads as the storm's.
   *
   * Same rule as the Together row directly below, for the same reason: nothing is
   * distinguished from things that are not there.
   */
  const sunLine = skyRows
    ? `<span class="cost-row"><span class="tag">The hour</span>${sunValue}</span>`
    : `<span class="cost-row bare">${sunValue}</span>`;

  /*
   * What is not fitted, and what that costs you *in this panel* — the other half of the
   * radio's pattern. "No radio fitted. You will hear them when they arrive." is a line
   * about a thing to go and build; a silence is only an absence.
   *
   * One line, not two. Two absences stated separately was three paragraphs of small grey
   * text under a three-line fragment, and the whole panel stopped being readable — which
   * is a strange way to explain a cost.
   */
  const missing =
    !hour.clock && !hour.glass
      ? 'Nothing fitted to measure this. The hour is a guess and so are the figures.'
      : !hour.glass
        ? 'No glass fitted, so the hour is words rather than figures.'
        : !hour.clock
          ? 'No clock fitted, so the hour itself is a guess.'
          : '';

  const wants = missing ? `<span class="cost-want">${escape(missing)}</span>` : '';

  const together = hour.together && skyRows
    ? `<span class="cost-row together"><span class="tag">Together</span>
         ${factor({ what: 'dose', factor: round2(hour.together.radiation) })}
         ${factor({ what: 'finds', factor: round2(hour.together.finds) })}</span>`
    : '';

  return `<div class="hourbar">
    <div class="hourbar-in">
      ${/*
        * Figures first and the band last, which is the order the strip is actually read
        * in: the hour and the temperature are what a glance is for, and the band is the
        * word you go back to when you want to know what they mean. It is also the
        * trigger, so it sits at the end of its own row rather than in front of the
        * numbers it explains.
        */ ''}
      ${hour.clock ? from('Clock', `${time}${light}`) : light}
      ${hour.glass ? from('Glass', warmth) : ''}
      <span class="costs" tabindex="0" role="button" aria-label="What going out now costs">
        <span class="band">${escape(hour.band)}</span>
        <span class="costs-panel">
          <span class="costs-head">Out there now</span>
          ${skyRows}${sunLine}${together}${wants}
        </span>
      </span>
      ${sky}${turnAlarm}${placePicker(place)}
    </div>
  </div>`;
}

/**
 * Where this camp stands, asked once and then never again.
 *
 * `null` for a camp that was placed at founding, which is every camp founded since the
 * browser's zone started being read — so for almost everybody this renders nothing at all
 * and the strip is exactly as it was. It appears only for a camp standing on the idealised
 * sky by default rather than by choice, and it appears there once.
 *
 * The summary says what is wrong rather than what the control is, because a camp in that
 * state has no other way of finding out: Greenwich and noon at 12:00 sharp is a coherent
 * sky, almost certainly not the player's, and indistinguishable on the strip from a
 * correct one.
 */
function placePicker(place) {
  if (!place) return '';

  return `<details class="place">
    <summary>Where we are — not set</summary>
    <div class="place-in">
      <form class="place-form" method="post" action="/clock">
        <select name="zone" data-zonepick aria-label="Where this camp is">
          ${place.zones
            .map((z) => `<option value="${escape(z.zone)}">${escape(z.label)}</option>`)
            .join('')}
        </select>
        <button type="submit">Set</button>
      </form>
      <span class="soft">Sets the clock and the sun together, once.</span>
    </div>
  </details>`;
}

/**
 * What a survivor's two numbers buy, as figures.
 *
 * This replaced a sentence, and the sentence had a stated reason: "it is a sentence about a
 * person, and prefixing it with a field name turns them into a record." That reason was
 * right about the arrival prose and wrong about this. The arrival is still prose and still
 * carries the person; what this shows is the two multipliers the trip actually turns on,
 * and "comes back heavy" cannot tell a player whether heavy is a tenth or a third.
 *
 * The measured spread the sentence was flattening: haul runs ×0.7 to ×1.3, and the dose
 * bites anywhere between 45 and 75. Both ends read as the same phrase.
 *
 * Coloured against an ordinary survivor rather than against zero, because a level means
 * nothing on its own — 3 is only low next to the 4 that buys nothing either way.
 */
function skillStats(skills) {
  if (!skills || skills.length === 0) return '';

  const row = (skill) => {
    // Better or worse than baseline, or neither. `up` and `down` are the page's existing
    // pair; a baseline level takes neither and stays the colour of plain text.
    const lean =
      skill.level > skill.ordinary ? ' up' : skill.level < skill.ordinary ? ' down' : '';

    /*
     * Pips rather than a filled track, which is the whole reason this is not the gauge
     * beside it.
     *
     * Health is continuous and runs to a hundred, so a proportional fill reads true. A
     * skill is a small integer where the *middle* is the neutral point: drawn as a fill, a
     * baseline survivor would show a bar four-sevenths full, which reads as "somewhat good"
     * when the honest reading is "no bonus either way". Discrete marks say what the number
     * is, and a tick under the fourth says where the bonus starts.
     */
    const pips = Array.from({ length: skill.max }, (_, i) => {
      const at = i + 1;
      const on = at <= skill.level ? ' on' : '';
      const ord = at === skill.ordinary ? ' ord' : '';
      return `<i class="pip${on}${ord}"></i>`;
    }).join('');

    /*
     * The breakdown, on hover, in the idiom the three gauges already use.
     *
     * Rows are a name and a number and nothing else. The figures come off the skill rather
     * than out of this file, so "per level +10%" cannot drift from the function that
     * applies it.
     */
    const note =
      skill.name === 'scavenging'
        ? stats(`level ${skill.level} / ${skill.max}`, [
            ['loot', `×${skill.multiplier}`],
            ['per level', `+${Math.round(skill.perPoint * 100)}%`],
            ['baseline', `${skill.ordinary}`],
            ['minimum', `×${skill.floor}`],
          ])
        : stats(`level ${skill.level} / ${skill.max}`, [
            ['rad resist', signedText(skill.relief)],
            ['per level', `+${skill.perPoint}`],
            ['baseline', `${skill.ordinary}`],
          ]);

    return `<li class="skill noted${lean}">
      <div class="skill-top">
        <span class="tag">${escape(skill.name)}</span>
        <span class="val">${skill.level} <span class="of">/ ${skill.max}</span></span>
      </div>
      ${/*
        * One label for the whole bar. The pips are decorative marks a screen reader would
        * otherwise walk through one at a time, saying nothing each time.
        */ ''}
      <div class="pips" role="img"
           aria-label="${escape(skill.name)} level ${skill.level} of ${skill.max}, baseline ${skill.ordinary}">${pips}</div>
      ${/*
        * No line under the bar restating the first row of the note.
        *
        * It read "loot x0.7" directly above a panel whose opening row is "loot x0.7", which
        * is the block answering a question twice. The three gauges beside this settled the
        * shape already: a label, a figure and a track, and everything else on hover. On a
        * touch screen the note is not hidden in the first place, so nothing is lost where
        * there is no hover to depend on.
        */ ''}
      ${note}
    </li>`;
  };

  return `<ul class="skills">${skills.map(row).join('')}</ul>`;
}

/** A signed figure for a stat row, where the minus is a real minus sign. */
function signedText(value) {
  return `${value < 0 ? '\u2212' : '+'}${Math.abs(value)}`;
}

const round2 = (value) => Math.round(value * 100) / 100;

/** A world-clock reading, zero-padded: 18:38. */
const at = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * The way out, and the only thing on the page that belongs to no column.
 *
 * It reads as the foot of the rail and is not inside it, because those are two
 * different requirements and only one of them is about the DOM. On a wide screen the
 * shell is a grid and this is parked in the left column's bottom row; on a phone the
 * shell is ordinary block flow and this is simply the last thing on the page. Keeping
 * it inside the rail would satisfy the first and make the second impossible — the rail
 * is a band across the top there, so the way out would sit above everything it is
 * meant to come after.
 *
 * Still outside any `section()`, which is what makes it navigate rather than post in
 * place — the rule `section()` documents, used rather than restated.
 */
const EXIT = `<form class="exit" method="post" action="/logout">
  <button type="submit">Log out</button>
</form>`;

/**
 * The rail: the mark, who this camp is, and the five views.
 */
function rail(pane, identity, state = '') {
  const links = RAIL.map(
    ([name, label, href]) =>
      `<a href="${href}"${name === pane ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<div class="rail">
    ${/*
      * Outside every section, like the log out form beneath it and for the same reason:
      * a section is a thing the page re-fetches and swaps when its contents differ, and
      * the mark never differs. It is the one part of this column that is not state.
      */ ''}
    <div class="crest">
      <span class="mark"><span class="bar">Camp</span><span class="word">Wastelandia</span></span>
    </div>
    ${identity}
    ${state}
    <nav>${links}</nav>
  </div>`;
}

const n = (value, places = 1) => Number(value).toFixed(places);

/**
 * A duration, in whatever unit makes it readable.
 *
 * Everything here used to be hours, so hours were hard-coded everywhere. Since the
 * pacing rescale a build can be thirty seconds and an upgrade nine days, and a fixed
 * unit is wrong at one end or the other — the first camp rendered after the change
 * offered five builds all costing "0.0 h", which is worse than no number at all.
 */
/**
 * How long something takes, as a span rather than as a countdown.
 *
 * This used to hand its hours to `clock()`, which is the formatter the live countdowns
 * use — so a static label about a trip that is always exactly eight hours long read
 * "8h 00m 00s", seconds of precision on a number that has never had seconds in it. The
 * same mistake as the elapsed time in the Away report, one layer down: a countdown
 * formatter borrowed for something that is not counting down.
 *
 * `clock()` is left exactly as it is. It is interpolated into the browser script and
 * pinned by a test, and a ticking clock genuinely does want its seconds.
 *
 * Two units at most, and never a unit that is zero. Precision below a minute survives
 * only for spans that are under a minute, where it is the whole answer.
 */
function duration(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 'now';

  const totalMinutes = Math.round(h * 60);
  const days = Math.floor(totalMinutes / 1440);
  const restHours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
  if (restHours > 0) return minutes > 0 ? `${restHours}h ${minutes}m` : `${restHours}h`;
  if (minutes > 0) return `${minutes}m`;

  return `${Math.round(h * 3600)}s`;
}

/**
 * A span of time as hours, minutes and seconds.
 *
 * Rounded units — "2.1 h", "12 min" — are fine to read once and useless to watch: a
 * countdown that sits on "2.1 h" for six minutes looks broken even when it is not.
 * Seconds are what make a timer legibly alive, so they are always shown below a day.
 *
 * Three units at most. Past a day the seconds are noise nobody is watching tick, and
 * a build cost of "9d 03h 12m" is already at the edge of what fits in a table cell.
 *
 * The client script below cannot import this — it is inline JavaScript with no build
 * step to share modules through — so it is handed this function's own source instead,
 * the same way STORE_DECIMALS is interpolated. There is therefore no second copy to
 * keep in step, and the one rule that makes that work is: **this function must close
 * over nothing.** Only globals. A test evaluates it in an empty scope to prove it.
 */
export function clock(totalSeconds) {
  const t = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (t <= 0) return 'now';

  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (value) => String(value).padStart(2, '0');

  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/**
 * A duration that keeps counting after the page is rendered.
 *
 * Every timer here used to be a number computed once and then frozen, which was
 * defensible while a build took four hours — you would close the tab and come back
 * tomorrow. The pacing rescale made a first workshop take thirty-six seconds, and a
 * frozen countdown on a thirty-six second build is just wrong: things now finish
 * while you are looking at them. Found by playing it, which is the only way this
 * kind of thing gets found.
 *
 * The element carries the instant rather than the text, so the script below can
 * re-render it every second without knowing what it is counting towards.
 */
function countdown(at, done = 'now') {
  const until = new Date(at).getTime();
  const left = (until - Date.now()) / 3600000;
  return `<span data-until="${until}" data-done="${escape(done)}">${
    // clock(), not duration(): the browser overwrites this every second using
    // clock() itself, so painting it any other way would change format on the first
    // tick. A countdown keeps its seconds; a span does not have any.
    escape(left > 0 ? clock(Math.round(left * 3600)) : done)
  }</span>`;
}

/**
 * How many decimals a store is shown to.
 *
 * One. Three was tried, on the reasoning that a fresh camp gains 0.7 food an hour and
 * a single decimal therefore only moves every eight and a half minutes — a live
 * counter that looks frozen. Three did move, every few seconds, and looked like
 * noise: two digits of precision nobody acts on, on four rows, changing constantly.
 *
 * The rate beside it is what actually answers "is my camp working", and it says so
 * in one legible figure without demanding to be watched. A number that changes
 * slowly because the thing it counts changes slowly is telling the truth.
 *
 * Declared once and interpolated into the script below, so the browser and the server
 * cannot disagree about it the way the two clock formatters could.
 */
const STORE_DECIMALS = 1;

/**
 * The whole of the client-side JavaScript, and it is meant to stay small.
 *
 * It does three things: ticks every visible timer once a second, extrapolates the
 * stores between server states, and — when a timer runs out or the player acts —
 * fetches a fresh copy of the page and swaps in the sections that changed.
 *
 * **The fetch is not optional and never was.** The server is the only thing that knows
 * what a finished build produced, what an expedition brought home, or whether the
 * survivor came back; outcomes roll from seeds server-side and the tick runs during
 * the render. This used to be a full `location.reload()`, and the only thing that has
 * changed is that the new HTML is applied in place instead of replacing the document.
 * Anything that removes the round trip entirely breaks the game.
 *
 * Two invariants that are easy to lose and produce infinite loops if lost:
 *
 * - **Only timers with a future instant are armed.** Re-checked on every swap, not
 *   once at load. An already-expired timer is showing the server's own "done" text,
 *   and asking the server about it again would never stop.
 * - **A response with no sections in it is a full navigation** — an expired session
 *   renders the landing page — so it falls back to a reload rather than swapping
 *   nothing and appearing frozen.
 */
export const TIMERS = `
(() => {
  // clock() itself, injected rather than copied out by hand — the same trick
  // STORE_DECIMALS already uses, so the browser and the server cannot disagree.
  // This is safe only because there is no build step: a minifier would make
  // Function.prototype.toString untrustworthy, and this would have to go back to a
  // second copy kept in step by a test. Keep clock() closing over nothing.
  const clock = ${clock.toString()};
  const fmt = (ms) => clock(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');

  let live = [];
  let stores = [];
  let counters = [];
  let clocks = [];
  let nowlines = [];
  let since = Date.now();
  let busy = false;

  /*
   * The tab buttons carry aria-selected, and CSS cannot write it. Re-applied on every scan
   * because a swap replaces the buttons with a fresh pair that know nothing about which tab
   * is open — the body attribute is the one copy of that, and this is the only thing that
   * has to be told about it twice.
   */
  const syncTabs = () => {
    const tabs = [...document.querySelectorAll('[data-survivortab]')];
    if (tabs.length === 0) return;
    // No attribute means the first tab, which is what the stylesheet also assumes.
    const open = document.body.dataset.survivorTab || tabs[0].dataset.survivortab;
    for (const el of tabs) {
      el.setAttribute('aria-selected', String(el.dataset.survivortab === open));
    }
  };

  // Re-read after every swap, so the future-only rule holds per render rather than
  // once per page.
  const scan = () => {
    live = [...document.querySelectorAll('[data-until]')]
      .filter((el) => Number(el.dataset.until) > Date.now());
    // Stores accrue continuously, so between server states they are extrapolated from
    // the rate the server sent. That rate is already net of the survivor and the
    // weather, which is why this is a straight line and not a simulation — the moment
    // it would need to be more than that, fresh state has arrived anyway.
    stores = [...document.querySelectorAll('[data-amount]')];
    /*
     * Figures that climb rather than drain, and stop climbing at a stated instant: what a raid
     * has carried off so far, and what each person at the fence has held back or taken.
     *
     * "data-per-hour" rather than "data-rate", which belongs to the stores and whose count the
     * page contract asserts against theirs. Two things sharing an attribute name is how a test
     * about one of them starts failing for the other.
     */
    counters = [...document.querySelectorAll('[data-count]')];

    /*
     * What the ticked boxes would hold back, worked out as they are ticked.
     *
     * One in the product for each of them, which is standTogether on the server written the
     * same way. It is the only figure on this page the browser computes rather than reads,
     * and it earns that: the question is whether to send one more, and it cannot be answered
     * by a page that only knows what has already been sent.
     */
    const fence = document.querySelector('[data-fencetotal]');
    if (fence) {
      const rows = [...document.querySelectorAll('.fencer[data-share]')];
      const retally = () => {
        let held = 0;
        for (const row of rows) {
          const box = row.querySelector('input[type=checkbox]');
          if (!box || !box.checked) continue;
          held += Number(row.dataset.share) * (1 - held);
        }
        fence.textContent = Math.round(Math.min(0.9, held) * 100) + '%';
      };
      for (const row of rows) {
        const box = row.querySelector('input[type=checkbox]');
        if (box) box.addEventListener('change', retally);
      }
      retally();
    }
    // The camp clock. Not UTC since migration 015: each element carries its camp's own
    // offset, and the tick below shifts the browser's Date by it rather than reading the
    // viewer's locale — so the strip shows the camp's hour on any machine anywhere.
    clocks = [...document.querySelectorAll('[data-worldclock]')];
    // The marker on the glass. The day it is drawn against stands still, so the present
    // walks across it — and it has to walk on the client, because nothing fetches the page
    // between one minute and the next.
    nowlines = [...document.querySelectorAll('[data-nowline]')];
    // The zone picker opens on the browser's own place, so the usual answer is one click.
    // A default and not a claim: the server derives the offset from whichever zone is
    // actually submitted, so nothing here is trusted, only pre-filled.
    for (const el of document.querySelectorAll('[data-zonepick]')) {
      try {
        const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (here && [...el.options].some((o) => o.value === here)) el.value = here;
      } catch (e) {}
    }
    syncTabs();
    since = Date.now();
  };

  /*
   * Who is going, copied into every row's hidden field the moment it changes.
   *
   * The dispatch table asks once and eleven forms have to agree. A form= attribute on the
   * select would do it without script, but each row is its own form and a select can only
   * belong to one. change rather than input, because a select fires both and doing the work
   * twice is doing it twice.
   */
  document.addEventListener('change', (event) => {
    const picker = event.target.closest ? event.target.closest('[data-whopicks]') : null;
    if (!picker) return;

    // Only the fields belonging to this block: three blocks ask who now, and the bench's
    // answer is not the dispatch table's.
    const which = picker.dataset.whopicks;
    for (const field of document.querySelectorAll('[data-whofield="' + which + '"]')) {
      field.value = picker.value;
    }

    // And whoever asked to be told the name gets it. The dispatch buttons read "Send Odd",
    // so a choice made on a card up the page is legible at the button that acts on it —
    // without this they would all still say whoever was free when the page was drawn.
    var named = picker.dataset.whoname;
    if (named) {
      for (const label of document.querySelectorAll('[data-nameof="' + which + '"]')) {
        label.textContent = named;
      }
    }
  });

  document.addEventListener('click', (event) => {
    const tab = event.target.closest ? event.target.closest('[data-survivortab]') : null;
    if (!tab) return;
    // Always written, whichever tab it is. Storing the default as the absence of the
    // attribute meant the handler had to know which one that was, and a third tab was
    // enough to make it wrong.
    document.body.dataset.survivorTab = tab.dataset.survivortab;
    syncTabs();
  });

  const apply = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const incoming = doc.querySelectorAll('section[id^="s-"]');
    if (incoming.length === 0) { location.reload(); return; }

    for (const next of incoming) {
      const current = document.getElementById(next.id);
      if (!current || current.innerHTML === next.innerHTML) continue;
      current.innerHTML = next.innerHTML;
      if (next.innerHTML.trim() === '') continue;
      // Restart the cue even if it is already running.
      current.classList.remove('changed');
      void current.offsetWidth;
      current.classList.add('changed');
    }

    drop();
    scan();
    tick();
  };

  const fail = (fallback) => () => fallback();

  // An expired timer still has to ask the server what happened; it just does not throw
  // the document away to do it.
  const pull = () => {
    if (busy) return;
    busy = true;
    // Path *and* query: the glass carries the day it is showing in the search string, and
    // a refresh that dropped it would walk the chart back to today every time a timer
    // expired — which is most minutes.
    fetch(location.pathname + location.search, { credentials: 'same-origin' })
      .then((res) => res.text())
      .then(apply)
      .catch(fail(() => location.reload()))
      .finally(() => { busy = false; });
  };

  const tick = () => {
    const elapsedHours = (Date.now() - since) / 3600000;

    for (const el of stores) {
      const cap = Number(el.dataset.cap);
      const projected =
        Number(el.dataset.amount) + Number(el.dataset.rate) * elapsedHours;
      const clamped = Math.max(0, Math.min(cap, projected));
      el.textContent = clamped.toFixed(${STORE_DECIMALS});

      // The fill bar reads off the same figure rather than off a second attribute, so
      // a track that disagrees with the number beside it is not a state this can be
      // in. Optional and null-guarded: the bar is presentation, and a store that
      // renders without one must still climb.
      const fill = el.closest('.store');
      const track = fill && fill.querySelector('[data-fill]');
      if (track && cap > 0) track.style.width = (100 * clamped) / cap + '%';
    }

    for (const el of counters) {
      // A rate that ends. Past the stop the figure is whatever it reached, which is what
      // makes this safe to leave on a page nobody reloads for an hour after a raid.
      const stop = Number(el.dataset.stop);
      const upto = stop ? Math.min(Date.now(), stop) : Date.now();
      const ran = Math.max(0, (upto - Number(el.dataset.since)) / 3600000);
      const value = Number(el.dataset.count) + Number(el.dataset.perHour) * ran;
      el.textContent = value.toFixed(Number(el.dataset.decimals) || 0);
    }

    // The camp's own hour, not Greenwich's: the offset rides on the element because it
    // is a fact about the camp and the browser has no business guessing it from its own
    // locale — a player on holiday would otherwise watch their camp change timezone.
    for (const el of clocks) {
      const shifted = new Date(Date.now() + Number(el.dataset.offset || 0) * 60000);
      el.textContent = pad(shifted.getUTCHours()) + ':' + pad(shifted.getUTCMinutes());
    }

    for (const el of nowlines) {
      const at = Date.now();
      const from = Number(el.dataset.from);
      const span = Number(el.dataset.span);
      // Past midnight the day the chart was drawn for is over; the server has a new one,
      // so ask for it rather than running the marker off the end.
      if (at < from || at > from + span) { pull(); continue; }

      const px = ((at - from) / span) * Number(el.dataset.plot);
      const line = el.querySelector('line');
      const dot = el.querySelector('circle');
      if (line) { line.setAttribute('x1', px); line.setAttribute('x2', px); }
      if (dot) dot.setAttribute('cx', px);
    }

    for (const el of live) {
      const left = Number(el.dataset.until) - Date.now();
      if (left > 0) { el.textContent = fmt(left); continue; }
      el.textContent = el.dataset.done;
      pull();
    }
  };

  // Actions post in place too. A form outside a section — logging out, and everything
  // on the landing page — is left alone and navigates as it always did.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form.closest('section[id^="s-"]')) return;

    event.preventDefault();
    if (busy) return;
    busy = true;

    const button = event.submitter;
    if (button) button.disabled = true;

    // urlencoded, because that is what the server parses. A refusal comes back as the
    // same page carrying an error, so success and failure need no separate handling.
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      body: new URLSearchParams(new FormData(form)),
    })
      .then((res) => res.text())
      .then(apply)
      .catch(fail(() => form.submit()))
      .finally(() => { busy = false; if (button) button.disabled = false; });
  });

  // The note that follows the cursor.
  //
  // It reads its text out of the row rather than out of an attribute, which is what
  // keeps one copy of the sentence: the same element is the note on a phone, the
  // clipped text a screen reader announces, and the source for this. Mouse only —
  // a touch "hover" fires once and would leave a note stranded on the screen with
  // nothing to dismiss it.
  //
  // It lives on <body>, outside every section, so a swap cannot delete it mid-hover.
  // The swap does hide it, because the row it was describing may no longer exist.
  const pop = document.createElement('div');
  pop.className = 'note-pop';
  pop.hidden = true;
  document.body.appendChild(pop);

  let noted = null;
  const drop = () => { noted = null; pop.hidden = true; };

  const follow = (x, y) => {
    const gap = 14;
    let left = x + gap;
    let top = y + gap;
    // Flip rather than clamp: a note pinned to the edge sits under the cursor, and
    // pointer-events cannot save it from covering the thing it is describing.
    if (left + pop.offsetWidth > window.innerWidth - 8) left = x - gap - pop.offsetWidth;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = y - gap - pop.offsetHeight;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  };

  document.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse') return;

    const host = event.target.closest ? event.target.closest('.noted') : null;
    if (!host) { if (noted) drop(); return; }

    if (host !== noted) {
      /*
       * This host's own note: the first one inside it that no *nearer* host owns.
       *
       * Unscoped, a ".noted" containing another ".noted" shows its child's explanation —
       * the gauges carry a mark per effect, each with a note of its own, and the outer
       * gauge would pick up the first of those instead of its own scale.
       *
       * The first fix for that was ":scope > .note", direct children only, and it was
       * wrong in a way nothing caught: **a span cannot be a direct child of a tr.** Three
       * blocks put their note in a cell because the HTML gives them no choice — the
       * structures table, the bench, and the pack — so from the day the scoping landed
       * every row in all three hovered and said nothing. Reported from play, four commits
       * later.
       *
       * Ownership is the rule the markup actually expresses, and it is what "closest" is
       * for: a note belongs to the nearest host above it, so it is this host's note when
       * that nearest host is this one. Correct for a cell three levels down and still
       * correct for a mark nested inside a gauge.
       */
      const mine = (one) => one.closest('.noted') === host;
      const source = Array.prototype.find.call(host.querySelectorAll('.note'), mine) || null;
      const text = source ? source.textContent.trim() : '';
      if (!text) { drop(); return; }
      noted = host;
      // Cloned rather than read as text, because a note is a paragraph in one place and
      // a block of rates in another, and the pop should be whichever one the row wrote.
      // The clone drops "note" itself: that class is what clips the original off screen.
      const copy = source.cloneNode(true);
      copy.className = 'note-body';
      pop.replaceChildren(copy);
      pop.hidden = false;
    }

    follow(event.clientX, event.clientY);
  });


  // Fixed positioning is relative to the viewport, so a scroll moves the row out from
  // under a note that would otherwise stay exactly where it was.
  document.addEventListener('scroll', drop, true);
  window.addEventListener('blur', drop);

  scan();
  tick();
  setInterval(tick, 1000);
})();
`;

/**
 * The gate: the mark, one way in, and a door to the other one.
 *
 * Both blocks used to stand open side by side, which asked a returning player to read
 * two forms and work out which was theirs — and there is only ever one of them that is.
 * Signing in is the overwhelmingly common errand, so it is the only thing with fields
 * showing; founding a camp is a thing you do once, so it is a button that opens.
 *
 * `<details>` rather than a script, because this is the one page in the game that has
 * to work before anything else does. A toggle that needs JavaScript to reveal the
 * registration form is a page that cannot be registered on when the script fails, and
 * the summary is keyboard-operable and announced as expandable without any help.
 *
 * `signUp` forces it open, and the reason is the whole point of not doing this in the
 * client: a registration that fails comes back through here as a fresh render, and
 * without it the player would be shown "That email already has a camp" above a
 * collapsed form with their typing gone and no clue which half complained.
 */
export function landingPage({ error, signUp = false } = {}) {
  return layout('Camp Wastelandia', `
    <div class="gate">
      <h1 class="mark">
        <span class="bar">Camp</span><span class="word">Wastelandia</span>
      </h1>
      ${error ? `<p class="error">${escape(error)}</p>` : ''}

      <div class="block wants">
        <h2>Return to your camp</h2>
        <div class="block-body">
          <form method="post" action="/login">
            <label>Email <input name="email" type="email" required autocomplete="username"></label>
            <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
            <button type="submit" class="fill">Enter</button>
          </form>
        </div>
      </div>

      <details class="enlist"${signUp ? ' open' : ''}>
        <summary>Found a new camp</summary>
        <div class="block">
          <div class="block-body">
            <form method="post" action="/register">
              <label>Email <input name="email" type="email" required autocomplete="username"></label>
              <label>Password <input name="password" type="password" required autocomplete="new-password" minlength="8"></label>
              <label>Password again <input name="passwordAgain" type="password" required autocomplete="new-password" minlength="8"></label>
              <label>Camp name <input name="settlementName" placeholder="Camp"></label>
              ${/*
                * The camp's clock, taken from the browser and never asked for.
                *
                * A camp keeps its own hour so that dark outside and dark in the game are
                * the same dark, and the only place that offset is knowable without asking
                * is here. Filled by script and harmless without it: an empty field lands
                * as Greenwich, which is exactly what every camp founded before this had.
                *
                * A fixed offset rather than a zone name, so it never jumps an hour in
                * spring — see migration 015. The cost is that a camp founded in summer
                * keeps summer's offset, which is an hour of drift and no discontinuity.
                */ ''}
              <input type="hidden" name="clockOffset" id="clock-offset">
              ${/*
                * And the zone the offset came from, which is a different fact. The offset
                * says what time it is here; only the zone says where the sun sits against
                * that — see zones.js. Madrid and Warsaw are both CEST in summer and their
                * solar noons are ninety-nine minutes apart, so no arithmetic on the offset
                * alone could have got both right.
                *
                * Also filled by script and also harmless without it: an unrecognised or
                * missing zone leaves the camp on the idealised sky, sun at 12:00 sharp.
                */ ''}
              <input type="hidden" name="timeZone" id="time-zone">
              <button type="submit">Begin</button>
            </form>
            <script>
              // getTimezoneOffset is minutes *behind* UTC, so the sign is flipped: a
              // browser two hours east reports -120 and the camp wants +120.
              document.getElementById('clock-offset').value =
                -new Date().getTimezoneOffset();
              // Wrapped: resolvedOptions().timeZone is everywhere now, but a browser that
              // lacked it should still be able to found a camp.
              try {
                document.getElementById('time-zone').value =
                  Intl.DateTimeFormat().resolvedOptions().timeZone || '';
              } catch (e) {}
            </script>
          </div>
        </div>
      </details>
    </div>
  `);
}

/**
 * One updatable region of the page.
 *
 * The page updates in place rather than reloading, and the client script does that by
 * comparing these against the same ids in a freshly fetched copy — so an id is a
 * contract, not decoration. Two rules follow from that and are easy to break by
 * accident:
 *
 * - **A section is always rendered, even when it is empty.** A caravan that arrives
 *   while the page is open has to have somewhere to appear. Omitting the empty case
 *   would mean it never shows up until the player navigated.
 * - **Forms inside a section are submitted in place; forms outside one navigate.**
 *   That is how logging out still leaves the page, with no extra markup to remember.
 */
const section = (id, html) => `<section id="s-${id}">${html ?? ''}</section>`;

/**
 * A block with nothing in it, as one line rather than a panel.
 *
 * Six of these blocks are absent far more often than they are present — the sky is
 * clear three visits in four, contact is open for about a third of the hours of a trip
 * and not at all otherwise — and a page that renders each of those as an empty panel is
 * a page full of holes. A page that renders them as nothing at all is worse: the slot
 * stops existing, and the player stops expecting anything to appear in it.
 *
 * So: a label in a fixed column, a sentence, a hairline. Quiet enough that a calm camp
 * reads as calm, present enough that a caravan arriving has somewhere to arrive.
 */
const quiet = (label, line) =>
  `<div class="quiet"><span class="tag">${label}</span><p>${line}</p></div>`;

/**
 * A block that has something to say: a bordered box with its label in a strip.
 *
 * The label used to be an `<h2>` floating above loose content, which is how a document
 * is set and not how an instrument is. Put it in a strip across the top of the box and
 * a run of blocks reads as panels on one machine — which is also what lets the label be
 * ten pixels and still be findable, because there is a filled bar under it.
 *
 * Still an `<h2>`, because it is still the heading of that block and the page should
 * say so to anything reading it without the stylesheet.
 */
/**
 * `aside` rides in the label strip, hard right, opposite the name.
 *
 * The strip is already a full-width bar with the block's name on it, so a control that
 * belongs to the whole block — which day the glass is showing, not which day any one
 * figure on it belongs to — has a place to sit that is neither in the body nor in the
 * foot. The radio has hand-rolled exactly this shape in `.block-head` since it was
 * written; this is the same idea reaching the helper the rest of the page goes through.
 */
const block = (label, body, { wants = false, flush = false, foot = '', aside = '' } = {}) =>
  `<div class="block${wants ? ' wants' : ''}"><h2>${label}${aside}</h2>${
    flush ? body : `<div class="block-body">${body}</div>`
  }${foot}</div>`;

/** A pointer from a block on Camp to the view that holds the whole of it. */
const onward = (href, label) => ` <a href="${href}">${label} &rarr;</a>`;

/**
 * What each of those blocks says when it is empty, in one place.
 *
 * These are the only strings in the redesign that did not already exist somewhere in
 * `page-states/*.html`, and they are written to `docs/LORE.md` §7 rather than invented:
 * the observation, not the null state. Never "None", never an empty table. A camp with
 * no radio is told what it is missing and what happens without it, because that is a
 * fact about the world; it is not told that a field is unset.
 */
const NOTHING = {
  moment: 'Nobody is on the wire.',
  raid: 'No radio fitted. You will hear them when they arrive.',
  sky: 'The sky is doing nothing worth naming.',
  events: 'Nothing happened while you were gone.',
  inventory: 'Nothing they did not leave with.',
  caravan: 'Nobody at the gate, and nobody on the road here.',
  roster: 'Nobody has died here.',
  forecast: 'No glass fitted. The sky is whatever you can see of it from here.',
  direction: 'Nothing to advise until somebody is standing here.',
  expedition: 'Nobody to send.',
  post: 'No link on the road opens one yet.',
  standings: 'Neither crew has met this camp.',
};

/**
 * The camp page, in the order a check-in actually reads.
 *
 * Nothing here is styling — the look is still scaffolding — but the *sequence* is not
 * decoration, and it had drifted into the order things were built in rather than the
 * order they are used in. Four groups, and the reasoning is worth keeping because a
 * redesign will want to move all of it:
 *
 * 1. **Anything with a deadline**, which is the rule the top slot already had: a moment
 *    closing, raiders due. The sky sits with them because it changes what a trip is
 *    worth right now.
 * 2. **What happened while you were gone**, then the person it happened to and what
 *    they are carrying. The pack moved up beside the survivor: it hangs off the
 *    character, dies with them, and reading it three sections away from their health
 *    made it look like camp stores.
 * 3. **What the camp is spending on** — stores, then the two things fuel can go to.
 *    Structures and the road are now adjacent on purpose: a fitting and a link are the
 *    same 60-to-70 fuel, and the whole decision Phase 8 adds is choosing between them.
 *    Putting them a screen apart hid the only interesting question in the phase.
 * 4. **Who you can trade with**, together at last — the caravan at the gate, the post on
 *    the road, and the standings that price both. Those three were scattered across
 *    three separate places, which made a post look like a second unrelated shop.
 *
 * The graveyard stays at the bottom. It is the one thing on the page that is finished.
 */
/**
 * The parts of the page that belong to the camp rather than to any view of it.
 *
 * The mark, who this camp is, its stores, the hour across the top, the error box and
 * whatever is on the wire. Every one of them is true on all five views, and Records had
 * none of them — because it is a separate `layout()` call and simply never grew them.
 *
 * Written once and called twice, so that cannot happen again. A sixth page gets the shell
 * by using this; a page that does not use it is visibly not a view of the camp.
 */
function shell(view, pane, { error, inner }) {
  const identity = section('head', `
    <div class="who">
      <span class="tag">Camp</span>
      <h1>${escape(view.name)}</h1>
      <p>wealth ${view.wealth}<br>defence ${view.defence}<br>
         founded ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>
    </div>`);

  return `<div class="shell">
    ${rail(pane, identity, section('stores', renderResources(view.resources)))}
    <main>
    ${section('hour', hourBar(view.hour, view.place))}
    <div class="stream">
    ${section('error', error ? `<p class="error">${escape(error)}</p>` : '')}
    ${section('moment', renderMoment(view.expedition))}
    ${inner}
    </div>
    </main>
    ${EXIT}
  </div>`;
}

/**
 * The first screen, and the only one that is not the camp.
 *
 * A camp nobody has ever held used to render the whole page: five view tabs, the stores,
 * eleven panels each saying a different version of "nothing yet", the full recipe list with
 * every recipe locked — and then, around line seventy-eight of a hundred and fifty, the one
 * thing there is to do. A player who did not already know the game had no way to find it,
 * and nothing anywhere said where they were or who this was.
 *
 * So the empty camp gets its own page instead of a block on a busy one. Three beats and a
 * button: what this place is, what this camp is, who is at the gate.
 *
 * ### What it deliberately does not say
 *
 * It does not say what happened. `docs/LORE.md` §6 lists that among the load-bearing
 * absences — "not a body count, not a date, not a cause with a name" — and §7 ends with the
 * rule that protects the others: *if a line explains the world, cut it.* An opening screen
 * is exactly where that rule is hardest to keep and most worth keeping, because an opening
 * screen is where every other game explains itself.
 *
 * So the world arrives as leavings rather than as history. The towers are still standing
 * and still strung and have not carried anything in a long time; that is the whole of it,
 * and it tells a player what kind of place this is without telling them one fact about it.
 * Two sentences, statement then turn, no proper nouns, no numbers with authority — the four
 * rules of §1, applied to the one screen that most wants to break them.
 *
 * It also carries no tutorial. The camp explains itself in place, every block already says
 * what it costs and what it lacks, and a page of instructions in front of that would be a
 * worse copy of it.
 */
function openingPage(view) {
  const arriving = view.arriving;

  const gate = arriving
    ? `<p><strong>${escape(arriving.name)}</strong> is at the gate.
         ${escape(arriving.arrival)}</p>
       ${skillStats(arriving.skills)}`
    : `<p>Somebody will come along the road before the day is out.</p>`;

  return layout(
    view.name,
    `<div class="opening">
      <div class="opening-in">
        ${/*
          * The camp's name, and the mark. The same two things the rail leads with, because
          * this is the same camp and a player should recognise the header when the rail
          * appears a click later.
          */ ''}
        <h1 class="opening-name">${escape(view.name)}</h1>

        <p>The towers still stand, and the lines are still strung between them.
           They have not carried anything in a long time.</p>

        <p>What is left is what was sealed, and what nobody has reached yet.
           This camp is four walls, a garden, and enough water to start.</p>

        ${gate}

        <p class="opening-turn">Nothing here happens until somebody is standing in it.</p>

        ${/*
          * Outside any `section()`, so it navigates rather than posting in place — the same
          * rule the way out follows. There is no page to swap into yet.
          */ ''}
        <form method="post" action="/successor">
          <button type="submit" class="fill">Let them stay</button>
        </form>
      </div>
    </div>`,
  );
}

export function campPage(view, { error, pane = 'camp' } = {}) {
  /*
   * A camp nobody has ever held is not the camp page with a block in it — it is a different
   * screen, and branching here rather than at the route is what makes that unbypassable.
   * Every view lands on it, a bookmark lands on it, and the moment somebody is standing in
   * the camp it is gone for good.
   */
  if (!view.survivor && view.fallenCount === 0) return openingPage(view);

  return layout(
    view.name,
    shell(view, pane, {
      error,
      inner: `
    ${section('raid', view.underRaid ? renderRaid(view) : renderRaidWarning(view.raidExpectedAt))}
    ${section('sky', renderWeather(view.weather))}
    ${section('forecast', renderForecast(view.forecast))}

    ${/*
      * The away log and Next, side by side.
      *
      * Both are usually short — three visits in four nothing happened, and Next is one
      * sentence — and stacked full-width across a thousand pixels they read as two
      * mostly-empty bands. Paired, they fill a row and the check-in has a shape: what
      * happened, and what to do about it.
      *
      * The pair unpicks itself when the log has something in it. A list of things that
      * happened while you were gone is the longest block on the page some visits, and
      * half a column is not where you read it.
      */ ''}
    <div class="lane lane-pair">
      ${section('events', renderEvents(view.events))}
      ${section('direction', renderDirection(view.direction))}
    </div>

    ${/*
      * The people first and across the width, then the places they can be sent.
      *
      * This was two columns — the dispatch table in a 1fr lane, the survivor in a 300px
      * sidebar — which is the shape a camp of one wants. A camp of four stacks four full
      * blocks down that gutter, so the roster went wide and the eleven-row table took the
      * full width it always wanted. No wrapper: the roster is one block with the people as
      * rows in it, so there is nothing here left to arrange.
      *
      * Order is what puts the roster on top. That cost nothing elsewhere while all four of
      * these were survivor-only; the bench has since moved to the camp view and out of this
      * group, which is why it is no longer in the stream just below.
      */ ''}
    ${section(
      'survivor',
      view.roster?.length
        ? renderSurvivors(view)
        : renderNoSurvivor(view.fallenCount > 0, view.arriving),
    )}
    ${section('gate', renderGate(view.atTheGate))}
    ${section(
      'expedition',
      view.roster?.length ? renderExpeditions(view) : quiet('Away', NOTHING.expedition),
    )}
    ${section(
      'structures',
      renderStructures(
        view.structures,
        view.buildInFlight,
        Boolean(view.survivor),
        view.direction,
        !view.expedition?.moment,
        // Whose hands, and the selector that sets it. Prepared here because these four
        // functions are about a structure rather than about a camp.
        whoField(view, 'work'),
        whoSelector(view, { field: 'work', label: 'working' }),
      ),
    )}
    ${/*
      * The bench under the structures, and on the camp view rather than the survivors'.
      *
      * It was beside the people because crafting is something a survivor does. So is
      * building, and that has always lived here — what the two blocks actually share is the
      * *camp*: a workshop level gates the recipes, one crew queue serves both, and the
      * question "what should we be making" is asked in the same breath as "what should we be
      * raising". A player deciding either was reading two views to do it.
      *
      * Order matters because a pane is a CSS filter over one stream, not a page of its own —
      * so this sits below structures on screen by sitting below it here.
      */ ''}
    ${section('workshop', renderWorkshop(view))}

    ${section('road', renderRoad(view.road))}

    ${section('caravan', renderCaravan(view.caravan, Boolean(view.survivor)))}
    ${section('post', renderPost(view.post, Boolean(view.survivor)))}
    ${section('standings', renderStandings(view.standings))}

    ${section('roster', renderRoster(view.fallenCount))}`,
    }),
    { pane },
  );
}

/**
 * Events the trip log already narrates, so the page does not say them twice.
 *
 * `item_found` is really an instruction to the caller — "put this in the pack" — that
 * happens to travel in the same list as the player-facing events. The expedition's
 * own log line already reported the find in the middle of the story, so rendering
 * the event as well reads as a bug rather than as emphasis.
 */
const NARRATED_ELSEWHERE = new Set(['item_found']);

/**
 * What the sky is doing, and for how much longer.
 *
 * Shown to everyone with no upgrade required — this is weather, not intelligence.
 * The hours remaining are the useful half: a storm with four hours left is a reason
 * to wait, and one with three days left is a reason to change plan.
 */
function renderWeather(weather) {
  if (!weather || weather.length === 0) return quiet('Sky', NOTHING.sky);

  /*
   * One event is a wide cell and one narrow one; several are a full grid.
   *
   * The difference is not decoration. With one event in force there is only ever one
   * side that has anything on it, and printing an empty "In camp — " beside it spends
   * a column saying nothing. With three, both sides have to appear on every row or the
   * player cannot tell which of them a missing number belongs to — so the dash comes
   * back, and the labels repeat per row rather than sitting in a header. A header row
   * is read once; these are read per event, which is the whole point of the grid.
   */
  const sides =
    weather.length === 1
      ? ['camp', 'road'].filter((where) =>
          weather[0].effects.some((effect) => effect.where === where),
        )
      : ['camp', 'road'];

  const cells = weather
    .flatMap((event) => [
      `<div>
        <div class="sky-what">
          <span class="name">${escape(event.name)}</span>
          <span class="clock deadline">${countdown(event.endsAt, 'clearing')} left</span>
        </div>
        <p>${escape(event.description)}</p>
      </div>`,
      ...sides.map(
        (where) => `<div class="sky-side">
          <span class="tag">${where === 'camp' ? 'In camp' : 'Out there'}</span>
          ${sideOf(event.effects, where)}
        </div>`,
      ),
    ])
    .join('');

  // Two blights are worse than one, and the page had no way to say so. Only shown when
  // something is actually stacking, because for one event it would restate the row
  // directly above it — and it is the one place two events are allowed to meet.
  const foot =
    weather.length > 1
      ? `<div class="block-foot"><span class="tag">Together</span>
           <span class="val">${escape(stacked(weather))}</span></div>`
      : '';

  return block('The sky', `<div class="sky-grid cols-${sides.length + 1}">${cells}</div>`, {
    wants: true,
    flush: true,
    foot,
  });
}

/**
 * What an event costs, under the sentence about what it looks like.
 *
 * The sky used to be prose and a countdown, and prose is the wrong instrument for this:
 * a blight is on for days and slows the garden to a third, and a player was left to
 * infer that from a stores figure drifting. **The whole decision the weather offers is
 * when to spend survivor-hours** — send them under Caravan Season, keep them home under
 * a Rad Storm — and a multiplier nobody can see is not a decision.
 *
 * Multipliers rather than adjectives, because they are exact and because the page is
 * already numeric one section down. `docs/LORE.md` bars numbers with authority from the
 * *prose*, and this deliberately is not prose: it sits under the sentence, in small, in
 * the same register as "danger 4" on the dispatch table.
 */
function sideOf(effects, where) {
  const parts = (effects ?? []).filter((e) => e.where === where).map(factor);
  // An event with nothing to say on one side says so with a dash. A blank cell reads
  // as a rendering fault, and in a grid where the cell above it is full of numbers it
  // reads as a *missing* number, which is the one thing it is not.
  return parts.length > 0
    ? parts.join('')
    : '<span class="val none">&mdash;</span>';
}

/**
 * One multiplier, and whether it is costing the camp or paying it.
 *
 * The accent that makes the grid worth looking at rather than reading. Everything else
 * in the block is one colour, so a figure in oxide is found before it is read — and
 * "the sky is taking something off me" is exactly the fact a player is scanning for
 * when they glance at the weather before deciding whether to send anybody out.
 *
 * Which direction is bad depends on what is being multiplied, and there is no way
 * around knowing that: more haul is good and more dose is not. `dose` is the only
 * figure the game states where the number going up is the bad news, so it is the only
 * exception, and it is named here rather than being carried on the effect — the
 * simulation has no opinion about which of its numbers a player would rather see.
 */
function factor(effect) {
  const costs = effect.what === 'dose' ? effect.factor > 1 : effect.factor < 1;
  return `<span class="val${costs ? ' costs' : ''}">${escape(
    `${effect.what} ×${effect.factor}`,
  )}</span>`;
}

/** Everything in force, multiplied out — which is what the tick actually applies. */
function stacked(weather) {
  const totals = new Map();
  for (const event of weather) {
    for (const effect of event.effects ?? []) {
      const seen = totals.get(effect.what) ?? { ...effect, factor: 1 };
      totals.set(effect.what, { ...seen, factor: seen.factor * effect.factor });
    }
  }

  return [...totals.values()]
    .map((effect) => `${effect.what} ×${Math.round(effect.factor * 100) / 100}`)
    .join(' · ');
}

/**
 * The week ahead, as a line rather than as a sentence.
 *
 * **The chart is the reading.** Temperature is what decides how much the hour is worth —
 * heat widens the gap between day and night, cloud narrows it — so a plot of temperature
 * against time *is* a plot of how much choosing a departure hour will pay, for a week. A
 * paragraph could have said "it turns cold on Thursday"; only a line says how cold,
 * against what, and for how long.
 *
 * Three things are drawn on one set of axes because they are one question. The night
 * bands are when the discount is available; the line is how big it is; the weather blocks
 * are why it moves. Reading any of them apart from the other two would be reading a
 * different chart.
 *
 * Deliberately no axis furniture beyond two numbers and the days. This page states figures
 * where a player needs them and does not decorate them, and a temperature chart with grid
 * lines, ticks and a legend would be four times the ink for the same three facts.
 */
/**
 * Yesterday, today, tomorrow — and the name of the day being shown.
 *
 * Plain links rather than the in-place form the rest of the page posts through, because
 * this changes what is being *read* and not what the camp has done. The address is the
 * state: a reload lands on the same day, and the link can be sent to somebody.
 *
 * An arrow at the end of its reach is rendered as text rather than as a dead control. A
 * disabled-looking link that does nothing is a worse answer than no link.
 */
function dayNav(forecast) {
  const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = forecast.from.getUTCDay();

  const label =
    forecast.offset === 0
      ? 'Today'
      : forecast.offset === -1
        ? 'Yesterday'
        : forecast.offset === 1
          ? 'Tomorrow'
          : NAMES[day];

  const step = (to, glyph, title) =>
    `<a href="?day=${to}" class="f-step" title="${escape(title)}" aria-label="${escape(title)}">${glyph}</a>`;

  return `<span class="f-nav">
      ${forecast.canGoBack ? step(forecast.offset - 1, '&larr;', 'The day before') : '<span class="f-step off">&larr;</span>'}
      <span class="tag">${escape(label)}</span>
      ${forecast.canGoOn ? step(forecast.offset + 1, '&rarr;', 'The day after') : '<span class="f-step off">&rarr;</span>'}
    </span>`;
}

function renderForecast(forecast) {
  if (!forecast) return quiet('The glass', NOTHING.forecast);

  const W = 720;
  const H = 190;
  const TOP = 12;
  const FLOOR = 150;
  const RIGHT = 34;
  const plot = W - RIGHT;

  const t0 = forecast.from.getTime();
  const span = forecast.until.getTime() - t0;
  const x = (at) => ((at - t0) / span) * plot;

  // Round the ends outward to whole degrees so the axis reads in numbers a person would
  // say, and the warmest hour of the week is not drawn on the frame.
  const low = Math.floor(forecast.low) - 1;
  const high = Math.ceil(forecast.high) + 1;
  const y = (c) => TOP + (1 - (c - low) / (high - low)) * (FLOOR - TOP);

  const points = forecast.series.map((p) => ({ x: x(p.at), y: y(p.degrees), ...p }));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
  const area = `${line}L${plot},${FLOOR}L0,${FLOOR}Z`;

  /*
   * Day and night as two grounds rather than one shading.
   *
   * Night on its own could only ever be a shade darker than a page that is already nearly
   * black — there was nowhere left to go. Lifting the daylight instead gives the pair a
   * step in both directions, and a hairline at each turn makes the edge an edge: this is
   * the one boundary on the chart a player is reading *for*, and a soft one says the sun
   * fades out over an hour, which it does not.
   */
  const daylight = `<rect x="0" y="${TOP}" width="${plot}" height="${FLOOR - TOP}" class="f-daylight"/>`;

  const nights = forecast.dark
    .map((d) => {
      const from = x(d.from);
      const to = x(d.to);
      const edges = [d.from, d.to]
        .filter((at) => at > t0 && at < forecast.until.getTime())
        .map(
          (at) =>
            `<line x1="${x(at).toFixed(1)}" y1="${TOP}" x2="${x(at).toFixed(1)}" y2="${FLOOR}" class="f-turn"/>`,
        )
        .join('');
      return `<rect x="${from.toFixed(1)}" y="${TOP}" width="${(to - from).toFixed(1)}" height="${FLOOR - TOP}" class="f-night"/>${edges}`;
    })
    .join('');

  // Four or five gridlines at whole degrees, labelled on the right where the eye lands
  // after reading the line left to right.
  const step = Math.max(1, Math.round((high - low) / 4));
  const rows = [];
  for (let c = Math.ceil(low / step) * step; c <= high; c += step) {
    rows.push(`<line x1="0" y1="${y(c).toFixed(1)}" x2="${plot}" y2="${y(c).toFixed(1)}" class="f-grid"/>
      <text x="${plot + 6}" y="${(y(c) + 4).toFixed(1)}" class="f-axis">${c}°</text>`);
  }

  /*
   * The turns of the light, named on the axis under their own lines.
   *
   * These are the two hours on the chart a player is reading it *for* — when the discount
   * starts and when it stops — so they are the two that get a figure rather than a tick.
   * Brighter than the six-hourly divisions beneath them, which are only there to give the
   * day a shape.
   */
  const turns = forecast.turns.map((turn) => ({ ...turn, px: x(turn.at) }));
  const turnLabels = turns
    .map(
      (turn) =>
        `<text x="${turn.px.toFixed(1)}" y="${FLOOR + 15}" class="f-sun" text-anchor="middle">${escape(at(turn.hour, turn.minute))}</text>`,
    )
    .join('');

  // Every six hours, which is the division a day is actually read by — and the labels are
  // world hours, the same clock the strip at the top of the page is showing.
  //
  // A tick that would land under a sunrise figure is dropped rather than drawn through it:
  // the turn is the one worth reading, and two numbers on top of each other are neither.
  const clear = (px) => turns.every((turn) => Math.abs(turn.px - px) > 26);

  const days = [];
  for (let hour = 0; hour <= 24; hour += 6) {
    const at_ = t0 + hour * 3600_000;
    const px = Math.min(plot - 1, x(at_));
    const label = clear(px)
      ? `<text x="${(hour === 24 ? px - 16 : px + 5).toFixed(1)}" y="${FLOOR + 15}" class="f-axis">${String(hour % 24).padStart(2, '0')}</text>`
      : '';
    days.push(`<line x1="${px.toFixed(1)}" y1="${TOP}" x2="${px.toFixed(1)}" y2="${FLOOR}" class="f-day"/>${label}`);
  }

  /*
   * The current hour, and it moves.
   *
   * Painted where the server says it is and then walked across the day by the same tick
   * that drives the clock in the strip — the window is a fixed day, so the marker travels
   * rather than the chart scrolling under it. The attributes are what the browser needs to
   * do the arithmetic itself: the day's first instant, its span, and how many viewBox units
   * the plot is wide, which is the one number it could not otherwise know.
   */
  const nowLine = forecast.now
    ? (() => {
        const nowX = x(forecast.now.getTime());
        return `<g data-nowline data-from="${t0}" data-span="${span}" data-plot="${plot}">
          <line x1="${nowX.toFixed(1)}" y1="${TOP}" x2="${nowX.toFixed(1)}" y2="${FLOOR}" class="f-now"/>
          <circle cx="${nowX.toFixed(1)}" cy="${TOP - 4}" r="2.5" class="f-now-dot"/>
        </g>`;
      })()
    : '';

  const weather = forecast.weather
    .map((event) => {
      const from = x(event.from);
      return `<rect x="${from.toFixed(1)}" y="${FLOOR + 22}" width="${Math.max(2, x(event.to) - from).toFixed(1)}" height="5" class="f-weather"><title>${escape(`${event.name} — ${event.effects.map((e) => `${e.what} ×${e.factor}`).join(', ') || 'nothing out there'}`)}</title></rect>`;
    })
    .join('');

  // The extremes, marked where they happen. A week's high and low are the two figures a
  // forecast is actually read for, and hunting for them along a line is work the chart
  // can do instead.
  const peak = points.reduce((a, b) => (b.degrees > a.degrees ? b : a));
  const trough = points.reduce((a, b) => (b.degrees < a.degrees ? b : a));
  const mark = (p, label, dy) =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" class="f-mark"/>
     <text x="${Math.min(plot - 30, Math.max(2, p.x - 12)).toFixed(1)}" y="${(p.y + dy).toFixed(1)}" class="f-extreme">${escape(`${label} ${Math.round(p.degrees)}°`)}</text>`;

  return block(
    'The glass',
    `<div class="forecast">
      <svg viewBox="0 0 ${W} ${H}" role="img"
           aria-label="${escape(`Temperature across today, between ${forecast.low} and ${forecast.high} degrees`)}">
        <defs>
          <linearGradient id="f-wash" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" class="f-hot"/>
            <stop offset="100%" class="f-cold"/>
          </linearGradient>
        </defs>
        ${daylight}${nights}${rows.join('')}${days.join('')}${turnLabels}
        <path d="${area}" class="f-area"/>
        <path d="${line}" class="f-line"/>
        ${mark(peak, 'high', -9)}${mark(trough, 'low', 16)}
        ${nowLine}${weather}
      </svg>
      <div class="forecast-foot">
        ${/*
          * A key rather than a sentence.
          *
          * "Shaded is dark, the bar beneath is weather" made the reader hold two mappings
          * in their head and then go looking for the things they described. A swatch is
          * the thing itself: it is drawn from the same custom properties the chart is, so
          * it cannot come to disagree with the chart the way a sentence about it can.
          */ ''}
        <span class="f-key"><i class="k-day"></i>day</span>
        <span class="f-key"><i class="k-night"></i>night</span>
        <span class="f-key"><i class="k-weather"></i>weather</span>
        <span class="f-key"><i class="k-now"></i>now</span>
      </div>
    </div>`,
    { flush: true, aside: dayNav(forecast) },
  );
}

/**
 * The radio, and the whole of what it bought.
 *
 * Placed above everything else because it is the only thing on this page with a
 * deadline. Stores are all a raid can take, so the useful response to this is to
 * spend them — which is the point: a warning turns a hoard into a decision.
 */
/**
 * The camp being robbed, with the clock running.
 *
 * Reworked twice on 2026-09-01. The mechanic first: a raid is a state the camp is in for four
 * hours rather than a question with one answer, so this is an instrument you watch and act on
 * rather than a prompt. Then the block itself, because the first cut of it had **three lists
 * of the same four people** — a stat block of what had been taken, a list of who was at the
 * fence, and a list of who could be — and a paragraph explaining what all of it meant.
 *
 * One list now. A survivor is a row; a row that is ticked is somebody out there, and it grows
 * the two figures that decide whether to leave them there. Nothing appears or disappears when
 * you send somebody, which is what makes the list scannable while it changes under you.
 *
 * ### The hero is the share, not the loss
 *
 * What a player controls is how much of the drain is being held back, so that is the figure at
 * the top with the track under it — the same gauge idiom the road's live link and the survivor
 * blocks use. What is *going* is a fact about the raid rather than about them, and sits under
 * it in one line. Four stat rows for four resources was a footnote where a headline belonged.
 */
function renderRaid(view) {
  const raid = view.underRaid;
  const crew = raid.crew ? `Raiders out of ${raid.crew}` : 'Raiders';
  const since = new Date(raid.takenAt).getTime();
  const stop = new Date(raid.closesAt).getTime();
  const stand = Number(raid.stand ?? 0);

  /*
   * A figure that climbs on its own. `data-count` is what it was at `data-since`, and
   * `data-per-hour` is the rate until `data-stop` — see the counter in the client script.
   * Rendered with a real value too, so a page with no script still says something true about
   * the moment it was drawn.
   */
  const live = (from, rate, decimals = 0) =>
    `<span data-count="${from}" data-per-hour="${rate}" data-since="${since}"
           data-stop="${stop}" data-decimals="${decimals}">${n(from, decimals)}</span>`;

  const kinds = Object.keys(raid.perHour ?? {});

  /*
   * What they have carried off, read the way a trip's haul is read.
   *
   * The same `.readout` cells the Away block uses for damage, dose and haul — a label over a
   * figure, one cell per thing, ruled apart. It was a sentence with middots in it, which is
   * the shape prose takes when it is really a table: four labelled numbers pretending to be a
   * clause, wrapping badly and leaving a separator hanging at the end of a line.
   *
   * A trip's readout and a raid's are the same kind of fact — this is what happened to us
   * while we were not in control of it — so they should not be two different pictures.
   */
  const taken = `<div class="readout">${kinds
    .map(
      (kind) =>
        `<div class="read"><span class="tag">${escape(kind)}</span><span class="fig">${live(
          Number(raid.taken?.[kind] ?? 0),
          Number(raid.losingPerHour?.[kind] ?? 0),
        )}</span></div>`,
    )
    .join('')}</div>`;

  const out = new Map((raid.defending ?? []).map((one) => [String(one.id), one]));

  /*
   * What one person at the fence has been worth and what it has cost them — the two figures a
   * decision to pull them back is actually made on, and both still climbing while they stand.
   *
   * Their share of the crew's holding rather than the whole of it: three people out there are
   * each credited with their part, and the parts add up to what the camp actually kept.
   */
  const worth = (one) => {
    const held = kinds.reduce((sum, kind) => sum + Number(one.prevented?.[kind] ?? 0), 0);
    const crewSize = Math.max(1, (raid.defending ?? []).length);
    const heldRate =
      (kinds.reduce((sum, kind) => sum + Number(raid.perHour?.[kind] ?? 0), 0) * stand) / crewSize;

    return `<span class="held">held ${live(held, heldRate)}</span>
            <span class="took">took ${live(
              Number(one.damage ?? 0),
              Number(view.vitals?.raidDamagePerHour ?? 0),
            )}</span>`;
  };

  const row = (one) => {
    const away = one.busy === 'away';
    const standing = out.get(String(one.id));
    return `<li class="fencer${away ? ' off' : ''}${standing ? ' outthere' : ''}"
        data-share="${away ? 0 : Number(one.stands ?? 0).toFixed(4)}">
        <label class="pick${away ? ' off' : ''}">
          <input type="checkbox" name="who" value="${escape(String(one.id))}"${
            away ? ' disabled' : ''
          }${standing ? ' checked' : ''}>
          <span class="tag">${escape(one.name ?? 'Survivor')}</span>
        </label>
        <span class="share">${
          away ? 'on the road' : `${Math.round(Number(one.stands ?? 0) * 100)}%`
        }</span>
        <span class="tally">${standing ? worth(standing) : ''}</span>
      </li>`;
  };

  return `<div class="block wants raiding">
      <div class="block-head">
        <span class="tag">${escape(view.name ?? 'The camp')} is being raided</span>
        <span class="clock deadline">${countdown(
          raid.closesAt,
          'gone',
        )}<small>until they go</small></span>
      </div>
      <div class="block-body">
        <div class="holding">
          <div class="gauge-top"><span class="tag">holding back</span>
            <span class="val">${Math.round(stand * 100)}%</span></div>
          <div class="track">${stand > 0 ? `<i style="width:${(stand * 100).toFixed(1)}%"></i>` : ''}</div>
        </div>

        <p class="gone">${escape(crew)} are in the yard. They have taken:</p>
        ${taken}

        <form method="post" action="/raid">
          <ul class="fencers">${(view.roster ?? []).map(row).join('')}</ul>
          <div class="standers-foot">
            ${/*
               * What the boxes as they stand would hold back — before committing to it.
               *
               * The block could say what the fence *is* worth and not what it *would* be,
               * which left the only question a player actually has ("is one more worth it?")
               * unanswerable until after they had answered it. The figure is combined the way
               * the raid combines it, from the shares on the rows.
               */ ''}
            <span class="keeps">these would hold back
              <b data-fencetotal>${Math.round(stand * 100)}%</b></span>
            <button type="submit" class="fill">Set the fence</button>
          </div>
        </form>
      </div>
    </div>`;
}

function renderRaidWarning(expectedAt) {
  // No radio, so no hour — and that is a fact about the camp rather than a blank. The
  // line says what is missing and what happens without it, which is the difference
  // between an empty slot and a thing to go and build.
  if (!expectedAt) return quiet('Raiders', NOTHING.raid);

  const hoursLeft = (new Date(expectedAt).getTime() - Date.now()) / 3600000;
  if (hoursLeft <= 0) {
    return '<p class="error">The radio has gone quiet. They are overdue &mdash; reload.</p>';
  }

  return `<div class="block wants contact">
      <div class="block-head">
        <span class="tag">Radio</span>
        <span class="clock deadline">${countdown(expectedAt, 'any moment')}<small>until raiders</small></span>
      </div>
      <div class="block-body"><p>Anything still in the stores is theirs to take.</p></div>
    </div>`;
}

function renderEvents(events) {
  const shown = (events ?? []).filter((event) => !NARRATED_ELSEWHERE.has(event.type));
  if (shown.length === 0) return quiet('Away log', NOTHING.events);
  const items = shown
    .map((event) => `<li><span class="when">${escape(stamp(event.at))}</span> ${escape(describe(event))}</li>`)
    .join('');
  // aria-live because this list now grows without the page navigating: a build that
  // finishes while the player is reading is announced rather than silently appearing.
  return block(
    'While you were away',
    `<ul class="events" aria-live="polite">${items}</ul>`,
    { flush: true },
  );
}

/**
 * When it happened, as a figure rather than as the head of a sentence.
 *
 * It used to be glued to the front of every line `describe()` returns, which was fine
 * while the whole page was one monospace face. It is not fine now: a string never
 * crosses families, and a timestamp is a number sitting in front of prose. Split out so
 * the stamp can be mono and tabular and the sentence can be prose.
 */
const stamp = (at) => new Date(at).toISOString().replace('T', ' ').slice(0, 16);

function describe(event) {
  switch (event.type) {
    case 'survivor_died':
      return `your survivor died of ${event.cause} after ${n(event.daysSurvived)} days.`;
    case 'auto_consumed':
      return `with nothing left in the stores, they used a ${event.item}.`;
    case 'expedition_returned':
      return event.log.join(' ');
    case 'expedition_lost':
      return event.log ? event.log.join(' ') : 'an expedition never came home.';
    // Filtered out of the camp page by NARRATED_ELSEWHERE; kept so this stays a
    // total formatter, and so a find reported on its own still has words.
    case 'item_found':
      return `brought back ${event.qty} × ${event.slug.replaceAll('_', ' ')}.`;
    case 'build_completed':
      return `the ${event.kind.replaceAll('_', ' ')} reached level ${event.level}.`;
    case 'raid':
    case 'raid_repelled':
      return event.log.join(' ');
    case 'caravan_arrived':
      return `a caravan from ${event.name} pulled up at the gate.`;
    case 'caravan_departed':
      return `the ${event.name} caravan moved on.`;
    case 'upgrade_fitted':
      return `the crew finished fitting the ${event.name.toLowerCase()}.`;
    case 'craft_delivered':
      return `the workshop turned out ${event.qty} × ${event.name}.`;
    case 'craft_lost':
      return `the ${event.name} was finished with nobody left to take it off the bench.`;
    default:
      return event.type;
  }
}

/**
 * The consequence of a radiation figure, in the same cell as the figure.
 *
 * Not `class="error"`: that box is the alarm idiom and belongs to raids. A survivor
 * cooking gently is a thing to plan around, not an alarm — and the numbers say how
 * urgent it is far better than a colour would.
 */
function strainNote(strain) {
  if (!strain) return '';

  const clear = `clear in ${duration(strain.hoursToMending)}`;

  // Losing health, and by how much. There is no line to be "past" any more — the dose
  // costs on a curve — so the note says the rate and when it stops, which is what the
  // old sentence was using the threshold to imply.
  if (strain.state === 'burning') {
    return `<small>losing ${n(strain.damagePerHour)} health an hour, gaining again under ${Math.round(strain.tipping)} in ${duration(strain.hoursToSafe)}, ${clear}</small>`;
  }

  // Holding: the dose is taking about what rest is giving back. A real state and the one
  // the page used to describe as "not healing", which was true and told nobody why.
  if (strain.state === 'stalled') {
    return `<small>the dose is taking what rest gives back, ${clear}</small>`;
  }

  // Mending, but slowly, because the dose is smothering it. Worth saying: this is the
  // forty points of the scale where the page used to have nothing at all to report.
  //
  // Only once the slowing is worth a sentence, though. A trace of a dose costs a tenth of
  // an hour's healing, and announcing that would be the page finding something to say
  // rather than having something to say — which is the failure `NOTHING` exists to avoid.
  if (strain.healingPerHour > 0 && strain.healingPerHour < strain.fullHealing * 0.85) {
    return `<small>healing at ${n(strain.healingPerHour)} an hour, slowed by the dose, ${clear}</small>`;
  }

  return '';
}

/**
 * Somebody at the gate of a camp that already has people in it.
 *
 * The same beat as the empty camp's — a name, two sentences, one lit button — because it is
 * the same event seen twice: somebody walks up and the player decides. What differs is
 * everything around it. An empty camp is succession and the block is the only thing on the
 * page; this is a camp that is running, so it is one block among many and says who they are
 * rather than what has gone to ruin.
 *
 * Before the hour comes it is an armed timer and nothing else. `data-until` is what the
 * client script watches, so the block writes itself in at eight in the morning without the
 * player reloading — the same trick the returning expedition uses, and the reason the hour
 * is worth having at all.
 */
function renderGate(gate) {
  if (!gate) return '';

  if (!gate.wanderer) {
    return block(
      'The gate',
      `<p>The bed is made. Somebody comes up the road most mornings.</p>
       <p class="soft" data-until="${gate.dueAt.getTime()}">Nobody yet.</p>`,
    );
  }

  const who = gate.wanderer;
  return block(
    'The gate',
    `<p><strong>${escape(who.name)}</strong> is at the gate. ${escape(who.arrival)}</p>
     ${skillStats(who.skills)}
     <form method="post" action="/gate">
       <button type="submit" class="fill">Let them stay</button>
     </form>`,
    { wants: true },
  );
}

/**
 * One block per person, stacked.
 *
 * The decision on 2026-08-31, and the reason a trip is reported inside a block rather than
 * in a stack of its own: Vera's block says where Vera is, so "what is Vera doing" is one
 * place rather than two to cross-reference.
 *
 * `vitals` is the camp's rather than the person's — what each gauge counts and what moves
 * it is the same for everybody, which is why it stays one argument.
 */
/**
 * What a trip has done so far, in the person's own block.
 *
 * The same figures the Away block printed when a camp had one traveller — both deltas, both
 * signed, a dash before anything has happened. It moved here on 2026-08-31 so that a block
 * answers "what is this person doing" on its own, and the Away block could go back to being
 * only about where to send somebody.
 */
function tripReadout(away) {
  if (!away) return '';
  const report = away.report;

  const signed = (value, mark) =>
    value > 0 ? `${mark}${n(value, mark === '−' ? 0 : 1)}` : '—';

  const cells = [];
  if (report) {
    cells.push({
      tag: 'damage',
      value: signed(report.damage, '−'),
      tone: report.damage > 0 ? 'hurt' : '',
    });
    cells.push({ tag: 'rads', value: signed(report.radiation, '+') });
    for (const [kind, amount] of Object.entries(report.carrying ?? {})) {
      cells.push({ tag: kind, value: String(amount) });
    }
    if (Object.keys(report.carrying ?? {}).length === 0) cells.push({ tag: 'haul', value: '—' });
  }

  /*
   * On the ground of the place they are in.
   *
   * This was a photograph in a band above the figures, which is the shape the Away block
   * used when it was a block of its own — its own subject, its own width, the picture at the
   * top of it. Inside a roster row it is a second thing stacked on a first, and it made one
   * traveller's row twice the height of everybody else's.
   *
   * Under the figures instead, at the dispatch table's own strength: nothing is added to the
   * row, the photograph is beneath the words it belongs to, most of the way to the page's
   * grey. The same argument the table makes — a place behind a row rather than a picture
   * beside one — and now the two say it the same way, which is what makes "Coastal Wreckage"
   * on the readout and "Coastal Wreckage" in the table below read as one place.
   */
  /*
   * Where they are and when they are back, on the ground of the place itself.
   *
   * Those two facts sat under the name in the left column, in the same small line a camp
   * survivor gets for "fitting · a bed" — which is right for a job in the yard and thin for
   * a person who is not here. Being away is the largest thing true of a survivor, and the
   * photograph of where they went was already directly beside the words naming it, doing
   * nothing for them.
   *
   * So the middle column becomes the elsewhere: headed by the place and the countdown,
   * standing on a picture of it, with the trip's figures underneath. The left column goes
   * back to being who they are, which is what it says for everybody else in the roster.
   *
   * The head renders whether or not a report has arrived. A trip an hour old has nothing to
   * report yet and is no less a trip, and an empty field with a countdown running on it is
   * the honest shape of that — where somebody is does not wait on the first haul.
   */
  const figures =
    cells.length > 0
      ? `<div class="readout out-readout">${cells
          .map(
            (cell) =>
              `<div class="read"><span class="tag">${escape(cell.tag)}</span><span class="fig${
                cell.tone ? ` ${cell.tone}` : ''
              }">${escape(cell.value)}</span></div>`,
          )
          .join('')}</div>`
      : '';

  return `<div class="afield plated"${plateGround(away.regionSlug)}>
      <div class="afield-head">
        <span class="tag">away &middot; ${escape(away.regionName)}</span>
        <span class="back"><span class="short">back in</span> ${countdown(
          away.returnsAt,
          'now',
        )}</span>
      </div>
      ${figures}
    </div>`;
}

/**
 * Who does the work, chosen once for a block rather than once per row.
 *
 * Three blocks ask it now — where to send them, the structures, the bench — and the
 * reasoning is the same for all three: a roster repeated on eleven rows is one decision
 * asked eleven ways, and you know who is free before you know what to set them to.
 *
 * Only the free are offered. The service checks again behind this, because the page is a
 * render of a moment ago and somebody can be sent from another tab.
 */
/*
 * What an occupation is called, in one place.
 *
 * `occupations` answers with a kind — the word the service refuses by — and two things
 * render it: the disabled option in a selector, and the line under a survivor's name. They
 * have to agree, or the page says a person is crafting where the dropdown says they are at
 * the bench and the player is left wondering whether those are two different jobs.
 */
const OCCUPIED_AS = Object.assign(Object.create(null), {
  away: 'away',
  building: 'building',
  fitting: 'fitting',
  crafting: 'at the bench',
  sleeping: 'asleep',
});

const occupiedAs = (busy) => OCCUPIED_AS[busy] ?? busy;

/*
 * The same, with the job named — "fitting · a bed" rather than "fitting".
 *
 * Which is the version a survivor's own block wants and a dropdown does not: the block is
 * answering "what is this person doing", where an option in a list is only answering
 * "can I pick them", and a name trailing four more words in a narrow select is a worse
 * answer to that question than a short one.
 *
 * Middot, because that is how this line already joins its parts when somebody is away.
 */
const occupiedFully = (busy, what) =>
  what ? `${occupiedAs(busy)} &middot; ${escape(what)}` : escape(occupiedAs(busy));

function whoSelector(view, { field, label }) {
  const roster = view.roster ?? [];
  if (roster.length === 0) return '';

  const free = roster.filter((one) => !one.busy);
  if (free.length === 0) {
    /*
     * Nobody, and only that.
     *
     * This used to name everybody and what they were doing — "Hansert is away, Wren is
     * fitting" — which is a roster printed into a label strip, and printed again on the
     * next block, and the next. Three blocks ask who, so a camp with nobody free said the
     * same sentence three times across one screen while the strips it sat in were meant to
     * be captions. What each survivor is doing belongs under their own name, in their own
     * block, once; the strip only has to say the choice is closed.
     */
    return '<span class="f-nav"><span class="short">no survivor available</span></span>';
  }

  /*
   * The busy are listed and cannot be chosen, rather than quietly dropped.
   *
   * The bench's rule, and the moment options': an option you cannot take keeps its place and
   * says why, because a name that vanishes from a list reads as a bug rather than as a
   * person who is occupied. Disabled, so the browser refuses the choice before the service
   * has to — and the service refuses it again, because the page is a render of a moment ago.
   */
  const option = (one) =>
    one.busy
      ? `<option value="${escape(String(one.id))}" disabled>${escape(
          one.name ?? 'Survivor',
        )} — ${escape(occupiedAs(one.busy))}</option>`
      : `<option value="${escape(String(one.id))}">${escape(one.name ?? 'Survivor')}</option>`;

  return `<span class="f-nav"><span class="tag">${escape(label)}</span>
      <select data-whopicks="${escape(field)}" aria-label="${escape(label)}">${roster
        .slice()
        .sort((a, b) => Number(Boolean(a.busy)) - Number(Boolean(b.busy)))
        .map(option)
        .join('')}</select></span>`;
}

/** The hidden field a row carries, kept in step with the block's selector. */
function whoField(view, field) {
  const free = (view.roster ?? []).filter((one) => !one.busy);
  if (free.length === 0) return '';
  return `<input type="hidden" name="who" data-whofield="${escape(field)}" value="${escape(
    String(free[0].id),
  )}">`;
}

function renderSurvivors(view) {
  if (!view.roster?.length) return '';

  /*
   * Which card shows as chosen, decided the same way the table decides it.
   *
   * whoField writes the first free survivor's id into all eleven hidden fields when the
   * page is built, so the card that reads as picked and the person who would actually walk
   * out of the gate are the same one before a line of script has run. Get these two from
   * different places and a player with JavaScript off sends somebody they did not pick.
   */
  const chosen = view.roster.find((one) => !one.busy)?.id ?? null;

  /*
   * One tab strip for the whole roster, because there was only ever one tab.
   *
   * Every survivor carried their own, and the switch is a single attribute on <body> — so
   * four strips were four copies of one control, always in the same state, and clicking any
   * of them moved all four. A control that cannot disagree with its neighbours is not four
   * controls. It is one, printed four times.
   *
   * "aria-controls" takes a list, which is exactly the shape of the truth here: one tab, and
   * every person's panel for it.
   */
  const panelId = (person, tab) => `survivor-${person.id}-${tab}`;
  const tabs = `<span class="tabs" role="tablist" aria-label="Survivors">${SURVIVOR_TABS.map(
    ([id, label]) =>
      `<button type="button" class="tab" data-survivortab="${id}"
               role="tab" aria-controls="${view.roster
                 .map((person) => panelId(person, id))
                 .join(' ')}">${label}</button>`,
  ).join('')}</span>`;

  const people = view.roster
    .map((person) =>
      renderSurvivor(person, person.strain, view.vitals, person.inventory, chosen, panelId),
    )
    .join('');

  return block('Survivors', people, { flush: true, aside: tabs });
}

function renderSurvivor(survivor, strain, vitals, inventory, chosen, panelId) {
  /*
   * What this one is, under how they are doing — as figures now rather than as a sentence.
   *
   * The sentence said the skills were there and refused to say how much: "careful with a
   * dose, and unhurried about a haul" is the same phrase at ×0.9 as at ×0.7. The two
   * numbers decide where this survivor can profitably be sent, so the page prints them.
   */
  const who = skillStats(survivor.skills);

  /*
   * The tabs are built once, up in renderSurvivors, and ride in the block's label strip.
   *
   * The switch lives on <body> rather than in here, which is the same trick PANES uses one
   * level up and for the same reason and one more. The reason: a grouping expressed in CSS
   * from outside leaves the markup it groups untouched, so nothing in here has to know it is
   * in a tab. The extra one: this section is swapped in place whenever anything changes, and
   * any state held inside it — a checked radio, an .on class, an open details — is destroyed
   * by that swap. A player watching the skills tab would be thrown back to the gauges every
   * time a timer fired. The body attribute is outside the swapped region and survives it.
   */

  /*
   * Number first, bar second — and the bar is the reason this is not a table.
   *
   * Three figures in a two-column table are three facts you have to compare by reading.
   * The same three over 2px tracks are a shape: a player can see at a glance that
   * health is nearly full and rads are creeping up without parsing a single digit, and
   * only reads the number once the shape has told them there is something to read.
   *
   * Radiation is measured against the threshold it starts burning at rather than
   * against a hundred, because that is the number the survivor's life depends on and
   * the only one the track can honestly be full of.
   */
  /*
   * A gauge, and beneath its label whatever is acting on it right now.
   *
   * The note under a gauge explains the *scale* — "food drawn 0.5/h", "starves at 70" — and
   * reads the same for everybody in every state, because it is the rules rather than the
   * reading. The marks are this person in this hour: out on the road so nothing is
   * scrubbing, resting and drinking six times a mouth for it, too hungry to heal.
   *
   * Recovery's cost on the stores was real and invisible from the day it shipped — derivable
   * from three numbers on two blocks, which is to say not derived. A mark that says
   * "resting ×6" and explains itself on hover is the difference between a cost the game
   * charges and a cost the player can see being charged.
   *
   * Each mark is its own `.noted`, nested inside the gauge's. That works because the popup
   * takes a host's own note rather than the first one under it — see the handler in TIMERS.
   */
  /*
   * The same facts twice, and only one of them is ever on screen.
   *
   * A pointer gets **signs**: one glyph an effect, beside the gauge's name, explaining
   * itself on hover. That is the whole of what a mark needs to be for somebody who can
   * hover — the strip of words underneath cost a line of every gauge and said in six
   * words what the popup was going to say properly anyway.
   *
   * A finger gets the **words**, because a glyph with no hover is a rune. This is the same
   * split `.note` itself has used since it was written: `@media (hover: hover)` decides
   * which, and neither device is shown the other's version.
   *
   * `aria-label` carries the word onto the glyph, so the two are one fact to a screen
   * reader rather than a symbol and an orphaned duplicate.
   */
  const signs = (list) =>
    (list ?? []).length === 0
      ? ''
      : `<span class="signs">${list
          .map(
            (one) =>
              `<span class="sign noted" aria-label="${escape(one.tag)}">${escape(
                one.sign ?? '•',
              )}<span class="note">${escape(one.note)}</span></span>`,
          )
          .join('')}</span>`;

  const marks = (list) =>
    (list ?? []).length === 0
      ? ''
      : `<div class="drivers">${list
          .map(
            (one) =>
              `<span class="driver noted">${escape(one.tag)}<span class="note">${escape(
                one.note,
              )}</span></span>`,
          )
          .join('')}</div>`;

  /*
   * A gauge with nothing happening to it steps back.
   *
   * Four gauges a survivor, and on a rested camp every one of them reads the same
   * uninteresting thing: full health, no hunger, no dose, full stamina. Five people is
   * twenty figures saying nothing, and what a player is scanning a roster for is the one
   * that is not saying nothing.
   *
   * Dimmed rather than dropped, which is the argument worth writing down. The roster is
   * rows so that figures line up across people — health under health, the dose under the
   * dose — and that column is the whole of what makes four survivors comparable at a
   * glance. Gauges that come and go make every row a different shape and there is no column
   * left to read down. It would also make "fine" and "not rendered" the same picture, which
   * is the fault `NOTHING` exists to avoid one level up: a slot that disappears stops being
   * a slot a player expects anything to appear in.
   *
   * So it keeps its place and loses its weight — no track, no accent on the figure, the
   * label at the grey the page uses for something that is merely present. Anything acting
   * on it wakes it up, whatever the number says.
   */
  /*
   * Every gauge, always. What comes and goes is the marks under it.
   *
   * This spent an afternoon not rendering a gauge that had nothing acting on it, which was
   * a misreading of the note it was written from: the four figures are the reading, and a
   * reading that disappears when it is unremarkable is a reading you cannot trust to be
   * there. Full health is a fact about a survivor; a blank where it should be is not.
   *
   * `resting` stays in the signature because the marks still use it — see `driversFor`.
   */
  const gauge = (label, value, of, note, tail = '', acting = []) => {
    return `<div class="gauge noted g-${label.toLowerCase()}">
      <div class="gauge-top"><span class="tag">${label}</span>${signs(acting)}
        <span class="val">${n(value)}</span></div>
      <div class="track">${
        value > 0 ? `<i style="width:${bar(value, of)}%"></i>` : ''
      }</div>${marks(acting)}${tail}${note}
    </div>`;
  };

  const said = gaugeNotes(strain, vitals);

  /*
   * Who goes, asked on the person rather than in a caption two blocks down.
   *
   * It was a dropdown in the dispatch table's label strip, which is a fine place for a
   * setting and a poor one for half the decision — and with a roster it is half: where to
   * send somebody and which somebody are the same size of question now. A card is already
   * the person, so the choice belongs on it, and picking it names the button on all eleven
   * rows so the table stops asking something the page has already answered.
   *
   * A radio rather than a button, and outside any form: it submits nothing. The eleven
   * dispatch forms carry the id in a hidden field the script keeps in step, exactly as the
   * dropdown fed them — so this changes where the question is asked and not how it travels.
   *
   * The busy keep a control they cannot use, which is the rule the bench rows and the
   * moment options follow: an option that vanishes reads as a bug where one that is there
   * and refuses reads as a person who is occupied. Why they are occupied is two lines up on
   * this same card, so the label does not say it twice.
   */
  /*
   * Sleep, under the sending radio, because the two are the same question asked twice.
   *
   * What this card decides about a person is what to do with the hours they have: send them
   * somewhere, or spend the hours getting the hours back. Phase 10's fifth decision is that
   * sleep is an accelerator and never a requirement — recovery happens anyway at a point an
   * hour — so what the player is buying here is speed, and what they pay is that this person
   * cannot be asked to do anything until they wake. There is no waking them.
   *
   * ### Refusing without saying why, on purpose
   *
   * Two states disable it and neither gets a sentence. Busy is written under the name, two
   * lines up on this same card, and repeating it beside the control is the fault the sending
   * radio already avoids. Rested is the stamina gauge in the row beside this one reading a
   * hundred — a reason a player can see is not a reason worth printing.
   *
   * The control keeps its place in both, which is this page's rule everywhere: an option
   * that vanishes reads as a bug where one that refuses reads as a person who is occupied.
   */
  const rested = Number(survivor.stamina) >= 100;
  const canSleep = !survivor.busy && !rested;
  const rest = `<form class="rest" method="post" action="/sleep">
      ${/* Whose hours. The page has a roster and the service will not guess. */ ''}
      <input type="hidden" name="who" value="${escape(String(survivor.id))}">
      <select name="hours" aria-label="how long${
        survivor.name ? ` ${escape(survivor.name)} sleeps` : ''
      }"${canSleep ? '' : ' disabled'}>${(vitals?.sleepHours ?? [])
        .map((h) => `<option value="${escape(String(h))}">${escape(String(h))}h</option>`)
        .join('')}</select>
      <button type="submit"${canSleep ? '' : ' disabled'}>Sleep</button>
    </form>`;

  const goes = `<div class="goes">
      <label class="pick${survivor.busy ? ' off' : ''}">
        <input type="radio" name="sending" value="${escape(String(survivor.id))}"
               data-whopicks="send" data-whoname="${escape(survivor.name ?? 'Survivor')}"
               ${survivor.busy ? 'disabled' : ''}${
                 !survivor.busy && String(survivor.id) === String(chosen) ? ' checked' : ''
               }>
        <span class="tag">sending</span>
      </label>
      ${(vitals?.sleepHours ?? []).length > 0 ? rest : ''}
    </div>`;

  /*
   * A row in the roster rather than a panel of its own.
   *
   * Every survivor used to be a whole block — its own header, its own tab strip, its own
   * border — which is what a camp of one deserves and what a camp of four cannot carry: four
   * headers all saying "Survivor", four copies of one control, four frames around what is
   * really one list. So the frame went up a level and the person came down to a row.
   *
   * Three columns, because at full width the alternative is a name with a great deal of
   * nothing beside it: who they are and what has them on the left, the open tab in the
   * middle, and whether they are the one going at the right end where the eye lands last.
   */
  return `<div class="person">
     <div class="who-head">
       <div class="who-name">${escape(survivor.name ?? 'Survivor')}</div>
       ${
         /*
          * Where they are, beside the tabs rather than behind one.
          *
          * Health and radiation keep moving while somebody is out — the dose accrues across
          * the walk since Phase 11 — so putting the trip in a tab would hide the numbers most
          * worth watching at the moment they move fastest.
          */
         /*
          * What has them, when what has them is a job in the yard.
          *
          * Being away used to print here too, and it outgrew the slot: a place and a
          * countdown are not the same size of fact as "fitting · a bed", and the picture of
          * that place was sitting inertly beside the words. It heads its own field now, in
          * the middle column — see tripReadout. This line is for the work that keeps
          * somebody in the camp, which is genuinely a footnote to their name.
          */
         survivor.busy && !survivor.away
           ? `<p class="out">${
               /*
                * Asleep is the one occupation with an hour attached, so it gets the treatment
                * being away gets: the state, then the clock. Every other job on this line
                * finishes when the camp's own countdown says so and is named instead — see
                * occupiedFully. Without the hour, "asleep" is a state a player cannot plan
                * around, which is the opposite of what committing the hours was for.
                */
               survivor.busy === 'sleeping' && survivor.sleepUntil
                 ? `asleep &middot; wakes in ${countdown(survivor.sleepUntil)}`
                 : occupiedFully(survivor.busy, survivor.busyWith)
             }</p>`
           : ''
       }
     </div>
     <div class="who-body">
       ${
         survivor.away
           ? `${/*
                * The place they are in, back where it belongs.
                *
                * The Away block carried an <img> of the region — the one placement where a
                * plate is a picture rather than ground, because there the place is the
                * subject: one region, for however many hours, with the countdown on it.
                * When the reports moved onto the survivors the image did not come with
                * them, and "away · Coastal Wreckage" went back to being a string. It reads
                * like a form field, and the eleven photographs exist precisely so that
                * being out there is not a form field.
                *
                * The rest of the block is already here — the readout is the same readout,
                * the countdown is on the line under the name — so this is the one part that
                * was dropped rather than moved.
                */ ''}
              ${tripReadout(survivor.away)}
              ${/*
                 * The armed timer that fetches the next window.
                 *
                 * It lived on the Away block's trip report, and moving the reports onto the
                 * survivors left it defined and never called — so the Contact box stopped
                 * arriving on its own and only appeared if you happened to reload inside a
                 * window. The db suite caught it. One per traveller, which is what a roster
                 * needs: each trip arms for its own next moment.
                 */ ''}
              ${survivor.away.report ? momentAlarm(survivor.away.report) : ''}`
           : ''
       }
       <div class="tabbed" id="${panelId(survivor, 'condition')}" data-tab="condition" role="tabpanel">
         <div class="gauges">
           ${gauge('Health', survivor.health, 100, said.health, '', survivor.drivers?.health)}
           ${gauge('Hunger', survivor.hunger, 100, said.hunger, '', survivor.drivers?.hunger)}
           ${gauge(
             'Radiation',
             survivor.radiation,
             strain?.threshold ?? 100,
             said.radiation,
             strainNote(strain),
             survivor.drivers?.radiation,
           )}
           ${/*
             * Phase 10's gauge, and the first time `characters.stamina` has been on a page.
             *
             * Fourth rather than first because it is the one that says what a survivor can
             * do next rather than how they are: health, hunger and the dose are their
             * condition, and this is their day.
             */ ''}
           ${gauge('Stamina', survivor.stamina, 100, said.stamina, '', survivor.drivers?.stamina)}
         </div>
       </div>
       <div class="tabbed" id="${panelId(survivor, 'skills')}" data-tab="skills" role="tabpanel">
         ${who}
       </div>
       <div class="tabbed" id="${panelId(survivor, 'carrying')}" data-tab="carrying" role="tabpanel">
         ${inventoryBody(inventory, survivor.id)}
       </div>
     </div>
     ${goes}
   </div>`;
}

/**
 * What each gauge counts, which way is bad, and what moves it — as a stat block.
 *
 * Played on 2026-08-24: the block read `HUNGER 0.0` and `RADIATION 0.7` and said nothing
 * else. Both numbers were fine and both were unreadable — 0.0 hunger is a survivor who
 * has just eaten, and the obvious reading of it is a survivor with nothing to eat. The
 * scale is not guessable either: health and hunger run to 100, radiation is drawn
 * against the dose it starts burning at, and each of the three is moved by something
 * different.
 *
 * The first cut of this was three paragraphs, and prose was the wrong instrument: a
 * player checking what hunger costs does not want to read a sentence to find `-12/h`
 * inside it. Every one of these facts is a label and a figure, so it is written as a
 * label and a figure — a scale on top, rates under it, in the numeric face the rest of
 * the panel already counts in.
 *
 * It rides in the note that follows the cursor, the same idiom the structures and the
 * bench use, so the panel keeps the three numbers a player came to read and the rates
 * behind them are one hover away.
 *
 * Every figure comes from `vitals`, which is `CONFIG` — a balance pass that halves the
 * regen rate changes this block with it, and cannot leave the page quoting the old
 * number. Written to survive a missing `vitals` too, because a note is an explanation
 * and a page that throws rather than render one is a bad trade.
 */
function gaugeNotes(strain, vitals) {
  if (!vitals) return { health: '', hunger: '', radiation: '', stamina: '' };

  /*
   * The dose at which this survivor stops gaining health and starts losing it.
   *
   * Read off `strain` rather than named as a constant, because there is no constant any
   * more: radiation damages on a curve and smothers healing in proportion, so the crossing
   * point falls out of the two and moves with medicine. It was `strain.threshold` until
   * the cliff was removed, and that field going away silently left this printing 100 —
   * a fallback doing the work of a value, which is the quietest way for a page to lie.
   */
  const tipsAt = rate(strain?.tipping ?? 65);
  // Filtration is bolted to the purifier and does not follow anyone into the Deep Zone,
  // so the camp's figure and the road's figure are two different numbers whenever it is
  // fitted — and the difference is the whole of what the upgrade sells.
  const scrubs =
    vitals.radDecayPerHour > vitals.radDecayBasePerHour
      ? [
          ['scrubbed in camp', `-${rate(vitals.radDecayPerHour)}/h`],
          ['out on the road', `-${rate(vitals.radDecayBasePerHour)}/h`],
        ]
      : [['decays', `-${rate(vitals.radDecayBasePerHour)}/h`]];

  return {
    health: stats('0 – 100 · 0 is a grave', [
      ['heals', `+${rate(vitals.regenPerHour)}/h clear`],
      // Healing fades with the dose rather than stopping at a line, so this says what it
      // is worth rather than when it switches off — which is what the old
      // "rads < 20" row was claiming and is no longer true at any dose.
      ['slowed by', 'the dose, in proportion'],
      ['only while', `hunger < ${rate(vitals.regenHungerCeiling)}`],
      ['starving', `to -${rate(vitals.starvationDamagePerHour)}/h`],
      ['irradiated', `to -${rate(vitals.radDamagePerHour)}/h`],
    ]),
    hunger: stats('0 fed – 100 starving', [
      ['eating', `-${rate(vitals.hungerFallPerHour)}/h`],
      ['food drawn', `${rate(vitals.eats.food)}/h`],
      ['water drawn', `${rate(vitals.eats.water)}/h`],
      ['nothing to eat', `+${rate(vitals.hungerRisePerHour)}/h`],
      /*
       * Where recovery is paid for, which is the one thing about this gauge a player cannot
       * work out by watching it. Nothing else in the game takes food but a mouth, so the
       * chain a player has to hold is stores, then hunger, then stamina — and this is the
       * middle link stated on the gauge it lands on.
       */
      ['recovering', `+${rate(vitals.staminaRecoveryHungerPerPoint)} a point`],
      ['starves at', `${rate(vitals.starvationThreshold)}+`],
    ]),
    /*
     * What a survivor's day is worth, which is the one gauge that says what they may do
     * rather than how they are.
     *
     * The rows are the whole mechanic: every kind of work spends it at one rate, danger does
     * not touch it, rest pays it back on its own, sleep pays it back faster, and recovery of
     * either kind is work enough to eat for. The last row is the refusal a player will
     * actually meet — a walk they cannot finish is a walk the gate will not open for.
     *
     * Sleep is one row because one figure is the whole of it: it is the work rate read
     * backwards, so an hour under undoes an hour out. The rations row covers both kinds of
     * recovery, and says per point rather than per hour for the reason it is true — sleep
     * costs the same food as dozing and takes a quarter of the time.
     */
    stamina: stats('0 – 100 · a day’s walking', [
      ['any work', `-${rate(vitals.staminaPerHourWorked)}/h`],
      ['danger', 'costs none of it'],
      ['resting', `+${rate(vitals.staminaRegenPerHour)}/h`],
      ['asleep', `+${rate(vitals.staminaSleepPerHour)}/h`],
      ['costs', `${rate(vitals.staminaRecoveryHungerPerPoint)} hunger a point`],
      /*
       * The row that says where a sleep's price actually falls.
       *
       * Without it the block reads as though sleeping were simply four times better, and the
       * cost — hunger climbing at the unfed rate for as long as it runs — is on the other
       * gauge with nothing here pointing at it.
       */
      ['asleep, eating', 'nothing at all'],
      ['a trip needs', 'enough for all of it'],
    ]),
    radiation: stats('0 – 100 · carried in from the road', [
      ...scrubs,
      // Two rows where there used to be two thresholds, and both are now facts about the
      // whole scale rather than lines on it: every dose costs something, and the crossing
      // point is where the cost overtakes the rest.
      ['costs health', 'at every dose'],
      ['net loss above', `${tipsAt}`],
    ]),
  };
}

/**
 * A heading and a column of figures. **This is the house style for anything a popup
 * explains**, and the rule is worth stating rather than leaving to be noticed.
 *
 * > A number belongs in a row. Prose is for what a number cannot say.
 *
 * Concretely: a popup opens with a heading, may carry **one** short line for the thing a
 * figure cannot carry — what a place is like, what a structure is for — and everything
 * measurable after that is `[key, value]`. Not a sentence with figures embedded in it.
 *
 * **And only the figures that were asked for.** The rule is not "tabulate everything known
 * about the subject". The marks beside a gauge went from prose to a five-row table each and
 * that was worse, not better: a mark is a footnote to a number already on screen, and the
 * question behind hovering a triangle is "what is that" — "out there −3.8/h" is the whole
 * answer. A table belongs where the subject is the whole point of the popup, which is what
 * a gauge's own scale and a fitting's terms are. Short is part of the style, not a failure
 * to apply it.
 *
 * The reason is what the reader is doing. "Paying back stamina is work of a kind, and they
 * eat for it — 3 food and 4.5 water an hour out of the stores, against 0.5 and 0.8 for
 * somebody idle" holds four numbers and makes each of them a small excavation. The same
 * four in a column are read at a glance, and — the part that matters on a roster — they
 * line up with the same four on the survivor underneath. A player comparing two people is
 * doing arithmetic, and prose is the one format that cannot be scanned down a page.
 *
 * It is also what the game is. Every other surface here already gave up prose for figures:
 * the gauges, the skills, the trip readout, the dispatch table. A popup that still writes
 * paragraphs is the last place reading like documentation instead of like a game.
 *
 * One element, whether it is read inline on a phone, announced by a screen reader in
 * document order, or lifted into the note that follows the cursor — the script clones
 * this rather than copying its text, so there is still exactly one copy of every figure.
 */
function stats(scale, rows) {
  const line = ([key, value]) =>
    `<span class="stat-row"><span class="k">${escape(key)}</span><span class="v">${escape(value)}</span></span>`;

  return `<span class="note">
      <span class="stat-head">${escape(scale)}</span>
      ${rows.map(line).join('\n      ')}
    </span>`;
}

/** A per-hour figure, where "12.0/h" is a machine talking and "12/h" is a number. */
function rate(value) {
  const figure = Number(value);
  if (!Number.isFinite(figure)) return '?';
  return figure.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * A region's plate.
 *
 * Eleven photographs of eleven places, one per slug in `REGIONS`, in `public/img`.
 * `docs/DESIGN-BRIEF.md` §2.1 puts illustration on the restraint list because the
 * atmosphere is supposed to live in the prose, and a picture that competes with "Things
 * still grow here. That is the problem." has taken something the writing was holding.
 *
 * So it is never a picture. It is ground: a photograph underneath the words it belongs to,
 * most of the way to the page's own grey, in the two places that are about one region —
 * the dispatch row you would send somebody to, and the readout of the trip somebody is on.
 * It began as a 168px thumbnail in a fifth column of the table, which was a picture beside
 * a row rather than a row with a place behind it, and it cost the description a chunk of
 * the only measure it had.
 *
 * It was also an <img> band at the top of the Away block, back when that block was one
 * region for eighteen hours and had the width to be about it. The trip reports live in a
 * roster row now, where a band is a second thing stacked on a first — one traveller's row
 * standing twice as tall as everybody else's — so both placements are grounds, and there
 * is nothing here that renders an <img>. That is why the load-failure handler is gone from
 * the client script too: a background that 404s paints nothing, all by itself.
 *
 * A slug with no file therefore costs nothing: the row simply has no ground.
 */

/**
 * The same plate as a custom property for the row to use as its background.
 *
 * A style attribute, which nothing else in this file uses, and the reason is that this
 * is the one value the stylesheet cannot know: there is one row per region and the file
 * is named after the slug. What the attribute carries is a URL and nothing else — every
 * decision about how it looks stays in `PANE_CSS` with the rest of the design.
 *
 * The slug is checked rather than escaped. Escaping is the wrong tool inside a CSS
 * url(), where the delimiters are different and a quote is not the only thing that can
 * break out; a slug is `[a-z0-9_]` by construction in `seed.js`, so anything else is a
 * bug upstream and gets no background rather than a guess at what it meant.
 */
function plateGround(slug) {
  if (!/^[a-z0-9_]+$/.test(String(slug ?? ''))) return '';
  return ` style="--plate:url(/img/${slug}.webp)"`;
}

/** A track's fill, clamped and rounded — a width is not worth fifteen decimals. */
function bar(value, of) {
  if (!(of > 0)) return 0;
  return Math.round(Math.max(0, Math.min(100, (100 * value) / of)) * 100) / 100;
}

/**
 * The empty camp. A camp nobody has ever held is not a camp that has been abandoned,
 * and telling a brand-new player their stores have spoiled would be a lie on the
 * first screen they see.
 */
function renderNoSurvivor(everHeld, arriving) {
  const preamble = everHeld
    ? `<p>Structures have fallen into disrepair and much of the store has spoiled or
         been taken.</p>`
    : `<p>Four walls, a garden, and enough water to start. It needs somebody in it.</p>`;

  // Who is at the gate, named before the button rather than after it. The name box that
  // used to sit here is gone: a survivor is somebody who turned up, and the page says so
  // by telling the player who *has* turned up and offering one button about it. There is
  // deliberately nothing to reroll — reloading shows the same person, because
  // `wandererFor` derives them from the camp and the count of everyone before them.
  const atTheGate = arriving
    ? `<p><strong>${escape(arriving.name)}</strong> is at the gate.
         ${escape(arriving.arrival)}</p>
       ${skillStats(arriving.skills)}`
    : '';

  // The one lit control on the page, and the only thing there is to do. Nothing else on
  // an empty camp is a decision, so nothing else takes the fill.
  return block(
    'The camp stands empty',
    `${preamble}
     ${atTheGate}
     <form method="post" action="/successor">
       <button type="submit" class="fill">${everHeld ? 'Let them take it on' : 'Let them stay'}</button>
     </form>`,
    { wants: true },
  );
}

/**
 * A moment, in the top slot beside the raid warning.
 *
 * That slot's rule is that the only thing on the page with a deadline goes first, and a
 * closing window is the second thing to qualify. It is deliberately *not* given
 * `class="error"` — that box is the alarm idiom and a moment is an invitation. A warned
 * option is the exception, and carries its warning where every other option carries its
 * price.
 *
 * The one-line context sentence duplicates what the Away section says further down, on
 * purpose: a decision needs its facts beside it, and making somebody scroll to find out
 * whether 34 health is bad would be the whole design failing at the last inch.
 */
/**
 * The button, or the reason there isn't one.
 *
 * Same shape as the bench, deliberately: a recipe you cannot afford keeps its row and
 * says which workshop level it wants, because hiding it hides the goal. An option
 * priced in a dose the survivor is not carrying is the same case — it is a real option
 * on a real trip, and what it is missing is a thing you can go and craft. What it must
 * never do is look identical to an option you can take and refuse after the click,
 * which is what it did until 2026-08-19, on a window with eleven minutes left on it.
 */
function momentAction(moment, option, filled) {
  if (option.missing) return `<span class="short">needs ${escape(option.needs)}</span>`;

  return `<form method="post" action="/moment">
            <input type="hidden" name="index" value="${moment.index}">
            <input type="hidden" name="option" value="${escape(option.key)}">
            <button type="submit"${filled ? ' class="fill"' : ''}>Choose</button>
          </form>`;
}

function renderMoment(expedition) {
  const moment = expedition?.moment;
  if (!moment) return quiet('Contact', NOTHING.moment);

  /*
   * Which choice wears the filled button, and it is not "the first one".
   *
   * The rule is that exactly one option is filled and it is never the dangerous one:
   * marking the card would tell the player the encounter is dangerous, which they can
   * see; marking the option tells them which decision kills them, which is the true
   * thing and the only thing worth an accent. So the fill goes to the first option
   * that is neither warned nor priced in something the survivor is not carrying — and
   * if every option is one of those, nothing is filled and no choice is a default.
   */
  const filled = moment.options.find((option) => !option.warned && !option.missing);

  // The glyph goes on the consequence, not on the title. A title says what you would be
  // choosing; the consequence says what it would cost, and the warning is about the
  // cost. Marking the title would read as "this option is disabled".
  const choices = moment.options
    .map(
      (option) => `<div class="choice${option.warned ? ' warned' : ''}">
        <span class="title">${escape(option.label)}</span>
        <span class="detail">${
          option.warned ? '<span class="glyph">&#9888;</span>' : ''
        }<span>${escape(option.detail)}</span></span>
        ${effects(option)}
        ${momentAction(moment, option, option === filled)}
      </div>`,
    )
    .join('');

  const warned = moment.options.some((option) => option.warned);

  // Said once, under the choices, and only where a chip actually needs it. Pressing on
  // and sheltering scale the hours that are left rather than the trip, so "+55% haul"
  // is true of the rest of the walk and not of what comes home — which is a footnote,
  // not something every chip should have to carry in its own eleven characters.
  const scaled = moment.options.some((option) =>
    (option.effects ?? []).some((effect) => effect.label.includes('from here')),
  );

  // The state line is the facts the decision needs, beside the decision. It duplicates
  // what the Away report says on the Survivor view, on purpose and now more than ever:
  // the two are a click apart, and making somebody go and look up whether 34 health is
  // bad would be the whole design failing at the last inch.
  return `<div class="block contact${warned ? ' warned' : ''}">
      <div class="block-head">
        <span class="tag">Contact</span>
        <span class="clock deadline">${countdown(moment.closesAt, 'gone')}<small>to answer</small></span>
      </div>
      <div class="block-body">
        <p class="state">${escape(condition(expedition))}</p>
        ${moment.title ? `<p class="subject">${escape(moment.title)}</p>` : ''}
        ${moment.scene ? `<p class="scene">${escape(moment.scene)}</p>` : ''}
        <p class="turn">${escape(moment.prose)}</p>
      </div>
      <div class="choices">${choices}</div>
      ${scaled ? '<p class="footnote">Haul and rads change only for what is left of the trip.</p>' : ''}
    </div>`;
}

/**
 * What an option does, in figures, under the sentence that says how it feels.
 *
 * The list is derived in `optionEffects` and only laid out here — this function knows
 * nothing about hours or hazards and must not learn, or there would be two accounts of
 * what an option costs and one of them would go stale.
 *
 * A real list rather than a row of spans: three of these sit side by side and a screen
 * reader should say how many there are before reading them out, the same way the eye
 * counts them.
 */
function effects(option) {
  const chips = option.effects ?? [];
  if (chips.length === 0) return '';

  return `<ul class="effects">${chips
    .map((effect) => `<li class="eff ${effect.tone}">${escape(effect.label)}</li>`)
    .join('')}</ul>`;
}

/** "Six hours into the Deep Zone, carrying 22 scrap, at 61 health." */
/**
 * How long they have been gone, in hours and deliberately not in seconds.
 *
 * This used to be `duration()`, which is a countdown formatter, so the page printed
 * "17m 08s into The Millrace" directly beneath a due-back timer that was actually
 * ticking: one live clock and one frozen one, and the frozen one reads as broken.
 *
 * Wiring it to tick would have been the wrong fix. The two would then be counting the
 * same span from opposite ends — two timers to say one thing — and the page contract
 * has exactly one job for a live countdown, which is to fetch fresh state when it
 * expires. Elapsed time never expires.
 *
 * Rounded to hours it changes about as slowly as the thing it measures, which is the
 * argument the haul is already rendered on: a number that changes slowly because the
 * thing it counts changes slowly is telling the truth.
 */
function elapsed(hoursOut, region) {
  // Under a few minutes there is nothing to round to, and "0 hours in" is a worse
  // answer than saying what actually happened.
  if (hoursOut < 0.05) {
    return region ? `Just set out for ${region}` : 'Just set out';
  }

  const into = region ? ` into ${region}` : ' in';
  if (hoursOut < 1) return `Less than an hour${into}`;

  const whole = Math.floor(hoursOut);
  return `${whole} hour${whole === 1 ? '' : 's'}${into}`;
}

/**
 * The one-line state of a trip, for the moment box.
 *
 * The Away report used to share this and no longer does — six facts in one breath is
 * the wrong container for a set of independent figures, and that block reads them off
 * a `readout()` now. Here the sentence is still right: it is small print under a
 * decision, read once to answer "can they afford this", and a row of instrument cells
 * above three choices would out-shout the choices.
 *
 * The region is named because the heading over it is "Contact" rather than the place,
 * and a decision needs to know where they are standing.
 */
function condition(expedition) {
  const carried = Object.entries(expedition.carrying)
    .map(([kind, amount]) => `${amount} ${kind}`)
    .join(', ');

  return [
    elapsed(expedition.hoursOut, expedition.regionName),
    carried ? `carrying ${carried}` : 'carrying nothing yet',
    `at ${n(expedition.health, 0)} health`,
  ].join(', ') + '.';
}

/**
 * A row of labelled figures: a set of independent numbers, as an instrument.
 *
 * Same two-part cell the stores in the rail are built from — a tracked label with a
 * mono figure under it — because this is the same kind of thing being read, and a
 * second idiom for it would be a second thing to learn. It differs only in running
 * across rather than down, and in having no cap and no track: a trip's health is a
 * figure out of a hundred, and its haul is not out of anything.
 *
 * Tone is for the one cell worth noticing, and the accent rule is the same one a
 * draining store follows: oxide marks the fact you would otherwise have to work out.
 *
 * `html` is for a figure that is already markup — which today means a live countdown,
 * whose span the client script finds by `data-until` and cannot be handed as text.
 * **It is never for anything a player typed.** Every caller passes `value` and gets it
 * escaped; the one that passes `html` builds it here in this file.
 */
function readout(cells) {
  return `<div class="readout">${cells
    .map(
      ({ tag, value, html, tone }) => `<div class="read${tone ? ` ${tone}` : ''}">
        <span class="tag">${escape(tag)}</span>
        <span class="fig">${html ?? escape(value)}</span>
      </div>`,
    )
    .join('')}</div>`;
}

function renderExpeditions(view) {
  /*
   * Only ever the dispatch table now.
   *
   * It used to be either a trip report *or* the table, which was right while a camp had one
   * traveller and wrong the moment it had two: one person out meant the other could not be
   * sent anywhere, because the block that sends people had been replaced by a report about
   * somebody else. The reports moved into the survivor blocks; this went back to being about
   * where to send whoever is free.
   */

  /*
   * Who is going is asked on the survivor's own card now, not here.
   *
   * The block kept a dropdown in its label strip while the person it referred to sat in
   * another block entirely — the caption of a table asking a question about somebody two
   * blocks away. The card is the person, so the card asks. What is left here is the answer
   * to it, printed on the button: the table says whose trip it is about to start.
   */
  const going = (view.roster ?? []).find((one) => !one.busy);

  const rows = view.regions
    .map(
      (region) => `<tr class="plated"${plateGround(region.slug)}>
        <td><span class="name">${escape(region.name)}</span>
            <span class="lvl">danger ${region.danger} &middot; ${escape(duration(region.travel_hours))} out</span></td>
        <td class="lede"><small>${escape(region.description ?? '')}</small></td>
        <td class="contact-col"><span class="cost">${escape(contact(region.moments))}</span></td>
        <td class="act">
          <form method="post" action="/expedition">
            <input type="hidden" name="region" value="${escape(region.slug)}">
            ${/*
              * Who goes rides along hidden, filled from the selector above the table.
              *
              * The choice is made once for the block rather than eleven times inside it —
              * you know who is free before you know where they should go, and a list of the
              * roster repeated on every row would be the same decision asked eleven ways.
              * The client script copies the selection into each of these on change.
              */ ''}
            ${whoField(view, 'send')}
            <button type="submit">Send${
              going ? ` <span data-nameof="send">${escape(going.name ?? 'them')}</span>` : ''
            }</button>
          </form>
        </td>
      </tr>`,
    )
    .join('');

  /*
   * And it is named for what it is.
   *
   * "Where to send them" was the name of a decision, and the decision has been leaving this
   * block for a while: the trip reports went to the survivors, and now the choice of who
   * has too. What stands here is the eleven places and what is known about each — a
   * catalogue, which is exactly the thing that wanted the full width.
   */
  return block('The roads out', `<table class="dispatch">${rows}</table>`, { flush: true });
}

/**
 * One line telling a new camp what this game is, directly above the table where the
 * mistake gets made.
 *
 * Placed last in the group that ends with the dispatch decision, because that is the
 * decision it is about: a new player reads the region table top to bottom, finds the
 * interesting names at the dangerous end, and buys twelve hours of a page that cannot
 * change. The advice has to arrive before their eye does.
 *
 * Deliberately not in the top slot with the raid warning and the closing moment. Those
 * are there because they expire; this does not, and putting a permanent line among the
 * things that vanish would teach the player to stop reading that corner of the page.
 *
 * Understated on purpose — one heading, one sentence, no list, no progress bar, no
 * count of steps remaining. See `docs/DESIGN-BRIEF.md` on the voice. It disappears for
 * good once the camp has been round the loop, which is the other half of not being a
 * quest log: a quest log is proud of itself and this leaves without saying goodbye.
 */
function renderDirection(direction) {
  if (!direction) return quiet('Next', NOTHING.direction);
  // The one block with an edge and no strip. It is a single sentence, and a filled bar
  // labelling one line would be a label longer than the thing it labels.
  return `<div class="block wants inline-label"><h2>Next</h2>
    <p>${escape(direction.line)}</p></div>`;
}

/**
 * A timer set for the instant the next window opens, so the box arrives on its own.
 *
 * The page is not a document that sits still — every deadline on it is armed, and when
 * one runs out the script fetches fresh state and swaps in whatever changed. A build
 * finishing, a craft coming off the bench, a caravan reaching the gate, the survivor
 * walking back through it: all of them appear without anybody pressing anything.
 *
 * A moment opening did not, and the reason is an accident worth writing down. The
 * radio's line is rendered with `countdown()`, which emits `data-until`, which the
 * script arms like any other — so a camp with a radio fitted has *always* had its
 * moment box appear by itself, and a camp without one has been sitting on a page that
 * silently declined to update. That is not the radio being worth its fuel. That is the
 * only upgrade-gated refresh on the page, gated by nobody's decision.
 *
 * **So this is not gated, and the radio keeps the job it was sold for.** It tells you
 * *when* — which is what lets you decide to wait, or to go and do something else and
 * come back. Without it the window simply arrives unannounced, exactly as a moment met
 * by reloading at the right minute always did, minus the reloading. A player sitting on
 * the page watching has attended either way; making them press F5 to prove it was never
 * a design, it was static HTML.
 *
 * Silent, and hidden, because announcing it *is* the radio. `data-done` is empty for
 * the same reason: when it fires there is nothing to say, only something to fetch.
 *
 * Skipped entirely when the radio line is up, since that line already carries a timer
 * for this instant and two spans would arm two timers for one fetch.
 */
function momentAlarm(trip) {
  if (trip.nextMomentAt) return '';

  const opensAt = (trip.upcoming ?? [])[0];
  if (!opensAt) return '';

  return `<span hidden>${countdown(opensAt, '')}</span>`;
}

/**
 * What the trip holds, in the word the rest of the page already uses for it.
 *
 * "Contact" is what the radio line and the moment box call an encounter, so the
 * dispatch table says it the same way rather than inventing a second name for the
 * same thing. A region with none says *why* — the reason is a fact about the trip's
 * length, and a player who knows it can choose against it deliberately instead of
 * discovering over fifteen dispatches that nothing ever happens on a ten-minute run.
 */
function contact(count) {
  const n = Number(count) || 0;
  if (n === 0) return 'too short for contact';
  return n === 1 ? '1 contact' : `${n} contacts`;
}

/**
 * The road, which is the only thing on this page that measures years.
 *
 * Everything else here is about the next few hours: what is finishing, what is due
 * back, what the stores will do by morning. This section is the one place the camp
 * gets to be older than its survivor, so it reads as a list of places rather than as
 * a progress bar with a number on it — the neighbours are the point, and the fuel is
 * how you get to them.
 *
 * Reached links carry their news, which is derived fresh every render: somebody
 * standing last week can be gone on this load. What they gave is not taken back.
 */
/**
 * The post on the road: the same goods a caravan carries, and no deadline on them.
 *
 * Rendered as its own section rather than folded into the caravan, because the two are
 * different things wearing the same table. A caravan is a window and reads as one — it
 * arrives, it has a countdown, it goes. A post has no countdown at all, and giving it
 * one would be inventing urgency the road exists to remove.
 */
function renderPost(post, alive) {
  if (!post) return quiet('Trade post', NOTHING.post);

  const rows = post.offers
    .map(
      (offer) => `<tr>
        <td><span class="name">${offer.qty} &times; ${escape(String(offer.what).replaceAll('_', ' '))}</span></td>
        <td class="cost-col"><span class="cost">${escape(
          Object.entries(offer.costs).map(([kind, amount]) => `${amount} ${kind}`).join(', '),
        )}</span>${
          offer.shortBy ? `<span class="short">${escape(offer.shortBy)}</span>` : ''
        }</td>
        <td class="act">${!offer.shortBy && alive
          ? `<form method="post" action="/trade">
              <input type="hidden" name="faction" value="${escape(post.faction)}">
              <input type="hidden" name="offer" value="${offer.index}">
              <button type="submit">Buy</button>
            </form>`
          : ''}</td>
      </tr>`,
    )
    .join('');

  return block(
    `The post on the road &mdash; ${escape(post.name)}, standing ${Math.round(post.standing)}`,
    `<table>${rows}</table>`,
    { flush: true },
  );
}

/**
 * The box that puts fuel toward the next link.
 *
 * "Send fuel up the road" was a metaphor doing a mechanic's job. Nothing is sent
 * anywhere: fuel comes out of the stores and stays on the link until the link is paid
 * for. So the button says what it does, and the sentence that explains the rule lives
 * above the table rather than inside the form, where it was competing with the numbers.
 *
 * With no fuel at all there is no form, for the same reason a recipe you cannot afford
 * has no button: an input that can only be refused is not an offer.
 */
/**
 * What a link opens, as facts rather than as a sentence.
 *
 * `linkGot` says it in prose — "somewhere new to send people &mdash; 8h out, danger 3, 3
 * contacts" — which is right where the road is telling you a story about a place you have
 * already reached. It is wrong where the road is a thing you are buying. Played on
 * 2026-09-01: *"too many sentences and commas."*
 *
 * The page's own rule, written above `stats`: **a number belongs in a row, and prose is for
 * what a number cannot say.** How far, how dangerous and how much there is to answer are all
 * numbers. Middots, because that is how this page already joins facts that share a line.
 */
function linkFacts(link) {
  const parts = [];

  if (link.place) {
    parts.push(escape(duration(link.place.travelHours)));
    parts.push(`danger ${link.place.danger}`);
    if (link.place.moments > 0) parts.push(`${link.place.moments} contacts`);
  }
  if (link.tradePost) parts.push('trader');
  /*
   * What the three that open nowhere are actually for.
   *
   * They read "neighbours only" until 2026-09-01, when the player asked what they were —
   * which is the answer, really: 873 fuel between them and nothing to show. They take a fifth
   * off a walk the camp already makes, and this is the page finally saying which walk.
   */
  if (link.shortens) {
    parts.push(`${escape(duration(link.shortens.from - link.shortens.to))} off ${escape(link.shortens.name)}`);
  }
  if (parts.length === 0) parts.push('neighbours only');

  return parts.join(' &middot; ');
}

function addFuel(road) {
  const wanted = road.next.cost - road.next.fuel;
  const most = Math.floor(Math.min(road.available, wanted));

  /*
   * Only the half that sends the player somewhere.
   *
   * It read "No fuel in the stores. Only expeditions bring it back." — and the stores row
   * above now states that in a figure, so the first sentence had become the same fact in
   * words with a zero next to it. What a row cannot say is where fuel comes from.
   */
  if (most < 1) {
    return `<p class="road-note">Only expeditions bring fuel back.</p>`;
  }

  return `<form method="post" action="/road" class="row">
      <input type="number" name="fuel" min="1" max="${most}" step="1"
             value="${most}" required>
      <button type="submit" class="fill">Add fuel</button>
    </form>`;
}

/**
 * What reaching a place gets the camp, said as a reward rather than as a category.
 *
 * "Somewhere to go" told the player which box the link was in; it did not tell them
 * whether 70 fuel was worth spending. A destination is worth exactly what a region is
 * worth, so it says the things a region is judged on — how far, how dangerous, how much
 * there is to answer out there — in the same words the dispatch table uses.
 *
 * And a link that brings only news says so plainly. Three of the seven pay in nothing
 * but the sight of somebody else out there, which is deliberate — a road where every
 * step pays is a shop, not a road — and dressing that up would be the page lying about
 * the design.
 */
function linkGot(link) {
  const parts = [];

  if (link.place) {
    const contact =
      link.place.moments > 0
        ? `${link.place.moments} contact${link.place.moments === 1 ? '' : 's'}`
        : 'no contact';

    parts.push(
      `somewhere new to send people &mdash; ${escape(duration(link.place.travelHours))} out, danger ${link.place.danger}, ${contact}`,
    );
  }

  if (link.shortens) {
    parts.push(
      `${escape(duration(link.shortens.from - link.shortens.to))} off every walk to ${escape(
        link.shortens.name,
      )}`,
    );
  }

  if (link.tradePost) parts.push('a trader who never moves on, unlike a caravan');

  return parts.join('<br>') || 'word of who else is out there, and nothing more';
}
function renderRoad(road) {
  if (!road) return '';

  const reached = road.reached
    .map(
      (link) => `<tr>
        <td><span class="name">${escape(link.name)}</span>
            <span class="lvl">${link.stillThere ? `${link.size} people` : 'nobody left'}</span></td>
        <td class="lede"><small>${escape(link.news)}</small>
            <small>${linkGot(link)}</small></td>
      </tr>`,
    )
    .join('');

  // The end of the road is a standing fact about the camp, not a win: nothing resets
  // and nothing is taken away, so it says so plainly and stops asking for fuel.
  if (!road.next) {
    return block(
      `The road &mdash; all ${road.links} reached`,
      `<p class="road-note">The region is as reconnected as this camp can make it.</p>
       <table>${reached}</table>`,
      { flush: true },
    );
  }

  /*
   * The road behind you, and only if there is any.
   *
   * With nothing reached this was a heading reading "0 of 7 reached" over a rule nobody had
   * broken yet — a block whose entire content was the fact that it was empty. Cut on
   * 2026-09-01. Once a link is behind you the table is the record of it and the count is
   * worth having, so it comes back the moment it has something to hold.
   *
   * The rule it used to carry went with it. Where it lives now is a note on the gauge: it is
   * the one thing here a figure cannot say, and it matters at the instant somebody is about
   * to spend, not in a paragraph above the place they spend it.
   */
  const behind =
    road.reached.length > 0
      ? `${block(
          `The road &mdash; ${road.reached.length} of ${road.links} reached`,
          `<table>${reached}</table>`,
          { flush: true },
        )}
    `
      : '';

  /*
   * What is still ahead, as options that refuse.
   *
   * It was a footer reading "6 more after that", which is the road's whole remaining length
   * written as a number. Every other block on this page keeps an option it cannot offer and
   * says why — the bench rows, the moment options, a fitting four levels out of reach — and
   * this was the one that hid them.
   *
   * A name and a price each, because that is what makes something an option. Not who is
   * there: `neighbourFor` knows and two neighbours in five have already gone, but that is
   * what the fuel buys. Only the live link has a form; these have a number and no way to
   * spend it, which is exactly what greyed means.
   */
  const ahead =
    road.ahead && road.ahead.length > 0
      ? `<ul class="ahead">${road.ahead
          .map(
            (link) => `<li class="link off">
              <span class="idx">${link.index}</span>
              <span class="name">${escape(link.name)}</span>
              <span class="what">${linkFacts(link)}</span>
              <span class="cost">${n(link.cost, 0)} fuel</span>
            </li>`,
          )
          .join('')}</ul>`
      : '<p class="road-note">Nothing past this one. It is the last.</p>';

  /*
   * The live link as a gauge, which is what it always was.
   *
   * It read as three sentences — what the place is, what has been paid, what is in the
   * stores — and the player's verdict was the right one: too many sentences and commas. Every
   * one of those facts is a figure, and this page has an idiom for a figure that fills up.
   * The track and the label-and-value rows are the same ones the survivor gauges use, so the
   * road now reads the way the rest of the game does rather than like a paragraph about it.
   *
   * `wants` is the number a player actually acts on — what is left, not what is done — so it
   * leads. The track carries the shape and the row carries the figure.
   */
  const paid = Math.max(0, Math.min(1, road.next.fuel / Math.max(1, road.next.cost)));
  const wants = Math.max(0, road.next.cost - road.next.fuel);
  const facts = [
    ['still wants', `${n(wants, 0)} fuel`],
    ['in the stores', `${n(road.available, 0)} fuel`],
    ['opens', linkFacts(road.next)],
  ];

  /*
   * Standing on the place it opens, the way a dispatch row and a trip's readout do.
   *
   * The same argument as both: the road block and the region table are two views of one
   * place, and a photograph that is a picture in one and absent in the other makes them read
   * as different kinds of thing. A link you are paying into is a place you are buying, so it
   * gets the ground of that place.
   *
   * Only the four links that open a region have a plate; `plateGround` answers with nothing
   * for the neighbours, and the block falls back to plain panel without a special case here.
   */
  return `${behind}<div class="block wants next-link plated"${plateGround(road.next.region)}>
      <h2>Working toward ${escape(road.next.neighbour)}</h2>
      <div class="block-body">
        <div class="paying noted">
          <div class="gauge-top"><span class="tag">paid</span>
            <span class="val">${n(road.next.fuel, 0)} / ${n(road.next.cost, 0)}</span></div>
          <div class="track">${paid > 0 ? `<i style="width:${(paid * 100).toFixed(1)}%"></i>` : ''}</div>
          ${/*
            * The one thing on this block a row cannot say, where somebody about to spend will
            * meet it. It was a paragraph over the whole view; a player who has paid into a
            * link once knows it, and one who has not is standing on the button.
            */ ''}
          <span class="note">Fuel goes in and does not come out. Cover the cost and the place
            stays reached.</span>
        </div>
        ${facts
          .map(
            ([key, value]) =>
              `<span class="stat-row"><span class="k">${escape(key)}</span><span class="v">${value}</span></span>`,
          )
          .join('')}
        ${addFuel(road)}
      </div>
      ${/*
        * The strip heads the list rather than closing the block, which is a small departure
        * from what `block-foot` usually is and the right one here: the total is the fact you
        * want before reading six rows, not after. Its border and ground make it read as a
        * rule across the block either way.
        */ ''}
      <div class="block-foot"><span class="tag">Ahead</span>
        <span class="val">${
          road.ahead?.length
            ? `${road.ahead.length} more, ${n(
                road.ahead.reduce((sum, link) => sum + link.cost, 0),
                0,
              )} fuel between them`
            : 'the last of them'
        }</span></div>
      ${ahead}
    </div>`;
}

/**
 * What they are carrying, as the contents of a tab rather than a block of its own.
 *
 * It was `Carrying`, a bordered box under the survivor, and it is the same three facts
 * about the same person — so it is a third tab beside Condition and Skills rather than a
 * second box saying their name a different way.
 *
 * Returns a body and no label: the tab is the label. An empty pack still says so in words,
 * because a tab that opens onto nothing reads as a page that failed to load.
 */
function inventoryBody(inventory, owner = null) {
  if (!inventory || inventory.length === 0) {
    return `<p class="none">${NOTHING.inventory}</p>`;
  }

  /*
   * A third column, and it is the only thing in this block that does anything.
   *
   * Until now a consumable could only be spent when a moment offered it: a long trip, an
   * open window, somebody else's hour. The pack is where a player looks for a thing they
   * own, so the verb belongs here.
   *
   * A row that cannot be used keeps its column empty rather than losing the column — the
   * shape of the table is what lets the eye find the quantity without reading the names —
   * and a row that *could* be used but would do nothing says why instead of offering a
   * button. That is the bench's rule and the moment's rule: an option you cannot take must
   * never look identical to one you can.
   */
  const rows = inventory
    .map((item) => {
      /*
       * Three columns and no fourth. The effect used to be printed beside the button, which
       * on a rail two hundred pixels wide pushed "-0.4 rads" off the edge of the panel and
       * wrapped every two-word name onto a second line. It is in the note now, where there
       * is room for it and for the rest of what the row has never said.
       */
      const action = item.use
        ? `<form method="post" action="/use">
             <input type="hidden" name="slug" value="${escape(item.slug)}">
             ${/*
               * Whose pack this is. Without it the button in one survivor's block reached
               * into the first survivor's pack, because the service had never had to ask.
               */ ''}
             <input type="hidden" name="who" value="${escape(String(owner ?? ''))}">
             <button type="submit">Use</button>
           </form>`
        : '';

      /*
       * What it is, what it does, and — when it does nothing right now — why not.
       *
       * The pack has listed a Plate Vest as a name and a count since gear shipped while
       * `equipmentOf` read its potency on every trip, so this is the first time the block
       * says what any of it is for. `worth` is what the thing is worth in the abstract; the
       * button's own figure is capped by how hurt they happen to be, and "+0.4 health" says
       * nothing about the ration.
       */
      const note = `<span class="note">
        <span class="stat-head">${escape(item.name)}</span>
        ${item.description ? `<span class="what">${escape(item.description)}</span>` : ''}
        <span class="stat-row"><span class="k">${escape(item.kind)}</span><span class="v">${escape(
          item.worth ?? '',
        )}</span></span>
        ${
          item.idle
            ? `<span class="stat-row"><span class="k">not now</span><span class="v">${escape(
                item.idle,
              )}</span></span>`
            : ''
        }
        ${/*
          * And what taking it *now* would actually do, when that is less than the thing is
          * worth. A Rad-X is worth thirty rads and a survivor carrying one rad would spend
          * the whole tablet to scrub it — which is the player's call to make, but only if
          * the page tells them. Shown solely when the two differ, so the ordinary case is
          * not two rows saying one number.
          */ ''}
        ${
          item.use && item.use.effect !== item.worth
            ? `<span class="stat-row"><span class="k">right now</span><span class="v">${escape(
                item.use.effect,
              )}</span></span>`
            : ''
        }
      </span>`;

      return `<tr class="noted">
        <td class="name">${escape(item.name)}</td>
        <td class="qty">×${item.qty}</td>
        <td class="use">${action}${note}</td>
      </tr>`;
    })
    .join('');

  return `<table class="carrying">${rows}</table>`;
}

/**
 * The bench. A recipe with no button keeps its row and says why — a workshop level
 * you have not reached yet is a thing to build towards, and hiding it hides the goal.
 */
function renderWorkshop(view) {
  if (view.craft) {
    const hoursLeft = (new Date(view.craft.completesAt).getTime() - Date.now()) / 3600000;
    const due =
      hoursLeft > 0
        ? `<span class="clock">${countdown(view.craft.completesAt, 'now')}<small>until ready</small></span>`
        : '<span class="short">ready &mdash; reload to collect it</span>';
    return `<div class="block contact"><div class="block-head">
        <span class="tag">On the bench &mdash; ${escape(view.craft.name)}</span>${due}
      </div></div>`;
  }

  if (!view.recipes || view.recipes.length === 0) return '';

  const rows = view.recipes
    .map((recipe) => {
      // Most recipes are named after what they make, so naming it twice reads as a
      // bug. Only the quantity is news in that case.
      const yields =
        recipe.output_name === recipe.name
          ? recipe.output_qty > 1
            ? `× ${recipe.output_qty}`
            : ''
          : `${recipe.output_qty} × ${escape(recipe.output_name)}`;
      const price = escape(`${priceOf(recipe)}, ${duration(recipe.craft_hours)}`);
      return `<tr class="noted">
        <td><span class="name">${escape(recipe.name)}${
          yields ? `<span class="qty">${yields}</span>` : ''
        }</span></td>
        <td class="lede"><span class="note">${escape(recipe.description ?? '')}</span></td>
        <td class="cost-col"><span class="cost">${price}</span>${craftPrice(recipe, view)}</td>
        <td class="act">${craftCell(recipe, view)}</td>
      </tr>`;
    })
    .join('');

  return block('Workshop', `<table>${rows}</table>`, {
    flush: true,
    aside: whoSelector(view, { field: 'bench', label: 'at the bench' }),
  });
}

/** Stores and carried materials read as one price, because that is how they are paid. */
function priceOf(recipe) {
  const parts = Object.entries(recipe.costs ?? {}).map(([kind, amount]) => `${amount} ${kind}`);
  for (const input of recipe.inputs ?? []) {
    parts.push(`${input.qty} × ${input.slug.replaceAll('_', ' ')}`);
  }
  return parts.join(', ');
}

function craftCell(recipe, view) {
  // A recipe you cannot afford keeps its row and says why, in the cost column where the
  // rest of the price is. Hiding it would hide the goal.
  if (view.workshopLevel < recipe.requires_workshop) return '';
  if (!view.survivor) return ''; // Starting work needs living hands, as builds do.
  if (recipe.shortBy) return '';

  return `<form method="post" action="/craft">
      <input type="hidden" name="recipe" value="${escape(recipe.slug)}">
      ${/* Whose hands, from the selector on the bench's label strip. */ ''}
      ${whoField(view, 'bench')}
      <button type="submit">Make</button>
    </form>`;
}

/**
 * The second line of a price: the reason there is no button.
 *
 * Under the cost rather than where the button would be, because both are answers to
 * "what would this take" — and a tier you have not reached reads as part of the price
 * rather than as a refusal when it sits with the rest of it.
 */
function craftPrice(recipe, view) {
  if (view.workshopLevel < recipe.requires_workshop) {
    return `<span class="needs">needs workshop ${recipe.requires_workshop}</span>`;
  }
  if (view.survivor && recipe.shortBy) {
    return `<span class="short">${escape(recipe.shortBy)}</span>`;
  }
  return '';
}

/**
 * The caravan — at the gate with its shopfront open, or on the road with an ETA.
 *
 * The ETA is shown to everyone, unlike the raid hour: caravans send word ahead
 * because they want you at the gate with scrap in hand, and a visit that can be
 * planned for is a reason to come back. Missing one still costs you the window.
 */
/**
 * The caravan, on the two views it belongs to and in the two shapes they want.
 *
 * `s-caravan` is the one block the split puts in two places, and it is there for a
 * reason worth keeping: a caravan is a *window*, so a player sitting on Camp has to
 * find out one has arrived without going to look for it. **The player should never
 * have to remember a view exists.** So Camp gets a line — who is at the gate and how
 * long they will be — and Trade gets the shopfront.
 *
 * Both are rendered on every view and the CSS shows one, which is what keeps the
 * section a single swappable unit: a caravan arriving replaces the whole of
 * `s-caravan`, and the pointer and the shopfront cannot disagree about what is at the
 * gate because they were built from the same object in the same render.
 *
 * The countdown is deliberately in the shopfront only. Two spans on one instant would
 * arm two timers for one fetch, and the pointer's job is to say *that* somebody is
 * here, not to run a second clock for them.
 */
function renderCaravan(caravan, someoneAlive) {
  if (!caravan) return quiet('Caravan', NOTHING.caravan);

  if (!caravan.visiting) {
    const hoursOut = (new Date(caravan.arrivesAt).getTime() - Date.now()) / 3600000;
    const when = hoursOut > 0 ? `expected in ${countdown(caravan.arrivesAt, 'now')}` : 'expected — reload';
    // Nothing to buy yet, so both views say the same short thing and neither needs a
    // table: this is a caravan that has not arrived, on a page about a camp that is
    // waiting for it.
    return quiet('Caravan', `A caravan from ${escape(caravan.name)}, ${when}.`);
  }

  const price = (offer) =>
    Object.entries(offer.costs).map(([kind, amount]) => `${amount} ${kind}`).join(', ');

  const rows = caravan.offers
    .map((offer) => {
      // A caravan is at the gate for a few hours, so an offer the stores cannot
      // cover is worth naming rather than leaving to be discovered by clicking.
      const buy =
        !offer.shortBy && someoneAlive
          ? `<form method="post" action="/trade">
              <input type="hidden" name="faction" value="${escape(caravan.faction)}">
              <input type="hidden" name="offer" value="${offer.index}">
              <button type="submit">Buy</button>
            </form>`
          : '';
      return `<tr>
        <td><span class="name">${offer.qty} × ${escape(offer.what)}</span></td>
        <td class="cost-col"><span class="cost">${escape(price(offer))}</span>${
          offer.shortBy ? `<span class="short">${escape(offer.shortBy)}</span>` : ''
        }</td>
        <td class="act">${buy}</td>
      </tr>`;
    })
    .join('');

  const rates =
    caravan.standing < 0
      ? 'their prices show it'
      : caravan.standing > 0
        ? 'the rates are friendly'
        : 'strangers pay list price';

  return `<div class="as-line">${quiet(
    'Caravan',
    `<strong>${escape(caravan.name)}</strong> are at the gate.${onward('/camp/trade', 'Trade')}`,
  )}</div>
    <div class="as-block">
      <div class="block wants">
        <div class="block-head">
          <span class="tag">${escape(caravan.name)} &mdash; at the gate</span>
          <span class="clock deadline">${countdown(caravan.departsAt, 'now')}<small>until they move on</small></span>
        </div>
        <div class="block-body">
          <p><small>${escape(caravan.description)}</small></p>
        </div>
        <table>${rows}</table>
        <div class="block-foot"><span class="tag">Standing</span>
          <span class="val">${describeStanding(caravan.standing)} &mdash; ${rates}</span></div>
      </div>
    </div>`;
}

/** Where the camp sits with each crew. One line each; the numbers earn no table. */
function renderStandings(standings) {
  if (!standings || standings.every((s) => s.standing === 0)) {
    return quiet('Standings', NOTHING.standings);
  }
  const rows = standings
    .map(
      (s) => `<tr>
        <td><span class="name">${escape(s.name)}</span></td>
        <td class="right"><span class="cost">${describeStanding(s.standing)}</span></td>
      </tr>`,
    )
    .join('');
  return block('Standing', `<table>${rows}</table>`, { flush: true });
}

function describeStanding(standing) {
  const word =
    standing <= -50 ? 'hated' :
    standing <= -15 ? 'unwelcome' :
    standing < 15 ? 'strangers' :
    standing < 50 ? 'known' : 'trusted';
  return `${word} (${standing > 0 ? '+' : ''}${n(standing, 0)})`;
}

/**
 * The stores, climbing or falling in front of you.
 *
 * The amount carries its rate and cap so the script can extrapolate between loads,
 * which is what an idle game's numbers are supposed to do — a camp that visibly
 * fills is the whole feedback loop, and a static number made it look stalled.
 *
 * The rate is net: production, scaled by whatever the weather is doing, minus what
 * the survivor eats. A negative one is shown rather than hidden, because a store
 * quietly draining is the single most useful thing this table can tell you.
 */
/**
 * What the rate above is made of, on hover, focus and tap.
 *
 * The structure list advertises a *building* — `perLevel × level`, no weather, nobody
 * eating — because that is what the upgrade decision turns on. This line reports a *camp*.
 * Both are right and they differ by exactly the survivor, which reads as the page
 * contradicting itself until the sum is taken apart.
 *
 * Returns nothing at all when there is nothing to explain: a store with no producer and no
 * consumer is its own explanation, and a panel saying so would be a panel about nothing.
 */
function rateBreakdown(r) {
  const b = r.breakdown;
  if (!b) return '';

  const weathered = b.gross * b.weather;
  const rows = [];

  if (b.gross !== 0) {
    rows.push([escape(String(b.from ?? 'produced').replace(/_/g, ' ')), b.gross]);
  }

  // Only when the sky is actually doing something. A row reading "weather x1" is a line of
  // text that says nothing, on a panel small enough that every line has to earn its place.
  if (b.weather !== 1 && b.gross !== 0) {
    rows.push([`weather &times;${rate(b.weather)}`, weathered - b.gross]);
  }

  if (b.eaten !== 0) rows.push(['the camp', -b.eaten]);

  if (rows.length === 0) return '';

  /*
   * `rate` and not `n`: this panel is the one place that claims to do the arithmetic, so it
   * has to print the real numbers rather than the display-rounded ones. At one decimal the
   * survivor drew &minus;0.8/h here and &minus;0.75/h in the vitals panel — the same constant,
   * contradicting itself across two blocks — and a blight at x0.35 printed as x0.4.
   */
  const signed = (v) => `${v > 0 ? '+' : v < 0 ? '&minus;' : ''}${rate(Math.abs(v))}/h`;

  const body = rows
    .map(
      ([label, value]) =>
        `<span class="cost-row"><span class="tag">${label}</span><span class="num">${signed(
          value,
        )}</span></span>`,
    )
    .join('');

  return `<span class="costs-panel">
    <span class="costs-head">${escape(r.kind.replace(/_/g, ' '))} an hour</span>
    ${body}
    <span class="cost-row net"><span class="tag">net</span><span class="num">${signed(
      r.ratePerHour,
    )}</span></span>
  </span>`;
}

function renderResources(resources) {
  const cells = resources
    .map((r) => {
      /*
       * Oxide only when the store is draining, which is the one thing this table can tell
       * you that you would otherwise find out by running out. A zero rate is a dash rather
       * than "+0.0/h": nothing is happening, and a figure that says so in four characters
       * of precision looks like something is.
       *
       * `rate` and not `n`, so this prints the same quantity the same way the panel below
       * it and the survivor panel do. At one decimal a purifier netting 1.75 read as +1.8
       * here and 1.75 inside its own breakdown, which is the page disagreeing with itself
       * about a number it is in the middle of explaining.
       */
      // Not named `rate`: that is the module-level formatter this line calls, and a local
      // const of the same name shadows it into its own temporal dead zone.
      const rateCell =
        r.ratePerHour === 0
          ? '<span class="rate none">&mdash;</span>'
          : `<span class="rate${r.ratePerHour < 0 ? ' down' : ''}">${
              r.ratePerHour > 0 ? '+' : ''
            }${rate(r.ratePerHour)}/h</span>`;

      // A zero store shows an empty track rather than no track. The four cells are the
      // same shape whatever is in them, or the eye has to re-find the layout each time.
      /*
       * The trigger wraps the rate rather than the whole cell, so the thing you point at is
       * the number you are asking about. Focusable and role="button" for the same reason
       * the strip's panel is: a phone has no hover, and an explanation only reachable by
       * hovering is one half the players cannot read.
       */
      const panel = rateBreakdown(r);
      const figure = panel
        ? `<span class="costs" tabindex="0" role="button"
                 aria-label="What makes up the ${escape(r.kind.replace(/_/g, ' '))} rate"
           >${rateCell}${panel}</span>`
        : rateCell;

      return `<div class="store">
        <div class="store-top"><span class="tag">${escape(r.kind)}</span>${figure}</div>
        <div class="store-fig"><span data-amount="${r.amount}" data-rate="${r.ratePerHour}"
                data-cap="${r.cap}">${n(r.amount, STORE_DECIMALS)}</span><span
                class="cap"> / ${n(r.cap, 0)}</span></div>
        <div class="track"><i data-fill style="width:${bar(r.amount, r.cap)}%"></i></div>
      </div>`;
    })
    .join('');

  /*
   * No block, no heading. In the rail this is not a panel about the stores — it is the
   * camp's state, sitting under the camp's name in the same column, and a bordered box
   * with "Stores" written across the top of it would be a second identity card.
   *
   * The four cells are unchanged apart from their arrangement, which is the point: the
   * figures, the rates and the tracks are the same markup the wide block used, so the
   * client script finds them exactly as it always did.
   */
  return `<div class="stores">${cells}</div>`;
}

/**
 * The camp's own machinery, as one table with no header row — the columns say what
 * they are without being told.
 *
 * Name and level together, then what it does over what it is for, then the price, then
 * the button. The upgrade sentence lives inside the description rather than in a column
 * of its own, because it is the same sentence one level later and a column would make
 * it look like a separate purchase.
 */
/**
 * Which structure's Build button is filled, and why exactly one of them is.
 *
 * `Next` sits three blocks up and names a structure in prose — "the workshop is the one
 * structure that changes that" — and then the table below offered five identical
 * buttons and left the player to match the sentence to the row. Filling the one it
 * named closes that gap with the accent the design already has, and it costs no new
 * colour: this is the same "one filled control per decision" rule the Contact panel and
 * the empty camp already follow.
 *
 * Keys that do not name a structure fill nothing, which is correct — most of what the
 * direction says is about sending somebody out, not about building.
 */
const ADVISED = {
  workshop: 'workshop',
  bench: 'workshop',
  overflowing: 'shelter',
  undefended: 'watchtower',
};

function renderStructures(structures, buildInFlight, someoneAlive, direction, quiet = true, who = '', picker = '') {
  // One filled control per view. A window that closes in eleven minutes outranks
  // standing advice about what to build next, so while contact is open the table stops
  // pointing — otherwise the page has two things marked as *the* thing to do and the
  // accent stops meaning either of them.
  const advised = quiet ? ADVISED[direction?.key] : undefined;

  const rows = structures
    .map((s) => {
      const name = escape(s.kind.replaceAll('_', ' '));
      const status = statusCell(s, buildInFlight, someoneAlive, s.kind === advised, who);
      // An unbuilt structure produces nothing, and saying so is more useful than
      // an empty cell the player has to interpret.
      const doing = s.effect
        ? `<span class="effect">${escape(s.effect)}</span>`
        : '<span class="effect nil">nothing yet</span>';
      const step = stepOf(s);
      return `<tr class="noted">
        <td><span class="name">${name}</span><span class="lvl">level ${s.level}</span></td>
        <td class="lede">
          ${doing}
          ${step ? `<span class="step">${step}</span>` : ''}
          <span class="note">${escape(s.summary ?? '')}</span>
          ${fittingIn(s, buildInFlight, someoneAlive, who)}
        </td>
        ${status}
      </tr>`;
    })
    .join('');
  return block('Structures', `<table>${rows}</table>`, { flush: true, aside: picker });
}

/**
 * The fuel branch, where a structure has one.
 *
 * Kept on its own row rather than folded into the level track, because that is the
 * point: scrap makes the thing bigger and fuel makes it do something new, and the
 * page should not make those look like the same purchase.
 */
function fittingIn(structure, buildInFlight, someoneAlive, who = '') {
  // A structure can carry more than one branch — the watchtower sells the hour of the
  // next raid and the sky as two separate purchases — so each gets its own inset in
  // declaration order. A structure with none renders nothing at all, as the shelter does.
  return (structure.upgrades ?? [])
    .map((upgrade) => oneFittingIn(structure, upgrade, buildInFlight, someoneAlive, who))
    .join('');
}

function oneFittingIn(structure, upgrade, buildInFlight, someoneAlive, who = '') {
  /*
   * The fitting lives *inside* its structure's description, behind a 2px inset.
   *
   * It used to be a sibling `<tr>`, which is the shape the handoff's prose asks for and
   * the wrong one: a row in a table is a sibling purchase however it is indented, and
   * the whole claim being made is that a fitting is not a separate thing to buy but a
   * property of the structure above it. Scrap makes the thing bigger and fuel makes it
   * do something new, and the page should not make those look like two entries in one
   * shopping list. Inside the cell, it cannot.
   *
   * Its own price and button ride in the same inset rather than in the table's cost and
   * action columns, for the same reason — those columns belong to the level track.
   */
  /*
   * The fitting's popup, as figures — the house style stated on `stats`.
   *
   * It was the summary and nothing else: one sentence, and every number about the thing
   * living somewhere else on the row or not on the page at all. What it needs to hold a
   * decision is what it costs, how long it takes, what it wants first and — for the one
   * fitting there can be more than one of — how many are standing.
   *
   * The summary stays, as the one line of prose the rule allows: "somewhere for one more
   * person to sleep" is what a bed is *for*, and no row of figures says it.
   */
  const costLabel =
    (upgrade.fuel ?? 0) > 0 ? `${upgrade.fuel} fuel` : `${upgrade.scrap} scrap`;
  const rows = [
    ['costs', costLabel],
    ['takes', duration(upgrade.hours)],
    ['needs', `${structure.kind.replaceAll('_', ' ')} ${upgrade.requiresLevel}`],
  ];
  // Only where more than one can stand, which is the bed and nothing else. "1 of 1" on an
  // instrument is a row that exists to have a row.
  if (upgrade.allowed > 1 || upgrade.standing > 0) {
    rows.push(['standing', `${upgrade.standing} of ${upgrade.allowed}`]);
  }

  const inset = (tail) => `<span class="fitting noted">
      <span class="tag">${escape(upgrade.name)}</span>
      <span class="note">
        <span class="stat-head">${escape(upgrade.name)}</span>
        <span class="what">${escape(upgrade.summary)}</span>
        ${rows
          .map(
            ([key, value]) =>
              `<span class="stat-row"><span class="k">${escape(key)}</span><span class="v">${escape(
                value,
              )}</span></span>`,
          )
          .join('')}
      </span>
      <span>${tail}</span>
    </span>`;

  /*
   * Held by the camp rather than by the structure, which is a different sentence.
   *
   * A bed the shelter has no depth for is "fitted" in the sense the page means: there is no
   * room for another and a deeper shelter is what buys one. A bed standing empty is not —
   * the room is there, the scrap is there, and what is missing is a person. Saying "fitted"
   * to that would send the player to the shelter's level track to fix something the level
   * track has nothing to do with.
   */
  if (upgrade.waiting) {
    return inset('<span class="needs">the spare is empty</span>');
  }

  if (upgrade.fitted) return inset('<em class="needs">fitted</em>');

  if (upgrade.fittingUntil) {
    const hoursLeft = (new Date(upgrade.fittingUntil).getTime() - Date.now()) / 3600000;
    const when =
      hoursLeft > 0
        ? `<span class="cost">being fitted, ${countdown(upgrade.fittingUntil, 'now')} left</span>`
        : '<span class="short">fitted &mdash; reload</span>';
    return inset(when);
  }

  if (structure.level < upgrade.requiresLevel) {
    return inset(`<span class="needs">needs level ${upgrade.requiresLevel}</span>`);
  }

  /*
   * In whatever it is priced in. Fuel only comes home from expeditions, so the cost is worth
   * spelling out — but a bed is scrap, and this said `${upgrade.fuel} fuel` for everything,
   * so the one scrap-priced fitting in the game advertised "undefined fuel, 30m". The view
   * already had to learn this same distinction for `shortBy`; the label never did.
   */
  const cost = `<span class="cost">${escape(`${costLabel}, ${duration(upgrade.hours)}`)}</span>`;

  if (upgrade.shortBy) {
    return inset(`${cost} <span class="short">${escape(upgrade.shortBy)}</span>`);
  }
  if (buildInFlight || !someoneAlive) return inset(cost);

  return inset(`${cost}
    <form method="post" action="/upgrade">
      <input type="hidden" name="upgrade" value="${escape(upgrade.slug)}">
      ${who}
      <button type="submit">Fit</button>
    </form>`);
}

/** What it is for, plus what the next level actually buys. */
/**
 * What the next level buys, as a figure rather than as a sentence.
 *
 * This used to be glued onto the end of the structure's description — "Grows food. One
 * level already outpaces what a survivor eats. Level 3 makes that +1.8 food/h." — which
 * put a number the player is deciding on at the end of two lines of prose they have
 * read fifty times. Split out, it sits directly under the current effect in the same
 * face, so what a level costs and what it buys are one glance apart:
 *
 *     +1.2 food/h
 *     level 3 → +1.8 food/h
 *
 * The prose it was attached to is the thing that moved into the note. It explains the
 * world; this is the decision.
 */
function stepOf(structure) {
  if (!structure.nextEffect) return '';
  return `level ${structure.level + 1} &rarr; ${escape(structure.nextEffect)}`;
}

function statusCell(structure, buildInFlight, someoneAlive, advised, who = '') {
  if (structure.build_completes_at) {
    const hoursLeft = (new Date(structure.build_completes_at).getTime() - Date.now()) / 3600000;
    const when =
      hoursLeft > 0
        ? `<span class="clock">${countdown(structure.build_completes_at, 'now')}</span>`
        : '<span class="short">done &mdash; reload</span>';
    return `<td class="cost-col"><span class="needs">building level ${structure.level + 1}</span></td>
      <td class="act">${when}</td>`;
  }

  if (!structure.nextCost) return '<td class="cost-col"></td><td class="act"></td>';

  const cost = `<td class="cost-col"><span class="cost">${escape(
    `${structure.nextCost.scrap} scrap, ${duration(structure.nextCost.hours)}`,
  )}</span>${
    structure.shortBy ? `<span class="short">${escape(structure.shortBy)}</span>` : ''
  }</td>`;

  // The queue holds one build, starting work needs living hands, and an unaffordable
  // level keeps its row and its price without a button to press.
  if (buildInFlight || !someoneAlive || structure.shortBy) {
    return `${cost}<td class="act"></td>`;
  }

  return `${cost}
    <td class="act"><form method="post" action="/build">
      <input type="hidden" name="kind" value="${escape(structure.kind)}">
      ${/* Whose hands, from the selector on the block's label strip. */ ''}
      ${who}
      <button type="submit"${advised ? ' class="fill"' : ''}>Build</button>
    </form></td>`;
}

/**
 * A pointer rather than a table. The detail — what they were carrying, where they
 * went last — belongs somewhere it can be read properly, and the camp page is long
 * enough already.
 */
function renderRoster(fallenCount) {
  if (fallenCount === 0) return quiet('Roster', NOTHING.roster);
  const who = fallenCount === 1 ? 'One person has' : `${fallenCount} people have`;
  return quiet('Roster', `${who} held this camp before.${onward('/graveyard', 'Records')}`);
}

/** The memorial. Deliberately not a table: these are people, not rows. */
export function graveyardPage(view) {
  const stones = view.fallen.map(headstone).join('');

  // A camp standing empty is the one thing on this page that is not history, so it is
  // the one thing that gets an edge. Everything else here is finished and says so by
  // being quiet.
  const holding = view.holding
    ? `<p class="state">${escape(view.holding.name)} holds the camp now, since
       ${escape(new Date(view.holding.bornAt).toISOString().slice(0, 10))}.</p>`
    : '<p class="standing-empty">Nobody holds the camp.</p>';

  /*
   * The same shell as every other view, which it did not have.
   *
   * This page built its own rail, with an identity that was not even a section — so it
   * could not swap — and no stores, no hour and no Contact box. The stores climb here as
   * anywhere; the hour turns; and a moment's window is measured in tens of minutes and is
   * gone if nobody answers it. A player who wandered into Records at the wrong moment was
   * never shown the box at all.
   *
   * `s-records` is its own section so it swaps like the rest, and it is revealed by name
   * the way the error box and Contact are rather than through `PANES`, which lists the
   * blocks of the camp page.
   */
  return layout(
    `${view.name} — the fallen`,
    shell(view, 'records', {
      inner: section(
        'records',
        `<p class="page-title">The fallen of ${escape(view.name)}</p>
         <p>The camp outlives its people.</p>
         ${holding}
         ${view.fallen.length === 0 ? '<p>Nobody has died here yet.</p>' : `<div class="stones">${stones}</div>`}`,
      ),
    }),
    { pane: 'records' },
  );
}

/**
 * One person, hairline-separated from the next. Deliberately not a table: these are
 * people, not rows — and no condolence, no ornament, nothing that would make the page
 * feel about itself rather than about them.
 */
function headstone(person) {
  const died = new Date(person.diedAt).toISOString().slice(0, 10);

  const trips =
    person.trips === 0
      ? 'Never left the camp.'
      : `Made ${person.trips} ${person.trips === 1 ? 'trip' : 'trips'}${
          person.lastRegion ? `, the last to ${escape(person.lastRegion)}` : ''
        }.`;

  // The detail that stings, and it was free: nothing cleans up after the dead, so
  // their pack is still there to be read.
  const carrying =
    person.carrying.length === 0
      ? 'Carrying nothing at all.'
      : `Carrying ${listOf(person.carrying.map((i) => `${i.qty} × ${escape(i.name)}`))}.`;

  return `<div class="stone">
      <div class="stone-head">
        <span class="who-name">${escape(person.name)}</span>
        <span class="cost">${n(person.daysSurvived)} days held</span>
      </div>
      <p>Died of ${escape(String(person.cause ?? 'unknown causes').replaceAll('_', ' '))}
         on <span class="num">${escape(died)}</span>. ${trips}</p>
      <p class="state">${carrying}</p>
    </div>`;
}

/** "a, b and c" — an inventory should read like someone describing it. */
function listOf(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
