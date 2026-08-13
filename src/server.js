import { createApp } from './web/app.js';
import { pool } from './db/pool.js';
import { purgeExpiredSessions } from './auth/sessions.js';

const PORT = Number(process.env.PORT ?? 3000);

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
