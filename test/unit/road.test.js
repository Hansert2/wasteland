import test from 'node:test';
import assert from 'node:assert/strict';

import { LINKS, linkCost, linkGives, neighbourFor, roadCost } from '../../src/game/road.js';
import { WORLD_EPOCH } from '../../src/game/world-events.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = WORLD_EPOCH + 230 * DAY; // roughly where the first real camp is living

test('the cost of the road is the table in the plan', () => {
  // Pinned rather than recomputed from the formula, because the plan quotes these
  // figures and prices the whole phase off them. If the multiplier moves, this is the
  // test that says so, and the plan is what has to move with it.
  assert.deepEqual(
    Array.from({ length: LINKS }, (_, i) => linkCost(i + 1)),
    [70, 105, 158, 236, 354, 532, 797],
  );

  assert.equal(roadCost(), 2252);
});

test('the road ends, and asking past the end is a question rather than a fault', () => {
  assert.equal(LINKS, 7);
  assert.equal(linkCost(LINKS), 797);

  // Null rather than a throw: the page asks "is there another link" every render.
  for (const past of [0, -1, LINKS + 1, 99, 1.5, 'two', null, undefined]) {
    assert.equal(linkCost(past), null, `link ${JSON.stringify(past)} should not exist`);
    assert.equal(neighbourFor(1234, past, NOW), null);
  }
});

test('four links are destinations, two of those trade, and three are only the news', () => {
  const gives = Array.from({ length: LINKS }, (_, i) => linkGives(i + 1));

  assert.equal(gives.filter((g) => g.destination).length, 4);
  assert.equal(gives.filter((g) => g.tradePost).length, 2);
  assert.equal(gives.filter((g) => !g.destination && !g.tradePost).length, 3);

  // A trade post is never dangled somewhere you cannot go.
  for (const g of gives) {
    if (g.tradePost) assert.ok(g.destination, 'a trade post implies somewhere to trade');
  }

  // The first link pays in something other than a sentence: 70 fuel is two or three
  // Deep Zone trips, and the player's first taste of what the road is for.
  assert.ok(linkGives(1).destination);
});

test('a neighbour is a pure function of the world seed and the link', () => {
  for (const seed of [1, 7, 4242, 999983]) {
    for (let index = 1; index <= LINKS; index += 1) {
      const a = neighbourFor(seed, index, NOW);
      const b = neighbourFor(seed, index, NOW);
      assert.deepEqual(a, b, 'the same inputs must give the same neighbour');
    }
  }

  // Different worlds meet different people. Not a guarantee about any one link, so it
  // is asserted across the whole road.
  const one = Array.from({ length: LINKS }, (_, i) => neighbourFor(11, i + 1, NOW).name);
  const two = Array.from({ length: LINKS }, (_, i) => neighbourFor(12, i + 1, NOW).name);
  assert.notDeepEqual(one, two);
});

test('a road never reaches the same place twice', () => {
  for (const seed of [0, 3, 88, 12345, 2 ** 30]) {
    const names = Array.from({ length: LINKS }, (_, i) => neighbourFor(seed, i + 1, NOW).name);
    assert.equal(new Set(names).size, LINKS, `world ${seed} repeats a name: ${names}`);
  }
});

test('a road never says the same thing twice', () => {
  // The first version rolled a news line per link out of a pool of four, which put the
  // same sentence on three of one road's seven neighbours and made a whole world sound
  // like one place. Pigeonhole rather than bad luck, so it is pinned rather than eyeballed.
  for (let seed = 1; seed <= 200; seed += 1) {
    const standing = [];
    const gone = [];

    for (let index = 1; index <= LINKS; index += 1) {
      const who = neighbourFor(seed, index, NOW);
      (who.stillThere ? standing : gone).push(who.news);
    }

    // Within each pool, because a standing camp and an empty one never share a line.
    assert.equal(new Set(standing).size, standing.length, `world ${seed} repeats itself`);
    assert.equal(new Set(gone).size, gone.length, `world ${seed} repeats itself`);
  }
});

test('a fate only ever runs one way', () => {
  // The reason a fate is an instant and not a roll against `now`: rolling would make a
  // neighbour flicker in and out as the page refreshed. Somebody holding on when you
  // linked to them may be gone when you look again, and never the other way round.
  for (let seed = 1; seed <= 40; seed += 1) {
    for (let index = 1; index <= LINKS; index += 1) {
      let seen = true;

      for (let day = 0; day <= 1200; day += 10) {
        const { stillThere } = neighbourFor(seed, index, WORLD_EPOCH + day * DAY);
        assert.ok(seen || !stillThere, `world ${seed} link ${index} came back on day ${day}`);
        seen = stillThere;
      }
    }
  }
});

test('the road is neither a ghost town nor a thriving one', () => {
  // A generator that made everybody survive would make the fate meaningless, and one
  // that killed everybody would make the road not worth walking. Both are silent
  // failures — the code works, the world is just boring — so the shape is asserted.
  let standing = 0;
  let gone = 0;

  for (let seed = 1; seed <= 300; seed += 1) {
    for (let index = 1; index <= LINKS; index += 1) {
      if (neighbourFor(seed, index, NOW).stillThere) standing += 1;
      else gone += 1;
    }
  }

  const share = gone / (standing + gone);
  assert.ok(share > 0.05 && share < 0.5, `${(share * 100).toFixed(1)}% of the road is gone`);
});

test('a neighbour says who they are, how many, and what it looks like from the road', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    for (let index = 1; index <= LINKS; index += 1) {
      const who = neighbourFor(seed, index, NOW);

      assert.equal(who.index, index);
      assert.ok(who.name.length > 0);
      assert.ok(who.size >= 6 && who.size <= 80, `a camp of ${who.size}`);
      assert.ok(who.news.length > 0);
      assert.equal(typeof who.stillThere, 'boolean');
      assert.equal(who.destination, linkGives(index).destination);
    }
  }
});
