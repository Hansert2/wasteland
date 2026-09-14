import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BOLTS_AT,
  MAX_TURNS,
  QUARRY,
  STAMINA,
  kitOf,
  WITHIN_REACH,
  movesFor,
  quarryFor,
  startOf,
  alarmCostOf,
  shotOf,
  takeTurn,
  toleranceFor,
  BEATS,
  yieldOf,
} from '../../src/game/hunting.js';
import { ORDINARY } from '../../src/game/wanderers.js';
import { CONFIG } from '../../src/game/constants.js';

const hunter = (overrides = {}) => ({
  skillScavenging: ORDINARY,
  inventory: [],
  ...overrides,
});

const armed = (potency) =>
  hunter({ inventory: [{ slug: 'x', kind: 'weapon', potency }] });

/** Press one move until the hunt ends or the turns run out. */
function play(seed, move, survivor = hunter()) {
  let state = startOf(seed);
  for (let n = 0; n < MAX_TURNS + 2 && state.status === 'active'; n += 1) {
    state = takeTurn(state, typeof move === 'function' ? move(state) : move, { seed, survivor });
  }
  return state;
}

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987];

test('a hunt is a pure function of its seed, so reloading cannot shake a better one out of it', () => {
  /*
   * The guarantee the whole mode rests on. A hunt lives across page loads in a row, and the
   * moment a redraw could produce a different animal or a different strike, every press
   * becomes a thing to retry rather than a thing to decide.
   */
  for (const seed of SEEDS) {
    assert.equal(quarryFor(seed), quarryFor(seed));
    assert.deepStrictEqual(play(seed, 'close'), play(seed, 'close'));
    assert.deepStrictEqual(play(seed, 'still'), play(seed, 'still'));
  }
});

test('backing off is offered on every single turn, and always ends it clean', () => {
  /*
   * This is a price of the design rather than a courtesy — see `hunting.js`. It is what makes
   * a lethal outcome fair, because a player who pressed on had somewhere else to press.
   */
  for (const seed of SEEDS) {
    let state = startOf(seed);
    for (let n = 0; n < MAX_TURNS && state.status === 'active'; n += 1) {
      const moves = movesFor(state);
      assert.ok(
        moves.some((one) => one.key === 'leave'),
        `${seed}/turn ${n}: no way out`,
      );

      const left = takeTurn(state, 'leave', { seed, survivor: hunter() });
      assert.equal(left.status, 'left');
      assert.equal(left.damage, state.damage, 'leaving costs no blood');

      state = takeTurn(state, 'close', { seed, survivor: hunter() });
    }
  }
});

test('nothing can be hurt without a turn that said so first', () => {
  /*
   * The rule settled with the user on 2026-09-13: a hunt can kill, but only ever on a press
   * made after the danger was visible and leaving was offered. `turning` is set at the end of
   * a turn and read at the start of the next, so this asserts the property rather than the
   * implementation — no state that took damage was reached from one that was not turning.
   */
  for (const seed of SEEDS) {
    for (const move of ['close', 'still', 'strike']) {
      let state = startOf(seed);
      for (let n = 0; n < MAX_TURNS && state.status === 'active'; n += 1) {
        const before = state;
        state = takeTurn(state, move, { seed, survivor: armed(25) });
        if (state.damage > before.damage) {
          assert.ok(
            before.turning,
            `${seed}/${move}: took ${state.damage - before.damage} with no warning`,
          );
        }
      }
    }
  }
});

test('a hare cannot hurt anybody, however badly it goes', () => {
  // The axis between the three is not size, it is what going wrong costs. Something with no
  // danger at all is what makes that axis legible on the first hunt a player takes.
  assert.equal(QUARRY.hare.danger, 0);

  for (const seed of SEEDS) {
    let state = { ...startOf(seed), quarry: 'hare', turning: true };
    for (let n = 0; n < MAX_TURNS && state.status === 'active'; n += 1) {
      state = takeTurn(state, 'close', { seed, survivor: hunter() });
      assert.equal(state.damage, 0, 'a hare drew blood');
    }
  }
});

