/**
 * What to do next, for a camp that has not yet worked out what this game is.
 *
 * There are two loops here and the page never said so. Building and crafting are the
 * active one — minute-scale, click-heavy, and the whole reason the Fence Line and the
 * Old Service Road exist. Expeditions past four hours are the idle one, what you set
 * running before closing the tab. `docs/PLAN.md` measured the good version of the first
 * hour and it is real: four builds and a return to read every ten minutes.
 *
 * A new player finds none of it. The dispatch table lists seven places in order of
 * danger, the interesting-sounding ones are at the bottom, and picking one on turn one
 * buys twelve hours in which nothing on the page can change. The mechanics were never
 * wrong. Nothing told the player which loop they had just walked into.
 *
 * **Derived, never stored, and it pays nothing.** A step is a question about the camp,
 * answered from rows that already exist — the same deal `momentsFor` gets from the
 * expedition seed, and for the same reason: a thing that can be computed should not
 * also be a column that can disagree with it. Rewards were considered and left out.
 * They are the only part of this that would need storage, and the simulation says they
 * are unnecessary — the whole chain is affordable on what the short walks pay.
 *
 * The voice is the page's voice. See `docs/DESIGN-BRIEF.md`: flat declarative, then a
 * turn. This is a line of advice from somewhere in the camp, not a quest log.
 */

/**
 * The chain, in order. The first step that is not done is the one shown.
 *
 * `done` is history where history exists and state where it does not, and the mix is
 * deliberate rather than sloppy — see `directionFor` for what that costs and how the
 * cost is paid.
 */
export const STEPS = [
  {
    key: 'workshop',
    done: (facts) => Number(facts.workshopLevel) > 0,
    line: () =>
      'Nothing in this camp makes scrap, and everything in it is priced in scrap. ' +
      'The workshop is the one structure that changes that.',
  },
  {
    key: 'wire',
    done: (facts) => Boolean(facts.ranShort),
    line: (facts) =>
      `${facts.shortestRegion ?? 'The short walk'} and back is where a new camp's scrap ` +
      'actually comes from. Send them, read what they brought, build with it, send them again.',
  },
  {
    key: 'bench',
    done: (facts) => Number(facts.workshopLevel) >= 2,
    line: () =>
      'The bench opens at a workshop of two. Take the workshop up a level and there is ' +
      'something to do with the scrap besides stack it.',
  },
  {
    key: 'craft',
    done: (facts) => Boolean(facts.everCrafted),
    line: () =>
      'Make something at the bench before the next long walk. What they carry out ' +
      'there is decided in here.',
  },
  {
    key: 'far',
    done: (facts) => Boolean(facts.ranLong),
    line: () =>
      'The far places pay in fuel and in hours, and the hours are the price. Send them ' +
      'when you are closing the tab, not when you are sitting down to play.',
  },
];

/**
 * The step this camp is on, or null once it has stopped needing one.
 *
 * **The chain switches off on history, not on state**, and that distinction is the
 * whole of this function. Two of the steps can only be asked of the camp as it stands
 * right now — there is no record of the highest level a workshop ever reached — and a
 * successor takes two levels off every structure. So a camp on its fifth survivor,
 * knocked back under workshop two, would be sat down and taught about the bench again.
 *
 * A camp that has run the short walks, crafted something and taken a long trip has
 * demonstrably been through all of this, whatever its structures currently say. That is
 * the off switch: three facts that cannot be undone, checked together. Falling into the
 * trap on turn one does not trip it — a first-ever dispatch to the Deep Zone sets
 * `ranLong` and nothing else, so the chain stays on and starts, correctly, at the
 * workshop.
 *
 * Null with nobody alive, too. A camp with an empty chair has exactly one thing to do
 * and the page already says so in a louder place.
 */
export function directionFor(facts) {
  if (!facts?.hasSurvivor) return null;
  if (facts.ranShort && facts.everCrafted && facts.ranLong) return null;

  const step = STEPS.find((candidate) => !candidate.done(facts));
  return step ? { key: step.key, line: step.line(facts) } : null;
}
