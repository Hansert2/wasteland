/**
 * Every shape the camp page can take, built against a real database.
 *
 * Two callers, one builder, and that is the point. `test/db/page-contract.test.js`
 * renders these and asserts the invisible contract still holds; run this file directly
 * and it writes them to disk as HTML for a redesign to work from.
 *
 * **A layout only ever looked at in one state will be wrong in the other five.** This
 * page is mostly conditional blocks — the Contact box exists for about a third of the
 * hours of a trip and not at all otherwise, the sky is clear three visits in four, and
 * the Survivor block is a person or a stranger at the gate depending on whether anybody
 * is alive. Designing against the state you happen to load is how a Contact box ends up
 * looking like a table row.
 *
 * Built through the real services rather than hand-written view objects, deliberately.
 * A fixture assembled by hand agrees with `viewCamp` on the day it is written and drifts
 * silently afterwards, which would make the contract test below assert the contract of a
 * page that no longer exists.
 *
 *   node scripts/with-db.mjs node --env-file=.env tools/page-states.mjs [outdir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { pool } from '../src/db/pool.js';
import { foundSettlement, raiseSuccessor } from '../src/services/settlement-lifecycle.js';
import { dispatchExpedition } from '../src/services/dispatch-expedition.js';
import { viewCamp } from '../src/services/view-camp.js';
import { viewGraveyard } from '../src/services/view-graveyard.js';
import { campPage, graveyardPage } from '../src/web/render.js';
import { momentsFor } from '../src/game/moments.js';

const HOUR = 3600_000;
const uniq = () => Math.random().toString(36).slice(2, 10);

/** A camp of its own, so one state cannot leave a mark on the next. */
async function camp(client, now) {
  const { settlementId } = await foundSettlement(client, {
    email: `states-${uniq()}@example.test`,
    password: 'correct horse battery staple',
    settlementName: 'Ashwood',
    now,
  });
  return settlementId;
}

/**
 * A trip whose first window is known, because "wait until a moment happens" is not
 * something a fixture can do.
 *
 * Moments derive from the region and the expedition seed alone, so the seed is searched
 * for the one that opens soonest rather than the clock being pushed forward until
 * something turns up. Same trick `test/db/moments.test.js` uses.
 *
 * Searched rather than given a range, because a range is a guess about the placement
 * arithmetic and guesses go stale: the Deep Zone places its first window in a band
 * running from about 2.5 hours to 4.6, and a fixture asking for one under two and a half
 * would simply never find one. Asking for the earliest cannot be wrong.
 */
function seedWithEarlyWindow(region) {
  let best = null;
  for (let seed = 1; seed < 400; seed += 1) {
    const [first] = momentsFor(region, seed);
    if (first && (best === null || first.atHour < best.at)) best = { seed, at: first.atHour };
  }
  if (best === null) throw new Error(`${region.slug} offers no windows at all`);
  return best;
}

/**
 * `now` defaults to the real clock rather than a pinned instant, and that is a
 * presentation decision rather than laziness. `countdown()` renders against the
 * browser's clock, so a fixture dated in 2287 produces "95246d 23h 25m to answer" —
 * true, useless to design against, and the sort of thing that would quietly become
 * the reference for how wide a countdown needs to be.
 *
 * The contract test does not care: it asserts that deadlines carry their attributes,
 * never what the attributes say.
 */
export async function buildStates(client, now = Date.now()) {
  const states = {};

  /*
   * 1. Nobody has taken the camp on. Two different screens live here and both are wanted.
   *
   * A camp nobody has *ever* held gets the opening — its own page, no rail, no stores — so
   * it is captured under its own name and left out of the block contract, which is a
   * contract about the camp page and would otherwise report every block on it as missing.
   *
   * A camp that has been held and stands empty still gets the full page with the
   * empty-camp block in it, and that is the state the contract wants: every block present,
   * the stores still climbing, and nobody home.
   */
  {
    const id = await camp(client, now);
    states['opening'] = campPage(await viewCamp(client, id, now));
  }

  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await client.query(
      `update characters set died_at = $2, cause_of_death = 'the dose'
        where settlement_id = $1 and died_at is null`,
      [id, new Date(now)],
    );
    states['empty-camp'] = campPage(await viewCamp(client, id, now));
  }

  // 2. Somebody is holding it, the stores are fine, and there is nothing to answer.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    states['home'] = campPage(await viewCamp(client, id, now));
  }

  const deepZone = {
    slug: 'the_deep_zone',
    travelHours: 18,
  };
  const early = seedWithEarlyWindow(deepZone);

  // 3. Away, mid-trip, nothing open. The report without the invitation.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    const { expeditionId } = await dispatchExpedition(client, id, 'the_deep_zone', now);
    await client.query('update expeditions set seed = $2 where id = $1', [expeditionId, early.seed]);
    states['away'] = campPage(await viewCamp(client, id, now + 0.3 * HOUR));
  }

  // 4. A window open, on a survivor healthy enough that nothing is warned.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    const { expeditionId } = await dispatchExpedition(client, id, 'the_deep_zone', now);
    await client.query('update expeditions set seed = $2 where id = $1', [expeditionId, early.seed]);
    states['contact'] = campPage(await viewCamp(client, id, now + (early.at + 0.1) * HOUR));
  }

  // 5. The same window, on somebody who cannot afford the worst case. Warned options are
  //    the variant most likely to be styled as decoration, so it gets its own artboard.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    const { expeditionId } = await dispatchExpedition(client, id, 'the_deep_zone', now);
    await client.query('update expeditions set seed = $2 where id = $1', [expeditionId, early.seed]);
    await client.query(
      `update characters set health = 12 where settlement_id = $1 and died_at is null`,
      [id],
    );
    states['contact-warned'] = campPage(await viewCamp(client, id, now + (early.at + 0.1) * HOUR));
  }

  // 6. Two events at once, so the sky carries its stacking line.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    let slot = 990000;
    for (const kind of ['blight', 'rad_storm']) {
      await client.query(
        `insert into world_events (slot, kind, starts_at, ends_at) values ($1, $2, $3, $4)`,
        [slot, kind, new Date(now - 6 * HOUR), new Date(now + 30 * HOUR)],
      );
      slot += 1;
    }
    states['weather'] = campPage(await viewCamp(client, id, now + HOUR));
  }

  // 7. The ledger, and the empty camp that follows a death.
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await client.query(
      `update characters set died_at = $2, cause_of_death = 'radiation', health = 0
        where settlement_id = $1 and died_at is null`,
      [id, new Date(now + 40 * HOUR)],
    );
    states['graveyard'] = graveyardPage(await viewGraveyard(client, id));
  }

  return states;
}

// `file://${argv[1]}` is not a URL on Windows, where argv[1] is a backslash path
// beginning with a drive letter. pathToFileURL is the only comparison that holds on
// both, and the failure mode without it is silent: the file imports fine and simply
// declines to do anything when run directly.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2] ?? 'page-states';
  const client = await pool.connect();
  try {
    await client.query('begin');
    const states = await buildStates(client);
    await mkdir(out, { recursive: true });
    for (const [name, html] of Object.entries(states)) {
      await writeFile(join(out, `${name}.html`), html, 'utf8');
      console.log(`  ${name.padEnd(16)} ${String(html.length).padStart(6)} bytes`);
    }
    console.log(`\n${Object.keys(states).length} states written to ${out}/`);
  } finally {
    await client.query('rollback');
    client.release();
    await pool.end();
  }
}
