import assert from 'node:assert/strict';
import test from 'node:test';

import { STEPS, directionFor } from '../../src/game/direction.js';

/** A camp that has been round the loop and needs telling nothing. */
const VETERAN = {
  hasSurvivor: true,
  workshopLevel: 6,
  ranShort: true,
  ranLong: true,
  everCrafted: true,
};

const camp = (over = {}) => ({ ...VETERAN, ranShort: false, ranLong: false, everCrafted: false, workshopLevel: 0, ...over });

test('a brand-new camp is pointed at the one structure that makes scrap', () => {
  const step = directionFor(camp());
  assert.equal(step.key, 'workshop');
  assert.match(step.line, /scrap/);
});

test('then at the short walk, by name', () => {
  const step = directionFor(camp({ workshopLevel: 1, shortestRegion: 'The Fence Line' }));
  assert.equal(step.key, 'wire');
  assert.match(step.line, /The Fence Line/, 'the advice names a row on the table below it');
});

test('the chain runs bench, then craft, then the far places', () => {
  assert.equal(directionFor(camp({ workshopLevel: 1, ranShort: true })).key, 'bench');
  assert.equal(directionFor(camp({ workshopLevel: 2, ranShort: true })).key, 'craft');
  assert.equal(
    directionFor(camp({ workshopLevel: 2, ranShort: true, everCrafted: true })).key,
    'far',
  );
});

test('the far step is the one that says what a long trip costs', () => {
  const step = directionFor(camp({ workshopLevel: 2, ranShort: true, everCrafted: true }));
  assert.match(step.line, /closing the tab/, 'the whole point: it is an idle loop, not an active one');
});

test('a camp that has been round the loop is told nothing', () => {
  assert.equal(directionFor(VETERAN), null);
});

test('and stays told nothing after a successor knocks the structures back', () => {
  // SUCCESSOR_STRUCTURE_LOSS takes two levels off everything, which can put a veteran
  // camp under workshop two. State alone would sit it down and teach it about the
  // bench again; the three history facts are what stop that.
  assert.equal(directionFor({ ...VETERAN, workshopLevel: 0 }), null);
});

test('falling into the trap on turn one does not switch the chain off', () => {
  // The failure this is built to survive. A first-ever dispatch straight to the Deep
  // Zone sets ranLong and nothing else — exactly the player who most needs telling.
  const step = directionFor(camp({ ranLong: true }));
  assert.ok(step, 'the chain is still speaking');
  assert.equal(step.key, 'workshop');
});

test('an empty chair is somebody else\'s advice to give', () => {
  assert.equal(directionFor({ ...camp(), hasSurvivor: false }), null);
  assert.equal(directionFor(null), null);
});

test('every step has a line, and no step is a checklist item', () => {
  const facts = camp({ shortestRegion: 'The Fence Line' });
  for (const step of STEPS) {
    const line = step.line(facts);
    assert.match(line, /\.$/, `${step.key} is a sentence`);
    assert.doesNotMatch(line, /\d+ *(scrap|fuel|water|food)\b/, `${step.key} prices nothing`);
  }
});
