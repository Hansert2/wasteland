#!/usr/bin/env node
/**
 * Runs a command with the database up, and keeps it up for the whole run.
 *
 * WSL terminates a distribution once no wsl.exe session is attached to it — systemd
 * services running inside do not count, and neither does a running container. So a
 * Postgres container vanishes roughly a minute after the last command, which is fine
 * for a one-shot migration and fatal for a server you leave running: it starts
 * healthy and loses its database while you are looking at the page.
 *
 * `vmIdleTimeout` in .wslconfig does not prevent this; it was measured and it does
 * not. What does work is holding a session open, which is what the keepalive child
 * here is for. It lives exactly as long as the wrapped command.
 *
 *   node scripts/with-db.mjs node --env-file=.env src/server.js
 */
import { spawn, spawnSync } from 'node:child_process';

const DISTRO = process.env.WSL_DISTRO ?? 'Debian';
const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('usage: node scripts/with-db.mjs <command> [args...]');
  process.exit(2);
}

// --wait blocks until the healthcheck passes, so the wrapped command never races
// a Postgres that is still starting up.
const up = spawnSync(
  'wsl.exe',
  ['-d', DISTRO, '--cd', process.cwd(), '--', 'docker', 'compose', 'up', '-d', '--wait'],
  { stdio: 'inherit' },
);

if (up.status !== 0) {
  console.error(`\ncould not start the database in WSL (${DISTRO}).`);
  process.exit(1);
}

const keepalive = spawn('wsl.exe', ['-d', DISTRO, '--', 'sleep', 'infinity'], {
  stdio: 'ignore',
  windowsHide: true,
});

let settled = false;
function finish(code) {
  if (settled) return;
  settled = true;
  keepalive.kill();
  process.exit(code);
}

const child = spawn(command, args, { stdio: 'inherit' });

child.on('exit', (code, signal) => finish(signal ? 1 : (code ?? 0)));
child.on('error', (error) => {
  console.error(`could not run ${command}: ${error.message}`);
  finish(1);
});

// Forward interrupts so Ctrl-C stops the server rather than orphaning it, and make
// sure the keepalive dies with us however we exit.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
process.on('exit', () => keepalive.kill());
