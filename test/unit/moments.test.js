import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AXES,
  LONG_REGIONS,
  MOMENTS,
  TURN_BACK,
  optionEffects,
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
  // The four the road opens. They are in here so the coverage rules below apply to
  // them exactly as they do to everywhere else: a place the game sends you to and then
  // has nothing to say about is a content shortage whatever unlocked it.
  the_millrace: 8,
  sixteen_wells: 14,
  the_waterworks: 20,
  harrow_end: 26,
};

const region = (slug) => ({ slug, travelHours: REGIONS[slug] });

/** Every region that offers moments at all — which is now everything but the wire. */
const MOMENT_REGIONS = Object.keys(REGIONS).filter((slug) => slug !== 'the_fence_line');
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

test('every moment can be named in one short phrase, and no two share a name', () => {
  // The title is what an outcome is filed under once the situation itself has scrolled
  // away — on the camp page while the trip is still out, and in the return log after.
  // A missing one leaves a consequence attached to nothing, which is the whole reason
  // this exists; a shared one attaches it to the wrong situation, which is worse.
  const seen = new Set();
  for (const [key, moment] of Object.entries(MOMENTS)) {
    assert.ok(moment.title?.length > 0, `${key} has a name`);
    assert.ok(moment.title.length <= 32, `${key}: "${moment.title}" fits on a line`);
    assert.ok(!seen.has(moment.title), `${key}: "${moment.title}" is not already taken`);
    seen.add(moment.title);
  }
});

test('a placed moment carries its name with it', () => {
  // momentsFor rebuilds the moment rather than passing the content row through, so a
  // field added to MOMENTS and not to the mapping is silently absent everywhere it is
  // read. That has now happened once per field this phase has added.
  for (const moment of momentsFor(region('the_deep_zone'), 42)) {
    assert.equal(moment.title, MOMENTS[moment.key].title);
  }
});

test('every moment has exactly one default, and the default does nothing', () => {
  // The load-bearing rule of the whole phase: the unattended outcome is the game as it
  // stands. Attending may add upside and a chosen risk; it may never restore a baseline
  // that absence took away. A default carrying an effect would break that silently.
  const effects = ['hours', 'lootFactor', 'radiationFactor', 'findChance', 'consumes',
    'heals', 'hazard', 'clearsHazard', 'parley', 'turnBack', 'dropsCarried'];

  for (const [key, moment] of Object.entries(MOMENTS)) {
    const defaults = moment.options.filter((option) => option.verb === 'default');
    assert.equal(defaults.length, 1, `${key} has one default`);

    for (const field of effects) {
      assert.ok(!(field in defaults[0]), `${key}: the default must not carry ${field}`);
    }
  }
});

test('every option value is inside the range its effect makes sense in', () => {
  // Eighteen moments is more hand-written numbers than anyone checks by reading, and a
  // typo here is a silent balance change rather than a crash — dropsCarried at 3 would
  // take three times what they are carrying and read as a rounding bug.
  for (const [key, moment] of Object.entries(MOMENTS)) {
    for (const option of moment.options) {
      const at = `${key}/${option.key}`;
      const within = (field, low, high) => {
        if (option[field] === undefined) return;
        assert.ok(
          option[field] >= low && option[field] <= high,
          `${at}: ${field} = ${option[field]}, outside ${low}..${high}`,
        );
      };

      within('lootFactor', 0.5, 2.5);
      within('radiationFactor', 0, 2.5);
      within('dropsCarried', 0.01, 0.99);
      within('findChance', 0.01, 1);
      within('heals', 1, 100);
      within('hours', -4, 4);

      if (option.hazard) {
        assert.ok(
          option.hazard.danger >= 1 && option.hazard.danger <= 5,
          `${at}: danger ${option.hazard.danger}`,
        );
      }
      if (option.consumes) {
        assert.ok(option.consumes.length > 0, `${at}: consumes nothing`);
      }
    }
  }
});

