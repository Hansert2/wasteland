import { makeRandom, intBetween, chance, mix } from './random.js';
import { equipmentOf } from './equipment.js';
import { EFFECTS_SALT, momentsFor } from './moments.js';
import { standingOf } from './factions.js';
import { stateAt, timelineOf } from './timeline.js';

/**
 * What a trip into a region produced. Pure: no clock, no database, no global
 * randomness — everything is derived from the seed the expedition was dispatched with.
 *
 * @param {object} args
 * @param {object} args.region   danger, loot ranges, finds, radiation
 * @param {object} args.survivor health, scavenging skill and pack at the moment of return
 * @param {number} args.seed
 * @param {{loot: number, radiation: number}} [args.weather] world events in force
 * @param {{index: number, option: string}[]} [args.choices] answers to the trip's moments
 * @param {Record<string, number>} [args.standings] standing per faction, for a parley
 */
export function resolveExpedition({ region, survivor, seed, weather, choices, standings }) {
  const random = makeRandom(seed);
  const log = [];

  // Gear shifts thresholds, never the number of draws taken from the generator. That
  // is what keeps an unarmed trip identical to what it rolled before crafting existed.
  const equipment = equipmentOf(survivor);

  // The sky follows the same rule for the same reason: it scales what a roll produced
  // and never how many rolls were taken, so a trip under clear skies is identical to
  // one taken before there was such a thing as weather.
  const sky = { loot: 1, radiation: 1, ...weather };

  const loot = rollLoot(random, region, survivor, sky, log);
  const finds = rollFinds(random, region, log);
  const radiation = rollRadiation(random, region, sky, log);
  const { damage, cause } = rollHazard(random, region, equipment, log);

  const trip = applyChoices(
    { loot, finds, radiation, damage, cause, healed: 0, log },
    { region, survivor, seed, choices, standings },
  );

  // Death is decided here rather than left to the tick, because the survivor has to
  // die of what happened out there — "mauled in the Deep Zone", not "starvation" at
  // whatever the camp's food happened to be that hour.
  //
  // Anything they ate out there counts towards surviving it, and is capped at full
  // health the same way the tick caps it. Without that, this and the tick would
  // disagree: a survivor could be declared dead here and walk home there.
  const mended = Math.min(100, Number(survivor.health) + trip.healed);
  const died = trip.damage >= mended;
  if (died) {
    trip.log.push(`They did not make it back from ${region.name}.`);
  } else if (trip.damage > 0) {
    trip.log.push(`They limped home.`);
  } else {
    trip.log.push(`They returned from ${region.name} without incident.`);
  }

  return {
    loot: trip.loot,
    finds: trip.finds,
    radiation: trip.radiation,
    damage: trip.damage,
    healed: trip.healed,
    died,
    cause: died ? trip.cause : null,
    log: trip.log,
  };
}

/**
 * What the player's answers did to a trip that had already been rolled.
 *
 * **Nothing here touches the generator above.** Consequences draw from
 * `mix(seed, 'effects')`, a third stream beside the one the outcome was rolled with and
 * the one the moments were placed with, so a trip nobody attended is identical to one
 * taken before any of this existed — roll for roll, not merely in total.
 *
 * With no answers this returns the trip it was handed, untouched and without opening a
 * generator at all. That early return is not an optimisation; it is the guarantee.
 *
 * Effects are measured against the timeline **as it was rolled**, not as it stands after
 * an earlier choice. Pressing on twice therefore adds a bonus over the same original
 * remainder each time rather than compounding, which is both simpler to reason about and
 * the conservative reading — the alternative lets two choices multiply into a haul no
 * region ever offered.
 *
 * The numbers on the options themselves are provisional; see `src/game/moments.js`.
 */
