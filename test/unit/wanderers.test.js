import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG } from '../../src/game/constants.js';
import {
  ORDINARY,
  WANDERERS,
  radThresholdFor,
  scavengingMultiplier,
  skillsOf,
  wandererFor,
} from '../../src/game/wanderers.js';

const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

test('the average wanderer is exactly the survivor the game has always had', () => {
  // The guard that keeps this a personality system and not a pay rise. The first draft
  // ran 1 to 6, averaged 3.5, and was a silent 25% loot buff on every trip ever taken
  // again — arriving inside a content file about backstories.
  assert.equal(mean(WANDERERS.map((w) => w.scavenging)), ORDINARY);
  assert.equal(mean(WANDERERS.map((w) => w.medicine)), ORDINARY);
  assert.equal(radThresholdFor(CONFIG.radThreshold, ORDINARY), CONFIG.radThreshold);
});

test('nobody is simply better than anybody else', () => {
  // If a wanderer were good at both, arrivals would sort into better and worse and the
  // player would be waiting for a good one. Strong in one means *who is out there
  // changes which option wins*, which is the whole point.
  for (const w of WANDERERS) {
    const total = w.scavenging + w.medicine;
    assert.equal(total, ORDINARY * 2, `${w.name} is worth ${total}, not ${ORDINARY * 2}`);
  }
});

test('the spread is wide enough to be felt on both axes', () => {
  const scav = WANDERERS.map((w) => w.scavenging);
  const med = WANDERERS.map((w) => w.medicine);

  // tools/skill-sensitivity.mjs: a cautious curve here reads as nothing at all.
  assert.ok(Math.max(...scav) - Math.min(...scav) >= 6, 'scavenging spans a real range');
  assert.ok(Math.max(...med) - Math.min(...med) >= 6, 'so does medicine');
  assert.ok(Math.min(...scav) >= 1, 'and nobody is at zero, which rollLoot cannot express');
});

test('who arrives is derived, so a refresh is not a reroll', () => {
  // The property the whole design rests on. If this were random per call, the empty-camp
  // page would be a slot machine and a survivor would be something you shop for.
  for (const seed of [1, 7654321, 1092059462]) {
    for (const index of [0, 1, 5]) {
      assert.equal(wandererFor(seed, index), wandererFor(seed, index));
    }
  }
});

test('a camp meets everybody before it meets anybody twice', () => {
  // Seven is prime, which is what buys this.
  for (const seed of [1, 42, 7654321]) {
    const seven = Array.from({ length: WANDERERS.length }, (_, i) => wandererFor(seed, i).key);
    assert.equal(new Set(seven).size, WANDERERS.length, `${seed}: ${seven}`);
  }
});

test('no camp is luckier than another about who turns up first', () => {
  const counts = new Map(WANDERERS.map((w) => [w.key, 0]));
  for (let seed = 1; seed <= 7000; seed += 1) {
    counts.set(wandererFor(seed, 0).key, counts.get(wandererFor(seed, 0).key) + 1);
  }
  for (const [key, n] of counts) {
    assert.equal(n, 1000, `${key} turned up ${n} times in 7000 camps`);
  }
});

test('medicine moves the dose that costs them, five points a level', () => {
  assert.equal(radThresholdFor(60, 1), 45);
  assert.equal(radThresholdFor(60, ORDINARY), 60);
  assert.equal(radThresholdFor(60, 7), 75);
  // A survivor loaded from a row written before the column meant anything.
  assert.equal(radThresholdFor(60, undefined), 60);
  assert.equal(radThresholdFor(60, null), 60);
});

test('every wanderer reads like the rest of the game', () => {
  // docs/LORE.md section 7: two sentences, no numbers with authority, no proper nouns
  // from before. A stat block with a paragraph attached is the failure mode.
  for (const w of WANDERERS) {
    assert.match(w.arrival, /\.$/, `${w.name}: arrival is prose`);
    assert.equal(w.arrival.split('. ').length, 2, `${w.name}: two sentences, statement then turn`);
    assert.doesNotMatch(w.arrival, /\d/, `${w.name}: no numbers with authority`);
    assert.equal(w.knownFor, undefined, `${w.name}: the prose no longer prices anything`);
  }
});

