import assert from 'node:assert/strict';
import test from 'node:test';

import { CONDITIONS, STEPS, directionFor } from '../../src/game/direction.js';

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

const STEP_KEYS = STEPS.map((step) => step.key);

test('a camp that has been round the loop is done being taught', () => {
  // The chain leaves for good. What speaks after it is a reading of the camp, never
  // another lesson about the game.
  const step = directionFor(VETERAN);
  assert.ok(step === null || !STEP_KEYS.includes(step.key), JSON.stringify(step));
});

test('and stays done after a successor knocks the structures back', () => {
  // SUCCESSOR_STRUCTURE_LOSS takes two levels off everything, which can put a veteran
  // camp under workshop two. State alone would sit it down and teach it about the
  // bench again; the three history facts are what stop that.
  const step = directionFor({ ...VETERAN, workshopLevel: 0 });
  assert.ok(step === null || !STEP_KEYS.includes(step.key), JSON.stringify(step));
});

test('an unknown camp is not told it is undefended', () => {
  // Number(undefined) is NaN and NaN < 6 is false, so a missing wealth used to fall
  // straight through the guard and announce that nothing turned raiders back.
  assert.equal(directionFor(VETERAN), null);
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

/** A camp past the chain, in good order, with nothing to say about it. */
const settled = (over = {}) => ({
  ...VETERAN,
  stores: [
    { kind: 'food', amount: 200, cap: 500, ratePerHour: 1.2 },
    { kind: 'water', amount: 200, cap: 500, ratePerHour: 2.5 },
    { kind: 'scrap', amount: 100, cap: 500, ratePerHour: 1.5 },
    { kind: 'fuel', amount: 0, cap: 500, ratePerHour: 0 },
  ],
  wealth: 20,
  defence: 24,
  upgrade: null,
  lowest: { kind: 'workshop', level: 3, next: '+1.5 scrap/h' },
  ...over,
});

test('a store on its way to empty is the first thing said, with the hour', () => {
  const step = directionFor(settled({
    stores: [{ kind: 'water', amount: 6, cap: 500, ratePerHour: -0.5 }],
  }));

  assert.equal(step.key, 'running_out');
  assert.match(step.line, /about 12 hours/);
  assert.match(step.line, /water purifier/, 'and names the one structure that answers it');
});

test('a rate that will not empty the stores this side of tomorrow is not news', () => {
  const step = directionFor(settled({
    stores: [{ kind: 'food', amount: 400, cap: 500, ratePerHour: -0.4 }],
  }));

  assert.notEqual(step.key, 'running_out', 'a thousand hours out is not a warning');
});

test('production about to be thrown away is warned before it is being thrown away', () => {
  // Measured on a real camp: water at 499 of 600, rising at 5.5 an hour. A threshold
  // on percent-full gives half an hour of notice on a build that takes longer; the
  // forecast gives eighteen, which is time to do something about it.
  const soon = directionFor(settled({
    stores: [{ kind: 'water', amount: 595, cap: 600, ratePerHour: 1 }],
  }));
  assert.equal(soon.key, 'overflowing');
  assert.match(soon.line, /reaches the cap in about 5 hours/);
  assert.match(soon.line, /shelter/);

  const already = directionFor(settled({
    stores: [{ kind: 'food', amount: 600, cap: 600, ratePerHour: 1.2 }],
  }));
  assert.equal(already.key, 'overflowing');
  assert.match(already.line, /being thrown away by the hour/);

  const roomy = directionFor(settled({
    stores: [{ kind: 'water', amount: 100, cap: 600, ratePerHour: 1 }],
  }));
  assert.notEqual(roomy.key, 'overflowing', 'five hundred hours of headroom is not news');
});

test('a camp worth robbing hears how often the fence actually turns them back', () => {
  // The figure has to come from raids.js or the page promises a number the raid does
  // not roll against. Eight defence is 8/40, which is a fifth.
  const step = directionFor(settled({ wealth: 20, defence: 8 }));

  assert.equal(step.key, 'undefended');
  assert.match(step.line, /one in 5/);
});

test('and a camp with nothing worth taking is not nagged about a watchtower', () => {
  const step = directionFor(settled({ wealth: 2, defence: 0 }));
  assert.notEqual(step.key, 'undefended');
});

test('a camp in good order gets its position, not an order', () => {
  const step = directionFor(settled());

  assert.equal(step.key, 'standing');
  assert.match(step.line, /Nothing pressing/);
  assert.match(step.line, /workshop is the least of the camp at level 3/);
  // The line that would answer the question the game exists to ask.
  assert.doesNotMatch(step.line, /\bbuild\b|\bshould\b|\bnext\b/i);
});

test('every condition reads a camp it was not given, without throwing', () => {
  // These run on every page load for every camp, including ones missing facts a future
  // caller forgot to pass. A crash here takes the whole page with it.
  for (const condition of CONDITIONS) {
    for (const facts of [{}, { stores: [] }, { stores: [{}] }, { wealth: null, defence: null }]) {
      assert.doesNotThrow(() => condition.read(facts), `${condition.key} on ${JSON.stringify(facts)}`);
    }
  }
});

test('a camp with nothing to do before they are back is told so, and only then', () => {
  const dead = { awayHours: 12, opensBeforeReturn: 0 };

  assert.equal(directionFor(settled(dead)).key, 'idle');
  assert.match(directionFor(settled(dead)).line, /before they are back/);

  // Every condition above it is something the camp could be doing, so reaching the
  // idle line at all means there was nothing. A camp that can fit an upgrade does not
  // have a dead evening and must not be told it has one.
  assert.equal(directionFor(settled({ ...dead, upgrade: 'Filtration' })).key, 'fittable');
  assert.equal(
    directionFor(settled({
      ...dead,
      stores: [{ kind: 'water', amount: 6, cap: 500, ratePerHour: -0.5 }],
    })).key,
    'running_out',
  );
});

test('a door opening before the return means the evening is not dead', () => {
  const step = directionFor(settled({ awayHours: 12, opensBeforeReturn: 1 }));
  assert.equal(step.key, 'standing');
});

test('an overdue trip is no trip, because they are already home', () => {
  // The block this replaced filtered its plan by hours-left, which goes negative when a
  // trip runs over — so everything dropped out and it announced a dead evening to a
  // camp whose survivor was standing in it.
  assert.equal(directionFor(settled({ awayHours: 0, opensBeforeReturn: 0 })).key, 'standing');
  assert.equal(directionFor(settled({ awayHours: null, opensBeforeReturn: null })).key, 'standing');
});
