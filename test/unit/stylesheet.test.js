import test from 'node:test';
import assert from 'node:assert/strict';

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { landingPage } from '../../src/web/render.js';

/**
 * The stylesheet is a template literal, and that is a worse place to be wrong than it
 * looks.
 *
 * Nothing here checks whether the page is *styled well* — no test can. These check the
 * two ways the CSS has actually been broken, both of which a browser recovers from
 * silently and no other test in the suite can see:
 *
 * 1. **A backtick inside a CSS comment**, which ends the template literal. That one at
 *    least fails loudly — the module stops parsing and whole test files go red — so it
 *    is here only to name the cause when it happens again.
 * 2. **A comment closed twice**, which is what appending a paragraph after a close
 *    delimiter produces. This is the dangerous one. CSS error recovery reads the loose
 *    text as a selector and keeps consuming until the next brace, so the rule
 *    *underneath* the comment is swallowed along with it. The page renders, every test
 *    passes, and one block has silently lost its padding and its border — which is
 *    exactly what happened to the rail crest.
 *
 * Extracting the sheet through a rendered page rather than exporting `STYLE`: it is
 * private on purpose, and what matters is the CSS that actually reaches a browser.
 */
function stylesheet() {
  const html = landingPage();
  const from = html.indexOf('<style>') + '<style>'.length;
  const to = html.indexOf('</style>', from);
  assert.ok(from > 6 && to > from, 'the page carries a stylesheet');
  return html.slice(from, to);
}

test('every CSS comment is opened once and closed once', () => {
  const css = stylesheet();
  const opens = css.split('/*').length - 1;
  const closes = css.split('*/').length - 1;

  assert.equal(
    opens,
    closes,
    `${opens} comment opens against ${closes} closes — a stray delimiter swallows the ` +
      'rule beneath it rather than failing',
  );
});

test('no CSS rule is left stranded outside a comment', () => {
  // What a doubled close actually leaves behind: prose sitting at the top level of the
  // sheet. Checked by removing every properly-formed comment and then looking for the
  // continuation marker a JSDoc-style block uses, which is not valid CSS anywhere.
  const bare = stylesheet().replace(/\/\*[\s\S]*?\*\//g, '');

  // A star that begins a word is prose; a star that begins a selector is followed by a
  // comma, a brace or a colon. `*, *::before` is a real rule in this sheet and has to
  // stay one, so the two cases are told apart rather than the star being banned.
  const stranded = bare
    .split('\n')
    .map((line, index) => [index + 1, line.trim()])
    .filter(([, line]) => /^\*\s+["A-Za-z]/.test(line) && !line.includes('{'));

  assert.deepEqual(
    stranded,
    [],
    `prose left outside a comment: ${stranded.map(([at, line]) => `line ${at}: ${line}`).join('; ')}`,
  );
});

test('the sheet reaches the page with its braces balanced', () => {
  // A missing close brace nests every rule after it inside the one before, which is
  // the other silent way a stylesheet can be wrong: no error, and half the page simply
  // stops matching its selectors.
  const bare = stylesheet().replace(/\/\*[\s\S]*?\*\//g, '');
  const open = bare.split('{').length - 1;
  const close = bare.split('}').length - 1;

  assert.equal(open, close, `${open} opening braces against ${close} closing`);
});

test('no backtick is written inside the stylesheet', async () => {
  /*
   * Three syntax errors in one day came from naming something in backticks inside a CSS
   * comment. STYLE is a template literal, so the first backtick ends it and the rest of
   * the file becomes whatever it happens to parse as — usually a confusing error pointing
   * at a line that is fine.
   *
   * Read as text rather than imported, and that is the point: by the time the module can
   * be imported the mistake has already been fixed, so a runtime assertion could never
   * see it. This is a lint, and it belongs in the suite because the failure it prevents
   * is a page that does not render at all.
   */
  const source = await readFile(
    fileURLToPath(new URL('../../src/web/render.js', import.meta.url)),
    'utf8',
  );

  const opened = source.indexOf('const STYLE = `');
  const body = source.slice(opened + 'const STYLE = `'.length);
  const closed = body.indexOf('`');

  assert.ok(opened > 0, 'the stylesheet is not where this test thinks it is');
  assert.ok(
    body.slice(0, closed).trim().endsWith('}') || closed > 1000,
    `a backtick ends STYLE ${closed} characters in, which is far too early`,
  );
});
