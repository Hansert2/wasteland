import { newSeed } from '../game/random.js';
import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';
import { CONFIG } from '../game/constants.js';
import { shortcutsFrom, travelHoursFor } from '../game/road.js';

/** "45m", "6h", "6h 30m" — the same reading the dispatch table gives the same number. */
function formatHours(hours) {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Send the survivor out. The outcome is not decided here — only the seed it will
 * later be rolled from, and the hour they are due back.
 *
 * Nothing about the trip is computed at dispatch time, because the player may not
 * return to the page for days and the result has to be derived from elapsed time
 * like everything else.
 */
/**
 * @param {string|number} [who] which survivor goes. Omitted means the first who is free,
 *   which is what every caller written before the roster meant by "the survivor".
 */
export async function dispatchExpedition(
  client,
  settlementId,
  regionSlug,
  now = Date.now(),
  who = null,
) {
  const { rows: characters } = await client.query(
    `select id, name, stamina from characters
      where settlement_id = $1 and died_at is null order by born_at, id`,
    [settlementId],
  );
  if (characters.length === 0) throw new InputError('There is nobody here to send.');

  /*
   * Who goes, and whether they can.
   *
   * A survivor who is building cannot leave, and two who are both free can both go — so
   * being busy is a fact about the person rather than about the camp. This refused a second
   * trip by asking whether *this* character was already out, which was the same question
   * while a camp held one person and is the wrong one now: it would have let somebody walk
   * out of a half-built shelter.
   *
   * Named rather than picked when the caller says so. Without a name it takes the first free
   * survivor, which is what "the survivor" meant everywhere this was called from before the
   * roster existed and keeps those callers honest.
   */
  const busy = await occupations(client, settlementId, now);

  const character =
    who == null
      ? characters.find((one) => !busy.has(Number(one.id))) ?? characters[0]
      : characters.find((one) => String(one.id) === String(who));

  if (!character) throw new InputError('Nobody here answers to that.');
  mustBeFree(busy, character, 'go anywhere');

  const { rows: regions } = await client.query(
    'select id, slug, name, travel_hours, requires_link from regions where slug = $1',
    [String(regionSlug ?? '')],
  );
  const region = regions[0];
  if (!region) throw new InputError('There is no such place on the map.');

  /*
   * How far it actually is for *this* camp.
   *
   * Three of the road's links are shortcuts rather than destinations — they open nowhere and
   * take a fifth off a walk the camp already makes. So the distance to a place is a fact
   * about the camp as well as about the map, and this is where that is decided: the gate
   * writes `returns_at`, and everything afterwards reads the trip's own ends.
   */
  const { rows: reachedLinks } = await client.query(
    `select link_index from road_links
      where settlement_id = $1 and completed_at is not null`,
    [settlementId],
  );
  const shortened = shortcutsFrom(reachedLinks.map((row) => Number(row.link_index)));
  const travelHours = travelHoursFor(region.slug, Number(region.travel_hours), shortened);

  // A place the road has not reached yet is refused here and not only hidden on the
  // page, for the reason written above the pack check in answerMoment: the page is a
  // render of a moment ago, and a form is whatever was posted to it. The page leading a
  // refusal is what makes the refusal unreachable from an honest click, not what makes
  // it unnecessary.
  if (region.requires_link !== null) {
    const { rows: link } = await client.query(
      `select 1 from road_links
        where settlement_id = $1 and link_index = $2 and completed_at is not null`,
      [settlementId, Number(region.requires_link)],
    );
    if (link.length === 0) {
      throw new InputError(`There is no road to ${region.name} yet.`);
    }
  }

  /*
   * And whether they have a day's walk in them, which is the whole of what stamina gates.
   *
   * A gauge matters if it decides what you may do next — that is the finding Phase 10 rests
   * on, and it is why health gates nothing: the game guarantees a healthy survivor cannot
   * die on a trip, so sixty health and a hundred permit exactly the same moves. Radiation
   * gates, and now this does.
   *
   * The refusal is "not enough for *this* trip" rather than a floor, because the cost is a
   * rate: the Fence Line is ten minutes and the Deep Zone is most of a day. Somebody too
   * tired for the far place is not too tired to walk to the wire, which is the decision the
   * gauge exists to create — where a flat threshold would only ever say "wait".
   *
   * Checked here rather than only hidden on the page for the reason written above the road
   * check: the page is a render of a moment ago and a form is whatever was posted to it.
   */
  const needed = CONFIG.staminaPerHourWorked * travelHours;
  const held = Number(character.stamina);
  if (held < needed) {
    const spare = Math.floor(held / CONFIG.staminaPerHourWorked);
    throw new InputError(
      `${character.name ?? 'They'} has about ${spare}h of walking left and ${region.name} ` +
        `is ${formatHours(travelHours)} out. Let them rest.`,
    );
  }

  const returnsAt = new Date(now + travelHours * HOUR_MS);

  /*
   * The sky the trip is leaving under, frozen onto the trip — see migration 017.
   *
   * Daylight multiplies finds, and `returnExpedition` integrates it between departure and
   * return. Reading the camp's clock at resolution instead would let a player who can set
   * their own timezone send somebody out at dusk and collect at dawn, which is the same
   * shape as the sky exploit of 2026-08-27. Stored with the trip, like `departed_at` and
   * `seed`, so it replays exactly whatever the camp does afterwards.
   */
  const { rows: camp } = await client.query(
    'select clock_offset_minutes, solar_noon_minutes from settlements where id = $1',
    [settlementId],
  );

  const { rows } = await client.query(
    `insert into expeditions (character_id, region_id, departed_at, returns_at, seed,
                              clock_offset_minutes, solar_noon_minutes)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      character.id,
      region.id,
      new Date(now),
      returnsAt,
      newSeed(),
      camp[0]?.clock_offset_minutes ?? 0,
      camp[0]?.solar_noon_minutes ?? 720,
    ],
  );

  return { expeditionId: rows[0].id, returnsAt, regionName: region.name };
}
