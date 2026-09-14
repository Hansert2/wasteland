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
import { startHunt, huntTurn } from '../src/services/hunt.js';
import { quarryFor, startOf } from '../src/game/hunting.js';
import { viewCamp } from '../src/services/view-camp.js';
import { viewGraveyard } from '../src/services/view-graveyard.js';
import { campPage, graveyardPage } from '../src/web/render.js';
import { momentsFor } from '../src/game/moments.js';
import { caravanVisit } from '../src/game/factions.js';

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

  /*
   * 2b. A survivor the camp is not keeping up with.
   *
   * Added 2026-08-31 because the page contract asked for it and nothing here could answer.
   * Every camp in this file is fed, so from the day gauges stopped rendering when nothing
   * was acting on them, the hunger gauge was never on any fixture — and the assertion that
   * every gauge explains what it counts had quietly stopped covering one of the four.
   *
   * A hungry survivor is also the state that carries the most marks: the stores are short,
   * they are too hungry to heal, and recovery is drawing rations it cannot get. Worth
   * having a page of on its own.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await client.query('update resources set amount = 0 where settlement_id = $1', [id]);
    await client.query(
      `update characters set hunger = 44, health = 61, stamina = 55
        where settlement_id = $1 and died_at is null`,
      [id],
    );
    states['hungry'] = campPage(await viewCamp(client, id, now));
  }

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

  /*
   * 6b. Somebody under, which is the one card state nothing else here reaches.
   *
   * Sleep replaces two things on a survivor's row at once: the line under the name becomes a
   * countdown rather than a named job, and the control at the foot of the card refuses
   * instead of offering. Both are conditional markup that only exists while a survivor is
   * asleep, and this file exists because a layout only ever looked at in one state will be
   * wrong in the other six.
   *
   * The camp is given a second person deliberately. One survivor asleep is a camp that can
   * do nothing at all, which is a legitimate state and not the interesting one to draw
   * against: what the roster has to show is one person committed and one still free, side by
   * side, with the same controls reading differently.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await client.query(
      `insert into characters (settlement_id, name, born_at, stamina)
       values ($1, 'Wren', $2, 31)`,
      [id, new Date(now - HOUR)],
    );
    await client.query(
      `update characters set stamina = 46, sleep_until = $2
        where settlement_id = $1 and died_at is null and name <> 'Wren'`,
      [id, new Date(now + 7.4 * HOUR)],
    );
    states['asleep'] = campPage(await viewCamp(client, id, now + 0.1 * HOUR));
  }

  /*
   * 6c. Raiders in the yard, which is the one block that asks a question about the camp.
   *
   * A raid is the only state on this page with a deadline that is not a trip's, and the only
   * one where every survivor is an option rather than a figure — so it is markup nothing else
   * here reaches. Two people, and one of them armed, because the block's whole job is to make
   * the difference between them legible: what each keeps back is printed on their own button.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await client.query(
      `insert into characters (settlement_id, name, born_at) values ($1, 'Wren', $2)`,
      [id, new Date(now - HOUR)],
    );
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 1 from characters c, items i
        where c.settlement_id = $1 and c.name <> 'Wren' and i.slug = 'scrap_spear'`,
      [id],
    );
    /*
     * Stocked first, and it is not decoration: a camp under `NOT_WORTH_THE_WALK` is picked
     * over and left without a window ever opening, so a fresh camp's empty larder produced a
     * page with no raid block on it at all. Raiders ask what a place is worth before they ask
     * who is in it.
     */
    await client.query(
      `update resources set amount = 260 where settlement_id = $1 and kind <> 'fuel'`,
      [id],
    );
    /*
     * Due half an hour *ahead*, and read an hour on. A camp founded at `now` and viewed at
     * `now` has no elapsed time for the walk to cover, so a raid dated in the past is never
     * reached — the first version of this fixture set it an hour back and rendered a page
     * with no raid on it. The hour that passes is what opens it; the window is four, so it
     * is still standing when the page is drawn.
     */
    await client.query('update settlements set next_raid_at = $2 where id = $1', [
      id,
      new Date(now + 0.5 * HOUR),
    ]);
    states['under-raid'] = campPage(await viewCamp(client, id, now + HOUR));
  }

  /*
   * 6c-ii. Somebody out after something, which is the one block on this page with no clock.
   *
   * Phase 20, and it is in here for the reason `at-the-gate` is: `s-gate` was empty in all
   * twelve saved states until the gate was rebuilt, so the block had never appeared in the set
   * a redesign works from and the contract test had never met it. A hunt is a harder case
   * again — it is the only block whose markup is a row of *decisions*, and it renders three
   * ways. This captures the one that matters, mid-hunt with the moves on offer.
   *
   * Two presses in, so the state is past its opening: one close puts them a few yards on and
   * the page has a line of its own log to show.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { name: 'Sol', now });
    await client.query(
      `update resources set amount = 200, storage_cap = 100000 where settlement_id = $1`,
      [id],
    );
    /*
     * A bow and a coat, because the board says what each half of the kit is worth and a
     * fixture carrying neither renders half the block. The armour row only exists when there
     * is armour: nothing is claimed about gear nobody owns.
     */
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 1 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null
          and i.slug in ('hunting_bow', 'hide_coat')`,
      [id],
    );

    const { rows: hunter } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [id],
    );
    /*
     * Pinned, like the two below it. Under the deterministic rules a hunt can be over on its
     * first press — close into the wind while the animal is watching and the alarm is at three
     * before anybody has done anything — so an unpinned fixture captured whatever it happened
     * to draw, and quietly stopped being a picture of a hunt in progress.
     */
    let mid = 1;
    while (quarryFor(mid) !== 'boar' || startOf(mid).wind !== 'behind') mid += 1;

    await startHunt(client, id, hunter[0].id, now);
    await client.query(
      `update hunts set seed = $2, state = $3::jsonb
        where settlement_id = $1 and status = 'active'`,
      [id, mid, JSON.stringify(startOf(mid))],
    );
    await huntTurn(client, id, 'close', now);

    states['hunting'] = campPage(await viewCamp(client, id, now));
  }

  /*
   * 6c-iii. And one that ended well, because the win is the state the view exists for.
   *
   * Every outcome rendered the same flat block until 2026-09-14, which is exactly the kind of
   * fault a saved state catches and a test does not: nothing was *broken*, a kill simply did
   * not look like one. Pinned rather than played: with the wind behind them every beat is free
   * to close on, so close-close-strike takes it on the third press for any such seed.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { name: 'Sol', now });
    await client.query(
      `update resources set amount = 200, storage_cap = 100000 where settlement_id = $1`,
      [id],
    );
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 1 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null
          and i.slug in ('hunting_bow', 'hide_coat')`,
      [id],
    );
    const { rows: hunter } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [id],
    );

    let downwind = 1;
    while (startOf(downwind).wind !== 'behind' || quarryFor(downwind) !== 'boar') downwind += 1;

    await startHunt(client, id, hunter[0].id, now);
    await client.query(
      `update hunts set seed = $2, state = $3::jsonb
        where settlement_id = $1 and status = 'active'`,
      [id, downwind, JSON.stringify(startOf(downwind))],
    );

    for (const move of ['close', 'close', 'strike']) {
      await huntTurn(client, id, move, now);
    }

    states['hunt-taken'] = campPage(await viewCamp(client, id, now));
  }

  /*
   * 6c-iv. And one that went wrong, which is the state that had never been looked at.
   *
   * Reported 2026-09-14: the mauling read "Mauled - 8 taken out of them" over "It came the
   * other way, and it came fast", which names neither what came nor what the 8 was. It had no
   * saved state, so nobody had ever read it on a page. The charge is set up rather than played
   * for: a boar already turned, and one press into it.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { name: 'Sol', now });
    await client.query(
      `update resources set amount = 200, storage_cap = 100000 where settlement_id = $1`,
      [id],
    );
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select c.id, i.id, 1 from characters c, items i
        where c.settlement_id = $1 and c.died_at is null and i.slug = 'hide_coat'`,
      [id],
    );
    const { rows: hunter } = await client.query(
      'select id from characters where settlement_id = $1 and died_at is null',
      [id],
    );

    let boar = 1;
    while (quarryFor(boar) !== 'boar') boar += 1;

    await startHunt(client, id, hunter[0].id, now);
    await client.query(
      `update hunts set seed = $2, state = $3::jsonb
        where settlement_id = $1 and status = 'active'`,
      [id, boar, JSON.stringify({ ...startOf(boar), turning: true, closeness: 1, alarm: 3 })],
    );
    await huntTurn(client, id, 'close', now);

    states['hunt-hurt'] = campPage(await viewCamp(client, id, now));
  }

  /*
   * 6d. A box with something in it, and a pack near its cap.
   *
   * Phase 13's block, and it is markup nothing else here reaches: the box renders one way
   * empty and another way stocked, and the pack tab grows a weight line and a second verb in
   * a column two hundred pixels wide. Two survivors, because the Take control is a hidden
   * field on a camp of one and a select on a camp of two — the two states of that control
   * are the whole reason this fixture has a second person in it.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    /*
     * Named from outside the wanderer pool, and the id is captured rather than matched on.
     * The first draft added a 'Wren' beside a successor the seed had also called Wren, so
     * every `name <> 'Wren'` in the fixture matched nobody: the packs came out empty, both
     * options in the Take control read the same, and the page looked wrong in a way that had
     * nothing to do with the code it was drawn to check.
     */
    const { rows: joiner } = await client.query(
      `insert into characters (settlement_id, name, born_at)
       values ($1, 'Marek', $2) returning id`,
      [id, new Date(now - HOUR)],
    );
    const { rows: living } = await client.query(
      `select id from characters
        where settlement_id = $1 and died_at is null and id <> $2 order by born_at, id`,
      [id, joiner[0].id],
    );

    await client.query(
      `insert into store_items (settlement_id, item_id, qty)
       select $1, i.id, x.qty from items i
         join (values ('scavenged_parts', 4), ('tinned_stew', 2)) as x(slug, qty)
           on x.slug = i.slug`,
      [id],
    );
    // A vest and a spear is 11 kg of the 15, which is what makes the free figure worth
    // printing rather than a rounding of the cap.
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, i.id, 1 from items i
        where i.slug in ('plate_vest', 'scrap_spear', 'rad_x')`,
      [living[0].id],
    );
    states['banked'] = campPage(await viewCamp(client, id, now + 0.1 * HOUR));
  }

  /*
   * 6e. Somebody at the gate, which no state in this file has ever reached.
   *
   * That absence is the reason this pair exists. `atTheGate` needs a camp that has a bed
   * *and* a spare place in it *and* has passed the eight-in-the-morning hour after the bed
   * was ready — three conditions no fixture here happened to satisfy, so `s-gate` rendered
   * empty in every state, the contract test never saw the block, and a layout nobody could
   * draw against went out with a control welded to the pips beside it.
   *
   * The bed is inserted rather than built: `startUpgrade` wants scrap, a free pair of hands
   * and half an hour of clock, and none of those three is what this fixture is about. What
   * matters is that it was ready yesterday, because the gate hour counts from the newest bed
   * and a bed fitted this morning would put the arrival tomorrow.
   */
  const bedFor = (id, at) =>
    client.query(
      `insert into structure_upgrades (settlement_id, kind, upgrade, started_at, completes_at, installed_at)
       values ($1, 'shelter', 'bed', $2, $2, $2)`,
      [id, new Date(at)],
    );

  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await bedFor(id, now - 30 * HOUR);
    states['at-the-gate'] = campPage(await viewCamp(client, id, now + 0.1 * HOUR), {
      pane: 'survivor',
    });
  }

  /*
   * 6f. The same person, and nowhere to put them.
   *
   * The state the block refused to render at all until 2026-09-09: `atTheGate` returned null
   * the moment `bedsFree` hit zero, so the camp with the most reason to hear about an arrival
   * was the one told nothing, and the two refusals `takeInWanderer` writes were sentences no
   * player could reach. One bed and two people is the whole of the setup.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    await bedFor(id, now - 30 * HOUR);
    await client.query(
      `insert into characters (settlement_id, name, born_at) values ($1, 'Marek', $2)`,
      [id, new Date(now - HOUR)],
    );
    states['gate-full'] = campPage(await viewCamp(client, id, now + 0.1 * HOUR), {
      pane: 'survivor',
    });
  }

  /*
   * 6g. A camp of six, which is the state the roads band was never drawn against.
   *
   * Reported from play on 2026-09-10: with more than four people the "Who can go" list ran
   * out of the band and printed over the table header and the first row of places. The band
   * is a fixed 148px on purpose -- the list below must not move when a place is pressed --
   * and the list inside it grows one row per survivor, so the two rules collide at five.
   *
   * Every fixture in this file had one survivor or two, so nothing here could show it. Beds
   * are not the constraint on the roster the page draws: `view.roster` is whoever is alive,
   * so this inserts people directly rather than raising a shelter to ten to earn them.
   *
   * The jobs are varied deliberately. The row is a name, a job in one word and the clock that
   * ends it, and a camp where everybody is idle renders the one column that cannot overflow.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { now });
    // Named from outside the wanderer pool, for the reason the `banked` state records: the
    // successor is drawn from that pool, and a fixture that reuses a name from it renders a
    // camp holding two Alders -- which `wandererFor` is written to make impossible and which
    // a reader would take for the bug rather than for the fixture.
    for (const name of ['Marek', 'Juna', 'Halle', 'Tove', 'Bex']) {
      await client.query(
        `insert into characters (settlement_id, name, born_at) values ($1, $2, $3)`,
        [id, name, new Date(now - HOUR)],
      );
    }
    const { rows: out } = await client.query(
      `select id from characters where settlement_id = $1 and name in ('Marek', 'Tove')`,
      [id],
    );
    // `who` is a bare id here, not an options object: see `dispatchExpedition`.
    for (const one of out) {
      await dispatchExpedition(client, id, 'the_deep_zone', now, one.id);
    }
    states['crowded'] = campPage(await viewCamp(client, id, now + 0.2 * HOUR), {
      pane: 'survivor',
    });
  }

  /*
   * 6e-ii. A caravan at the gate, and a camp that has an opinion about all three crews.
   *
   * The Trade view had no saved state at all, which since Phase 17 means the one block on the
   * page whose *number of rows* is content — three crews now, and the block renders nothing
   * whatever until a camp has met somebody. The standings are set directly rather than traded
   * for, because what this state is a fixture of is the block at three different readings, not
   * the arithmetic that gets there.
   *
   * The visit's crew derives from the seed, so the count is walked to the wanted one rather
   * than the seed being fixed and hoped over — the tick would have arrived here honestly.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { name: 'Sol', now });
    await client.query(
      `update resources set amount = least(200, storage_cap) where settlement_id = $1`,
      [id],
    );

    const seed = 4242;
    let count = 0;
    while (caravanVisit(seed, count).faction !== 'wellkeepers') count += 1;
    await client.query(
      `update settlements set caravan_seed = $2, caravan_count = $3, next_caravan_at = $4
        where id = $1`,
      [id, seed, count, new Date(now - HOUR)],
    );

    for (const [faction, standing] of [
      ['junction_crews', 42],
      ['green_river', -63],
      ['wellkeepers', 8],
    ]) {
      await client.query(
        `insert into faction_standing (settlement_id, faction, standing) values ($1, $2, $3)`,
        [id, faction, standing],
      );
    }

    states['trade'] = campPage(await viewCamp(client, id, now), { pane: 'trade' });
  }

  /*
   * 6f. Somebody lying out there, and the band that offers to go and get them.
   *
   * Phase 16's one piece of new markup, and without a state here it would be a block that is
   * empty in all eighteen of the others — which is this file's definition of untested. The
   * place is opened deliberately: the errand is a second form on the expanded band, and the
   * band is the only place on the page it can appear.
   *
   * Three days out rather than one. At zero hours the caption reads 70% and the control's
   * whole point — that it is going cold — has nothing to show; at three days it reads about a
   * third, which is the sentence the block exists to say.
   */
  {
    const id = await camp(client, now);
    await raiseSuccessor(client, id, { name: 'Sol', now });
    const { rows: gone } = await client.query(
      `insert into characters (settlement_id, name, born_at, died_at, cause_of_death, health,
                               died_at_region_id)
       select $1, 'Wren', $2, $3, 'a bad dose', 0, r.id from regions r where r.slug = $4
       returning id`,
      [id, new Date(now - 200 * HOUR), new Date(now - 72 * HOUR), 'the_deep_zone'],
    );
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, i.id, 2 from items i where i.slug in ('scavenged_parts', 'tinned_stew')`,
      [gone[0].id],
    );
    states['errand'] = campPage(await viewCamp(client, id, now), {
      // 'survivor', not 'road': `PANES` puts the dispatch table on the Survivors view, and
      // the Road view is the links block. Named wrong, the state saves a page whose band is
      // display:none — present in the markup, and never once looked at.
      pane: 'survivor',
      place: 'the_deep_zone',
    });

    /*
     * And the same camp's ledger, which is where the other half of the phase shows: one stone
     * still out at a named place beside one that never left the wire.
     */
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