function applyChoices(trip, { region, survivor, seed, choices, standings }) {
  if (!choices || choices.length === 0) return trip;

  const moments = momentsFor(region, seed);
  if (moments.length === 0) return trip;

  const travelHours = Number(region?.travelHours) || 0;
  const timeline = timelineOf({ outcome: trip, travelHours, seed });
  const random = makeRandom(mix(seed, EFFECTS_SALT));
  const equipment = equipmentOf(survivor);

  // Index order, not the order they were answered in: the trip happened in the order the
  // hours did, and a replay must not depend on how quickly somebody clicked.
  const answered = [...choices].sort((a, b) => a.index - b.index);

  for (const answer of answered) {
    const moment = moments[answer.index];
    if (!moment) continue;

    // An answer names the moment it answered. If the content has moved under a trip in
    // flight, the position still resolves but the name does not, and the answer is
    // dropped rather than applied to whatever took its place. Answers written before
    // this carried no name and are trusted by position, which is what they were.
    if (answer.key && moment.key !== answer.key) continue;

    const option = moment.options.find((candidate) => candidate.key === answer.option);
    if (!option || option.verb === 'default') continue;

    const at = stateAt(timeline, moment.atHour);

    if (option.turnBack) {
      turnBack(trip, at, moment);
      return trip;
    }

    // Where this moment's account of itself starts, so it can be signed afterwards.
    // Above the hazard clause rather than below it: dodging what was waiting further on
    // is the first thing an answer can narrate, and was the one line this missed.
    const from = trip.log.length;

    if (option.clearsHazard && timeline.hazard && timeline.hazard.atHour > moment.atHour) {
      trip.damage -= timeline.hazard.damage;
      trip.cause = null;
      trip.log.push('Whatever was waiting further on never found them.');
    }

    if (option.dropsCarried) spill(trip, at, option.dropsCarried);
    if (option.lootFactor) pressOn(trip, timeline, at, option.lootFactor);
    if (option.radiationFactor) shelter(trip, timeline, at, option.radiationFactor);
    if (option.heals) {
      trip.healed += option.heals;
      trip.log.push('They ate, and walked better for it.');
    }
    if (option.findChance) {
      investigate(trip, region, random, option.findChance, option.finding);
    }
    if (option.parley) {
      parley(trip, timeline, at, random, standingOf(standings ?? {}, moment.faction));
    }
    if (option.hazard) confront(trip, random, equipment, option.hazard.danger);

    attribute(trip, moment, from);
  }

  trip.damage = Math.max(0, Math.round(trip.damage));
  return trip;
}

/** Bank what the timeline says is in the pack, and leave the rest out there. */
function turnBack(trip, at, moment) {
  trip.loot = at.carrying;
  trip.finds = at.finds;
  trip.radiation = at.radiation;
  trip.damage = at.damage;
  trip.cause = at.cause;
  trip.log.push(`They turned back ${formatHours(moment.atHour)} in, carrying what they had.`);
}

/**
 * Lose a share of what is already in the pack.
 *
 * The mirror of pressing on, and the reason it exists: every other option that costs
 * something costs it out of the *rest* of the trip, which is a cost you can only feel
 * at the end. This one takes what they are visibly carrying right now, which is the
 * only kind of loss a mid-trip report can make you flinch at.
 */
function spill(trip, at, share) {
  let lost = 0;

  for (const [kind, carried] of Object.entries(at.carrying)) {
    const gone = Math.round(carried * share);
    if (gone <= 0) continue;
    trip.loot[kind] = Math.max(0, (trip.loot[kind] ?? 0) - gone);
    lost += gone;
  }

  trip.log.push(
    lost > 0 ? `They lost ${lost} of what they were carrying.` : 'They kept hold of it.',
  );
}

/** A share of what the rest of the trip would have produced, on top of it. */
function pressOn(trip, timeline, at, factor) {
  let gained = 0;

  for (const [kind, total] of Object.entries(timeline.loot)) {
    const remaining = total - (at.carrying[kind] ?? 0);
    const bonus = Math.round(remaining * (factor - 1));
    if (bonus === 0) continue;
    trip.loot[kind] = Math.max(0, (trip.loot[kind] ?? 0) + bonus);
    gained += bonus;
  }

  if (gained > 0) trip.log.push(`They came away with ${gained} more than they should have.`);
}