test('every hunt ends, and only ever in one of the five ways the schema allows', () => {
  const allowed = new Set(['taken', 'bolted', 'lost', 'left', 'mauled']);

  for (const seed of SEEDS) {
    for (const move of ['close', 'still', 'strike']) {
      const state = play(seed, move, armed(35));
      assert.ok(allowed.has(state.status), `${seed}/${move} ended as ${state.status}`);
      assert.ok(state.turn <= MAX_TURNS, `${seed}/${move} ran ${state.turn} turns`);
    }
  }
});

test('a strike is a verdict, not a wager, and the weapon decides how much slack it survives', () => {
  /*
   * The 2026-09-13 rebuild, stated as a test. **Nothing rolls.** A strike lands when they are
   * close enough and the animal is no more alert than the weapon allows, so the board can say
   * "clean" and be right — where a percentage could only ever be a mood.
   *
   * The weapon stopped being luck and became *slack*: bare hands may spend nothing getting
   * there, a spear one, a bow two. That is a thing a player can plan a route around.
   */
  const far = startOf(1);
  assert.ok(!movesFor(far).some((one) => one.key === 'strike'), 'no striking from a field away');
  assert.equal(shotOf(far, armed(35)).why, 'too far');
  assert.equal(shotOf(far, armed(35)).shortBy, WITHIN_REACH);

  assert.equal(toleranceFor(hunter()), 0, 'bare hands allow nothing');
  assert.equal(toleranceFor(armed(25)), 1, 'a scrap spear allows one');
  assert.equal(toleranceFor(armed(35)), 2, 'a bow allows two');

  const near = { ...startOf(1), closeness: WITHIN_REACH, alarm: 2 };
  assert.equal(shotOf(near, hunter()).lands, false, 'and an empty hand at two is not a shot');
  assert.equal(shotOf(near, hunter()).shortBy, 2, 'which it says, in presses');
  assert.equal(shotOf(near, armed(25)).lands, false);
  assert.equal(shotOf(near, armed(35)).lands, true, 'the bow takes it');

  // And the resolution honours exactly that, with no stream of its own to disagree with.
  const missed = takeTurn(near, 'strike', { seed: 1, survivor: armed(25) });
  const landed = takeTurn(near, 'strike', { seed: 1, survivor: armed(35) });
  assert.equal(missed.status, 'bolted', 'a shot outside tolerance moves the animal, every time');
  assert.equal(landed.status, 'taken');
});

test('what closing costs is the beat and the wind, and both are on the board a press early', () => {
  /*
   * The two tells the mode is built on. The cycle turns on every press including standing
   * still, which is what makes waiting a cost rather than a free reset — and what lets a
   * player count the cheap moment toward them instead of guessing at it.
   */
  const at = (beat, wind) => ({ ...startOf(1), beat: BEATS.indexOf(beat), wind });

  assert.equal(alarmCostOf(at('feeding', 'across')), 0);
  assert.equal(alarmCostOf(at('lifting', 'across')), 1);
  assert.equal(alarmCostOf(at('watching', 'across')), 2);

  // The wind shifts every one of those by a point, and never below nothing.
  assert.equal(alarmCostOf(at('lifting', 'behind')), 0, 'behind them, a lifting head is free');
  assert.equal(alarmCostOf(at('feeding', 'behind')), 0, 'and nothing is cheaper than free');
  assert.equal(alarmCostOf(at('feeding', 'ahead')), 1, 'into their faces, even feeding costs');
  assert.equal(alarmCostOf(at('watching', 'ahead')), BOLTS_AT, 'and watching, into the wind, ends it');

  // The beat turns on every press, whatever the press was.
  const start = at('feeding', 'across');
  assert.equal(takeTurn(start, 'close', { seed: 1, survivor: hunter() }).beat, BEATS.indexOf('lifting'));
  assert.equal(takeTurn(start, 'still', { seed: 1, survivor: hunter() }).beat, BEATS.indexOf('lifting'));

  // And closing pays exactly what the board said it would.
  const closed = takeTurn(at('watching', 'across'), 'close', { seed: 1, survivor: hunter() });
  assert.equal(closed.alarm, 2, 'what it costs is what it said');
});

