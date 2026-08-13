import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { pool, withTransaction } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * Applies every unapplied migration, in filename order, each in its own transaction.
 *
 * Deliberately not an ORM and deliberately not clever: numbered .sql files, a table
 * recording which have run, no down-migrations. Rolling back a schema change means
 * writing the next migration.
 */
async function migrate() {
  await pool.query(`
    create table if not exists schema_migrations (
      version    text        primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  const { rows } = await pool.query('select version from schema_migrations');
  const applied = new Set(rows.map((r) => r.version));

  const pending = files.filter((f) => !applied.has(f));
  if (pending.length === 0) {
    console.log(`up to date (${applied.size} applied)`);
    return;
  }

  for (const file of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    // One transaction per file: a migration either lands whole or not at all.
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
    });
    console.log(`applied ${file}`);
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
