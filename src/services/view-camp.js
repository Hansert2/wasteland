import { advanceSettlement } from './advance-settlement.js';
import {
  WORLD_EVENTS,
  activeAt,
  deriveEventsBetween,
  effectsOf,
  expeditionFactors,
  productionFactors,
} from '../game/world-events.js';
import {
  climateAt,
  DAY_REACH,
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
import { WANDERERS, radThresholdFor, wandererFor } from '../game/wanderers.js';
import { stateAt, timelineOf } from '../game/timeline.js';
import { CONFIG } from '../game/constants.js';
import { radDamagePerHourAt } from '../game/tick.js';
import { LINKS, TRADE_POST_LINKS, linkCost, linkGives, neighbourFor } from '../game/road.js';
import { WORLD_SEED, loadWorldEvents } from '../db/world-events.js';
import { FACTIONS, caravanVisit, postKeeper, priceAt, standingOf } from '../game/factions.js';
import {
  STRUCTURES,
  UPGRADES,
  campDefence,
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
function hourStrip(state, now, fitted) {
  const active = activeAt(state.worldEvents, now);
  const time = worldTimeAt(now);
  const lit = isLit(now);

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
        nextBandChange(now),
        nextTurnOfLight(now),
        hasGlass ? nextDegreeChange(state.worldEvents ?? [], now) : Infinity,
      ),
    ),
    turnsHour: hasClock ? worldTimeAt(nextTurnOfLight(now)).hour : null,
    turnsMinute: hasClock ? worldTimeAt(nextTurnOfLight(now)).minute : null,
    turning: lit ? 'sunset' : 'sunrise',
    roughly: hasClock ? null : roughLight(now, lit),

    // The glass: the temperature, and the sun's numbers rather than its direction.
    glass: hasGlass,
    temperature: hasGlass ? Math.round(temperatureAt(now, active)) : null,
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
async function forecastOf(client, now, offset) {
  const { from, to: until } = dayWindow(now, offset);

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

  const series = forecastSeries(events, from, until);
  const degrees = series.map((point) => point.degrees);

  return {
    from: new Date(from),
    until: new Date(until),
    // Null on any day but the one being lived: a marker for "now" on Thursday's chart
    // while it is Tuesday would be a line pointing at nothing.
    now: now >= from && now < until ? new Date(now) : null,
    offset,
    canGoBack: offset > -DAY_REACH,
    canGoOn: offset < DAY_REACH,
    series: series.map((point) => ({
      at: point.at,
      degrees: Math.round(point.degrees * 10) / 10,
      lit: point.lit,
    })),
    dark: darkSpansBetween(from, until),
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
      const { sunrise, sunset } = sunAt(from);
      return [
        { kind: 'sunrise', at: from + sunrise * HOUR_MS },
        { kind: 'sunset', at: from + sunset * HOUR_MS },
      ].map((turn) => ({
        ...turn,
        hour: worldTimeAt(turn.at).hour,
        minute: worldTimeAt(turn.at).minute,
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
function nextTurnOfLight(now) {
  const today = Math.floor(now / DAY_MS) * DAY_MS;

  for (const day of [today, today + DAY_MS]) {
    const { sunrise, sunset } = sunAt(day);
    for (const hour of [sunrise, sunset]) {
      const at = day + hour * HOUR_MS;
      if (at > now) return at;
    }
  }

  return now;
}

/** How much of the day is left, for a camp with no clock to read it off. */
function roughLight(now, lit) {
  const hours = (nextTurnOfLight(now) - now) / HOUR_MS;

  if (!lit) return hours < 2 ? 'the sky is going grey' : 'a long way from light';
  if (hours < 1) return 'the light is nearly gone';
  if (hours < 3) return 'not long before dark';
  return 'hours yet before dark';
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
    weather: travelFactors(overTheTrip, departedAt, returnsAt),
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
    `select name, founded_at, next_raid_at, caravan_seed, caravan_count, next_caravan_at
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
            e.returns_at, e.departed_at, e.seed, e.choices
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

  const { rows: inventory } = await client.query(
    `select i.slug, i.name, i.kind, ii.qty
       from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is null and ii.qty > 0
      order by i.name`,
    [settlementId],
  );

  const { rows: upgradeRows } = await client.query(
    'select kind, upgrade, completes_at, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );
  const fitted = new Set(
    upgradeRows.filter((row) => row.installed_at !== null).map((row) => row.upgrade),
  );
  const beingFitted = upgradeRows.find((row) => row.installed_at === null) ?? null;

  // Only when there is a glass to read it with: the query is cheap and the derivation is
  // cheaper, but a camp that cannot see the week should not be paying for a week's rows.
  const forecast = fitted.has('glass')
    ? await forecastOf(client, now, clampDay(day))
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
  const eats = state.survivor
    ? { food: CONFIG.foodPerHour, water: CONFIG.waterPerHour }
    : {};

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
    hour: hourStrip(state, now, fitted),
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
      upgrades: upgradesFor(s.kind).map((branch) => ({
        ...branch,
        fitted: fitted.has(branch.slug),
        shortBy: shortfall(purse, pack, { fuel: branch.fuel }),
        fittingUntil: beingFitted?.upgrade === branch.slug ? beingFitted.completes_at : null,
      })),
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
          // What this one is, matched back from the content by name. Not stored on the
          // character: the skills are, and they are what the simulation reads — this is
          // only the sentence that explains them, and a row that cached it would be a
          // second copy of a string to keep in step.
          knownFor: WANDERERS.find((w) => w.name === survivorRow[0]?.name)?.knownFor ?? null,
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
    arriving: state.survivor
      ? null
      : wandererFor(settlements[0].caravan_seed, Number(fallen[0].n)),
    // What those numbers are doing to them. Null with nobody in the camp, because a
    // camp with no survivor has no strain, only an empty chair.
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
    })),
  };
}