test('a hunt can be lost to the clock as well as to the animal', () => {
  /*
   * The tension the whole rebuild rests on: waiting for a free close is how you get a clean
   * shot, and waiting is how you run out of presses. A player who only ever waits should end
   * with nothing — measured across every seed in the set rather than asserted about one.
   *
   * `tools/hunt-balance.mjs` puts the line that only reads the beat at 44% taken and 56% lost
   * to the light, against 66% for the line that also counts its presses. That gap is the mode.
   */
  let lost = 0;
  for (const seed of SEEDS) {
    let state = startOf(seed);
    for (let n = 0; n < MAX_TURNS && state.status === 'active'; n += 1) {
      state = takeTurn(state, 'still', { seed, survivor: armed(35) });
    }
    if (state.status === 'lost') lost += 1;
  }
  assert.equal(lost, SEEDS.length, 'standing still for every press takes nothing, ever');
});

test('what the meat is worth is about what the stamina cost, and the materials are the point', () => {
  /*
   * The arithmetic the whole phase is priced on. `docs/PLAN.md`: a full stamina gauge costs
   * the camp 50 food, so a point is about half a unit — and this hunt spends `STAMINA` of
   * them. If the meat ever pays much more than that, sleeping and hunting becomes a camp that
   * has solved food for ever, which is the one thing a reverse arrow must not be.
   *
   * Asserted as a band rather than a figure, because the quarry are content and will be
   * retuned. The band is what may not move.
   */
  const foodPerPoint = 0.5;
  const spent = STAMINA * foodPerPoint;

  /*
   * The ceiling is a whole gauge, not this hunt's share of one.
   *
   * `yieldOf` answers for a hunt that *succeeded*, and a bow takes about three in five — so
   * asserting the best quarry against what one hunt spent would be pricing a hunter who never
   * misses. What may never be true is stronger and simpler: **no single hunt may hand back
   * more food than a full stamina gauge costs the camp**, or a survivor could hunt, sleep it
   * off, and come out ahead on both. `tools/hunt-balance.mjs` measures the expected value,
   * which is the figure the content was actually tuned against.
   */
  const wholeGauge = 100 * foodPerPoint;
  const best = yieldOf({ quarry: 'boar' }, hunter({ skillScavenging: ORDINARY + 3 }));
  assert.ok(best.food < wholeGauge, `a boar pays ${best.food} against a gauge worth ${wholeGauge}`);

  const worst = yieldOf({ quarry: 'hare' }, hunter());
  assert.ok(worst.food < spent, 'and the disappointment is a loss');

  // Every quarry pays at least one material, or a hunt could come to nothing worth having.
  for (const name of Object.keys(QUARRY)) {
    const got = yieldOf({ quarry: name }, hunter());
    assert.ok(got.raw_hide + got.sinew >= 1, `${name} yields no material`);
  }

  // The skill reads the same way it does on a haul, and nothing else does.
  const better = yieldOf({ quarry: 'deer' }, hunter({ skillScavenging: ORDINARY + 3 }));
  const ordinary = yieldOf({ quarry: 'deer' }, hunter());
  assert.ok(better.food > ordinary.food, 'a good scavenger gets more off a carcass');
});

test('the hunt pays no scrap and no fuel, which is the rule that is not tuning', () => {
  /*
   * Fuel for the reason trade may not produce it: nothing in the camp makes fuel, and the
   * whole fuel track is priced against that. Scrap because the Fence Line pays 23.5 a
   * survivor-hour, and a hunt paying any would be measured against it instead of against the
   * thing it is.
   *
   * The existing guard covers structures only — a trader or a hunt would walk straight past
   * it — so this is the second half of that test, written where the second faucet lives.
   */
  for (const name of Object.keys(QUARRY)) {
    const got = yieldOf({ quarry: name }, hunter({ skillScavenging: 20 }));
    assert.ok(!('scrap' in got), `${name} pays scrap`);
    assert.ok(!('fuel' in got), `${name} pays fuel`);
    assert.ok(!('water' in got), `${name} pays water`);
  }
});