/** Scale only the dose they had not taken yet. What is in them is in them. */
function shelter(trip, timeline, at, factor) {
  const remaining = timeline.radiation - at.radiation;
  if (remaining <= 0) return;

  trip.radiation = Math.round((at.radiation + remaining * factor) * 10) / 10;
  trip.log.push(`They sat out the worst of it — ${trip.radiation} rads instead of ${timeline.radiation}.`);
}

/**
 * One extra roll on whatever this region has to find.
 *
 * **The narration is the option's, not this function's.** These two lines were written
 * for the welded door — "whatever was behind it", "behind it: three parts" — and then
 * `findChance` turned out to be the natural way to price a shot at something on options
 * that have no *it* to be behind. Helping a stranger to their feet reported that
 * whatever was behind them was not worth the hours, which reads as a bug and is one.
 *
 * So an option that draws a find says how a find reads for it, and the door's own words
 * are the fallback rather than the rule. A test holds the line: any option drawing a
 * find outside the `investigate` verb has to bring its own.
 */
function investigate(trip, region, random, probability, words = {}) {
  const missed = words.missed ?? 'Whatever was behind it was not worth the hours.';
  const found = words.found ?? ((what) => `Behind it: ${what}.`);

  const table = region.finds ?? [];
  if (table.length === 0 || !chance(random, probability)) {
    trip.log.push(missed);
    return;
  }

  const find = table[Math.floor(random() * table.length)];
  const [min, max] = find.qty ?? [1, 1];
  const qty = intBetween(random, min, max);
  if (qty <= 0) return;

  trip.finds.push({ slug: find.slug, qty });
  trip.log.push(found(`${qty} × ${find.slug.replaceAll('_', ' ')}`));
}

/**
 * Whoever is out there, and what they make of the camp.
 *
 * Standing decides it, which is what puts the rivalry out on the road rather than only
 * at the gate. Provisional thresholds — like every other number in this phase, these
 * want measuring before anybody believes them.
 */
function parley(trip, timeline, at, random, standing) {
  if (standing <= -25) {
    const taken = Math.round((at.carrying.scrap ?? 0) * 0.25);
    if (taken > 0) {
      trip.loot.scrap = Math.max(0, (trip.loot.scrap ?? 0) - taken);
      trip.log.push(`They knew the camp, and did not think much of it — ${taken} scrap lighter.`);
    } else {
      trip.log.push('They knew the camp, and did not think much of it.');
    }
    return;
  }

  const share = standing >= 25 ? 0.15 : 0.05;
  let gained = 0;

  for (const [kind, total] of Object.entries(timeline.loot)) {
    const bonus = Math.round((total - (at.carrying[kind] ?? 0)) * share);
    if (bonus === 0) continue;
    trip.loot[kind] = (trip.loot[kind] ?? 0) + bonus;
    gained += bonus;
  }

  trip.log.push(
    gained > 0
      ? 'They shared what they could spare, and pointed out the good ground.'
      : 'They shared a fire and little else.',
  );
}

/** Settle it now, at whatever health they have. */
function confront(trip, random, equipment, danger) {
  const raw = intBetween(random, danger * 3, danger * 9);
  const damage = Math.round(raw * equipment.damageMultiplier);

  trip.damage += damage;
  if (damage > 0 && !trip.cause) trip.cause = 'what was following them';
  trip.log.push(`They stopped and dealt with it — ${damage} damage.`);
}

