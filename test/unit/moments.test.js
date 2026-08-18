import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXES,
  LONG_REGIONS,
  MOMENTS,
  TURN_BACK,
  isOpen,
  isWarned,
  momentCount,
  momentsFor,
  walkHomeHours,
  windowHours,
  worstCase,
} from '../../src/game/moments.js';

/** The regions as seeded, so the tests fail if the content and the world drift apart. */
const REGIONS = {
  the_fence_line: 0.17,
  the_service_road: 0.75,
  ruined_city: 4,
  irradiated_farmland: 6,
  underground_bunkers: 9,
  coastal_wreckage: 12,
  the_deep_zone: 18,
};

const region = (slug) => ({ slug, travelHours: REGIONS[slug] });
const SEEDS = [1, 2, 3, 7, 42, 99, 12345, 65535, 987654321];

test('every moment names a real axis and at least one real region', () => {
  for (const [key, moment] of Object.entries(MOMENTS)) {
    assert.ok(AXES.includes(moment.axis), `${key}: ${moment.axis} is an axis`);
    assert.ok(moment.regions.length > 0, `${key} appears somewhere`);
    for (const slug of moment.regions) {
      assert.ok(slug in REGIONS, `${key}: ${slug} is a region`);
    }
    assert.ok(moment.prose.length > 0, `${key} has something to say`);
  }
});

test('every moment has exactly one default, and the default does nothing', () => {
  // The load-bearing rule of the whole phase: the unattended outcome is the game as it
  // stands. Attending may add upside and a chosen risk; it may never restore a baseline
  // that absence took away. A default carrying an effect would break that silently.
  const effects = ['hours', 'lootFactor', 'radiationFactor', 'findChance', 'consumes',
    'heals', 'hazard', 'clearsHazard', 'parley', 'turnBack'];

  for (const [key, moment] of Object.entries(MOMENTS)) {
    const defaults = moment.options.filter((option) => option.verb === 'default');
    assert.equal(defaults.length, 1, `${key} has one default`);

    for (const field of effects) {
      assert.ok(!(field in defaults[0]), `${key}: the default must not carry ${field}`);
    }
  }
});

test('option keys are unique within a moment, so a choice can be recorded by key', () => {
  for (const [key, moment] of Object.entries(MOMENTS)) {
    const keys = moment.options.map((option) => option.key);
    assert.equal(new Set(keys).size, keys.length, `${key}`);
    assert.ok(!keys.includes(TURN_BACK.key), `${key} does not collide with turning back`);
  }
});

test('the short regions have no moments and the long ones do', () => {
  assert.equal(momentCount(REGIONS.the_fence_line), 0);
  assert.equal(momentCount(REGIONS.the_service_road), 0);

  for (const slug of LONG_REGIONS) {
    assert.ok(momentCount(REGIONS[slug]) > 0, slug);
  }
});

test('every long region can actually fill its moments with distinct axes', () => {
  // The distinct-axis rule is only worth having if the content can satisfy it. A region
  // short of axes silently offers fewer moments, which is a content shortage worth
  // failing on rather than shipping.
  for (const slug of LONG_REGIONS) {
    const wanted = momentCount(REGIONS[slug]);

    for (const seed of SEEDS) {
      const moments = momentsFor(region(slug), seed);
      assert.equal(moments.length, wanted, `${slug}, seed ${seed}`);

      const axes = moments.map((moment) => moment.axis);
      assert.equal(new Set(axes).size, axes.length, `${slug}, seed ${seed}: axes are distinct`);
    }
  }
});

test('moments sit in the interior of the trip, in order, and their windows never overlap', () => {
  for (const slug of LONG_REGIONS) {
    const hours = REGIONS[slug];

    for (const seed of SEEDS) {
      const moments = momentsFor(region(slug), seed);
      let previousClose = 0;

      for (const moment of moments) {
        assert.ok(moment.atHour >= hours * 0.1, `${slug}: not in the first tenth`);
        assert.ok(moment.atHour <= hours * 0.9, `${slug}: not in the last tenth`);
        assert.ok(moment.atHour >= previousClose, `${slug}: windows do not overlap`);
        assert.ok(moment.closesAt <= hours, `${slug}: window ends within the trip`);
        assert.ok(moment.closesAt > moment.atHour, `${slug}: window is not empty`);
        previousClose = moment.closesAt;
      }
    }
  }
});