test('the quarry breaks when it has had enough, and the dangerous one does not break', () => {
  // What you are spending is the animal's patience, which is why there is no health bar.
  const jumpy = { ...startOf(1), quarry: 'deer', alarm: BOLTS_AT - 1, closeness: 1 };
  const gone = takeTurn({ ...jumpy, alarm: BOLTS_AT }, 'still', { seed: 1, survivor: hunter() });
  assert.notEqual(gone.status, 'bolted', 'standing still is how you stop that happening');

  const spooked = takeTurn(
    { ...jumpy, alarm: BOLTS_AT },
    'strike',
    { seed: 1, survivor: hunter() },
  );
  assert.ok(['bolted', 'taken'].includes(spooked.status));

  // A boar at the same alarm turns instead of leaving, which is the whole of its danger.
  const boar = takeTurn(
    { ...startOf(1), quarry: 'boar', alarm: BOLTS_AT, closeness: 1 },
    'still',
    { seed: 1, survivor: hunter() },
  );
  assert.notEqual(boar.status, 'bolted', 'a boar does not run');
});

test('a hunt costs a real part of a day, measured against the gauge it spends', () => {
  // A quarter of a hundred-point gauge, and `staminaPerHourWorked` says a hundred points is
  // the longest walk on the map. So hunting instead of walking is a choice about the same day.
  assert.ok(STAMINA >= 15 && STAMINA <= 40, `${STAMINA} is not a quarter of anybody's day`);
  assert.ok(
    STAMINA > CONFIG.staminaPerHourWorked * 4,
    'a hunt should cost more than four hours of ordinary work',
  );
});

test('what they are wearing counts here, through the same reader a trip uses', () => {
  /*
   * Found on 2026-09-13 by being asked how equipment affects a hunt: it did not. `rollHazard`
   * has run a region's damage through `equipmentOf`'s `damageMultiplier` since gear existed
   * and the mauling ignored it, so a plate vest was worth thirty percent on the road and
   * nothing against a boar twenty yards from the fence.
   *
   * Asserted as a comparison rather than against a figure, because the cap and the potencies
   * are content: what may not be true again is that armour makes no difference.
   */
  const turned = { ...startOf(1), quarry: 'boar', turning: true, closeness: WITHIN_REACH };
  const bare = hunter();
  const coated = hunter({
    inventory: [{ slug: 'plate_vest', kind: 'armour', potency: 30, qty: 1 }],
  });

  let hurtBare = 0;
  let hurtCoated = 0;
  for (const seed of SEEDS) {
    hurtBare += takeTurn(turned, 'close', { seed, survivor: bare }).damage;
    hurtCoated += takeTurn(turned, 'close', { seed, survivor: coated }).damage;
  }

  assert.ok(hurtBare > 0, 'a turned boar draws blood from somebody with nothing on');
  assert.ok(hurtCoated < hurtBare, `a vest is worth something: ${hurtCoated} against ${hurtBare}`);

  // And the page quotes the same two numbers the arithmetic uses, rather than its own.
  const kit = kitOf(armed(35));
  assert.equal(kit.weapon.allows, 2, 'the weapon row is the tolerance the shot resolves with');
  assert.equal(kit.armour, null, 'and nothing is claimed about armour nobody owns');

  const both = kitOf({
    inventory: [
      { slug: 'hunting_bow', kind: 'weapon', potency: 35, qty: 1, name: 'Hunting Bow' },
      { slug: 'plate_vest', kind: 'armour', potency: 30, qty: 1, name: 'Plate Vest' },
    ],
  });
  assert.equal(both.armour.cuts, 30, 'and the armour row is the cap the mauling applies');
});
