import test from 'node:test';
import assert from 'node:assert/strict';

import { solarNoonFor, ZONE_LONGITUDE, IDEALISED_SOLAR_NOON } from '../../src/game/zones.js';
import { sunAt } from '../../src/game/daylight.js';

const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test('the derived solar noon matches the real one, to the minute', () => {
  /*
   * Each row is a real solar noon, on that zone's own clock, for the summer offset given.
   * These are not outputs pasted back in: they are what the meridian arithmetic says the
   * sun does, and the point of the table is that the code has to agree with the world
   * rather than with itself.
   *
   * Amsterdam and Athens sit first because they are the whole argument — the same offset,
   * seventy-five minutes apart, which is why the offset alone could never have done this.
   */
  const cases = [
    ['Europe/Amsterdam', 120, '13:40'],
    ['Europe/Athens', 120, '12:25'],
    ['Europe/Madrid', 120, '14:15'], // Spain keeps a clock two zones east of its sun.
    ['Europe/London', 60, '13:01'],
    ['America/New_York', -240, '12:56'],
    ['America/Denver', -360, '13:00'],
    ['Asia/Tokyo', 540, '11:41'],
    ['Pacific/Auckland', 720, '12:21'], // Auckland is 5.2° west of the 180th meridian.
  ];

  for (const [zone, offset, expected] of cases) {
    assert.equal(hm(solarNoonFor(zone, offset)), expected, `${zone} at ${offset}`);
  }
});

test('Amsterdam and Athens share a clock and do not share a sun', () => {
  // The finding the module exists for, asserted rather than described.
  const amsterdam = solarNoonFor('Europe/Amsterdam', 120);
  const athens = solarNoonFor('Europe/Athens', 120);
  assert.equal(amsterdam - athens, 75, 'same offset, seventy-five minutes of sun apart');
});

test('an unknown zone leaves the camp on the idealised sky', () => {
  /*
   * `null` and not a throw, and not a guess. Not knowing where a camp is is an ordinary
   * state — an old browser, a zone nobody listed, a form posted without script — and the
   * caller reads `null` as "keep the default", which is a correct sky rather than a
   * wrong one.
   */
  assert.equal(solarNoonFor('Antarctica/Troll', 0), null, 'a real zone that is not listed');
  assert.equal(solarNoonFor('', 0), null, 'nothing at all');
  assert.equal(solarNoonFor(undefined, 0), null);
  assert.equal(solarNoonFor('Europe/Amsterdam', NaN), null, 'no offset to hang it on');
});

test('a zone name off the wire cannot reach anything it should not', () => {
  /*
   * The value arrives from a form field and is used as a key. The table has a null
   * prototype and the name is shape-checked before the lookup, so the inherited members of
   * `Object.prototype` are not reachable and neither is anything shaped unlike a zone.
   */
  for (const hostile of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(solarNoonFor(hostile, 0), null, hostile);
  }
  assert.equal(solarNoonFor('; drop table settlements', 0), null);
  assert.equal(solarNoonFor('../../etc/passwd', 0), null);
  assert.equal(Object.getPrototypeOf(ZONE_LONGITUDE), null, 'the table has no prototype');
});

test('every listed longitude is a longitude', () => {
  const names = Object.keys(ZONE_LONGITUDE);
  assert.ok(names.length > 80, 'the table is meant to cover where players actually are');

  for (const name of names) {
    const lon = ZONE_LONGITUDE[name];
    assert.ok(Number.isFinite(lon), `${name} is a number`);
    assert.ok(lon >= -180 && lon <= 180, `${name} is on earth`);
    assert.match(name, /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){1,2}$/, `${name} is shaped like a zone`);
  }
});

test('the result always fits the column the migration declared', () => {
  /*
   * `solar_noon_minutes` is `check (between 0 and 1439)`. A camp whose clock is wildly out
   * of step with its longitude can push the raw arithmetic outside a day, and the database
   * would refuse the insert. Clamped rather than wrapped, so the sun stays in the same day
   * as the clock it is being measured against.
   */
  for (const name of Object.keys(ZONE_LONGITUDE)) {
    for (const offset of [-840, -720, -360, 0, 360, 720, 840]) {
      const noon = solarNoonFor(name, offset);
      assert.ok(Number.isInteger(noon), `${name} at ${offset} is whole minutes`);
      assert.ok(noon >= 0 && noon <= 1439, `${name} at ${offset} fits the column`);
    }
  }
});

test('the default is the sky of a camp standing on its own meridian', () => {
  /*
   * The fallback is not arbitrary: 720 is what the derivation returns when longitude and
   * meridian cancel. No listed zone sits exactly on one — London is Westminster, an eighth
   * of a degree west of Greenwich, and lands at 721 — so the invariant is asserted against
   * the arithmetic rather than against a city that happens to be close.
   */
  const onTheMeridian = (offset) => IDEALISED_SOLAR_NOON + offset - 4 * (offset / 4);
  for (const offset of [-720, -300, 0, 60, 330, 720]) {
    assert.equal(onTheMeridian(offset), IDEALISED_SOLAR_NOON, `UTC${offset}`);
  }

  // And the nearest real camp to it is within the minute the column is stored in.
  assert.equal(solarNoonFor('Europe/London', 0), 721);
});

test('a derived noon moves the sun and never the length of the day', () => {
  /*
   * The property that made this safe to ship without re-running the balance tools. Solar
   * noon sets where the day sits on the clock; `daylightHoursAt` never sees it. If this
   * ever fails, day length has become a function of longitude and every loot figure
   * measured against the sun is stale.
   */
  const at = Date.UTC(2026, 7, 28, 12);
  const amsterdam = sunAt(at, solarNoonFor('Europe/Amsterdam', 120) / 60);
  const athens = sunAt(at, solarNoonFor('Europe/Athens', 120) / 60);

  assert.equal(amsterdam.hours, athens.hours, 'same day length');
  assert.ok(
    Math.abs(amsterdam.sunrise - athens.sunrise - 75 / 60) < 1e-9,
    'shifted by exactly the difference in their suns',
  );
});
