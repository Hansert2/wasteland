import { UPGRADES, fittingsAllowed, fittingsBuildable } from '../game/structures.js';
import { InputError } from '../errors.js';
import { occupations, mustBeFree } from './who-is-free.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Fit a structure upgrade — the fuel track.
 *
 * Scrap makes a structure bigger and fuel makes it do something new, and the two
 * currencies are not interchangeable: nothing in the camp produces fuel, so it can
 * only be earned by sending someone out. Paying in fuel means paying in risk.
 *
 * Fitting is building work, so it shares the build queue rather than getting one of
 * its own. It is one crew, and choosing what they work on next is the game. That
 * makes this the mirror of `startBuild` in every respect except the currency and the
 * fact that an upgrade has no levels — the camp either has the capability or it does
 * not, which is what stops the fuel track becoming a second grind alongside the first.
 */
/**
 * @param {string|number} [who] whose hands, as `startBuild`.
 */
export async function startUpgrade(
  client,
  settlementId,
  upgradeSlug,
  now = Date.now(),
  who = null,
) {
  const slug = String(upgradeSlug ?? '');
  const spec = UPGRADES[slug];
  if (!spec) throw new InputError('Nobody here knows how to fit that.');

  // Starting work needs hands, even though finishing does not.
  const { rows: living } = await client.query(
    'select id, name from characters where settlement_id = $1 and died_at is null order by born_at, id',
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to fit it.');



  const { rows: existing } = await client.query(
    'select upgrade, ordinal, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );

  const standing = existing.filter((row) => row.upgrade === slug && row.installed_at !== null);

  const fitting = existing.find((row) => row.installed_at === null);
  if (fitting) {
    const name = UPGRADES[fitting.upgrade]?.name ?? fitting.upgrade;
    throw new InputError(`The crew is already fitting the ${name.toLowerCase()}.`);
  }

  // The shared queue, seen from this side: a build in flight occupies the same crew.
  const { rows: structures } = await client.query(
    'select kind, level, build_completes_at from camp_structures where settlement_id = $1',
    [settlementId],
  );

  const building = structures.find((s) => s.build_completes_at !== null);
  if (building) {
    throw new InputError(`The ${building.kind.replaceAll('_', ' ')} is already being worked on.`);
  }

  // After the crew's own rule, for the reason `start-build` gives: a build and a fitting
  // share one crew, and that refusal names the job rather than the person.
  /*
   * Whose hands, because fitting occupies them exactly as building does — a survivor at the
   * purifier with a filter in pieces is not going anywhere.
   */
  const busy = await occupations(client, settlementId, now);
  const fitter =
    who == null
      ? living.find((one) => !busy.has(Number(one.id)))
      : living.find((one) => String(one.id) === String(who));

  if (!fitter) {
    if (who != null) throw new InputError('Nobody here answers to that.');

    /*
     * Nobody free, and on a camp of one "everybody here is already busy" is a worse sentence
     * than naming them: there is one person, the player knows who, and what they want to know
     * is what that person is doing instead. `mustBeFree` says it.
     */
    if (living.length === 1) mustBeFree(busy, living[0], 'fit anything');
    throw new InputError('Everybody here is already busy with something.');
  }
  mustBeFree(busy, fitter, 'fit anything');

  const host = structures.find((s) => s.kind === spec.kind);
  const level = Number(host?.level ?? 0);

  if (level < spec.requiresLevel) {
    const name = spec.kind.replaceAll('_', ' ');
    throw new InputError(`That needs a ${name} at level ${spec.requiresLevel}.`);
  }

  /*
   * How many the structure may hold, which for everything but a bed is one.
   *
   * This was "is it already fitted", and for an instrument that is the same question — a
   * second clock tells the same hour. A bed is capacity, so the ceiling is what the shelter
   * allows and the refusal has to name it rather than say the thing is already there.
   */
  const ceiling = fittingsAllowed(slug, level);
  const allowed = fittingsBuildable(slug, level, living.length);
  if (standing.length >= allowed) {
    const name = spec.kind.replaceAll('_', ' ');

    // Which ceiling bit, because they are two different problems with two different answers:
    // one is solved by a deeper shelter and the other by somebody arriving.
    if (allowed < ceiling) {
      throw new InputError(
        'The spare bed is still empty. Somebody has to sleep in it before the camp builds another.',
      );
    }

    throw new InputError(
      spec.repeats
        ? `A ${name} at level ${level} holds ${allowed} of those. A deeper one holds more.`
        : `The ${spec.name.toLowerCase()} is already fitted.`,
    );
  }

  /*
   * Paid in whatever the fitting is priced in, which is fuel for an instrument and scrap for
   * a bed. Conditional update rather than read-then-write: the row refuses to go negative
   * even if a concurrent request slipped past the settlement lock somehow.
   */
  const currency = (spec.fuel ?? 0) > 0 ? 'fuel' : 'scrap';
  const price = spec[currency];

  const { rowCount } = await client.query(
    `update resources set amount = amount - $3
      where settlement_id = $1 and kind = $2 and amount >= $3`,
    [settlementId, currency, price],
  );
  if (rowCount === 0) {
    throw new InputError(
      currency === 'fuel'
        ? `Not enough fuel — that needs ${price}, and only trips bring it in.`
        : `Not enough scrap — that needs ${price}.`,
    );
  }

  const completesAt = new Date(now + spec.hours * HOUR_MS);

  const { rows } = await client.query(
    `insert into structure_upgrades (settlement_id, kind, upgrade, ordinal, started_at, completes_at, fitted_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    // The next one along, counting everything of this kind whether standing or in flight —
    // the unique key is on the ordinal, so reusing one would be refused by the database
    // rather than quietly overwriting a bed somebody is already sleeping in.
    [
      settlementId,
      spec.kind,
      slug,
      existing.filter((row) => row.upgrade === slug).length + 1,
      new Date(now),
      completesAt,
      fitter.id,
    ],
  );

  return { upgradeId: rows[0].id, name: spec.name, completesAt };
}
