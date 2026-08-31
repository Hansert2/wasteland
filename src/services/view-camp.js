import { advanceSettlement } from './advance-settlement.js';
import { choosableZones, isPlaced } from './set-camp-clock.js';
import { occupations } from './who-is-free.js';
import { POTENCY_TO_POINTS } from './use-item.js';
import {
  WORLD_EVENTS,
  activeAt,
  deriveEventsBetween,
  effectsOf,
  expeditionFactors,
  productionFactors,
} from '../game/world-events.js';
import {
  DAY_REACH,
  DEFAULT_SOLAR_NOON,
  climateAt,
  darkSpansBetween,
  dayWindow,
  forecastSeries,
  coefficientsAt,
  isLit,
  nextBandChange,
  nextDegreeChange,
  sunAt,
  temperatureAt,
  travelFactors,
  worldTimeAt,
} from '../game/daylight.js';
import { answerTo, resolveExpedition } from '../game/expeditions.js';
import {
  isOpen,
  isWarned,
  momentCount,
  momentsFor,
  optionEffects,
  walkHomeHours,
} from '../game/moments.js';
import { openWithin, planFor } from '../game/planning.js';
import { directionFor } from '../game/direction.js';
import { radThresholdFor, skillsOf, wandererFor } from '../game/wanderers.js';
import { stateAt, timelineOf } from '../game/timeline.js';
import { CONFIG } from '../game/constants.js';
import { radDamagePerHourAt, workingAt } from '../game/tick.js';
import { LINKS, TRADE_POST_LINKS, linkCost, linkGives, neighbourFor } from '../game/road.js';
import { WORLD_SEED, loadWorldEvents } from '../db/world-events.js';
import { FACTIONS, caravanVisit, postKeeper, priceAt, standingOf } from '../game/factions.js';
import {
  STRUCTURES,
  UPGRADES,
  campDefence,
  bedsToRoster,
  fittingsAllowed,
  fittingsBuildable,
  campWealth,
  productionRates,
  structureEffect,
  upgradeCost,
  upgradesFor,
} from '../game/structures.js';

/**
 * Everything a camp page needs, as one transaction.
 *
 * The tick runs first: nothing is rendered from state that has not been brought up
 * to the current instant, so the page can never show stale resources or a survivor
 * who is, as of now, already dead.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * What is knowable about a trip that is still happening.
 *
 * The outcome is resolved *early* here, which looks alarming and is not: an expedition
 * has always been a pure function of its seed, so rolling it now and rolling it at
 * `returns_at` give the same trip. Nothing is written and nothing is decided — this is
 * the same arithmetic the tick will do later, done sooner so the page has something
 * true to say.
 *
 * The weather used is the weather **across the whole trip**, because that is what the
 * tick will resolve against — the duration-weighted mean of what was in force between
 * departure and return, not a reading taken at either end.
 *
 * That window runs into the future, and the loaded events stop at `now`. World events are
 * derived from the world seed rather than observed, so the remainder is generated here and
 * deliberately not written: the past is what the table says it is, and pre-inserting the
 * future would freeze it against the next balance pass for nothing. Stored rows cover
 * everything up to `now` and derived ones start at or after it, so the two sets never
 * describe the same slot.
 *
 * Returns null when nobody is out, which is most of the time.
 */
/**
 * What the top strip knows, tiered by what the camp has fitted.
 *
 * The costs quoted are for *this instant* rather than for a trip: out there right now, in
 * this light, under this sky. A trip's factors are integrated across its hours and cannot
 * be stated before one is chosen, so the strip answers the question it can — what going
 * out now is worth — and leaves the rest to the trip.
 */
function hourStrip(state, now, fitted, clock = 0, noon = DEFAULT_SOLAR_NOON) {
  const active = activeAt(state.worldEvents, now);
  const time = worldTimeAt(now, clock, noon);
  const lit = isLit(now, clock, noon);

  // The sun at this instant: full daylight or full dark, since an instant is one or the
  // other. `2d - 1` is +1 or -1, so the factors are simply 1 plus or minus the
  // coefficient — which is what the strip means by "out there now".
  const k = coefficientsAt(climateAt(now, active));
  const lean = lit ? 1 : -1;
  const sun = { radiation: 1 + k.radiation * lean, finds: 1 + k.finds * lean };

  const hasClock = fitted.has('clock');
  const hasGlass = fitted.has('glass');

  return {
    band: time.band,
    // Carried to the page so the ticking clock in the browser shows this camp's hour.
    offset: clock,
    // Free at every tier: which way the hour is pushing. Numbers cost fuel; the direction
    // never does, because the whole decision the sun offers is when to spend an hour.
    //
    // Phrased to sit in the same column as "dose ×1.37 · finds ×1.55" and read as the
    // same kind of thing — two clauses, same order, one line. The first version was a
    // sentence fragment with no subject sat in a value column, which read as neither
    // prose nor a figure.
    lean: lit ? 'doses harder, finds more' : 'doses lighter, finds less',
    lit,

    // The clock: the hour itself, and when the light turns. Without it the strip says how
    // much of the day is left in words rather than refusing to say anything.
    clock: hasClock,
    hour: hasClock ? time.hour : null,
    minute: hasClock ? time.minute : null,
    /*
     * When the strip has to be redrawn, which is the soonest of three different things
     * going out of date: the band's word, the turn of the light, and — only when there is
     * a glass to show it — the degree on the thermometer.
     *
     * The last one is the frequent one. The air moves about two degrees an hour, so a
     * rendered figure is wrong within ten minutes; beside a chart whose marker walks along
     * the line correctly, a strip stuck three degrees out is the page contradicting
     * itself. Armed rather than polled, so it fires exactly when the number changes.
     */
    refreshAt: new Date(
      Math.min(
        nextBandChange(now, clock, noon),
        nextTurnOfLight(now, clock, noon),
        hasGlass ? nextDegreeChange(state.worldEvents ?? [], now) : Infinity,
      ),
    ),
    turnsHour: hasClock ? worldTimeAt(nextTurnOfLight(now, clock, noon), clock, noon).hour : null,
    turnsMinute: hasClock ? worldTimeAt(nextTurnOfLight(now, clock, noon), clock, noon).minute : null,
    turning: lit ? 'sunset' : 'sunrise',
    roughly: hasClock ? null : roughLight(now, lit, clock, noon),

    // The glass: the temperature, and the sun's numbers rather than its direction.
    glass: hasGlass,
    temperature: hasGlass ? Math.round(temperatureAt(now, active, clock)) : null,
    sun: hasGlass ? sun : null,

    // The sky's own numbers are free and always have been — the sky block has printed
    // them since the honesty pass, and hiding them here would be a regression dressed as
    // an upgrade. Only the sun's half is bought.
    sky: active.map((event) => ({
      kind: event.kind,
      name: WORLD_EVENTS[event.kind]?.name ?? event.kind,
      endsAt: new Date(event.endsAt),
      effects: effectsOf(event.kind),
    })),

    // What the two come to together, for the panel behind the strip.
    together: hasGlass
      ? {
          radiation: expeditionFactors(active).radiation * sun.radiation,
          finds: sun.finds,
          loot: expeditionFactors(active).loot,
        }
      : null,
  };
}

/** A day offset the glass will actually answer for. */
function clampDay(day) {
  const n = Math.trunc(Number(day) || 0);
  return Math.max(-DAY_REACH, Math.min(DAY_REACH, n));
}

/**
 * The day the glass is showing: temperature quarter-hour by quarter-hour, the nights it runs through, and the weather
 * that arrives during it.
 *
 * **The past is what the table says; the future is what the seed says.** Stored rows cover
 * the hours already lived and derived ones start at or after now, exactly as the report on
 * a trip in flight does — and for the same reason nothing here is written. Pre-inserting a
 * week of weather would freeze it against the next balance pass for no gain at all.
 *
 * The horizon is a design decision rather than a limit of the arithmetic; see
 * `FORECAST_HOURS`.
 */
