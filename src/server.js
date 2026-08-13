import { createApp } from './web/app.js';
import { pool } from './db/pool.js';
import { purgeExpiredSessions } from './auth/sessions.js';

const PORT = Number(process.env.PORT ?? 3000);

// Fail loudly at boot rather than at the first login. A server that starts happily
// and only breaks when someone tries to use it is the worst of both worlds.
try {
  await pool.query('select 1');
} catch (error) {
  console.error(`cannot reach the database at startup: ${error.code ?? error.message}`);
  console.error('is the container up? try `npm run db:up`');
  process.exit(1);
}

const server = createApp().listen(PORT, () => {
  console.log(`wasteland listening on http://localhost:${PORT}`);
});

// Housekeeping only. Nothing about correctness depends on this running, because
// expiry is checked on every session read — which is what lets the game survive the
// server being down for a week without a cron job anywhere.
purgeExpiredSessions(pool).catch((error) => console.error('session purge failed', error));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}
