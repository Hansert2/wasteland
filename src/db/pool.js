import pg from 'pg';

/**
 * Postgres runs in Docker inside WSL; this process runs on the Windows host and
 * reaches it over forwarded localhost. Load the connection string with Node's own
 * `--env-file=.env` rather than a dotenv dependency.
 */
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — run with `node --env-file=.env`');
}

// Timestamps come back as strings by default only for some types; make sure the
// numeric columns the tick cares about arrive as numbers rather than strings.
// pg returns numeric/int8 as strings to avoid precision loss, which is right for
// money and wrong for game stats — everything here fits comfortably in a double.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, Number.parseFloat);
pg.types.setTypeParser(pg.types.builtins.INT8, Number.parseInt);

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** Run `fn` inside a transaction, rolling back on any throw. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