async function forecastOf(client, now, days, clock = 0, noon = DEFAULT_SOLAR_NOON) {
  const { from, to: until } = dayWindow(now, days, clock);

  /*
   * The past is what the table says; the future is what the seed says.
   *
   * The tick's own window only covers the stretch it simulated, which is nothing like the
   * day being drawn once the player steps a week either way — so the stored rows are
   * loaded for this window specifically, and only the part that has not happened yet is
   * derived. Deriving the past instead would be subtly wrong: migration `014` lets a
   * retune change what unwritten slots become, and a chart of Tuesday must show the
   * Tuesday that was lived rather than the one today's content would have produced.
   */
  const stored = await loadWorldEvents(client, from, Math.min(until, now));
  const ahead =
    until > now
      ? deriveEventsBetween(WORLD_SEED, Math.max(from, now), until).filter(
          (event) => event.startsAt >= Math.max(from, now),
        )
      : [];
  const events = [...stored, ...ahead];

  const series = forecastSeries(events, from, until, undefined, clock, noon);
  const degrees = series.map((point) => point.degrees);

  return {
    from: new Date(from),
    until: new Date(until),
    // Null on any day but the one being lived: a marker for "now" on Thursday's chart
    // while it is Tuesday would be a line pointing at nothing.
    now: now >= from && now < until ? new Date(now) : null,
    offset: days,
    canGoBack: days > -DAY_REACH,
    canGoOn: days < DAY_REACH,
    series: series.map((point) => ({
      at: point.at,
      degrees: Math.round(point.degrees * 10) / 10,
      lit: point.lit,
    })),
    dark: darkSpansBetween(from, until, clock, noon),
    /*
     * Sunrise and sunset for this day, as instants and as readings.
     *
     * Exactly two, and always inside the day: the lit window never crosses midnight,
     * which is a property `daylight.js` holds to on purpose and a test pins at every day
     * of the year. Formatted here rather than in the renderer, for the reason the strip's
     * clock is — these are world hours, and a `Date` formatted in the browser's locale
     * would print the viewer's own afternoon beside a world one.
     */
    turns: (() => {
      const shift = clock * 60_000;
      const { sunrise, sunset } = sunAt(from + shift, noon);
      return [
        { kind: 'sunrise', at: from + sunrise * HOUR_MS },
        { kind: 'sunset', at: from + sunset * HOUR_MS },
      ].map((turn) => ({
        ...turn,
        hour: worldTimeAt(turn.at, clock, noon).hour,
        minute: worldTimeAt(turn.at, clock, noon).minute,
      }));
    })(),
    // Only what is in force during the window, and only the kinds that do something —
    // a band on the chart for an event with no effect out there is a mark that means
    // nothing, which on a chart is worse than on a list.
    weather: events
      .filter((event) => event.endsAt > from && event.startsAt < until)
      .map((event) => ({
        kind: event.kind,
        name: WORLD_EVENTS[event.kind]?.name ?? event.kind,
        from: Math.max(from, event.startsAt),
        to: Math.min(until, event.endsAt),
        warmth: WORLD_EVENTS[event.kind]?.warmth ?? 0,
        effects: effectsOf(event.kind),
      }))
      .sort((a, b) => a.from - b.from),
    low: Math.round(Math.min(...degrees) * 10) / 10,
    high: Math.round(Math.max(...degrees) * 10) / 10,
  };
}

/** The next instant the light turns, sunrise or sunset, whichever comes first. */
function nextTurnOfLight(now, clock = 0, noon = DEFAULT_SOLAR_NOON) {
  const shift = clock * 60_000;
  const today = Math.floor((now + shift) / DAY_MS) * DAY_MS;

  for (const day of [today, today + DAY_MS]) {
    const { sunrise, sunset } = sunAt(day, noon);
    for (const hour of [sunrise, sunset]) {
      const at = day + hour * HOUR_MS - shift;
      if (at > now) return at;
    }
  }

  return now;
}

/** How much of the day is left, for a camp with no clock to read it off. */
function roughLight(now, lit, clock = 0, noon = DEFAULT_SOLAR_NOON) {
  const hours = (nextTurnOfLight(now, clock, noon) - now) / HOUR_MS;

  if (!lit) return hours < 2 ? 'the sky is going grey' : 'a long way from light';
  if (hours < 1) return 'the light is nearly gone';
  if (hours < 3) return 'not long before dark';
  return 'hours yet before dark';
}

/**
 * Which structure makes this resource, or null for one nothing makes.
 *
 * Read off the specs rather than kept as a second list: a table mapping food to the garden
 * would be a copy of `produces`, and the copy is what goes stale when a structure changes
 * what it makes.
 */
function producerOf(kind) {
  const found = Object.entries(STRUCTURES).find(([, spec]) => spec.produces === kind);
  return found ? found[0] : null;
}

/** The hour a wanderer walks up, on the camp's own clock. */
const GATE_HOUR = 8;

/**
 * When somebody would be at the gate, given a bed that became free at `since`.
 *
 * The first eight in the morning after it, on the camp's clock — which is a real hour now
 * that migrations `015` and `016` gave the camp one. You build a bed in the evening, and
 * somebody is standing there when you check in over breakfast.
 *
 * Derived rather than stored. A column would have to be written by whatever made the bed
 * free — a build finishing, a survivor dying, a shelter knocked down by a succession — and
 * every one of those is a place it could be forgotten. The bed's own timestamp is already
 * the answer, so this asks it.
 */
function gateOpensAt(since, offset) {
  const local = since + offset * 60_000;
  const midnight = Math.floor(local / DAY_MS) * DAY_MS;
  const eight = midnight + GATE_HOUR * HOUR_MS;
  const due = eight > local ? eight : eight + DAY_MS;
  return due - offset * 60_000;
}