test('an option that draws a find outside investigating brings its own words for it', () => {
  // The find narration was written for the welded door — "whatever was behind it" — and
  // `findChance` then became the natural way to price a shot at something on options
  // with no *it* to be behind. Getting a wounded stranger upright reported that whatever
  // was behind them was not worth the hours. Found by playing it, not by testing it.
  for (const [key, moment] of Object.entries(MOMENTS)) {
    for (const option of moment.options) {
      if (!option.findChance || option.verb === 'investigate') continue;

      const where = `${key}/${option.key}`;
      assert.ok(option.finding, `${where}: a ${option.verb} says how a find reads`);
      assert.ok(option.finding.missed?.length > 0, `${where}: and how a miss reads`);
      assert.equal(typeof option.finding.found, 'function', `${where}: found names what`);
      assert.match(option.finding.found('2 × rad x'), /2 × rad x/, `${where}: and uses it`);
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

test('only the wire is too short to hold a moment', () => {
  // Ten minutes end to end has no interior. Everything else does, including the
  // forty-five minute service road, which is the shortest trip that can hold a
  // window worth catching.
  assert.equal(momentCount(REGIONS.the_fence_line), 0);

  for (const slug of MOMENT_REGIONS) {
    assert.ok(momentCount(REGIONS[slug]) > 0, slug);
  }

  // And they scale with the trip rather than all being the same.
  assert.ok(momentCount(REGIONS.the_deep_zone) > momentCount(REGIONS.ruined_city));
});

test('every long region can actually fill its moments with distinct axes', () => {
  // The distinct-axis rule is only worth having if the content can satisfy it. A region
  // short of axes silently offers fewer moments, which is a content shortage worth
  // failing on rather than shipping.
  for (const slug of MOMENT_REGIONS) {
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
  for (const slug of MOMENT_REGIONS) {
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

test('open windows come to about a third of a trip', () => {
  // Tightened from ~58% once there were eighteen moments rather than six. The two moves
  // belong together: wide windows on few moments meant each was easy to catch and rare
  // to meet, which is the worst of both. Narrower windows on more moments trades
  // "answerable whenever" for "actually happening".
  for (const slug of ['underground_bunkers', 'coastal_wreckage', 'the_deep_zone']) {
    const hours = REGIONS[slug];
    const coverage = SEEDS.map((seed) => {
      const open = momentsFor(region(slug), seed)
        .reduce((sum, moment) => sum + (moment.closesAt - moment.atHour), 0);
      return open / hours;
    });

    const mean = coverage.reduce((sum, value) => sum + value, 0) / coverage.length;
    assert.ok(mean > 0.25 && mean < 0.45, `${slug}: coverage ${(mean * 100).toFixed(0)}%`);
  }
});

test('every moment on a trip offers the way out', () => {
  // "A standing option underneath all of them" has to be true of what the trip actually
  // offers, not just of an exported constant — the first version of this declared
  // TURN_BACK and then never put it anywhere, so nothing could be answered with it.
  for (const slug of MOMENT_REGIONS) {
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
  assert.ok(windowHours(18, 4) > 1, 'a Deep Zone window is over an hour');
  assert.equal(windowHours(1, 0), 0, 'a trip with no moments has no window');
  // Twelve minutes, so a forty-five minute trip can hold a window at all. Short, and
  // deliberately so — catching one there means being on the page.
  assert.ok(windowHours(0.75, 1) >= 0.2, 'the floor holds');
  assert.ok(windowHours(0.75, 1) < 0.4, 'and a short trip gets a short window');
});

test('every moment is a scene and then a turn, and they are not the same sentence', () => {
  // The turn used to be the whole moment, which meant a player met each one at its
  // closing line and had to build the rest backwards out of a clause. Both halves are
  // required content now: without the scene the block opens on its own punchline, and
  // without the turn there is nothing for three buttons to be answers to.
  for (const [key, moment] of Object.entries(MOMENTS)) {
    assert.ok(moment.scene?.length > 0, `${key} sets its scene`);
    assert.notEqual(moment.scene, moment.prose, `${key}: the scene is not the turn again`);
    assert.ok(moment.scene.length > moment.prose.length / 2, `${key}: the scene is a scene`);
  }
});

test('a placed moment carries its scene with it', () => {
  // Same fault as the title, which this file already pins: momentsFor rebuilds the
  // moment rather than passing the content row through, so a field added to MOMENTS and
  // not to the mapping is silently absent on the page and nowhere else.
  for (const moment of momentsFor(region('the_deep_zone'), 42)) {
    assert.equal(moment.scene, MOMENTS[moment.key].scene);
  }
});

test('every option says what it does, and a default says it does nothing', () => {
  // The phase rule, now visible on the page rather than only true in the arithmetic:
  // the unattended outcome is the game as it stands, so the option that stands in for
  // absence has to be the one chip that promises nothing.
  for (const [key, moment] of Object.entries(MOMENTS)) {
    for (const option of [...moment.options, TURN_BACK]) {
      const chips = optionEffects(option);
      assert.ok(chips.length > 0, `${key}/${option.key} says something`);

      for (const chip of chips) {
        assert.ok(
          ['gain', 'cost', 'risk', 'plain'].includes(chip.tone),
          `${key}/${option.key}: ${chip.tone} is a tone the stylesheet knows`,
        );
        assert.ok(chip.label.length <= 28, `${key}/${option.key}: "${chip.label}" fits a chip`);
      }

      if (option.verb === 'default') {
        assert.deepStrictEqual(
          chips,
          [{ tone: 'plain', label: 'No change' }],
          `${key}/${option.key} is the baseline and reads as one`,
        );
      }
    }
  }
});

test('a damage chip promises exactly the spread the roll can produce', () => {
  // The one figure on the page that can kill somebody. It is derived from the same
  // danger the hazard rolls and the same arithmetic `worstCase` warns on, so the three
  // cannot drift apart — armour only ever makes the real number smaller.
  for (const moment of Object.values(MOMENTS)) {
    for (const option of moment.options) {
      const chip = optionEffects(option).find((effect) => effect.label.endsWith('damage'));
      if (!option.hazard) {
        assert.equal(chip, undefined, 'nothing without a hazard claims damage');
        continue;
      }

      const [low, high] = chip.label.replace(' damage', '').split('–').map(Number);
      assert.equal(low, option.hazard.danger * 3);
      assert.equal(high, worstCase(option));
      assert.equal(chip.tone, 'risk', 'the only tone kept for what costs health');
    }
  }
});

test('a price out of the pack is marked, so the caller can name it without rederiving', () => {
  // What a Rad Scrubber is called lives in a table this module cannot read. The chip
  // carries a flag rather than only placeholder wording, because the caller that has
  // the name is holding a view object by then and must rewrite this one chip in place
  // — deriving the list again there drops every other chip on the option.
  const eat = MOMENTS.the_tin.options.find((option) => option.key === 'eat');
  const chips = optionEffects(eat);

  const priced = chips.filter((effect) => effect.needs);
  assert.equal(priced.length, 1, 'exactly one chip is the caller’s to rewrite');
  assert.deepStrictEqual(priced[0], { tone: 'cost', label: '−1 from the pack', needs: true });

  // And it is not the only thing the option does. Eating the tin heals, and that chip
  // has to survive whatever the caller does to the price beside it.
  assert.ok(
    chips.some((effect) => effect.label === '+32 health'),
    chips.map((effect) => effect.label).join(' / '),
  );
});

test('turning back prices the walk home, when there is somewhere to walk from', () => {
  // The cost that belongs to the trip rather than to the option: the same hours
  // `answerMoment` will actually move the return by, said before the click.
  const priced = optionEffects(TURN_BACK, { walkHome: 1.5 }).map((effect) => effect.label);
  assert.deepStrictEqual(priced, ['Banks the haul', 'Ends the trip', '1h 30m walk home']);

  const bare = optionEffects(TURN_BACK).map((effect) => effect.label);
  assert.ok(!bare.some((label) => label.includes('walk home')), 'no hours it does not have');
});

test('an hours chip agrees with the sentence sitting above it', () => {
  // Boiling the cistern is 0.7 hours, which is "42m" exact and "forty minutes" in the
  // prose beside it. A chip that argues with its own detail line is worse than none.
  const boil = MOMENTS.bad_water.options.find((option) => option.key === 'boil');
  assert.ok(boil.detail.includes('forty minutes'));
  assert.ok(optionEffects(boil).some((effect) => effect.label === '+40m out'));

  const cut = MOMENTS.the_long_way.options.find((option) => option.key === 'cut');
  assert.ok(optionEffects(cut).some((effect) => effect.label === '−30m out'));
});
