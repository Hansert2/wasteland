#!/usr/bin/env bash
#
# Restore a dump into a scratch database and prove the game can be played on it.
#
# A backup nobody has restored is a file, not a backup. This runs the whole path — dump,
# restore, compare, play — against a throwaway database, so it can be run on the live box
# without touching the live game. It never writes to the real database and never drops it.
#
#   ./scripts/restore-check.sh                       # dump the running db and check it
#   ./scripts/restore-check.sh ~/backups/x.sql.gz    # check a backup already on disk
#
# The last step is the one that matters. Row counts prove the file arrived; loading every
# camp through the real service layer proves the *game* arrived, which is a different
# claim and the only one worth making about a save.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-wasteland}"
DB_NAME="${POSTGRES_DB:-wasteland}"
SCRATCH="${SCRATCH_DB:-wl_restore_check}"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
psql_at() { compose exec -T "$DB_SERVICE" psql -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$1" "${@:2}"; }

DUMP="${1:-}"
CLEANUP_DUMP=0

if [ -z "$DUMP" ]; then
  DUMP="$(mktemp -t wl-restore-XXXXXX.sql.gz)"
  CLEANUP_DUMP=1
  echo "==> dumping ${DB_NAME}"
  # The same command docs/DEPLOYING.md gives for the nightly backup, so this checks the
  # backup that is actually taken rather than a different one that happens to work.
  compose exec -T "$DB_SERVICE" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$DUMP"
fi

echo "==> restoring $(basename "$DUMP") into ${SCRATCH}"
psql_at postgres -c "drop database if exists ${SCRATCH}"
psql_at postgres -c "create database ${SCRATCH}"
# Quiet: a dump replays hundreds of CREATE and setval lines and none of them is news.
# Errors still stop it, because ON_ERROR_STOP is on.
gunzip -c "$DUMP" | psql_at "$SCRATCH" > /dev/null

echo "==> comparing every table"
COUNTS="select 'settlements ' || count(*) from settlements
 union all select 'characters ' || count(*) from characters
 union all select 'expeditions ' || count(*) from expeditions
 union all select 'world_events ' || count(*) from world_events
 union all select 'resources ' || count(*) from resources
 union all select 'camp_structures ' || count(*) from camp_structures
 union all select 'structure_upgrades ' || count(*) from structure_upgrades
 union all select 'road_links ' || count(*) from road_links
 union all select 'inventory_items ' || count(*) from inventory_items
 union all select 'faction_standing ' || count(*) from faction_standing
 union all select 'craft_orders ' || count(*) from craft_orders
 union all select 'players ' || count(*) from players"

live="$(compose exec -T "$DB_SERVICE" psql -tAU "$DB_USER" -d "$DB_NAME" -c "$COUNTS" | tr -d '\r' | sort)"
copy="$(compose exec -T "$DB_SERVICE" psql -tAU "$DB_USER" -d "$SCRATCH" -c "$COUNTS" | tr -d '\r' | sort)"

# Refuse an empty comparison. Two empty lists match, and a check that passes when it read
# nothing is worse than no check — it reports success for a restore that never happened.
if [ -z "$live" ] || [ "$(printf '%s\n' "$live" | wc -l)" -lt 5 ]; then
  echo "    could not read the live database; refusing to call this a match" >&2
  exit 1
fi

if [ "$live" != "$copy" ]; then
  echo "    TABLES DIFFER" >&2
  diff <(printf '%s\n' "$live") <(printf '%s\n' "$copy") || true
  exit 1
fi
printf '%s\n' "$live" | sed 's/^/    /'

echo "==> playing the restored copy"

# Run inside the app container where there is one, because that is where node and the code
# already live: the production box runs the game in Docker and need not have node installed
# on the host at all. Falls back to the host for a dev stack that is only a database.
if compose config --services 2>/dev/null | grep -qx app; then
  PLAY=(compose exec -T -e DATABASE_URL="postgresql://${DB_USER}@${DB_SERVICE}:5432/${SCRATCH}" app node --input-type=module)
elif command -v node > /dev/null; then
  PLAY=(env DATABASE_URL="${RESTORE_URL:?no app service, so set RESTORE_URL to reach the scratch database}" node --input-type=module)
else
  echo "    no app service and no node on this host, so the restored copy cannot be played" >&2
  echo "    that is the only step proving the game came back, so this counts as a failure" >&2
  exit 1
fi

# Through the project's own pool, deliberately: src/db/pool.js installs a NUMERIC type
# parser, and a harness that opens its own connection gets strings where the game expects
# numbers. Every figure then arithmetics to NaN and the check fails on a database that is
# perfectly fine, which is exactly what happened the first time this was written.
"${PLAY[@]}" <<'NODE'
const { pool } = await import('./src/db/pool.js');
const { viewCamp } = await import('./src/services/view-camp.js');

const client = await pool.connect();
const { rows } = await client.query('select id, name from settlements order by id');

let played = 0;
const failed = [];
for (const row of rows) {
  await client.query('begin');
  try {
    await viewCamp(client, row.id, Date.now());
    played += 1;
  } catch (error) {
    failed.push(`${row.name}: ${error.message}`);
  }
  await client.query('rollback');
}

console.log(`    ${played} of ${rows.length} camps load and advance`);
for (const line of failed) console.log(`    FAILED ${line}`);

client.release();
await pool.end();
if (failed.length > 0 || rows.length === 0) process.exit(1);
NODE

echo "==> dropping ${SCRATCH}"
psql_at postgres -c "drop database ${SCRATCH}"
[ "$CLEANUP_DUMP" = 1 ] && rm -f "$DUMP"

echo "==> the backup restores and the game plays on it"