function reportOn(row, state, now) {
  if (!row) return null;

  const travelHours = Number(row.travel_hours);
  const seed = Number(row.seed);
  const region = {
    slug: row.slug,
    name: row.name,
    danger: row.danger,
    travelHours,
    loot: row.loot,
    finds: row.finds,
    radiationPerTrip: row.radiation_per_trip,
  };

  const choices = row.choices ?? [];
  const departedAt = row.departed_at.getTime();
  const returnsAt = row.returns_at.getTime();
  const elapsed = Math.max(0, (now - departedAt) / HOUR_MS);

  const stillToCome = deriveEventsBetween(WORLD_SEED, now, returnsAt).filter(
    (event) => event.startsAt >= now,
  );
  const overTheTrip = [...(state.worldEvents ?? []), ...stillToCome];

  const outcome = resolveExpedition({
    region,
    survivor: state.survivor,
    seed,
    weather: travelFactors(
      overTheTrip,
      departedAt,
      returnsAt,
      /*
       * The sky frozen onto the trip at dispatch — migration 017 — falling back to the
       * camp's for a trip that predates it.
       *
       * This has to read exactly what `returnExpedition` reads. `travelFactors` is one
       * function so the two cannot compose the sky differently; that would be undone here
       * by handing it different arguments, and the symptom would be a report promising
       * one thing and the return delivering another.
       */
      row.clock_offset_minutes ?? state.settlement.clockOffset ?? 0,
      row.solar_noon_minutes === null || row.solar_noon_minutes === undefined
        ? (state.settlement.solarNoon ?? DEFAULT_SOLAR_NOON)
        : Number(row.solar_noon_minutes) / 60,
    ),
    choices,
    standings: state.settlement.standings,
  });

  const carried = stateAt(timelineOf({ outcome, travelHours, seed }), elapsed);
  const answered = new Set(choices.map((choice) => Number(choice.index)));
  const moments = momentsFor(region, seed);

  // Health as it stands out there: what they left with, less what the trip has already
  // done to them. This is what the warning on a lethal option is measured against, and
  // it is computed rather than simulated — the tick still applies damage at the return.
  const health = Math.max(0, Number(state.survivor?.health ?? 0) - carried.damage);

  const open = moments.find(
    (moment) => !answered.has(moment.index) && isOpen(moment, elapsed),
  );

  return {
    regionName: row.name,
    // Which plate to show beside the report. The name would not do: it is prose and the
    // files are named for the slug the game already keys everything else on.
    regionSlug: row.slug,
    // What the place is, beside the report of what is happening in it. The dispatch
    // table says this before you send anybody; the Away block is where you read it
    // again while they are out there, and it is the only sentence in that block about
    // somewhere rather than about somebody.
    regionDescription: row.description,
    returnsAt: row.returns_at,
    hoursOut: elapsed,
    carrying: carried.carrying,
    radiation: carried.radiation,
    damage: carried.damage,
    cause: carried.cause,
    findCount: carried.finds.length,
    health,
    // The radio's second job, and the same job it already had: it tells you when, and
    // nothing else. Without it a moment is found by loading the page inside its window.
    nextMomentAt: null,
    moment: open
      ? {
          index: open.index,
          // The situation, then the turn. Two fields because they are two registers on
          // the page — the scene is read, the turn is answered — and joining them here
          // would leave the renderer splitting a paragraph back apart on a full stop.
          title: open.title,
          scene: open.scene,
          prose: open.prose,
          closesAt: new Date(row.departed_at.getTime() + open.closesAt * HOUR_MS),
          options: open.options.map((option) => ({
            key: option.key,
            label: option.label,
            detail: option.detail,
            // What it does, in figures, derived here because this is the last place the
            // option still has all its fields. Turning back is the only one whose cost
            // depends on where the survivor is standing rather than on the option, so
            // the walk home is measured here and handed over.
            effects: optionEffects(option, { walkHome: walkHomeHours(elapsed, travelHours) }),
            warned: isWarned(option, health),
            // What it costs out of the pack, if anything. Resolved against what the
            // survivor is actually carrying by the caller, which is the first place
            // that knows — see the note there.
            consumes: option.consumes ?? null,
          })),
        }
      : null,
    // What has already been said out there. The moment box disappears the instant it is
    // answered — it is filtered out of `open` above — and until this existed nothing
    // took its place, so a decision the player had just made left no trace on the page
    // and the outcome was still hours away in the return log. The answer is recorded,
    // the consequence is rolled at `returns_at`, and this is the only thing that says so.
    settled: choices
      .map((choice) => {
        // The same guard the resolution uses, and now literally the same function: an
        // answer that names nothing was not applied out there, so it must not be
        // reported here either. Three hand-written copies of this rule was two too many.
        const honoured = answerTo(moments, choice);
        return honoured
          ? {
              title: honoured.moment.title,
              label: honoured.option.label,
              atHour: honoured.moment.atHour,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.atHour - b.atHour),
    upcoming: moments
      .filter((moment) => !answered.has(moment.index) && moment.atHour > elapsed)
      .map((moment) => new Date(row.departed_at.getTime() + moment.atHour * HOUR_MS)),
  };
}

/**
 * What the survivor's numbers are doing to them, rather than only what they are.
 *
 * Found by playing on 2026-08-20: the page said "Radiation 62.2" and nothing else, and
 * 62.2 happens to sit just past `radThreshold`, where a survivor stops healing and
 * starts losing health. Nothing was wrong — the number was right and the tick was right
 * — and the player had no way to know the number had crossed a line, which line, or what
 * it was costing. The same shape as the moment box that vanished on submit and the
 * option priced in a dose the pack did not hold: a fact the decision needs, not sitting
 * next to the decision.
 *
 * Three states worth telling apart, because each wants something different from the
 * player:
 *
 * - **Burning.** Past the threshold, losing health every hour. The bleed ramps from
 *   nothing at the threshold to the full rate at 100, so "past 60" and "at 87" are very
 *   different news — the figure is given rather than the band.
 * - **Stalled.** Under the threshold but over `regenRadCeiling`: nothing is being lost
 *   and nothing is coming back. This is where a Deep Zone run leaves a survivor for the
 *   better part of two days, and it is the state the page said least about.
 * - **Mending.** Clear enough to heal, which is the only state in which waiting works.
 *
 * `decayPerHour` is passed in rather than read here because filtration changes it, and
 * the whole point of that upgrade is this number: a player weighing 60 fuel against it
 * should be able to see what it buys.
 *
 * **Rewritten 2026-08-27, when radiation stopped having a cliff.** There is no threshold
 * to be past any more: the dose damages on a curve and smothers healing in proportion, so
 * health per hour is one number that slides from +2 down through zero at about sixty-five
 * rads. The three states survive because they are still three different situations a
 * player is in — gaining, holding, losing — but they are now *read off the number* rather
 * than off a line, and the number is the same one the tick applies.
 *
 * That last part is the whole reason this function exists rather than the page doing its
 * own arithmetic: `strainOf` read a flat threshold while the tick read a medicine-adjusted
 * one for months, and told a camp with a good medic it was burning while the simulation
 * had it merely stalled.
 */
function strainOf(survivor, decayPerHour) {
  const rads = Number(survivor.radiation) || 0;
  const damage = radDamagePerHourAt(survivor, CONFIG);

  // What the survivor is actually gaining or losing this hour, hunger aside — which is
  // the figure the tick will apply and therefore the only honest thing to print.
  const smothered = 1 - Math.min(100, Math.max(0, rads)) / 100;
  const healing = CONFIG.regenPerHour * smothered;
  const net = healing - damage;

  // The dose at which this survivor stops gaining, which replaces the constant the page
  // used to name. Solved by walking rather than algebraically: the curve's exponent is a
  // tuning constant and a closed form here would silently stop being true if it moved.
  let tipping = 100;
  for (let r = 0; r <= 100; r += 0.5) {
    const at = { ...survivor, radiation: r };
    if (CONFIG.regenPerHour * (1 - r / 100) - radDamagePerHourAt(at, CONFIG) >= 0) tipping = r;
  }

  const hoursTo = (mark) => (rads <= mark ? 0 : (rads - mark) / decayPerHour);

  return {
    state: net > 0.05 ? 'mending' : net < -0.05 ? 'burning' : 'stalled',
    // Per hour, net, and signed the way the page reads it: what they are losing.
    damagePerHour: Math.max(0, -net),
    healingPerHour: Math.max(0, net),
    // What healing would be with no dose at all, so the page can tell "healing" from
    // "healing slowly" without keeping a second copy of a tuning constant.
    fullHealing: CONFIG.regenPerHour,
    tipping,
    hoursToSafe: hoursTo(tipping),
    // No longer "hours until healing starts" — healing has already started. This is how
    // long until the dose is doing nothing worth naming.
    hoursToMending: hoursTo(10),
  };
}

/**
 * What is acting on each of this survivor's gauges, right now.
 *
 * Distinct from `gaugeNotes`, and the difference is the point. Those describe the *rules* —
 * "food drawn 0.5/h", "starves at 70" — and read the same for everybody in every state,
 * because they are the scale rather than the reading. These are facts about this person in
 * this hour: that they are out on the road so nothing is scrubbing, that they are resting
 * and drinking six times a mouth for it, that hunger has climbed past the line where they
 * stop healing.
 *
 * A player could work every one of them out from the numbers already on the page. That is
 * exactly the complaint: a cost you can derive is a cost most people will not derive, and
 * recovery's price on the stores was real and invisible from the day it shipped.
 *
 * Each is `{ tag, note }` — a word for the pip and a sentence for the hover — and an empty
 * list is the ordinary case rather than a missing one. Nothing is added for a survivor who
 * is simply standing in the camp being fed, because "nothing unusual" is not news.
 */
function driversFor(person, { working, resting, fedShort, radScrubbing, strain, config }) {
  const perHour = (value) => `${Math.round(Number(value) * 10) / 10}`;

  const health = [];
  if (person.hunger >= config.regenHungerCeiling) {
    health.push({
      tag: 'too hungry to heal',
      note: `Health only mends below ${config.regenHungerCeiling} hunger, and they are at ${perHour(person.hunger)}.`,
    });
  }
  if (strain?.state === 'burning') {
    health.push({
      tag: `the dose −${perHour(strain.damagePerHour)}/h`,
      note: 'The radiation they are carrying costs more health than rest gives back.',
    });
  } else if (strain?.state === 'stalled') {
    health.push({
      tag: 'the dose cancels rest',
      note: 'The dose is taking about what rest gives back, so health is standing still.',
    });
  }

  const hunger = [];
  if (resting) {
    hunger.push({
      // The mark says what, the hover says how much — so not a bare multiplier, which is a
      // figure with nothing to say what it multiplies.
      tag: 'resting, eating for it',
      note:
        `Paying back stamina is work of a kind, and they eat for it — ` +
        `${perHour(config.foodPerHour * config.staminaRecoveryRationMultiplier)} food and ` +
        `${perHour(config.waterPerHour * config.staminaRecoveryRationMultiplier)} water an hour ` +
        `out of the stores, against ${perHour(config.foodPerHour)} and ${perHour(config.waterPerHour)} for somebody idle.`,
    });
  }
  if (fedShort) {
    hunger.push({
      tag: 'the stores are short',
      note: 'The camp cannot meet what this survivor is drawing, so hunger is climbing.',
    });
  }

  /*
   * A mark is something acting on the gauge, and only that.
   *
   * There was one here reading "nothing comes off out there" for a survivor on the road,
   * and it is the wrong kind of thing to say: it announces a *non*-effect. Nothing is
   * touching their dose, which is precisely the state an empty mark strip already
   * describes — so the mark was a label whose whole content was the absence of a label.
   *
   * It was also the second copy of a fact the page already carries. Where they are is on
   * the same row, under their name, on a photograph of the place. A reader who has taken
   * that in does not need telling again that the camp's filter is not with them.
   *
   * The rule this leaves: a mark names a thing doing something to the number. If the number
   * is simply sitting still, the strip is empty and that is the whole report.
   */
  const radiation = [];
  if (working !== 'away' && radScrubbing) {
    radiation.push({
      tag: 'filtration',
      note: 'The filter on the purifier scrubs the camp, so a dose comes off faster than it would.',
    });
  }

  const stamina = [];
  if (working !== null) {
    const doing = { away: 'out there', building: 'building', fitting: 'fitting', crafting: 'at the bench' };
    stamina.push({
      tag: `${doing[working] ?? working} −${perHour(config.staminaPerHourWorked)}/h`,
      note:
        'Every kind of work spends it at the same rate — walking, building, the bench. ' +
        'Danger does not: that is what radiation is for.',
    });
  } else if (resting) {
    const slowed = person.hunger > config.regenHungerCeiling - config.staminaRecoveryHungerTaper;
    stamina.push({
      tag: slowed ? 'resting, slowed' : `resting +${perHour(config.staminaRegenPerHour)}/h`,
      note: slowed
        ? 'Recovery slows as hunger nears the line where healing stops, so it can never be ' +
          'the reason somebody stays injured. Feed them and it picks up.'
        : 'It comes back on its own. Nothing has to be scheduled for it.',
    });
  }

  return { health, hunger, radiation, stamina };
}

/**
 * The rates behind the three gauges, so the page can say what a figure is made of.
 *
 * Played on 2026-08-24: the Survivor block read `HUNGER 0.0` and `RADIATION 0.7`, and a
 * player who had not read `constants.js` had no way to know what either number counts,
 * which direction is bad, or what moves them. "0.0" hunger is a survivor who is fed; a
 * reasonable person reads it as a survivor with nothing to eat.
 *
 * These are the tuning constants, passed rather than described, because a sentence in
 * `render.js` saying "hunger climbs 4.2 an hour" is a second copy of a number that a
 * balance pass edits in one place. `radDecayPerHour` is the camp's real figure — the
 * one filtration changes — and `radDecayBasePerHour` is what a survivor out on the road
 * gets, since the filter is bolted to the purifier and does not follow anyone into the
 * Deep Zone.
 */
function vitalsOf(radDecayPerHour) {
  return {
    eats: { food: CONFIG.foodPerHour, water: CONFIG.waterPerHour },
    hungerRisePerHour: CONFIG.hungerRisePerHour,
    hungerFallPerHour: CONFIG.hungerFallPerHour,
    starvationThreshold: CONFIG.starvationThreshold,
    starvationDamagePerHour: CONFIG.starvationDamagePerHour,
    // Phase 10's three, passed rather than described for the reason above: a sentence in
    // `render.js` saying "work costs 3.8 an hour" is a second copy of a number a balance
    // pass edits in one place — and this one is derived from the map, so it moves.
    staminaPerHourWorked: CONFIG.staminaPerHourWorked,
    staminaRegenPerHour: CONFIG.staminaRegenPerHour,
    staminaRecoveryRationMultiplier: CONFIG.staminaRecoveryRationMultiplier,
    radDecayPerHour,
    radDecayBasePerHour: CONFIG.radDecayPerHour,
    radDamagePerHour: CONFIG.radDamagePerHour,
    regenPerHour: CONFIG.regenPerHour,
    regenHungerCeiling: CONFIG.regenHungerCeiling,
    regenRadCeiling: CONFIG.regenRadCeiling,
  };
}

/**
 * What a price is short by, in the words the player would use.
 *
 * Every priced thing on the camp page rendered its button whether or not the camp
 * could pay: Fit beside a 60-fuel filtration on 51 fuel, Make beside a vest wanting
 * two parts on a pack holding one. Clicking either returned a refusal that was
 * correct and arrived too late to be a decision. That is the same fault the moment
 * options had — a cost the page displays but does not verify is a button that lies —
 * and it was fixed there first only because that is where it was noticed.
 *
 * Returns null when the camp can pay, so the caller can treat it as a plain guard.
 */
function shortfall(resources, pack, costs = {}, inputs = []) {
  const missing = [];

  for (const [kind, amount] of Object.entries(costs)) {
    // Build costs carry their duration in the same object as their price.
    if (kind === 'hours') continue;
    const have = Number(resources[kind]?.amount ?? 0);
    if (have < amount) missing.push(`${Math.ceil(amount - have)} more ${kind}`);
  }

  for (const input of inputs) {
    const have = pack.get(input.slug) ?? 0;
    if (have < input.qty) missing.push(`${input.qty - have} more ${input.slug.replaceAll('_', ' ')}`);
  }

  return missing.length > 0 ? `needs ${missing.join(', ')}` : null;
}
export async function viewCamp(client, settlementId, now = Date.now(), { day = 0 } = {}) {
  const { state, events } = await advanceSettlement(client, settlementId, now);

  const { rows: settlements } = await client.query(
    `select name, founded_at, next_raid_at, caravan_seed, caravan_count, next_caravan_at,
            clock_offset_minutes, solar_noon_minutes, clock_changed_at
       from settlements where id = $1`,
    [settlementId],
  );

  const { rows: structures } = await client.query(
    'select kind, level, build_completes_at from camp_structures where settlement_id = $1 order by kind',
    [settlementId],
  );

  const { rows: survivorRow } = await client.query(
    'select name from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );

  // Only the count: the camp page points at the graveyard rather than reproducing it,
  // so pulling names and causes here would be fetching three columns to call .length
  // on them.
  const { rows: fallen } = await client.query(
    'select count(*)::int as n from character_history where settlement_id = $1',
    [settlementId],
  );

  const { rows: regionRows } = await client.query(
    `select slug, name, danger, travel_hours, description, requires_link
       from regions order by danger, travel_hours`,
  );

  // Re-read rather than using the post-tick state: the tick may have just resolved
  // an expedition, and what the page wants is whatever is in flight *now*.
  const { rows: away } = await client.query(
    `select r.name, r.slug, r.danger, r.travel_hours, r.loot, r.finds, r.radiation_per_trip,
            r.description,
            e.character_id,
            e.returns_at, e.departed_at, e.seed, e.choices,
            e.clock_offset_minutes, e.solar_noon_minutes
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'`,
    [settlementId],
  );

  const { rows: recipes } = await client.query(
    `select rec.slug, rec.name, rec.costs, rec.inputs, rec.output_qty,
            rec.requires_workshop, rec.craft_hours, rec.description,
            i.name as output_name
       from recipes rec
       join items i on i.id = rec.output_item_id
      order by rec.requires_workshop, rec.craft_hours`,
  );

  // Re-read for the same reason the expedition is: the tick may have just lifted an
  // order off the bench, and what the page wants is whatever is on it *now*.
  const { rows: onTheBench } = await client.query(
    `select rec.name, co.completes_at
       from craft_orders co
       join recipes rec on rec.id = co.recipe_id
      where co.settlement_id = $1 and co.status = 'active'`,
    [settlementId],
  );

  const { rows: inventoryRows } = await client.query(
    `select ii.character_id, i.slug, i.name, i.kind, i.potency, i.description, ii.qty
       from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is null and ii.qty > 0
      order by i.name`,
    [settlementId],
  );

  /*
   * What each thing in the pack would do, and whether taking it now would do anything.
   *
   * A weapon and a coil of parts are carried rather than taken, so they say nothing; a
   * ration at full health and a tablet on a clean survivor would be a crafted item spent on
   * moving a gauge that is already at its best, so they say why not rather than offering a
   * button. Same shape as a moment option the pack cannot pay for, and as a recipe the
   * workshop is not deep enough for: the row stays, and it says what it wants.
   *
   * The service refuses all three cases again. This decides what the page offers; that
   * decides what actually happens, because the page is a render of a moment ago.
   */
  /*
   * The packs, grouped by whose they are.
   *
   * The query already reaches every living character's items — it joined through
   * `characters` to find them — and only the grouping is new. With one survivor the whole
   * result was one pack and nobody had to ask.
   */
  const packsByOwner = new Map();

  const inventory = inventoryRows.map((row) => {
    // The constant `useItem` applies, not a copy of it: the page must not advertise a
    // dose the service would not deliver.
    const points = Number(row.potency) * POTENCY_TO_POINTS;
    const health = Number(state.survivor?.health ?? 0);
    const dose = Number(state.survivor?.radiation ?? 0);

    const round = (value) => Math.round(value * 10) / 10;

    if (row.kind === 'ration') {
      const mends = Math.min(points, 100 - health);
      return {
        ...row,
        use: health >= 100 ? null : { effect: `+${round(mends)} health` },
        idle: health >= 100 ? 'nothing to mend' : null,
        // What it is worth in the abstract, for the note: the row above is capped by how
        // hurt they happen to be, and "+0.4 health" says nothing about the item.
        worth: `+${round(points)} health`,
      };
    }

    if (row.kind === 'antirad') {
      const scrubs = Math.min(points, dose);
      return {
        ...row,
        use: dose <= 0 ? null : { effect: `−${round(scrubs)} rads` },
        idle: dose <= 0 ? 'no dose to scrub' : null,
        worth: `−${round(points)} rads`,
      };
    }

    /*
     * Worn rather than taken, and the pack has never said what any of it does.
     *
     * A Plate Vest has sat in this list as a name and a count since gear shipped, while
     * `equipmentOf` quietly reads its potency on every trip. Both are capped — armour at
     * 60% and a weapon at 50% — so a second vest is not twice the vest, and the figure
     * shown is the one that would actually apply.
     */
    /*
     * Gear reads its potency straight, the way `equipment.js` does — `capped()` there is
     * `potency / 100`, so a spear at 25 avoids 25% of hazards.
     *
     * This was written as `points * 2`, which equalled potency only because the consumable
     * constant happened to be 0.5. Retuning the tablets halved the spear, which is two
     * unrelated numbers tied together by an arithmetic coincidence.
     */
    const potency = Number(row.potency);
    if (row.kind === 'armour') {
      return { ...row, use: null, idle: null, worth: `blunts ${Math.min(60, potency)}% of damage` };
    }
    if (row.kind === 'weapon') {
      return { ...row, use: null, idle: null, worth: `avoids ${Math.min(50, potency)}% of hazards` };
    }

    return { ...row, use: null, idle: null, worth: 'used at the bench' };
  });

  for (const [i, row] of inventoryRows.entries()) {
    const owner = Number(row.character_id);
    if (!packsByOwner.has(owner)) packsByOwner.set(owner, []);
    packsByOwner.get(owner).push(inventory[i]);
  }

  const { rows: upgradeRows } = await client.query(
    'select kind, upgrade, completes_at, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );
  const fitted = new Set(
    upgradeRows.filter((row) => row.installed_at !== null).map((row) => row.upgrade),
  );

  // How many of each are standing, which is the question a bed asks where an instrument
  // asks whether it is there at all.
  /*
   * Beds standing, when the newest became ready, and how many people have ever held this
   * camp — the three facts a gate arrival is derived from.
   *
   * Capped by what the shelter can hold, because a succession knocks levels down and can
   * leave a bed in a room that is no longer there. The service checks the same ceiling.
   */
  /*
   * How many people have ever held this camp, counted the same way `takeInWanderer` counts
   * it — every row in `characters`, living and dead. It has to be the same count: the page
   * names who is at the gate and the service decides who actually walks in, and a page that
   * counted the fallen alone would introduce a stranger on the click.
   */
  const { rows: everHeldRows } = await client.query(
    'select count(*)::int as n from characters where settlement_id = $1',
    [settlementId],
  );
  const everHeld = everHeldRows[0].n;

  /*
   * What each survivor is doing, from the one place that decides it.
   *
   * The page had no idea. `whoSelector` filtered on a `busy` field that was never set, so a
   * survivor fitting a bed stayed in every dropdown and the service refused them after the
   * click — the exact fault the bench and the moment options exist to avoid, reintroduced
   * by a field I invented and did not wire.
   *
   * Read through `occupations` rather than recomputed here, so the page and the refusal
   * cannot disagree about who is free.
   */
  const busyBy = await occupations(client, settlementId, now);

  const bedRows = upgradeRows.filter(
    (row) => row.upgrade === 'bed' && row.installed_at !== null,
  );
  const shelterLevel = Number(
    structures.find((s) => s.kind === 'shelter')?.level ?? 0,
  );
  const bedsStanding = Math.min(bedRows.length, fittingsAllowed('bed', shelterLevel));
  const livingCount = state.survivors?.length ?? 0;
  const bedsFree = bedsToRoster(bedsStanding) - livingCount;
  const newestBedAt = bedRows.length
    ? Math.max(...bedRows.map((row) => row.installed_at.getTime()))
    : null;

  const installedCounts = new Map();
  for (const row of upgradeRows) {
    if (row.installed_at === null) continue;
    installedCounts.set(row.upgrade, (installedCounts.get(row.upgrade) ?? 0) + 1);
  }
  const beingFitted = upgradeRows.find((row) => row.installed_at === null) ?? null;

  /*
   * The camp's own clock, in minutes ahead of UTC.
   *
   * Read once and threaded into everything that asks what hour it is, rather than reached
   * for at each call site — a page where one figure used the camp's evening and the next
   * used Greenwich's would be wrong in a way nobody could see, and this file has already
   * had that bug once with the radiation threshold.
   */
  const clock = Number(settlements[0].clock_offset_minutes) || 0;

  /*
   * When the sun is highest on that clock, in hours.
   *
   * A second quantity from the offset and independent of it — see migration `016`. The
   * offset says what time it is here; this says where the sun sits against it, which
   * depends on longitude and on summer time and which nothing but the player knows.
   */
  // `Number.isFinite` and not `??`: `Number(null)` is 0 and `Number()` never returns
  // null, so a nullish coalesce never fires and a missing column would put noon at
  // midnight. The tick had exactly that bug for twenty minutes and every test passed.
  const noon = Number.isFinite(Number(settlements[0].solar_noon_minutes))
    ? Number(settlements[0].solar_noon_minutes) / 60
    : DEFAULT_SOLAR_NOON;

  // Only when there is a glass to read it with: the query is cheap and the derivation is
  // cheaper, but a camp that cannot see the week should not be paying for a week's rows.
  const forecast = fitted.has('glass')
    ? await forecastOf(client, now, clampDay(day), clock, noon)
    : null;

  // What the camp can actually pay with: stores, and what is on the survivor.
  const pack = new Map(inventory.map((item) => [item.slug, Number(item.qty)]));
  const purse = state.settlement.resources;
  // The caravan at the gate, or the one on the road. Standing prices the offers.
  const standings = {};
  const { rows: standingRows } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1',
    [settlementId],
  );
  for (const row of standingRows) standings[row.faction] = Number(row.standing);

  const caravanRow = settlements[0];
  const visit = caravanVisit(Number(caravanRow.caravan_seed), caravanRow.caravan_count);
  const arrival = caravanRow.next_caravan_at?.getTime() ?? null;
  const departsAt = arrival === null ? null : arrival + visit.stayHours * 3600_000;
  const visiting = arrival !== null && arrival <= now && now < departsAt;

  let caravan = null;
  if (arrival !== null) {
    const spec = FACTIONS[visit.faction];
    const standing = standingOf(standings, visit.faction);

    // Proper item names for the shopfront, in one query.
    const slugs = spec.offers.map((o) => o.item).filter(Boolean);
    const { rows: named } = await client.query(
      'select slug, name from items where slug = any($1)',
      [slugs],
    );
    const names = new Map(named.map((row) => [row.slug, row.name]));

    caravan = {
      faction: visit.faction,
      name: spec.name,
      description: spec.description,
      visiting,
      arrivesAt: visiting ? null : new Date(arrival),
      departsAt: visiting ? new Date(departsAt) : null,
      standing,
      offers: visiting
        ? spec.offers.map((offer, index) => {
            const costs = priceAt(offer, standing);
            return {
              index,
              what: offer.item ? names.get(offer.item) ?? offer.item : offer.resource,
              qty: offer.qty,
              costs,
              // Priced in stores alone, so the pack is not consulted. Standing has
              // already moved these numbers, which is why the shortfall is worked
              // out here and not from the list price.
              shortBy: shortfall(state.settlement.resources, new Map(), costs),
            };
          })
        : [],
    };
  }

  // The radio's second job, and the same shape as its first: it tells you *when*. Its
  // scrap levels protect the camp while you are gone; the radio only ever helps while
  // you are here, so an unfitted camp meets a moment by loading the page inside its
  // window and never by planning to.
  /*
   * A report per trip, keyed on whoever is walking it.
   *
   * `expedition` stays as the first of them because the Contact block and a good deal of the
   * page still read it. The map is what lets each survivor's own block say what their own
   * trip has done — the decision on 2026-08-31 — rather than every block repeating the first
   * traveller's numbers.
   */
  const reports = new Map();
  for (const row of away) {
    const report = reportOn(row, state, now);
    if (report) reports.set(Number(row.character_id), report);
  }

  const expedition = reportOn(away[0], state, now);
  if (expedition && fitted.has('radio')) {
    expedition.nextMomentAt = expedition.upcoming[0] ?? null;
  }

  /**
   * An option priced in something the pack does not hold is not a decision.
   *
   * Until this existed the page could not tell the difference: the option rendered like
   * any other, and the refusal — "There is nothing like that in the pack" — arrived
   * after the click, on a window with minutes left on it. The generator cannot help,
   * and should not: a moment is drawn from a region and a seed alone so that attending
   * one never changes what the trip was going to be. That makes *here* the first point
   * at which the price and the pack are both known, so here is where they are compared.
   */
  if (expedition?.moment) {
    const wanted = [
      ...new Set(expedition.moment.options.flatMap((option) => option.consumes ?? [])),
    ];
    if (wanted.length > 0) {
      const { rows: named } = await client.query(
        'select slug, name from items where slug = any($1)',
        [wanted],
      );
      const names = new Map(named.map((row) => [row.slug, row.name]));
      const held = new Set(inventory.map((item) => item.slug));

      for (const option of expedition.moment.options) {
        if (!option.consumes) continue;
        // Any one of them pays: the list is a preference order, not a shopping list.
        option.missing = !option.consumes.some((slug) => held.has(slug));
        option.needs = option.consumes.map((slug) => names.get(slug) ?? slug).join(' or ');
        // And now the price chip can say what the price is. Only that chip is touched:
        // everything else the option does was derived where the option still had all
        // its fields, and this is a view object with `consumes` and nothing else on it.
        option.effects = option.effects.map((effect) =>
          effect.needs ? { ...effect, label: `−1 ${option.needs}` } : effect,
        );
      }
    }
  }

  /**
   * The road: what has been reached, and what the next link wants.
   *
   * Every neighbour is derived here rather than read, so the table holds only what the
   * player did — and a neighbour's fate is derived against `now`, which is why somebody
   * standing last week can be gone on this page load with nothing having run.
   *
   * What a link bought is never repossessed. A destination stays on the dispatch table
   * and a trade post stays open after the people are gone, because otherwise "another
   * camp died, so you lost a shop" would be exactly the cross-camp failure this phase
   * refuses. The fate is news.
   */
  const { rows: roadRows } = await client.query(
    'select link_index, fuel, completed_at from road_links where settlement_id = $1 order by link_index',
    [settlementId],
  );

  const opened = new Set(
    roadRows.filter((row) => row.completed_at !== null).map((row) => Number(row.link_index)),
  );

  /**
   * What a place actually is, so the road can say it before it is paid for.
   *
   * The same facts the dispatch table carries — how far, how dangerous, how much
   * contact — because 70 fuel against an unknown is not a decision. The road already
   * fixes which link opens which region precisely so the player is choosing a known
   * thing; this is the page finally telling them what it is.
   *
   * Read from every region rather than the filtered list, since the whole point is
   * describing places this camp cannot go to yet.
   */
  const placeOf = (slug) => {
    const region = regionRows.find((candidate) => candidate.slug === slug);
    if (!region) return null;

    return {
      name: region.name,
      danger: region.danger,
      travelHours: Number(region.travel_hours),
      moments: momentCount(Number(region.travel_hours)),
      description: region.description,
    };
  };

  const reached = roadRows
    .filter((row) => row.completed_at !== null)
    .map((row) => {
      const who = neighbourFor(WORLD_SEED, Number(row.link_index), now);
      return {
        ...who,
        place: who.region ? placeOf(who.region) : null,
        completedAt: row.completed_at,
      };
    });

  const openRow = roadRows.find((row) => row.completed_at === null);
  const nextIndex = openRow ? Number(openRow.link_index) : reached.length + 1;
  const nextCost = linkCost(nextIndex);

  const road = {
    reached,
    links: LINKS,
    // Null once the seventh is done: the road ends, and the page says so rather than
    // offering an eighth that does not exist.
    next: nextCost === null
      ? null
      : {
          index: nextIndex,
          cost: nextCost,
          fuel: Number(openRow?.fuel ?? 0),
          ...linkGives(nextIndex),
          // Named, because the player is choosing a known thing — but only this one.
          // The links past it are a count rather than a list, so there is a picture of
          // the whole road without reading the end of it first.
          neighbour: neighbourFor(WORLD_SEED, nextIndex, now).name,
          place: linkGives(nextIndex).region ? placeOf(linkGives(nextIndex).region) : null,
        },
    beyond: nextCost === null ? 0 : LINKS - nextIndex,
    // What there is to send. The box asked for a number and never said what the
    // camp had, so the arithmetic was left to the player on the one page that
    // already knew the answer.
    available: Number(state.settlement.resources.fuel?.amount ?? 0),
  };

  /**
   * Where this camp can be sent, and what it will find when it gets there.
   *
   * Two things the list did not used to carry. **Contact**, because where to send
   * someone is the decision that settles whether Phase 6 happens at all, and the table
   * it is made from listed danger, hours and flavour and never once mentioned
   * encounters — nine of the first real camp's fifteen dispatches went to the one
   * region that categorically has no interior. And **the road**, because four of these
   * places are not reachable until a link is made.
   *
   * The moment count comes from the generator's own function, so what the page promises
   * and what the trip holds cannot drift apart.
   */
  const regionsOf = (plans) =>
    regionRows
      .filter((region) => region.requires_link === null || opened.has(Number(region.requires_link)))
      .map((region) => ({
        ...region,
        moments: momentCount(Number(region.travel_hours)),
      }));

  /**
   * The post on the road, if this camp keeps one.
   *
   * The same offers a caravan carries, always open. That is deliberately *not* a
   * discount — the prices are the crew's usual prices, moved by standing exactly as
   * they are at the gate — because the road buys reliability, which is a different good
   * from cheapness and the only one a missable caravan cannot also sell.
   */
  let post = null;
  if (TRADE_POST_LINKS.some((index) => opened.has(index))) {
    const keeper = postKeeper(standings);
    const spec = FACTIONS[keeper];
    const standing = standingOf(standings, keeper);

    const slugs = spec.offers.map((offer) => offer.item).filter(Boolean);
    const { rows: named } = await client.query(
      'select slug, name from items where slug = any($1)',
      [slugs],
    );
    const names = new Map(named.map((row) => [row.slug, row.name]));

    post = {
      faction: keeper,
      name: spec.name,
      standing,
      offers: spec.offers.map((offer, index) => {
        const costs = priceAt(offer, standing);
        return {
          index,
          what: offer.item ? names.get(offer.item) ?? offer.item : offer.resource,
          qty: offer.qty,
          costs,
          shortBy: shortfall(purse, pack, costs),
        };
      }),
    };
  }


  const rates = productionRates(structures);

  // How fast radiation leaves somebody standing in this camp. Read by both the strain
  // and the gauge's note, which must not disagree about what filtration is worth.
  const radDecayPerHour =
    CONFIG.radDecayPerHour *
    (fitted.has('filtration') ? UPGRADES.filtration.radDecayMultiplier : 1);

  // What the sky is doing to production, and what the survivor takes back out. Both
  // are part of "the rate" as a player experiences it; neither used to be counted.
  const weatherFactors = productionFactors(activeAt(state.worldEvents, now));
  /*
   * What the camp draws, which is everybody in it and not the first of them.
   *
   * This was `state.survivor ? one survivor's draw : {}` — truthy the moment anybody was
   * alive, and then a single mouth however many were standing there. A camp of four was
   * told its water climbed 6.75 an hour when it climbed 6.0, and the plan below, which
   * prices every door in hours-until-you-can-afford-it, was reading the same wrong number.
   * The simulation was always right: `simulateSurvivor` draws per person and the walk
   * covers the roster. Only the page was counting one.
   *
   * **And recovery draws rations.** A survivor paying back stamina takes six times a mouth
   * of both food and water, so a camp with three people resting is drawing nine food an hour
   * rather than one and a half.
   * That is the largest single number on the page for a camp that has just come home, and
   * leaving it out would make the stores line most wrong exactly when it matters most.
   * `workingAt` is the tick's own answer to "is this person resting", so this asks it the
   * same way rather than inventing a second definition that can drift.
   */
  const eats = { food: 0, water: 0 };
  for (const person of state.survivors ?? (state.survivor ? [state.survivor] : [])) {
    if (!person.alive) continue;
    const resting = workingAt(state, person) === null && Number(person.stamina) < 100;
    const draw = resting ? CONFIG.staminaRecoveryRationMultiplier : 1;
    eats.food += CONFIG.foodPerHour * draw;
    eats.water += CONFIG.waterPerHour * draw;
  }

  /**
   * The net rate, in the shape `planFor` wants, and the same arithmetic the stores
   * line already renders. Derived once here rather than twice, because a forecast that
   * disagrees with the number printed above it is worse than no forecast.
   */
  const netRates = {};
  for (const kind of Object.keys(state.settlement.resources)) {
    netRates[kind] = (rates[kind] ?? 0) * (weatherFactors[kind] ?? 1) - (eats[kind] ?? 0);
  }
  const have = Object.fromEntries(
    Object.entries(state.settlement.resources).map(([kind, r]) => [kind, Number(r.amount)]),
  );

  /**
   * Every door the camp has, priced, for `planFor` to put hours on.
   *
   * Assembled here because what counts as a door is a content question and this is the
   * only place that has read all of the content: the structure levels, the bench, and
   * the road. Trade is deliberately absent — a caravan leaves, so "affordable in nine
   * hours" is a promise this cannot keep.
   */
  const workshopLevel = Number(structures.find((s) => s.kind === 'workshop')?.level ?? 0);
  const doors = [
    ...structures.map((s) => ({
      what: `${s.kind.replaceAll('_', ' ')} level ${s.level + 1}`,
      costs: upgradeCost(s.kind, s.level) ?? {},
    })),
    ...recipes.map((recipe) => ({
      what: recipe.name,
      costs: recipe.costs ?? {},
      // Two things production cannot fix. A recipe over the workshop's level is waiting
      // on a build, not on an hour; one short of an item is waiting on an expedition.
      // Both are real answers and neither is "wait", so neither belongs in a forecast.
      blocked:
        Number(recipe.requires_workshop) > workshopLevel ||
        (recipe.inputs ?? []).some((input) => (pack.get(input.slug) ?? 0) < input.qty),
    })),
    ...(road.next ? [{ what: `the road to ${road.next.neighbour}`, costs: { fuel: road.next.cost } }] : []),
    // Fittings, which this list did not have until the two halves of the page were read
    // side by side and disagreed out loud: the advice said there was fuel enough for the
    // Radio while the forecast beneath it said the camp could pay for nothing at all.
    // Both were computed honestly off different lists, which is the worst kind of wrong.
    ...structures.flatMap((structure) =>
      upgradesFor(structure.kind)
        .filter((branch) => !fitted.has(branch.slug))
        .map((branch) => ({
          what: branch.name,
          costs: { fuel: branch.fuel },
          // A fitting under its level is waiting on a build, not on an hour — the
          // same rule the bench recipes get.
          blocked: Number(structure.level) < branch.requiresLevel,
        })),
    ),
  ];

  const plans = planFor(doors, have, netRates);
  const regions = regionsOf(plans);

  /**
   * The three facts that say whether this camp has been shown the game yet.
   *
   * History, not state, and keyed on the settlement rather than the survivor: the camp
   * outlives them, and what the *player* has learned does not die with a character.
   * Expeditions hang off characters, hence the join; craft orders already hang off the
   * camp. See `src/game/direction.js` for why the distinction is load-bearing.
   *
   * The thresholds are the two the region table is already built around — under two
   * hours is a walk you wait out, four and over is one you leave running.
   */
  const { rows: seen } = await client.query(
    `select
       exists (
         select 1 from expeditions e
           join characters c on c.id = e.character_id
           join regions r on r.id = e.region_id
          where c.settlement_id = $1 and r.travel_hours < 2
       ) as ran_short,
       exists (
         select 1 from expeditions e
           join characters c on c.id = e.character_id
           join regions r on r.id = e.region_id
          where c.settlement_id = $1 and r.travel_hours >= 4
       ) as ran_long,
       exists (select 1 from craft_orders where settlement_id = $1) as ever_crafted`,
    [settlementId],
  );

  /**
   * The first fitting the camp could pay for right now, if any.
   *
   * Affordable *and* unlocked *and* not already in flight — an upgrade the crew is
   * halfway through fitting is not something to go and do. Priced in stores alone, the
   * same as the row that offers the button.
   */
  const fittable = structures
    .flatMap((structure) =>
      upgradesFor(structure.kind).map((branch) => ({ structure, branch })),
    )
    .find(
      ({ structure, branch }) =>
        !fitted.has(branch.slug) &&
        beingFitted === null &&
        Number(structure.level) >= branch.requiresLevel &&
        Number(state.settlement.resources.fuel?.amount ?? 0) >= branch.fuel,
    );

  /**
   * The least of the camp, among the structures whose next level is unarguably better.
   *
   * The watchtower is deliberately not a candidate. It sits at level 0 in most camps
   * and would therefore be the permanent answer, and whether it is worth anything is a
   * question about wealth that the `undefended` condition already asks properly.
   */
  const lowest = structures
    .filter((structure) => STRUCTURES[structure.kind]?.defencePerLevel === undefined)
    .sort((a, b) => Number(a.level) - Number(b.level))[0];

  const direction = directionFor({
    hasSurvivor: Boolean(state.survivor),
    workshopLevel,
    ranShort: seen[0].ran_short,
    ranLong: seen[0].ran_long,
    everCrafted: seen[0].ever_crafted,
    // The camp as it stands, for the half of the advice that never stops. Stores carry
    // the net rate rather than the gross one, so a forecast off it says what the page
    // says — see the note on `resources` below, which fixed exactly that once already.
    stores: Object.entries(state.settlement.resources).map(([kind, r]) => ({
      kind,
      amount: Number(r.amount),
      cap: Number(r.cap),
      ratePerHour: netRates[kind] ?? 0,
    })),
    wealth: campWealth(structures, state.settlement.resources),
    defence: campDefence(structures),
    upgrade: fittable ? fittable.branch.name : null,
    // The trip, for the one condition that is about the evening rather than the camp.
    // Clamped at zero so an overdue trip reads as no trip: the survivor is effectively
    // home, and telling the player nothing can happen before they are back is false the
    // moment they already are.
    awayHours: expedition
      ? Math.max(0, (new Date(expedition.returnsAt).getTime() - now) / HOUR_MS)
      : null,
    opensBeforeReturn: expedition
      ? openWithin(plans, (new Date(expedition.returnsAt).getTime() - now) / HOUR_MS).filter(
          (plan) => plan.inHours > 0,
        ).length
      : null,
    lowest: lowest
      ? {
          kind: lowest.kind.replaceAll('_', ' '),
          level: Number(lowest.level),
          next: structureEffect(lowest.kind, Number(lowest.level) + 1),
        }
      : null,
    // Named rather than described, so the advice points at a row on the table below it
    // instead of at a duration the player has to go and match up themselves.
    shortestRegion: regions.reduce(
      (best, region) =>
        best === null || Number(region.travel_hours) < Number(best.travel_hours) ? region : best,
      null,
    )?.name,
  });

  return {
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
    // Two numbers, never one: what a raider wants, and what stands in their way.
    wealth: campWealth(structures, state.settlement.resources),
    defence: campDefence(structures),
    // The radio's entire effect. Without it the hour is in the database and none of
    // the player's business; with it, it is the most useful thing on the page.
    raidExpectedAt: fitted.has('radio') ? settlements[0].next_raid_at : null,
    caravan,
    road,
    post,
    standings: Object.entries(FACTIONS).map(([slug, spec]) => ({
      slug,
      name: spec.name,
      standing: standingOf(standings, slug),
    })),
    /**
     * The strip across the top of every view: what hour it is, and what that costs.
     *
     * Outside the five panes deliberately, the way the stores and the Contact box are.
     * The sky block lives on the Camp view and the dispatch table lives on Survivor, so
     * until this existed a player could not see what the weather was doing while choosing
     * where to send somebody — the one moment the answer matters most.
     *
     * Three tiers, and the *mechanic* is never one of them. Without an instrument the
     * band and the direction are still printed, because a cost a player cannot see is a
     * cost they cannot plan around. What fuel buys is precision: the clock sells the hour
     * and the exact turn of the light, the glass sells the temperature and the numbers.
     */
    hour: hourStrip(state, now, fitted, clock, noon),
    /**
     * Where the camp stands — offered once, to a camp that was never actually placed, and
     * `null` for everybody else.
     *
     * Founding places a camp already: registration reads the browser's zone and derives
     * both numbers without asking anything. So this is not a setting, it is a repair, and
     * it is offered to exactly the camps that need repairing — those founded before the
     * derivation existed, and those whose zone the table did not list. Both are standing on
     * the idealised sky by default rather than by choice.
     *
     * Which makes the control self-liquidating: it leaves the game as the last unplaced
     * camp is placed, instead of sitting on the strip for ever offering to re-answer a
     * settled question.
     *
     * Free at every tier when it is offered at all. The clock and the glass sell
     * *precision* — the exact hour, the temperature — and this is not precision, it is the
     * camp knowing where it stands. A player whose sky is eight hours out from their window
     * has a broken game rather than an un-upgraded one, and there is nothing to sell them
     * there.
     */
    place: isPlaced(settlements[0].clock_changed_at)
      ? null
      : { zones: choosableZones(), offset: clock },
    /**
     * The week ahead, and the whole of what the glass is worth its fuel for.
     *
     * Null without it, which the page turns into a line about a thing to go and build
     * rather than into a silence — the radio's rule.
     */
    forecast: fitted.has('glass') ? forecast : null,
    // Weather is visible to everyone: it is the sky, not a secret.
    weather: activeAt(state.worldEvents, now).map((event) => ({
      kind: event.kind,
      name: WORLD_EVENTS[event.kind]?.name ?? event.kind,
      description: WORLD_EVENTS[event.kind]?.description ?? '',
      endsAt: new Date(event.endsAt),
      // What it is actually doing, from the same table the tick multiplies by. The
      // prose says what the sky looks like; this says what it costs.
      effects: effectsOf(event.kind),
    })),
    structures: structures.map((s) => ({
      ...s,
      nextCost: upgradeCost(s.kind, s.level),
      // What the next level is short by, or null when the camp can pay for it.
      shortBy: shortfall(purse, pack, upgradeCost(s.kind, s.level) ?? {}),
      // What it does now and what the next level buys, so the page can answer
      // "why would I upgrade this" without the player working it out themselves.
      effect: structureEffect(s.kind, s.level),
      nextEffect: structureEffect(s.kind, s.level + 1),
      summary: STRUCTURES[s.kind]?.summary ?? '',
      // The fuel branches this structure has, in declaration order. A list because the
      // watchtower has two: the radio and the glass are both things the tower learns.
      upgrades: upgradesFor(s.kind).map((branch) => {
        /*
         * How many of this fitting stand here, and how many this structure may hold.
         *
         * `fitted` is a Set of slugs and stays one, because the clock, the glass, the radio
         * and filtration are all asked "is it there at all" and that is the right question
         * for an instrument. It is the wrong question for a bed: the first one would mark
         * beds fitted for ever and the second could never be offered.
         */
        const standing = installedCounts.get(branch.slug) ?? 0;
        const ceiling = fittingsAllowed(branch.slug, Number(s.level));
        const allowed = fittingsBuildable(branch.slug, Number(s.level), livingCount);

        /*
         * And priced in its own currency. This read `{ fuel: branch.fuel }`, which for a
         * scrap-priced bed passes `{ fuel: undefined }` and reports no shortfall whatever
         * the camp holds — so an unaffordable bed would have shown a button and refused
         * after the click, which is the exact fault this field was added to remove.
         */
        const price = (branch.fuel ?? 0) > 0 ? { fuel: branch.fuel } : { scrap: branch.scrap };

        return {
          ...branch,
          // No room for another, whether because one instrument is enough or because the
          // shelter is not deep enough for a fourth bed.
          fitted: standing >= allowed,
          /*
           * And whether the thing in the way is the camp rather than the structure — a
           * spare bed nobody has come to sleep in yet. Kept apart from `fitted` because the
           * page has to say something different: "fitted" on an empty bed would be a plain
           * falsehood, and the two are undone by two different things.
           */
          waiting: standing >= allowed && allowed < ceiling,
          standing,
          allowed,
          shortBy: shortfall(purse, pack, price),
          fittingUntil: beingFitted?.upgrade === branch.slug ? beingFitted.completes_at : null,
        };
      }),
    })),
    // Builds and fittings share one crew, so either one occupies the queue.
    buildInFlight: structures.some((s) => s.build_completes_at !== null) || beingFitted !== null,
    fallenCount: fallen[0].n,
    events,
    regions,
    /**
     * One line of advice, or nothing. Nothing is the normal state of this field — it
     * speaks to a camp that has not yet run a short walk, crafted anything and taken a
     * long trip, and goes quiet permanently once all three are true.
     */
    direction,
    /**
     * What the camp can do next, and when — soonest first.
     *
     * The answer to the question the page could not previously be asked: *is there
     * anything to do?* Rendered while a trip is out, where it matters most, but derived
     * unconditionally because the dispatch table needs the same list to say what each
     * trip length costs you in idle hours.
     */
    plans,
    inventory,
    recipes: recipes.map((recipe) => ({
      ...recipe,
      shortBy: shortfall(purse, pack, recipe.costs ?? {}, recipe.inputs ?? []),
    })),
    // What the bench can take on is gated by the workshop, so the page has to know
    // its level to explain why a recipe has no button rather than just hiding it.
    workshopLevel: Number(structures.find((s) => s.kind === 'workshop')?.level ?? 0),
    craft: onTheBench[0]
      ? { name: onTheBench[0].name, completesAt: onTheBench[0].completes_at }
      : null,
    expedition,
    survivor: state.survivor
      ? {
          ...state.survivor,
          name: survivorRow[0]?.name,
          /*
           * What their two numbers buy, as figures.
           *
           * This was `knownFor` — a sentence matched back from the content by name, saying
           * things like "comes back heavy, and should not linger where the counter climbs".
           * It gave the sign of both skills and the size of neither, which is the half a
           * player cannot act on: ×1.3 and ×0.7 read as the same sentence, and so do a dose
           * that bites at 45 and one that bites at 75.
           *
           * Derived in `wanderers.js` from the same functions the simulation reads, so the
           * page cannot advertise a haul the roll does not pay.
           */
          skills: skillsOf(state.survivor, CONFIG.radThreshold),
        }
      : null,
    /**
     * Who is at the gate, when nobody is holding the camp.
     *
     * Derived exactly as `raiseSuccessor` will derive them, so the page cannot show one
     * person and the button admit a different one. The two count different things —
     * `raiseSuccessor` counts every row in `characters`, this counts `character_history`,
     * which is the same table filtered to `died_at is not null` — and they agree for the
     * one state in which either is asked: a camp with nobody in it has no living row, so
     * every character it has ever had is a dead one. A test pins that the page and the
     * button name the same person, because the reasoning is sound and invisible.
     */
    /*
     * Somebody at the gate of a camp that already has people in it.
     *
     * A bed is what makes room and the hour is what makes it a moment: the first eight in
     * the morning after the bed was ready, on this camp's own clock. You build it in the
     * evening and meet them over breakfast, which is the rhythm the per-camp clock was added
     * for and the first thing to actually use it.
     *
     * They wait once they are there. The alternative — present only between eight and nine
     * — would punish a player for checking in at the wrong hour, which is the failure the
     * whole check-in design is arranged against.
     *
     * Null when the camp is empty: that is succession and goes through `arriving` below,
     * which halves what is left because a camp nobody held has been standing open.
     */
    atTheGate: (() => {
      if (!state.survivor || bedsFree <= 0 || newestBedAt === null) return null;

      const due = gateOpensAt(newestBedAt, clock);
      if (now < due) return { dueAt: new Date(due), wanderer: null };

      /*
       * The same `taken` the service passes. `wandererFor` will not offer somebody the camp
       * already holds, and the two have to agree about who that is — a page naming one
       * person and a service admitting another is the same class of fault as the count.
       */
      const who = wandererFor(settlements[0].caravan_seed, everHeld, {
        taken: (state.survivors ?? []).map((one) => one.name).filter(Boolean),
      });
      return { dueAt: new Date(due), wanderer: { ...who, skills: skillsOf(who, CONFIG.radThreshold) } };
    })(),
    arriving: state.survivor
      ? null
      : (() => {
          // The same figures the survivor block shows, so what the gate promises is what
          // the camp delivers. `skillsOf` takes either shape: a wanderer spec carries
          // `scavenging`/`medicine`, a character row carries `skill_*`.
          const who = wandererFor(settlements[0].caravan_seed, Number(fallen[0].n));
          return { ...who, skills: skillsOf(who, CONFIG.radThreshold) };
        })(),
    // What those numbers are doing to them. Null with nobody in the camp, because a
    // camp with no survivor has no strain, only an empty chair.
    /**
     * Everybody in the camp, each with what their own block needs.
     *
     * `survivor`, `strain` and `inventory` stay beside it as the first of them, because the
     * rest of the page still reads them and moving 26 call sites in the same change as
     * building the roster would be two risks in one commit.
     *
     * A person's trip is here rather than in a stack of its own — the decision on
     * 2026-08-31: Vera's block says where Vera is, so "what is Vera doing" is one place.
     */
    roster: (state.survivors ?? []).map((person) => {
      const trip = (state.expeditions ?? []).find(
        (one) => one.status === 'active' && one.characterId === person.id,
      );

      return {
        id: person.id,
        name: person.name,
        health: person.health,
        hunger: person.hunger,
        radiation: person.radiation,
        skills: skillsOf(person, CONFIG.radThreshold),
        // Phase 10's gauge, and the reason the column stopped being dead schema.
        stamina: Number(person.stamina),
        strain: strainOf(person, radDecayPerHour),
        /*
         * And what is acting on each gauge for *this* person in *this* hour.
         *
         * `fedShort` is read from the state the tick just wrote rather than predicted:
         * hunger above zero on a camp that is drawing means the stores did not meet the
         * draw, which is the same fact the simulation acted on and not a second guess at it.
         */
        drivers: driversFor(person, {
          working: workingAt(state, person),
          resting: workingAt(state, person) === null && Number(person.stamina) < 100,
          fedShort: Number(person.hunger) > 0,
          radScrubbing: fitted.has('filtration'),
          strain: strainOf(person, radDecayPerHour),
          config: CONFIG,
        }),
        inventory: packsByOwner.get(Number(person.id)) ?? [],
        // What they are doing, in the words the refusals use, so a block and a refusal
        // cannot describe the same person differently.
        // Kept as two flat fields rather than the map's object, because everything that
        // reads `busy` reads it as "is this person free" — a truthy object would keep
        // working and a rendered one would print [object Object] the first time somebody
        // forgot which it was.
        busy: busyBy.get(Number(person.id))?.kind ?? null,
        busyWith: busyBy.get(Number(person.id))?.what ?? null,
        away: trip
          ? {
              regionName: trip.region.name,
              regionSlug: trip.region.slug,
              returnsAt: new Date(trip.returnsAt),
              // What this trip has done to them so far, which is the whole reason the
              // report belongs in their block rather than in a stack of its own.
              report: reports.get(Number(person.id)) ?? null,
            }
          : null,
      };
    }),
    strain: state.survivor ? strainOf(state.survivor, radDecayPerHour) : null,
    // What the three gauges are counting and what moves them. Null with nobody in the
    // camp, for the same reason as the strain: there are no gauges to explain.
    vitals: state.survivor ? vitalsOf(radDecayPerHour) : null,
    /**
     * The rate a player can act on: what the stores will actually do next hour.
     *
     * This used to report gross production, which was wrong in two directions at
     * once. It ignored the survivor eating — a level 1 garden reads +1.2 while the
     * camp nets +0.7 — and it ignored the weather, so during a blight the page
     * promised +1.2 food/h while the true figure was 0.42 gross and *negative* once
     * the survivor was fed. A number that says food is climbing while it falls is
     * worse than no number.
     */
    resources: Object.entries(state.settlement.resources).map(([kind, r]) => ({
      kind,
      amount: r.amount,
      cap: r.cap,
      ratePerHour:
        (rates[kind] ?? 0) * (weatherFactors[kind] ?? 1) - (eats[kind] ?? 0),
      /**
       * The three numbers the rate above is made of.
       *
       * The structure list advertises what a *building* produces — `perLevel × level`,
       * with no weather in it and nobody eating — because that is the figure the upgrade
       * decision turns on. This line reports what the *camp* does. Both are right and they
       * disagree by exactly the survivor, which reads as a contradiction until somebody
       * takes the sum apart. So the page takes it apart.
       *
       * It matters more than the half a unit suggests. During a blight the garden goes on
       * advertising its fair-weather rating while the stores fall, and then the gap is
       * several units rather than 0.5 — the same confusion with a much larger number in
       * it.
       *
       * Sent as parts rather than as sentences: the arithmetic belongs here beside the
       * arithmetic it explains, and the words belong in the renderer.
       */
      breakdown: {
        from: producerOf(kind),
        gross: rates[kind] ?? 0,
        weather: weatherFactors[kind] ?? 1,
        eaten: eats[kind] ?? 0,
      },
    })),
  };
}
