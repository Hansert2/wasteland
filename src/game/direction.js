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
 * **Two halves, and they are different things.** The chain below teaches the game and
 * then leaves for good — five steps, and a camp that has been round the loop never sees
 * them again. What follows it never leaves: `CONDITIONS` reads the camp's own numbers
 * on every load, so the block goes on saying something useful for as long as there is
 * something useful to say. The join between them is in `directionFor`.
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

import { NOT_WORTH_THE_WALK, repelChance } from './raids.js';

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
 * What the camp's own numbers are saying, once the chain has nothing left to teach.
 *
 * **These report a condition; they do not issue an order.** The distinction is the
 * whole design of this half, and `docs/PLAN.md` states why under Not planned:
 * *choosing what to build next is the game*. A block that names the correct build every
 * visit has answered the question the game exists to ask — and it becomes wallpaper
 * besides, because advice that always speaks is advice nobody reads.
 *
 * So each of these fires on something objectively true and objectively bad, and names a
 * structure only where the causal link admits no argument: water is falling, and the
 * purifier is the thing that makes water. Where there is no problem the last one states
 * the camp's position and stops, because "what should I build" has no correct answer for
 * a camp in good order, and pretending otherwise would be a lie told confidently.
 *
 * Ordered by what costs you soonest.
 */
export const CONDITIONS = [
  {
    key: 'running_out',
    // Sixteen hours: long enough that a build can still answer it, short enough that it
    // is genuinely happening rather than a rate which will turn over on its own.
    read: (facts) => {
      const failing = (facts.stores ?? [])
        .filter((store) => ANSWERED_BY[store.kind] && store.ratePerHour < 0)
        .map((store) => ({ ...store, hoursLeft: store.amount / -store.ratePerHour }))
        .filter((store) => store.hoursLeft < 16)
        .sort((a, b) => a.hoursLeft - b.hoursLeft)[0];
      if (!failing) return null;

      return (
        `${capitalise(failing.kind)} is falling, and at this rate the stores are empty in ` +
        `${hoursish(failing.hoursLeft)}. The ${ANSWERED_BY[failing.kind]} is what makes more.`
      );
    },
  },
  {
    key: 'overflowing',
    // Forecast, not a percentage of the cap, and the difference is the whole value of
    // the warning. A threshold at 98% full gave a real camp — water 499 of 600, rising
    // at 5.5 an hour — about half an hour of notice on a shelter level that takes
    // longer than that to build. The same sixteen hours `running_out` uses gives
    // eighteen: time to do something, which is the only reason to say it at all.
    read: (facts) => {
      const filling = (facts.stores ?? [])
        .filter((store) => store.ratePerHour > 0 && store.cap > 0)
        .map((store) => ({ ...store, hoursToCap: (store.cap - store.amount) / store.ratePerHour }))
        .filter((store) => store.hoursToCap < 16)
        .sort((a, b) => a.hoursToCap - b.hoursToCap)[0];
      if (!filling) return null;

      return filling.hoursToCap <= 0
        ? `The stores are full of ${filling.kind}, and everything over the cap is being ` +
          'thrown away by the hour. Only the shelter raises it.'
        : `${capitalise(filling.kind)} reaches the cap in ${hoursish(filling.hoursToCap)}, ` +
          'and anything over it is lost. Only the shelter raises the cap.';
    },
  },
  {
    key: 'undefended',
    // The figures come from `raids.js` itself rather than being restated here, so the
    // page cannot promise a number the raid no longer rolls against.
    read: (facts) => {
      // `|| 0` rather than a bare Number(): an absent wealth is NaN, and `NaN < 6` is
      // false, so a fact this has not been given would have fallen through into telling
      // an unknown camp it was undefended.
      if ((Number(facts.wealth) || 0) < NOT_WORTH_THE_WALK) return null;

      const repel = repelChance(facts.defence);
      if (repel >= 0.4) return null;

      return repel <= 0
        ? 'There is enough here now to be worth robbing, and nothing at all turns raiders ' +
          'back. The watchtower is the only thing that does.'
        : 'There is enough here now to be worth robbing, and the fence turns back about ' +
          `${oneIn(repel)}. Watchtower levels are what move that figure.`;
    },
  },
  {
    key: 'fittable',
    read: (facts) =>
      facts.upgrade
        ? `There is fuel enough to fit the ${facts.upgrade}. A fitting is bought once and ` +
          'kept, which is not true of anything else fuel buys.'
        : null,
  },
  {
    key: 'idle',
    /**
     * The sentence this whole week started from, and the only part of the old
     * "Meanwhile, at camp" block that could not be said anywhere else.
     *
     * Last, and that placement is the argument: every condition above it is something
     * the camp can be doing, so reaching here at all means there was nothing. A camp
     * that can fit an upgrade or is about to lose production over the cap does not have
     * a dead evening, and does not get told it has one.
     */
    read: (facts) =>
      Number(facts.awayHours) > 0 && facts.opensBeforeReturn === 0
        ? 'Nothing the camp can pay for before they are back. Whatever happens next ' +
          'comes home with them.'
        : null,
  },
  {
    key: 'standing',
    read: (facts) =>
      facts.lowest
        ? `Nothing pressing. The ${facts.lowest.kind} is the least of the camp at level ` +
          `${facts.lowest.level}${facts.lowest.next ? `, and another makes it ${facts.lowest.next}` : ''}.`
        : null,
  },
];

/** The one structure that answers a resource running out. No others are unambiguous. */
const ANSWERED_BY = { food: 'garden', water: 'water purifier' };

const capitalise = (word) => word.charAt(0).toUpperCase() + word.slice(1);

/** "a third of them", from a probability. */
function oneIn(chance) {
  const n = Math.round(1 / chance);
  return { 2: 'half of them', 3: 'a third of them', 4: 'a quarter of them' }[n] ?? `one in ${n}`;
}

/** Rounded coarsely: a forecast off a rate does not deserve minutes. */
function hoursish(hours) {
  return hours < 1.5 ? 'under an hour' : `about ${Math.round(hours)} hours`;
}

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

  // Stage one, and it leaves for good. Everything after it is a reading of the camp
  // rather than a lesson about the game.
  if (!(facts.ranShort && facts.everCrafted && facts.ranLong)) {
    const step = STEPS.find((candidate) => !candidate.done(facts));
    if (step) return { key: step.key, line: step.line(facts) };
  }

  for (const condition of CONDITIONS) {
    const line = condition.read(facts);
    if (line) return { key: condition.key, line };
  }

  return null;
}
