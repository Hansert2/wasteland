import assert from 'node:assert/strict';
import test from 'node:test';

import { hoursUntilAffordable, openWithin, planFor } from '../../src/game/planning.js';

test('what the camp already affords opens now, not in an hour', () => {
  assert.equal(hoursUntilAffordable({ scrap: 5 }, { scrap: 9 }, { scrap: 0.5 }), 0);
  assert.equal(hoursUntilAffordable({ scrap: 5 }, { scrap: 5 }, { scrap: 0 }), 0);
});

test('a gap is the wait, at the net rate', () => {
  // The opening position of a real new camp: one scrap left after the first two
  // builds, half a scrap an hour, and a cheapest next door of five.
  assert.equal(hoursUntilAffordable({ scrap: 5 }, { scrap: 1 }, { scrap: 0.5 }), 8);
});

test('the slowest resource sets the hour', () => {
  const at = hoursUntilAffordable({ scrap: 10, fuel: 10 }, { scrap: 0, fuel: 0 }, { scrap: 5, fuel: 1 });
  assert.equal(at, 10, 'fuel at 1/h is the constraint, not scrap at 5/h');
});

test('a flat or falling resource is never, and never is not a long wait', () => {
  // The distinction the page has to keep: nothing in a camp produces fuel, so a road
  // link is not something you wait for, it is something you go and fetch.
  assert.equal(hoursUntilAffordable({ fuel: 60 }, { fuel: 0 }, { fuel: 0 }), null);
  assert.equal(hoursUntilAffordable({ food: 20 }, { food: 5 }, { food: -0.4 }), null);
});

test('build costs carry their duration and it is not a price', () => {
  // upgradeCost returns { scrap, hours } in one object; hours is how long the crew
  // takes, not something the stores hold.
  assert.equal(hoursUntilAffordable({ scrap: 4, hours: 900 }, { scrap: 4 }, { scrap: 0 }), 0);
});

test('a plan is soonest first, and drops what waiting cannot buy', () => {
  const plan = planFor(
    [
      { what: 'workshop level 2', costs: { scrap: 7 } },
      { what: 'garden level 2', costs: { scrap: 5 } },
      { what: 'the road', costs: { fuel: 60 } },
      { what: 'Plate Vest', costs: { scrap: 45 }, blocked: true },
    ],
    { scrap: 1, fuel: 0 },
    { scrap: 0.5, fuel: 0 },
  );

  assert.deepEqual(
    plan.map((entry) => entry.what),
    ['garden level 2', 'workshop level 2'],
    'the road wants fuel nothing produces, and the vest is over the workshop',
  );
  assert.equal(plan[0].inHours, 8, 'four short at half a scrap an hour');
  assert.equal(
    plan[1].inHours,
    22,
    'and the second starts from an empty purse, not from the same ten scrap as the first',
  );
});

test('one purse cannot buy five things at once', () => {
  // The bug this function shipped with. A brand-new camp holds ten scrap and makes
  // none, and every door on the page costs five to ten — priced independently, the
  // page told the player they had five things to do and a full evening. They had one.
  const doors = [
    { what: 'workshop level 1', costs: { scrap: 5 } },
    { what: 'garden level 3', costs: { scrap: 7 } },
    { what: 'watchtower level 1', costs: { scrap: 8 } },
    { what: 'water purifier level 3', costs: { scrap: 9 } },
    { what: 'shelter level 3', costs: { scrap: 10 } },
  ];

  const plan = planFor(doors, { scrap: 10 }, { scrap: 0 });
  assert.deepEqual(plan, [{ what: 'workshop level 1', inHours: 0 }]);
});

test('spending is what opens the next door later, not sooner', () => {
  const plan = planFor(
    [{ what: 'first', costs: { scrap: 10 } }, { what: 'second', costs: { scrap: 10 } }],
    { scrap: 10 },
    { scrap: 1 },
  );

  assert.equal(plan[0].inHours, 0);
  assert.equal(plan[1].inHours, 10, 'the first purchase emptied the purse');
});

test('a window holds what opens strictly inside it', () => {
  const plan = [{ what: 'a', inHours: 0 }, { what: 'b', inHours: 8 }, { what: 'c', inHours: 12 }];

  assert.equal(openWithin(plan, 12).length, 2, 'a door opening at the return is not an evening');
  assert.equal(openWithin(plan, 0.17).length, 1, 'the fence line is ten minutes and you can act now');
  assert.equal(openWithin(plan, 13).length, 3);
});
