import { UPGRADES } from '../game/structures.js';
import { InputError } from '../errors.js';

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
export async function startUpgrade(client, settlementId, upgradeSlug, now = Date.now()) {
  const slug = String(upgradeSlug ?? '');
  const spec = UPGRADES[slug];
  if (!spec) throw new InputError('Nobody here knows how to fit that.');

  // Starting work needs hands, even though finishing does not.
  const { rows: living } = await client.query(
    'select id from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );
  if (living.length === 0) throw new InputError('There is nobody here to fit it.');

  const { rows: existing } = await client.query(
    'select upgrade, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );

  if (existing.some((row) => row.upgrade === slug && row.installed_at !== null)) {
    throw new InputError(`The ${spec.name.toLowerCase()} is already fitted.`);
  }

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

  const host = structures.find((s) => s.kind === spec.kind);
  if (Number(host?.level ?? 0) < spec.requiresLevel) {
    const name = spec.kind.replaceAll('_', ' ');
    throw new InputError(`That needs a ${name} at level ${spec.requiresLevel}.`);
  }

  // Conditional update rather than read-then-write: the row refuses to go negative
  // even if a concurrent request slipped past the settlement lock somehow.
  const { rowCount } = await client.query(
    `update resources set amount = amount - $2
      where settlement_id = $1 and kind = 'fuel' and amount >= $2`,
    [settlementId, spec.fuel],
  );
  if (rowCount === 0) {
    throw new InputError(`Not enough fuel — that needs ${spec.fuel}, and only trips bring it in.`);
  }

  const completesAt = new Date(now + spec.hours * HOUR_MS);

  const { rows } = await client.query(
    `insert into structure_upgrades (settlement_id, kind, upgrade, started_at, completes_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [settlementId, spec.kind, slug, new Date(now), completesAt],
  );

  return { upgradeId: rows[0].id, name: spec.name, completesAt };
}