test('what a wanderer buys is priced in figures, and priced once', () => {
  /*
   * `knownFor` used to carry the mechanical claim as prose, and prose cannot carry a
   * magnitude: one sentence covered a haul at x1.3 and one at x0.7, and a dose biting at 45
   * read exactly like one biting at 75. The figures replaced it.
   *
   * What matters is that they are the *same* figures the simulation uses. `skillsOf` calls
   * `scavengingMultiplier` and `radThresholdFor` rather than restating either, so this
   * asserts against those functions — a page that recomputed the curve could advertise a
   * haul the roll does not pay.
   */
  for (const w of WANDERERS) {
    const rows = skillsOf(w, 60);
    assert.equal(rows.length, 2, `${w.name}: both numbers are priced`);

    const scavenging = rows.find((r) => r.name === 'scavenging');
    const medicine = rows.find((r) => r.name === 'medicine');

    assert.equal(
      scavenging.multiplier,
      Number(scavengingMultiplier(w.scavenging).toFixed(2)),
      `${w.name}: the haul shown is the haul rolled`,
    );
    assert.equal(
      medicine.relief,
      radThresholdFor(60, w.medicine) - 60,
      `${w.name}: the relief shown is the relief the tick subtracts`,
    );
  }
});

test('the spread the sentence was hiding is a real spread', () => {
  // If these ever collapse toward each other the figures stop being worth printing, and
  // the sentence was right after all. Measured 2026-08-28: x0.7 to x1.3, and 45 to 75.
  const hauls = WANDERERS.map((w) => scavengingMultiplier(w.scavenging));
  const bites = WANDERERS.map((w) => radThresholdFor(60, w.medicine));

  assert.ok(Math.max(...hauls) / Math.min(...hauls) >= 1.5, 'haul spans a real range');
  assert.ok(Math.max(...bites) - Math.min(...bites) >= 20, 'so does the dose');
});

test('the keys and names are unique, because both are looked up by', () => {
  assert.equal(new Set(WANDERERS.map((w) => w.key)).size, WANDERERS.length);
  // viewCamp matches a survivor back from the character row by name, so two wanderers
  // sharing one would quietly describe the wrong person.
  assert.equal(new Set(WANDERERS.map((w) => w.name)).size, WANDERERS.length);
});

test('the scale a skill is explained on is the scale it is applied on', () => {
  /*
   * The hover note says "each point is 10% of the haul" and "each point is 5 rads", and
   * those sentences are only true because they are read off the same constants the
   * functions use. Carried on the row rather than written into the page, so a balance pass
   * that retunes either cannot leave the explanation behind describing the old game.
   */
  const rows = skillsOf({ scavenging: 7, medicine: 1 }, 60);
  const scavenging = rows.find((r) => r.name === 'scavenging');
  const medicine = rows.find((r) => r.name === 'medicine');

  // A point is worth what the note claims: one level up is exactly one step. Compared with
  // a tolerance because 1.1 - 1.0 is 0.10000000000000009 in binary floating point, which is
  // the multiplier being right rather than the assertion being loose.
  assert.ok(
    Math.abs(scavengingMultiplier(5) - scavengingMultiplier(4) - scavenging.perPoint) < 1e-9,
    'a point of scavenging is worth what the note says',
  );
  assert.equal(
    radThresholdFor(60, 5) - radThresholdFor(60, 4),
    medicine.perPoint,
    'and so is a point of medicine',
  );

  // And the floor is the floor: far enough below ordinary that the curve would go under it.
  assert.equal(scavengingMultiplier(-100), scavenging.floor, 'the haul never goes below it');
  assert.equal(scavengingMultiplier(ORDINARY), 1, 'and ordinary is exactly no change');
});