test('open windows come to roughly sixty per cent of a long trip', () => {
  // The figure the design commits to: one check-in usually finds something, catching all
  // of them still takes attention or the radio. Full coverage would make timing
  // worthless, and timing is all the radio sells.
  for (const slug of ['underground_bunkers', 'coastal_wreckage', 'the_deep_zone']) {
    const hours = REGIONS[slug];
    const coverage = SEEDS.map((seed) => {
      const open = momentsFor(region(slug), seed)
        .reduce((sum, moment) => sum + (moment.closesAt - moment.atHour), 0);
      return open / hours;
    });

    const mean = coverage.reduce((sum, value) => sum + value, 0) / coverage.length;
    assert.ok(mean > 0.45 && mean < 0.7, `${slug}: coverage ${(mean * 100).toFixed(0)}%`);
  }
});

test('every moment on a trip offers the way out', () => {
  // "A standing option underneath all of them" has to be true of what the trip actually
  // offers, not just of an exported constant — the first version of this declared
  // TURN_BACK and then never put it anywhere, so nothing could be answered with it.
  for (const slug of LONG_REGIONS) {
    for (const seed of SEEDS) {
      for (const moment of momentsFor(region(slug), seed)) {
        const last = moment.options[moment.options.length - 1];
        assert.equal(last.key, TURN_BACK.key, `${slug}, seed ${seed}: and it is offered last`);
      }
    }
  }
});

test('isOpen is half-open, so a window ending as another begins never double-counts', () => {
  const [moment] = momentsFor(region('the_deep_zone'), 42);

  assert.equal(isOpen(moment, moment.atHour - 0.001), false);
  assert.equal(isOpen(moment, moment.atHour), true);
  assert.equal(isOpen(moment, moment.closesAt - 0.001), true);
  assert.equal(isOpen(moment, moment.closesAt), false);
});

test('the same trip always offers the same moments', () => {
  for (const seed of SEEDS) {
    assert.deepStrictEqual(
      momentsFor(region('the_deep_zone'), seed),
      momentsFor(region('the_deep_zone'), seed),
    );
  }
});

test('different seeds offer different moments', () => {
  const shapes = SEEDS.map((seed) =>
    momentsFor(region('coastal_wreckage'), seed).map((moment) => moment.key).join(','),
  );

  assert.ok(new Set(shapes).size > 1, 'the seed actually drives which moments come up');
});

test('a healthy survivor is never warned, and a hurt one is', () => {
  const confront = MOMENTS.kept_pace.options.find((option) => option.key === 'face');

  assert.equal(worstCase(confront), 45, 'danger 5 tops out at 45, as rollHazard does');
  assert.equal(isWarned(confront, 100), false, 'full health is out of reach');
  assert.equal(isWarned(confront, 46), false, 'and so is anything above the worst case');
  assert.equal(isWarned(confront, 45), true, 'exactly reachable is still reachable');
  assert.equal(isWarned(confront, 20), true, 'a hurt survivor is told');
});

test('an option that cannot hurt anybody never carries a warning', () => {
  for (const [key, moment] of Object.entries(MOMENTS)) {
    for (const option of moment.options) {
      if (option.hazard) continue;
      assert.equal(worstCase(option), 0, `${key}/${option.key}`);
      assert.equal(isWarned(option, 1), false, `${key}/${option.key} at 1 health`);
    }
  }
});

test('turning back costs least at the ends and most in the middle', () => {
  const total = 18;

  assert.equal(walkHomeHours(0, total), 0);
  assert.equal(walkHomeHours(total, total), 0);
  assert.equal(walkHomeHours(2, total), 1);
  assert.equal(walkHomeHours(9, total), 4.5, 'the midpoint is furthest from anywhere');
  assert.equal(walkHomeHours(16, total), 1);

  // And it is never cheaper to bail than to be home already.
  for (let hour = 0; hour <= total; hour += 0.5) {
    assert.ok(hour + walkHomeHours(hour, total) <= total + 0.0001, `hour ${hour}`);
  }
});

test('turning back late is never a free win', () => {
  // The bug this function exists to kill: with no walk home, bailing at four fifths
  // forfeited almost no loot and saved a fifth of the hours, so it was strictly optimal
  // on every trip. Arriving must never be more than marginally earlier than finishing.
  const total = 18;

  for (let hour = total * 0.7; hour <= total; hour += 0.25) {
    const saved = total - (hour + walkHomeHours(hour, total));
    assert.ok(saved <= total * 0.15, `bailing at ${hour}h saved ${saved.toFixed(2)}h`);
  }
});

test('window length is proportional to the trip and never punishingly short', () => {
  assert.ok(windowHours(18, 3) > 3, 'a Deep Zone window is hours, not minutes');
  assert.ok(windowHours(4, 1) > 2, 'and a short trip still gets a real one');
  assert.equal(windowHours(1, 0), 0, 'a trip with no moments has no window');
  assert.ok(windowHours(2, 1) >= 0.75, 'the floor holds');
});
