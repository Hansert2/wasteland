import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ERA_HOURS,
  PAIRS,
  RELATIONS,
  STATES,
  changesBetween,
  eraAt,
  pairKey,
  relationAt,
  relationsAt,
  stateOf,
  temperatureOf,
  warmthOf,
} from '../../src/game/relations.js';
import { FACTIONS } from '../../src/game/factions.js';
import { WORLD_EPOCH } from '../../src/game/world-events.js';

const HOUR = 3600_000;
const eraStart = (era) => WORLD_EPOCH + era * ERA_HOURS * HOUR;

test('every crew is paired with every other crew exactly once', () => {
  const slugs = Object.keys(FACTIONS);
  assert.equal(PAIRS.length, (slugs.length * (slugs.length - 1)) / 2);

  const keys = new Set(PAIRS.map(([a, b]) => pairKey(a, b)));
  assert.equal(keys.size, PAIRS.length, 'a pair appears twice');
  for (const [a, b] of PAIRS) assert.notEqual(a, b, 'nobody is at war with themselves');
});

test('a relationship has no direction — (a, b) and (b, a) are the same fact', () => {
  // The key is what seeds the draw, so this is not tidiness: an order-sensitive key would
  // give the same two crews two different opinions of each other.
  for (const [a, b] of PAIRS) {
    assert.equal(pairKey(a, b), pairKey(b, a));
    for (const era of [0, 1, 9, 400]) {
      assert.equal(temperatureOf(7, a, b, era), temperatureOf(7, b, a, era));
    }
  }
});

test('the same world reads the same at any distance from it', () => {
  // Every camp generates the world's politics rather than reading them from anywhere, so
  // "deterministic" is the only thing making them the same politics.
  for (const at of [eraStart(0), eraStart(3) + 17 * HOUR, eraStart(3000)]) {
    assert.deepEqual(relationsAt(20260101, at), relationsAt(20260101, at));
  }
  assert.notDeepEqual(
    relationsAt(1, eraStart(9)),
    relationsAt(2, eraStart(9)),
    'two worlds should not share a history',
  );
});

test('a season is four weeks, and an instant inside one reads the whole of it', () => {
  assert.equal(eraAt(WORLD_EPOCH), 0);
  assert.equal(eraAt(WORLD_EPOCH - 10_000 * HOUR), 0, 'before the world is era zero');
  assert.equal(eraAt(eraStart(5)), 5);
  assert.equal(eraAt(eraStart(5) + ERA_HOURS * HOUR - 1), 5, 'the last minute is still era 5');

  const [a, b] = PAIRS[0];
  assert.equal(relationAt(11, a, b, eraStart(5)), relationAt(11, a, b, eraStart(5) + 300 * HOUR));
});

test('the state never moves more than two steps in one season', () => {
  /*
   * The claim the moving average was chosen for, and an average is no evidence of it: the
   * whole point is the *largest* jump. Three hundred worlds, every pair, two hundred seasons.
   */
  let worst = 0;
  for (let world = 1; world <= 300; world += 1) {
    for (const [a, b] of PAIRS) {
      let previous = stateOf(temperatureOf(world * 7717, a, b, 0));
      for (let era = 1; era < 200; era += 1) {
        const state = stateOf(temperatureOf(world * 7717, a, b, era));
        worst = Math.max(worst, Math.abs(STATES.indexOf(state) - STATES.indexOf(previous)));
        previous = state;
      }
    }
  }
  assert.ok(worst <= 2, `a relation jumped ${worst} states in one season`);
  assert.ok(worst === 2, 'and it should be able to move two, or the middle states are unreachable');
});

test('the declared shares are what the world actually spends its time in', () => {
  /*
   * The cut points are derived from `share` by inverting an Irwin-Hall quantile, which is
   * either exactly right or silently out by a third — and nothing on the page would show it.
   * Within a point and a half over fifty thousand seasons.
   */
  const seen = Object.fromEntries(STATES.map((state) => [state, 0]));
  let total = 0;
  for (let world = 1; world <= 300; world += 1) {
    for (const [a, b] of PAIRS) {
      for (let era = 0; era < 60; era += 1) {
        seen[stateOf(temperatureOf(world * 7717, a, b, era))] += 1;
        total += 1;
      }
    }
  }

  const wanted = STATES.reduce((sum, state) => sum + RELATIONS[state].share, 0);
  for (const state of STATES) {
    const got = (seen[state] / total) * 100;
    const want = (RELATIONS[state].share / wanted) * 100;
    assert.ok(Math.abs(got - want) < 1.5, `${state} is ${got.toFixed(1)}% and wants ${want}%`);
  }
});

test('a change is reported once, at the turn of the season, with a reason', () => {
  const seed = 20260101;
  const changes = changesBetween(seed, eraStart(0), eraStart(40));
  assert.ok(changes.length > 0, 'forty seasons should produce some news');

  for (const change of changes) {
    assert.ok(STATES.includes(change.from) && STATES.includes(change.to));
    assert.notEqual(change.from, change.to, 'a change that changed nothing');
    assert.equal(change.warmer, STATES.indexOf(change.to) > STATES.indexOf(change.from));
    assert.ok(change.cause.length > 0, 'a state moved and nothing said why');
    assert.equal(
      change.at % (ERA_HOURS * HOUR),
      WORLD_EPOCH % (ERA_HOURS * HOUR),
      'changes happen at the turn of a season and nowhere else',
    );
    assert.equal(relationAt(seed, change.a, change.b, change.at), change.to);
    assert.equal(relationAt(seed, change.a, change.b, change.at - 1), change.from);
  }

  /*
   * Half-open on the left, closed on the right: a tick that has already reported a change must
   * not report it again on the next run. Counted rather than assumed to be one — three pairs
   * share a season boundary, and the first turn of this world moves two of them at once.
   */
  const first = changes[0];
  const together = changes.filter((change) => change.at === first.at).length;
  assert.equal(
    changesBetween(seed, first.at, eraStart(40)).length,
    changes.length - together,
    'a boundary already reported is reported again',
  );
});

test('a window only ever costs what it covers, however old the world is', () => {
  /*
   * The reason this is a moving average rather than a walk. `test/db/world.test.js` runs the
   * year 2287; a fold from the epoch would be twenty-four thousand seasons deep by then.
   */
  const late = Date.UTC(2287, 0, 1);
  const started = process.hrtime.bigint();
  const changes = changesBetween(20260101, late, late + 90 * 24 * HOUR);
  const micros = Number(process.hrtime.bigint() - started) / 1000;

  assert.ok(changes.length <= PAIRS.length * 5, 'ninety days is at most a few seasons of news');
  assert.ok(micros < 50_000, `ninety days in the year 2287 took ${micros.toFixed(0)}us`);
});

test('warmth is a number a multiplier can be built out of, and neutral is nothing', () => {
  assert.equal(warmthOf('neutral'), 0);
  assert.equal(warmthOf('hostile'), -2);
  assert.equal(warmthOf('working'), 2);
  assert.ok(warmthOf('trading') > warmthOf('tense'));
});
