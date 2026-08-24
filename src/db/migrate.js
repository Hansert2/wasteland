import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { pool } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * The lock every migrator waits on. Arbitrary, and it only has to be the same number in
 * every copy of this file — which it is, because there is only one copy of this file.
 */
const MIGRATION_LOCK = 8_675_309;

/**
 * Applies every unapplied migration, in filename order, each in its own transaction.
 *
 * Deliberately not an ORM and deliberately not clever: numbered .sql files, a table
 * recording which have run, no down-migrations. Rolling back a schema change means
 * writing the next migration.
 *
 * **One migrator at a time, and it is this file's job to make that true.** Reading the
 * applied set and then applying is two steps, and two migrators started together both
 * finish the first step before either starts the second — so both see the same file
 * pending and both run it. `create table` survives that; `alter table … add column` and
 * anything with an insert in it do not. The deployment intends to run one migrator,
 * which is why this has never happened, but intending it is not enforcing it — raised in
 * review on 2026-08-24.
 *
 * A session-level advisory lock is the right instrument: it is held by the connection
 * rather than by a transaction, so it spans the read *and* every file that follows, and
 * it is released even if the process dies, because the connection dies with it. The
 * second migrator blocks at the `pg_advisory_lock` call, and by the time it is let
 * through the first has committed — so it reads an up-to-date applied set and finds
 * nothing to do, which is the outcome you want rather than an error to interpret.
 *
 * Everything runs on that one checked-out client rather than through `withTransaction`,
 * for the reason the lock exists: a pooled client is a different session, and a lock
 * held by one session does not stop another one from working.
 */
async function migrate() {
  const client = await pool.connect();

  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);

    await client.query(`
      create table if not exists schema_migrations (
        version    text        primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    const { rows } = await client.query('select version from schema_migrations');
    const applied = new Set(rows.map((r) => r.version));

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.log(`up to date (${applied.size} applied)`);
      return;
    }

    for (const file of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

      // One transaction per file: a migration either lands whole or not at all. Written
      // out rather than borrowed from `withTransaction`, which would take its own client
      // out of the pool and leave the lock behind on this one.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (version) values ($1)', [file]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }

      console.log(`applied ${file}`);
    }
  } finally {
    // Unlocked explicitly rather than left to the connection closing, so a long-lived
    // caller does not hold the whole schema hostage. Its own try: a failed unlock must
    // not replace the migration error that is on its way up.
    try {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    } catch (error) {
      console.error('could not release the migration lock:', error);
    }
    client.release();
  }
}

try {
  await migrate();
} catch (error) {
  // AggregateError (dual-stack connect failures) hides everything in .errors.
  console.error('migration failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