/**
 * Say which moment an outcome came out of.
 *
 * The player answered a situation and then read, some hours later, a line of narration
 * with nothing tying it to the thing they answered — so a decision they made arrived
 * home anonymous, indistinguishable from the trip happening to them. The title and the
 * hour are the whole fix; only the first line is signed, because the rest are the same
 * account continuing.
 *
 * **A sentence of its own, rather than a clause joined onto the line it signs.** Three
 * of these narrations already carry an em dash of their own and one already carries a
 * colon, so any joining punctuation collides with something: "they sat out the worst of
 * it — 9.8 rads instead of 25.8" signed with a dash reads as two thoughts fighting.
 * Signing as a separate sentence also leaves the line it signs exactly as written.
 *
 * Turning back signs itself, in `turnBack`, and never reaches here.
 */
function attribute(trip, moment, from) {
  if (trip.log.length === from) return;
  trip.log[from] = `${moment.title}, ${formatHours(moment.atHour)} in. ${trip.log[from]}`;
}

/**
 * Hours in words, and minutes when hours would round to none.
 *
 * The rounding was written when only the five long regions had moments, so the worst
 * case was "2 hours". Short regions now have them too: a moment a fifth of the way into
 * the forty-five minute Service Road is 0.15 hours, and this said "0 hours in".
 */
function formatHours(hours) {
  if (hours < 0.9) return `${Math.max(1, Math.round(hours * 60))} minutes`;
  const rounded = Math.round(hours);
  return rounded === 1 ? 'an hour' : `${rounded} hours`;
}

function rollLoot(random, region, survivor, sky, log) {
  const loot = {};
  // Scavenging is worth a tenth more per level over the first.
  const skill = 1 + (Math.max(1, survivor.skillScavenging ?? 1) - 1) * 0.1;

  for (const [kind, [min, max]] of Object.entries(region.loot ?? {})) {
    const amount = Math.round(intBetween(random, min, max) * skill * sky.loot);
    if (amount > 0) {
      loot[kind] = amount;
      log.push(`Scavenged ${amount} ${kind}.`);
    }
  }

  if (Object.keys(loot).length === 0) log.push('They came back empty-handed.');
  return loot;
}

function rollFinds(random, region, log) {
  const finds = [];

  for (const find of region.finds ?? []) {
    if (!chance(random, find.chance)) continue;
    const [min, max] = find.qty ?? [1, 1];
    const qty = intBetween(random, min, max);
    if (qty <= 0) continue;

    finds.push({ slug: find.slug, qty });
    log.push(`Found ${qty} × ${find.slug.replaceAll('_', ' ')}.`);
  }

  return finds;
}

function rollRadiation(random, region, sky, log) {
  const base = Number(region.radiationPerTrip ?? 0);
  if (base <= 0) return 0;

  // Half to one and a half times the region's nominal dose, and more under a storm.
  const dose = Math.round(base * (0.5 + random()) * sky.radiation * 10) / 10;
  if (dose > 0) log.push(`Took ${dose} rads out there.`);
  return dose;
}

function rollHazard(random, region, equipment, log) {
  const danger = Number(region.danger ?? 1);

  // A weapon lowers the odds of trouble rather than winning the fight afterwards:
  // something that keeps its distance is something you never had to fight.
  if (!chance(random, danger * 0.09 * equipment.hazardMultiplier)) {
    return { damage: 0, cause: null };
  }

  const raw = intBetween(random, danger * 3, danger * 9);
  const damage = Math.round(raw * equipment.damageMultiplier);
  const cause = HAZARDS[Math.min(danger, HAZARDS.length) - 1];

  if (equipment.armour && damage < raw) {
    const worn = String(equipment.armour.id ?? 'armour').replaceAll('_', ' ');
    log.push(`${capitalise(cause)} — ${damage} damage; the ${worn} took the rest.`);
  } else {
    log.push(`${capitalise(cause)} — ${damage} damage.`);
  }

  return { damage, cause };
}

const HAZARDS = [
  'a bad fall',
  'a scavenger ambush',
  'a collapsing floor',
  'something in the dark',
  'the Deep Zone itself',
];

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
