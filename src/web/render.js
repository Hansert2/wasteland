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
 * `s-head` and `s-error` are on every view deliberately and are not listed. The head is
 * the camp's identity and lives in the rail; the error box is a refusal of something the
 * player just did, and a refusal that renders into a hidden section is a button that
 * silently did nothing.
 */
const PANES = {
  camp: ['moment', 'raid', 'sky', 'events', 'direction', 'stores', 'structures', 'caravan', 'roster'],
  survivor: ['survivor', 'inventory', 'expedition', 'workshop'],
  road: ['road'],
  trade: ['caravan', 'post', 'standings'],
};

/** Rail order, and the label each view answers to. `records` is the graveyard page. */
const RAIL = [
  ['camp', 'Camp', '/camp'],
  ['survivor', 'Survivor', '/camp/survivor'],
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
  .shell {
    display: flex;
    align-items: stretch;
    gap: 0;
    max-width: 1280px;
    margin: 0 auto;
    min-height: 100vh;
    background: var(--ground);
    border-left: 1px solid var(--rule);
    border-right: 1px solid var(--rule);
  }

  /*
   * The divider between rail and content is on "main", not on the rail.
   *
   * Whichever of the two is taller has to carry it, or the line stops partway down the
   * card and reads as a rendering fault. "main" is the tall one on every view except an
   * empty Road, and "align-items: stretch" makes it the tall one there too.
   */
  .rail {
    flex: 0 0 198px;
    width: 198px;
    background: var(--rail);
  }

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

  .rail form { margin: 20px; }

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
    flex: 1 1 auto;
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
  main #s-error { display: block; }
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

  /* Left: the trip and the bench. Right: the person, gauges number-first, and what
     they are carrying. Two flex columns rather than grid cells, because grid rows are
     shared and a tall dispatch table would drag the pack down the page with it. */
  body[data-pane="survivor"] main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 18px 24px;
    align-items: start;
  }
  /* Scoped to the two lanes the Survivor view actually arranges. ".lane-pair" has both
     its sections hidden here, and turning it into a flex box would leave an empty grid
     item eating a row and a gap. */
  body[data-pane="survivor"] .lane-main,
  body[data-pane="survivor"] .lane-side { display: flex; flex-direction: column; gap: 18px; }
  body[data-pane="survivor"] .lane-main { grid-column: 1; }
  body[data-pane="survivor"] .lane-side { grid-column: 2; }
  body[data-pane="survivor"] #s-error { grid-column: 1 / -1; }
  /* A 104px label gutter is a third of a 300px column, so in the sidebar a quiet row
     stacks its label above its line instead of standing beside it. */
  body[data-pane="survivor"] .lane-side .quiet { display: block; margin: 0; }
  body[data-pane="survivor"] .lane-side .quiet .tag { display: block; margin-bottom: 7px; }
  @media (max-width: 900px) {
    body[data-pane="survivor"] main { display: flex; }
    body[data-pane="survivor"] .lane { display: contents; }
  }

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
  body[data-pane="camp"] .lane-pair #s-inventory,
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
  /* The turn: the widest measure on the page and the only thing set above prose size,
     because it is the sentence the whole block exists to ask. */
  .contact .turn { margin: 11px 0 0; font-size: 20px; line-height: 1.5;
                   max-width: 64ch; color: #EAE7DD; }

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

  .stores { display: grid; grid-template-columns: repeat(4, 1fr); }
  .store { padding: 14px 18px; border-right: 1px solid var(--rule-in); }
  .store:last-child { border-right: 0; }
  .store-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .store-top .tag { letter-spacing: .12em; color: var(--dim); }
  .rate { font-family: var(--numer); font-size: 11.5px; line-height: 1;
          color: var(--quiet); font-variant-numeric: tabular-nums; }
  /* The single most useful thing this block can say, so it is the one figure here that
     gets the accent: a store quietly draining. */
  .rate.down { color: var(--oxide-light); }
  .rate.none { color: var(--faint); }
  .store-fig { margin-top: 8px; font-family: var(--numer); font-size: 23px; line-height: 1;
               color: var(--value); font-variant-numeric: tabular-nums; }
  .store-fig .cap { font-size: 11.5px; color: var(--faint); }
  /* A zero store shows an empty track rather than no track: the four cells are the same
     shape whatever is in them, or the eye has to re-find the layout each time. */
  .track { margin-top: 8px; height: 2px; background: #2C2A25; }
  .track i { display: block; height: 2px; background: var(--quiet); }

  @media (max-width: 640px) {
    .stores { grid-template-columns: repeat(2, 1fr); }
    .store:nth-child(2n) { border-right: 0; }
    .store:nth-child(n + 3) { border-top: 1px solid var(--rule-in); }
  }

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
  .road-note { padding: 12px 18px; border-bottom: 1px solid var(--rule-in); max-width: 74ch; }
  .page-title { font-family: var(--label); font-weight: 700; font-size: 25px;
                line-height: 1.15; color: var(--bone); margin: 0 0 10px; }

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

  ul.events { list-style: none; margin: 0; padding: 0; }
  ul.events li { padding: 11px 18px; border-bottom: 1px solid var(--rule-in);
                 max-width: 76ch; text-wrap: pretty; }
  ul.events li:last-child { border-bottom: 0; }
  .when { font-family: var(--numer); font-size: 12.5px; color: var(--faint);
          font-variant-numeric: tabular-nums; margin-right: 8px; white-space: nowrap; }

  /* ---- gauges ---- */

  .gauges { display: flex; flex-direction: column; gap: 13px; margin-top: 18px; }
  .gauge-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .gauge-top .tag { letter-spacing: .14em; color: var(--dim); }
  .gauge-top .val { font-family: var(--numer); font-size: 16px; line-height: 1;
                    color: var(--value); font-variant-numeric: tabular-nums; }
  .gauge .track { margin-top: 7px; }
  .gauge small { display: block; margin-top: 6px; font-size: 14px; line-height: 1.5; }
  .who-name { display: block; font-family: var(--label); font-weight: 700; font-size: 22px;
              line-height: 1.1; color: var(--bone); }
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

  input[type="email"], input[type="password"], input[type="text"], input[type="number"] {
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

  /* The sentence a block leads with, where the block's whole job is to say one thing.
     Prose, near-bone, and wide — the opposite register to ".state", which is the same
     kind of string doing small-print duty under a decision. */
  .lede-line { margin: 0; font-size: 18px; line-height: 1.55; color: #EAE7DD;
               max-width: 56ch; }
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
  .gate h1 { font-family: var(--label); font-weight: 700; font-size: 24px;
             letter-spacing: .18em; text-transform: uppercase; color: var(--bone);
             margin: 0 0 24px; }
  .gate .block { margin-bottom: 18px; }
  .gate .error { margin-bottom: 18px; }
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
    .shell { display: block; border-left: 0; border-right: 0; }
    main { border-left: 0; }
    .rail {
      width: auto;
      border-bottom: 1px solid var(--rule);
    }
    .rail .who { padding: 18px 16px 14px; border-bottom: 0; }
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
    .rail form { margin: 12px 16px; }
    main { padding: 16px 16px 64px; }
    button { padding: 13px 16px; min-height: 44px; }
    .choice button { padding: 13px 0; }
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
    .block > table td.cost-col, .block > table td.right { grid-column: 1;
                                                          text-align: left; width: auto; }
    .block > table td.act { grid-column: 2; grid-row: 1 / span 2; width: auto; }
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
export function layout(title, body, { pane } = {}) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head>
<body${pane ? ` data-pane="${escape(pane)}"` : ''}>${body}<script>${TIMERS}</script></body></html>`;
}

/**
 * The rail: who this camp is, the five views, and the way out.
 *
 * The log out form sits here and deliberately *outside* any section, which is what
 * makes it navigate rather than post in place — the rule `section()` documents, used
 * rather than restated.
 */
function rail(pane, identity) {
  const links = RAIL.map(
    ([name, label, href]) =>
      `<a href="${href}"${name === pane ? ' aria-current="page"' : ''}>${label}</a>`,
  ).join('');

  return `<div class="rail">
    ${identity}
    <nav>${links}</nav>
    <form method="post" action="/logout"><button type="submit">Log out</button></form>
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

  let live = [];
  let stores = [];
  let since = Date.now();
  let busy = false;

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
    since = Date.now();
  };

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
    fetch(location.pathname, { credentials: 'same-origin' })
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
      const source = host.querySelector('.note');
      const text = source ? source.textContent.trim() : '';
      if (!text) { drop(); return; }
      noted = host;
      pop.textContent = text;
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

export function landingPage({ error } = {}) {
  return layout('Wasteland', `
    <div class="gate">
      <h1>Wasteland</h1>
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

      <div class="block">
        <h2>Found a new camp</h2>
        <div class="block-body">
          <form method="post" action="/register">
            <label>Email <input name="email" type="email" required autocomplete="username"></label>
            <label>Password <input name="password" type="password" required autocomplete="new-password" minlength="8"></label>
            <label>Camp name <input name="settlementName" placeholder="Camp"></label>
            <button type="submit">Begin</button>
          </form>
        </div>
      </div>
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
const block = (label, body, { wants = false, flush = false, foot = '' } = {}) =>
  `<div class="block${wants ? ' wants' : ''}"><h2>${label}</h2>${
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
export function campPage(view, { error, pane = 'camp' } = {}) {
  const identity = section('head', `
    <div class="who">
      <span class="tag">Camp</span>
      <h1>${escape(view.name)}</h1>
      <p>wealth ${view.wealth}<br>defence ${view.defence}<br>
         founded ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>
    </div>`);

  return layout(view.name, `<div class="shell">
    ${rail(pane, identity)}
    <main>
    ${section('error', error ? `<p class="error">${escape(error)}</p>` : '')}

    ${section('moment', renderMoment(view.expedition))}
    ${section('raid', renderRaidWarning(view.raidExpectedAt))}
    ${section('sky', renderWeather(view.weather))}

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
      * The Survivor view is two columns — the trip and the bench on the left, the person
      * and their pack in a 300px sidebar — and these lanes are what make that possible
      * without the section stream growing a second arrangement.
      *
      * A grid cannot give two columns independent heights: rows are shared, so a tall
      * dispatch table on the left would push the pack halfway down the page on the
      * right. Two flex columns can, and the lanes are `display: contents` on every other
      * view, which means their sections are laid out as direct children of `main` and
      * the single-column views do not know the wrappers exist.
      *
      * The order changed to make them adjacent: `s-workshop` moved up beside
      * `s-expedition`, and the pair now sits before the person rather than after.
      * Filtered through `PANES` the Camp view is byte-for-byte what it was — none of
      * these four is on it.
      */ ''}
    <div class="lane lane-main">
      ${section(
        'expedition',
        view.survivor ? renderExpeditions(view) : quiet('Away', NOTHING.expedition),
      )}
      ${section('workshop', renderWorkshop(view))}
    </div>
    <div class="lane lane-side">
      ${section(
        'survivor',
        view.survivor
          ? renderSurvivor(view.survivor, view.strain)
          : renderNoSurvivor(view.fallenCount > 0, view.arriving),
      )}
      ${section('inventory', renderInventory(view.inventory))}
    </div>

    ${section('stores', renderResources(view.resources))}
    ${section(
      'structures',
      renderStructures(
        view.structures,
        view.buildInFlight,
        Boolean(view.survivor),
        view.direction,
        !view.expedition?.moment,
      ),
    )}
    ${section('road', renderRoad(view.road))}

    ${section('caravan', renderCaravan(view.caravan, Boolean(view.survivor)))}
    ${section('post', renderPost(view.post, Boolean(view.survivor)))}
    ${section('standings', renderStandings(view.standings))}

    ${section('roster', renderRoster(view.fallenCount))}
    </main>
  </div>`, { pane });
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
 * The radio, and the whole of what it bought.
 *
 * Placed above everything else because it is the only thing on this page with a
 * deadline. Stores are all a raid can take, so the useful response to this is to
 * spend them — which is the point: a warning turns a hoard into a decision.
 */
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
  if (!strain || strain.state === 'mending') return '';

  const clear = `clear in ${duration(strain.hoursToMending)}`;

  if (strain.state === 'burning') {
    return `<small>past ${strain.threshold}: losing ${n(strain.damagePerHour)} health an hour, under ${strain.threshold} in ${duration(strain.hoursToSafe)}, ${clear}</small>`;
  }

  return `<small>not healing until this is down, ${clear}</small>`;
}

function renderSurvivor(survivor, strain) {
  // What this one is, under how they are doing. Without it the skills are two hidden
  // multipliers and the arrival prose was a thing the player read once and never saw
  // the consequences of — which is the failure the whole feature exists to avoid.
  // Under the name and in prose, not in a "known for:" label. It is a sentence about a
  // person, and prefixing it with a field name turns them into a record.
  const who = survivor.knownFor
    ? `<p class="known">${escape(survivor.knownFor)}.</p>`
    : '';

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
  const gauge = (label, value, of, note = '') => `<div class="gauge">
      <div class="gauge-top"><span class="tag">${label}</span>
        <span class="val">${n(value)}</span></div>
      <div class="track">${
        value > 0 ? `<i style="width:${bar(value, of)}%"></i>` : ''
      }</div>${note}
    </div>`;

  return block(
    'Survivor',
    `<div class="who-name">${escape(survivor.name ?? 'Survivor')}</div>
     ${who}
     <div class="gauges">
       ${gauge('Health', survivor.health, 100)}
       ${gauge('Hunger', survivor.hunger, 100)}
       ${gauge('Radiation', survivor.radiation, strain?.threshold ?? 100, strainNote(strain))}
     </div>`,
  );
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
       <p><small>Known for: ${escape(arriving.knownFor)}.</small></p>`
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
        ${momentAction(moment, option, option === filled)}
      </div>`,
    )
    .join('');

  const warned = moment.options.some((option) => option.warned);

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
        <p class="turn">${escape(moment.prose)}</p>
      </div>
      <div class="choices">${choices}</div>
    </div>`;
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
 * The one-line state of a trip.
 *
 * The region is named only where the surrounding block has not already said it. In the
 * moment box it has not — that heading is "Contact", and a decision needs to know where
 * they are. In the Away report the heading *is* the region, so naming it here put the
 * same words twice in two consecutive lines.
 */
function condition(expedition, { region = true } = {}) {
  const carried = Object.entries(expedition.carrying)
    .map(([kind, amount]) => `${amount} ${kind}`)
    .join(', ');

  return [
    elapsed(expedition.hoursOut, region ? expedition.regionName : null),
    carried ? `carrying ${carried}` : 'carrying nothing yet',
    `at ${n(expedition.health, 0)} health`,
  ].join(', ') + '.';
}

function renderExpeditions(view) {
  if (view.expedition) {
    const trip = view.expedition;
    const hoursLeft = (new Date(trip.returnsAt).getTime() - Date.now()) / 3600000;
    // Label first, then the figure: "due back in 18h 00m 00s" is a sentence the strip
    // finishes, where "18h 00m 00s DUE BACK" is a readout with a caption. The Contact
    // strip runs the other way round for the same reason — there the figure is the
    // point and "to answer" is what it is a figure *of*.
    const due =
      hoursLeft > 0
        ? `<span class="clock"><small>due back in</small>${countdown(trip.returnsAt, 'now')}</span>`
        : '<span class="short">overdue &mdash; reload to see what came back</span>';

    // The report, which is what makes a check-in that catches no window worth making.
    // Rendered once and not animated: the haul steps by a whole unit about once an
    // hour, so a live counter would buy nothing and would cost the client script a copy
    // of the progress curve.
    const lines = [];

    if (trip.damage > 0) {
      lines.push(`Hurt out there${trip.cause ? ` — ${escape(trip.cause)}` : ''}.`);
    }
    if (trip.radiation > 0) lines.push(`${n(trip.radiation)} rads so far.`);
    if (trip.findCount > 0) {
      lines.push(`${trip.findCount} thing${trip.findCount === 1 ? '' : 's'} worth keeping.`);
    }
    if (trip.nextMomentAt) {
      lines.push(`Radio: next contact in ${countdown(trip.nextMomentAt, 'any moment')}.`);
    }

    // What has already been answered, and — the part that was missing — the fact that
    // it has not happened yet. Answering records a choice and nothing more; the trip is
    // still rolled at the return, with the answers as an input. Without this the moment
    // box simply vanished on submit and the page said nothing at all until the survivor
    // walked back through the gate, which reads exactly like a button that did nothing.
    for (const answer of trip.settled ?? []) {
      lines.push(`${escape(answer.title)}, ${duration(answer.atHour)} in — ${escape(answer.label)}.`);
    }
    if ((trip.settled ?? []).length > 0) {
      lines.push('What came of that comes home with them.');
    }

    /*
     * The state of the trip is the lede, not a readout.
     *
     * "Less than an hour in, carrying nothing yet, at 100 health" was set in 13px mono
     * in the colour reserved for things that are present but not the point — which is
     * right inside the Contact panel, where it is the small print under a decision, and
     * wrong here, where it is the whole of what the block has to say. Same string, two
     * jobs, and only one of them is a machine readout.
     *
     * Under it, what the place is. The dispatch table says that sentence before you
     * send anybody and then the block that replaces it never said it again, so a trip
     * in progress was eight hours of numbers about a name.
     */
    return `<div class="block contact">
        <div class="block-head">
          <span class="tag">Away &mdash; ${escape(trip.regionName)}</span>
          ${due}
        </div>
        <div class="block-body">
          <p class="lede-line">${escape(condition(trip, { region: false }))}</p>
          ${
            trip.regionDescription
              ? `<p class="under">${escape(trip.regionDescription)}</p>`
              : ''
          }
          ${lines.length > 0 ? `<p class="under">${lines.join('<br>')}</p>` : ''}
        </div>
      </div>${momentAlarm(trip)}`;
  }

  const rows = view.regions
    .map(
      (region) => `<tr>
        <td><span class="name">${escape(region.name)}</span>
            <span class="lvl">danger ${region.danger} &middot; ${escape(duration(region.travel_hours))} out</span></td>
        <td class="lede"><small>${escape(region.description ?? '')}</small></td>
        <td class="cost-col"><span class="cost">${escape(contact(region.moments))}</span>
            <span class="needs">${escape(meanwhile(region.openWhileAway))}</span></td>
        <td class="act">
          <form method="post" action="/expedition">
            <input type="hidden" name="region" value="${escape(region.slug)}">
            <button type="submit">Send</button>
          </form>
        </td>
      </tr>`,
    )
    .join('');

  return block('Where to send them', `<table>${rows}</table>`, { flush: true });
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
 * What the camp can do while they are gone, on the table where the trip is still a
 * choice.
 *
 * **A count, and it must stay a count.** There was a companion to this in the Away
 * report — the same plan rendered as a list of four doors and the hour each opened —
 * and it was removed on 2026-08-21 after being read beside the Next block, which
 * disagreed with it out loud. Three faults, and the third is the one that matters:
 *
 * - The plan's door list had no fittings in it, so the advice offered the Radio while
 *   the list beneath said the camp could pay for nothing. Fixed, and it was a real bug
 *   — this column was wrong too.
 * - An overdue trip has negative hours left, so every door filtered out and the block
 *   announced a dead evening to a camp whose survivor was already home.
 * - **`planFor` is greedy cheapest-first, which is honest for a count and misleading as
 *   a list.** Spending ten fuel on a Rad Scrubber puts the Radio out of reach, so the
 *   Radio is dropped — correct, since the camp cannot have both, and useless to read,
 *   since it silently picks one branch of a fork and never mentions the other.
 *
 * A count survives all three, because "will this evening have anything in it" does not
 * depend on which branch is taken. Anything above zero means yes; zero means the camp
 * goes quiet the moment you click Send, and that is worth knowing *before* the click
 * rather than four hours into finding out. The Next block says the same thing in words
 * once the trip is actually out.
 */
function meanwhile(count) {
  const n = Number(count) || 0;
  if (n === 0) return 'nothing to do meanwhile';
  return n === 1 ? '1 thing to do meanwhile' : `${n} things to do meanwhile`;
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
function addFuel(road) {
  const wanted = road.next.cost - road.next.fuel;
  const most = Math.floor(Math.min(road.available, wanted));

  if (most < 1) {
    return `<p><small>No fuel in the stores. Only expeditions bring it back.</small></p>`;
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

  // Said once, while it is still news. After a link or two the rule is obvious from
  // having done it, and a page that keeps explaining itself is a page nobody reads.
  const rule =
    road.reached.length === 0
      ? `<p class="road-note">Fuel you put toward a place is spent — you cannot take it
           back. It counts toward reaching that place, and once the cost is covered it
           stays reached.</p>`
      : '';

  const beyond =
    road.beyond > 0
      ? `${road.beyond} more after that.`
      : 'The last one.';

  return `${block(
    `The road &mdash; ${road.reached.length} of ${road.links} reached`,
    `${rule}${reached ? `<table>${reached}</table>` : ''}`,
    { flush: true },
  )}
    <div class="block wants next-link">
      <h2>Working toward ${escape(road.next.neighbour)}</h2>
      <div class="block-body">
        <p>${linkGot(road.next)}</p>
        <p class="state">Paid so far ${n(road.next.fuel, 0)} of ${n(road.next.cost, 0)} fuel.${
          // Said once. With no fuel at all `addFuel` says so and says why, and a stores
          // line beside it would only be the same sentence with a zero in it.
          road.available >= 1 ? ` ${n(road.available, 0)} in the stores.` : ''
        }</p>
        ${addFuel(road)}
      </div>
      <div class="block-foot"><span class="tag">Beyond</span>
        <span class="val">${beyond}</span></div>
    </div>`;
}

function renderInventory(inventory) {
  if (!inventory || inventory.length === 0) return quiet('Carrying', NOTHING.inventory);
  const rows = inventory
    .map(
      (item) => `<tr>
        <td><span class="name">${escape(item.name)}</span></td>
        <td class="right"><span class="cost">×${item.qty}</span></td>
      </tr>`,
    )
    .join('');
  return block('Carrying', `<table>${rows}</table>`, { flush: true });
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

  return block('Workshop', `<table>${rows}</table>`, { flush: true });
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
function renderResources(resources) {
  const cells = resources
    .map((r) => {
      // Oxide only when the store is draining, which is the one thing this table can
      // tell you that you would otherwise find out by running out. A zero rate is a
      // dash rather than "+0.0/h": nothing is happening, and a figure that says so in
      // four characters of precision looks like something is.
      const rate =
        r.ratePerHour === 0
          ? '<span class="rate none">&mdash;</span>'
          : `<span class="rate${r.ratePerHour < 0 ? ' down' : ''}">${
              r.ratePerHour > 0 ? '+' : ''
            }${n(r.ratePerHour)}/h</span>`;

      // A zero store shows an empty track rather than no track. The four cells are the
      // same shape whatever is in them, or the eye has to re-find the layout each time.
      return `<div class="store">
        <div class="store-top"><span class="tag">${escape(r.kind)}</span>${rate}</div>
        <div class="store-fig"><span data-amount="${r.amount}" data-rate="${r.ratePerHour}"
                data-cap="${r.cap}">${n(r.amount, STORE_DECIMALS)}</span><span
                class="cap"> / ${n(r.cap, 0)}</span></div>
        <div class="track"><i data-fill style="width:${bar(r.amount, r.cap)}%"></i></div>
      </div>`;
    })
    .join('');
  return block('Stores', `<div class="stores">${cells}</div>`, { flush: true });
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

function renderStructures(structures, buildInFlight, someoneAlive, direction, quiet = true) {
  // One filled control per view. A window that closes in eleven minutes outranks
  // standing advice about what to build next, so while contact is open the table stops
  // pointing — otherwise the page has two things marked as *the* thing to do and the
  // accent stops meaning either of them.
  const advised = quiet ? ADVISED[direction?.key] : undefined;

  const rows = structures
    .map((s) => {
      const name = escape(s.kind.replaceAll('_', ' '));
      const status = statusCell(s, buildInFlight, someoneAlive, s.kind === advised);
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
          ${fittingIn(s, buildInFlight, someoneAlive)}
        </td>
        ${status}
      </tr>`;
    })
    .join('');
  return block('Structures', `<table>${rows}</table>`, { flush: true });
}

/**
 * The fuel branch, where a structure has one.
 *
 * Kept on its own row rather than folded into the level track, because that is the
 * point: scrap makes the thing bigger and fuel makes it do something new, and the
 * page should not make those look like the same purchase.
 */
function fittingIn(structure, buildInFlight, someoneAlive) {
  const upgrade = structure.upgrade;
  if (!upgrade) return '';

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
  const inset = (tail) => `<span class="fitting noted">
      <span class="tag">${escape(upgrade.name)}</span>
      <span class="note">${escape(upgrade.summary)}</span>
      <span>${tail}</span>
    </span>`;

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

  // Fuel only comes home from expeditions, so the cost is worth spelling out.
  const cost = `<span class="cost">${escape(
    `${upgrade.fuel} fuel, ${duration(upgrade.hours)}`,
  )}</span>`;

  if (upgrade.shortBy) {
    return inset(`${cost} <span class="short">${escape(upgrade.shortBy)}</span>`);
  }
  if (buildInFlight || !someoneAlive) return inset(cost);

  return inset(`${cost}
    <form method="post" action="/upgrade">
      <input type="hidden" name="upgrade" value="${escape(upgrade.slug)}">
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

function statusCell(structure, buildInFlight, someoneAlive, advised) {
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

  const identity = `<div class="who">
      <span class="tag">Camp</span>
      <h1>${escape(view.name)}</h1>
      <p>founded ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>
    </div>`;

  return layout(`${view.name} — the fallen`, `<div class="shell">
    ${rail('records', identity)}
    <main>
      <p class="page-title">The fallen of ${escape(view.name)}</p>
      <p>The camp outlives its people.</p>
      ${holding}
      ${view.fallen.length === 0 ? '<p>Nobody has died here yet.</p>' : `<div class="stones">${stones}</div>`}
    </main>
  </div>`, { pane: 'records' });
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
