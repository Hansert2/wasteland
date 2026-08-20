import { advanceSettlement } from './advance-settlement.js';
import {
  WORLD_EVENTS,
  activeAt,
  expeditionFactors,
  productionFactors,
} from '../game/world-events.js';
import { resolveExpedition } from '../game/expeditions.js';
import { isOpen, isWarned, momentCount, momentsFor } from '../game/moments.js';
import { stateAt, timelineOf } from '../game/timeline.js';
import { CONFIG } from '../game/constants.js';
import { LINKS, TRADE_POST_LINKS, linkCost, linkGives, neighbourFor } from '../game/road.js';
import { WORLD_SEED } from '../db/world-events.js';
import { FACTIONS, caravanVisit, postKeeper, priceAt, standingOf } from '../game/factions.js';
import {
  STRUCTURES,
  UPGRADES,
  campDefence,
  campWealth,
  productionRates,
  structureEffect,
  upgradeCost,
  upgradeFor,
} from '../game/structures.js';

/**
 * Everything a camp page needs, as one transaction.
 *
 * The tick runs first: nothing is rendered from state that has not been brought up
 * to the current instant, so the page can never show stale resources or a survivor
 * who is, as of now, already dead.
 */
const HOUR_MS = 60 * 60 * 1000;

/**
 * What is knowable about a trip that is still happening.
 *
 * The outcome is resolved *early* here, which looks alarming and is not: an expedition
 * has always been a pure function of its seed, so rolling it now and rolling it at
 * `returns_at` give the same trip. Nothing is written and nothing is decided — this is
 * the same arithmetic the tick will do later, done sooner so the page has something
 * true to say.
 *
 * The weather used is the weather **at the scheduled return**, not the weather now,
 * because that is what the tick will resolve against. World events are derived rather
 * than observed, so that hour is already knowable, and using it is what makes the
 * report land on what actually comes home rather than near it.
 *
 * Returns null when nobody is out, which is most of the time.
 */
function reportOn(row, state, now) {
  if (!row) return null;

  const travelHours = Number(row.travel_hours);
  const seed = Number(row.seed);
  const region = {
    slug: row.slug,
    name: row.name,
    danger: row.danger,
    travelHours,
    loot: row.loot,
    finds: row.finds,
    radiationPerTrip: row.radiation_per_trip,
  };

  const choices = row.choices ?? [];
  const returnsAt = row.returns_at.getTime();
  const elapsed = Math.max(0, (now - row.departed_at.getTime()) / HOUR_MS);

  const outcome = resolveExpedition({
    region,
    survivor: state.survivor,
    seed,
    weather: expeditionFactors(activeAt(state.worldEvents, returnsAt)),
    choices,
    standings: state.settlement.standings,
  });

  const carried = stateAt(timelineOf({ outcome, travelHours, seed }), elapsed);
  const answered = new Set(choices.map((choice) => Number(choice.index)));
  const moments = momentsFor(region, seed);

  // Health as it stands out there: what they left with, less what the trip has already
  // done to them. This is what the warning on a lethal option is measured against, and
  // it is computed rather than simulated — the tick still applies damage at the return.
  const health = Math.max(0, Number(state.survivor?.health ?? 0) - carried.damage);

  const open = moments.find(
    (moment) => !answered.has(moment.index) && isOpen(moment, elapsed),
  );

  return {
    regionName: row.name,
    returnsAt: row.returns_at,
    hoursOut: elapsed,
    carrying: carried.carrying,
    radiation: carried.radiation,
    damage: carried.damage,
    cause: carried.cause,
    findCount: carried.finds.length,
    health,
    // The radio's second job, and the same job it already had: it tells you when, and
    // nothing else. Without it a moment is found by loading the page inside its window.
    nextMomentAt: null,
    moment: open
      ? {
          index: open.index,
          prose: open.prose,
          closesAt: new Date(row.departed_at.getTime() + open.closesAt * HOUR_MS),
          options: open.options.map((option) => ({
            key: option.key,
            label: option.label,
            detail: option.detail,
            warned: isWarned(option, health),
            // What it costs out of the pack, if anything. Resolved against what the
            // survivor is actually carrying by the caller, which is the first place
            // that knows — see the note there.
            consumes: option.consumes ?? null,
          })),
        }
      : null,
    // What has already been said out there. The moment box disappears the instant it is
    // answered — it is filtered out of `open` above — and until this existed nothing
    // took its place, so a decision the player had just made left no trace on the page
    // and the outcome was still hours away in the return log. The answer is recorded,
    // the consequence is rolled at `returns_at`, and this is the only thing that says so.
    settled: choices
      .map((choice) => {
        const moment = moments[Number(choice.index)];
        // Same guard as `applyChoices`: an answer names the moment it answered, and one
        // whose name no longer matches is not applied, so it must not be reported either.
        if (!moment || (choice.key && moment.key !== choice.key)) return null;
        const option = moment.options.find((candidate) => candidate.key === choice.option);
        return option
          ? { title: moment.title, label: option.label, atHour: moment.atHour }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.atHour - b.atHour),
    upcoming: moments
      .filter((moment) => !answered.has(moment.index) && moment.atHour > elapsed)
      .map((moment) => new Date(row.departed_at.getTime() + moment.atHour * HOUR_MS)),
  };
}

/**
 * What the survivor's numbers are doing to them, rather than only what they are.
 *
 * Found by playing on 2026-08-20: the page said "Radiation 62.2" and nothing else, and
 * 62.2 happens to sit just past `radThreshold`, where a survivor stops healing and
 * starts losing health. Nothing was wrong — the number was right and the tick was right
 * — and the player had no way to know the number had crossed a line, which line, or what
 * it was costing. The same shape as the moment box that vanished on submit and the
 * option priced in a dose the pack did not hold: a fact the decision needs, not sitting
 * next to the decision.
 *
 * Three states worth telling apart, because each wants something different from the
 * player:
 *
 * - **Burning.** Past the threshold, losing health every hour. The bleed ramps from
 *   nothing at the threshold to the full rate at 100, so "past 60" and "at 87" are very
 *   different news — the figure is given rather than the band.
 * - **Stalled.** Under the threshold but over `regenRadCeiling`: nothing is being lost
 *   and nothing is coming back. This is where a Deep Zone run leaves a survivor for the
 *   better part of two days, and it is the state the page said least about.
 * - **Mending.** Clear enough to heal, which is the only state in which waiting works.
 *
 * `decayPerHour` is passed in rather than read here because filtration changes it, and
 * the whole point of that upgrade is this number: a player weighing 60 fuel against it
 * should be able to see what it buys.
 */
function strainOf(survivor, decayPerHour) {
  const rads = Number(survivor.radiation) || 0;
  const until = (mark) => (rads <= mark ? 0 : (rads - mark) / decayPerHour);

  if (rads >= CONFIG.radThreshold) {
    const severity = (rads - CONFIG.radThreshold) / (100 - CONFIG.radThreshold);
    return {
      state: 'burning',
      threshold: CONFIG.radThreshold,
      damagePerHour: CONFIG.radDamagePerHour * severity,
      hoursToSafe: until(CONFIG.radThreshold),
      hoursToMending: until(CONFIG.regenRadCeiling),
    };
  }

  if (rads >= CONFIG.regenRadCeiling) {
    return {
      state: 'stalled',
      threshold: CONFIG.radThreshold,
      damagePerHour: 0,
      hoursToSafe: 0,
      hoursToMending: until(CONFIG.regenRadCeiling),
    };
  }

  return {
    state: 'mending',
    threshold: CONFIG.radThreshold,
    damagePerHour: 0,
    hoursToSafe: 0,
    hoursToMending: 0,
  };
}

/**
 * What a price is short by, in the words the player would use.
 *
 * Every priced thing on the camp page rendered its button whether or not the camp
 * could pay: Fit beside a 60-fuel filtration on 51 fuel, Make beside a vest wanting
 * two parts on a pack holding one. Clicking either returned a refusal that was
 * correct and arrived too late to be a decision. That is the same fault the moment
 * options had — a cost the page displays but does not verify is a button that lies —
 * and it was fixed there first only because that is where it was noticed.
 *
 * Returns null when the camp can pay, so the caller can treat it as a plain guard.
 */
function shortfall(resources, pack, costs = {}, inputs = []) {
  const missing = [];

  for (const [kind, amount] of Object.entries(costs)) {
    // Build costs carry their duration in the same object as their price.
    if (kind === 'hours') continue;
    const have = Number(resources[kind]?.amount ?? 0);
    if (have < amount) missing.push(`${Math.ceil(amount - have)} more ${kind}`);
  }

  for (const input of inputs) {
    const have = pack.get(input.slug) ?? 0;
    if (have < input.qty) missing.push(`${input.qty - have} more ${input.slug.replaceAll('_', ' ')}`);
  }

  return missing.length > 0 ? `needs ${missing.join(', ')}` : null;
}
export async function viewCamp(client, settlementId, now = Date.now()) {
  const { state, events } = await advanceSettlement(client, settlementId, now);

  const { rows: settlements } = await client.query(
    `select name, founded_at, next_raid_at, caravan_seed, caravan_count, next_caravan_at
       from settlements where id = $1`,
    [settlementId],
  );

  const { rows: structures } = await client.query(
    'select kind, level, build_completes_at from camp_structures where settlement_id = $1 order by kind',
    [settlementId],
  );

  const { rows: survivorRow } = await client.query(
    'select name from characters where settlement_id = $1 and died_at is null',
    [settlementId],
  );

  // Only the count: the camp page points at the graveyard rather than reproducing it,
  // so pulling names and causes here would be fetching three columns to call .length
  // on them.
  const { rows: fallen } = await client.query(
    'select count(*)::int as n from character_history where settlement_id = $1',
    [settlementId],
  );

  const { rows: regionRows } = await client.query(
    `select slug, name, danger, travel_hours, description, requires_link
       from regions order by danger, travel_hours`,
  );

  // Re-read rather than using the post-tick state: the tick may have just resolved
  // an expedition, and what the page wants is whatever is in flight *now*.
  const { rows: away } = await client.query(
    `select r.name, r.slug, r.danger, r.travel_hours, r.loot, r.finds, r.radiation_per_trip,
            e.returns_at, e.departed_at, e.seed, e.choices
       from expeditions e
       join regions r on r.id = e.region_id
       join characters c on c.id = e.character_id
      where c.settlement_id = $1 and c.died_at is null and e.status = 'active'`,
    [settlementId],
  );

  const { rows: recipes } = await client.query(
    `select rec.slug, rec.name, rec.costs, rec.inputs, rec.output_qty,
            rec.requires_workshop, rec.craft_hours, rec.description,
            i.name as output_name
       from recipes rec
       join items i on i.id = rec.output_item_id
      order by rec.requires_workshop, rec.craft_hours`,
  );

  // Re-read for the same reason the expedition is: the tick may have just lifted an
  // order off the bench, and what the page wants is whatever is on it *now*.
  const { rows: onTheBench } = await client.query(
    `select rec.name, co.completes_at
       from craft_orders co
       join recipes rec on rec.id = co.recipe_id
      where co.settlement_id = $1 and co.status = 'active'`,
    [settlementId],
  );

  const { rows: inventory } = await client.query(
    `select i.slug, i.name, i.kind, ii.qty
       from inventory_items ii
       join items i on i.id = ii.item_id
       join characters c on c.id = ii.character_id
      where c.settlement_id = $1 and c.died_at is null and ii.qty > 0
      order by i.name`,
    [settlementId],
  );

  const { rows: upgradeRows } = await client.query(
    'select kind, upgrade, completes_at, installed_at from structure_upgrades where settlement_id = $1',
    [settlementId],
  );
  const fitted = new Set(
    upgradeRows.filter((row) => row.installed_at !== null).map((row) => row.upgrade),
  );
  const beingFitted = upgradeRows.find((row) => row.installed_at === null) ?? null;

  // What the camp can actually pay with: stores, and what is on the survivor.
  const pack = new Map(inventory.map((item) => [item.slug, Number(item.qty)]));
  const purse = state.settlement.resources;
  // The caravan at the gate, or the one on the road. Standing prices the offers.
  const standings = {};
  const { rows: standingRows } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1',
    [settlementId],
  );
  for (const row of standingRows) standings[row.faction] = Number(row.standing);

  const caravanRow = settlements[0];
  const visit = caravanVisit(Number(caravanRow.caravan_seed), caravanRow.caravan_count);
  const arrival = caravanRow.next_caravan_at?.getTime() ?? null;
  const departsAt = arrival === null ? null : arrival + visit.stayHours * 3600_000;
  const visiting = arrival !== null && arrival <= now && now < departsAt;

  let caravan = null;
  if (arrival !== null) {
    const spec = FACTIONS[visit.faction];
    const standing = standingOf(standings, visit.faction);

    // Proper item names for the shopfront, in one query.
    const slugs = spec.offers.map((o) => o.item).filter(Boolean);
    const { rows: named } = await client.query(
      'select slug, name from items where slug = any($1)',
      [slugs],
    );
    const names = new Map(named.map((row) => [row.slug, row.name]));

    caravan = {
      faction: visit.faction,
      name: spec.name,
      description: spec.description,
      visiting,
      arrivesAt: visiting ? null : new Date(arrival),
      departsAt: visiting ? new Date(departsAt) : null,
      standing,
      offers: visiting
        ? spec.offers.map((offer, index) => {
            const costs = priceAt(offer, standing);
            return {
              index,
              what: offer.item ? names.get(offer.item) ?? offer.item : offer.resource,
              qty: offer.qty,
              costs,
              // Priced in stores alone, so the pack is not consulted. Standing has
              // already moved these numbers, which is why the shortfall is worked
              // out here and not from the list price.
              shortBy: shortfall(state.settlement.resources, new Map(), costs),
            };
          })
        : [],
    };
  }

  // The radio's second job, and the same shape as its first: it tells you *when*. Its
  // scrap levels protect the camp while you are gone; the radio only ever helps while
  // you are here, so an unfitted camp meets a moment by loading the page inside its
  // window and never by planning to.
  const expedition = reportOn(away[0], state, now);
  if (expedition && fitted.has('radio')) {
    expedition.nextMomentAt = expedition.upcoming[0] ?? null;
  }

  /**
   * An option priced in something the pack does not hold is not a decision.
   *
   * Until this existed the page could not tell the difference: the option rendered like
   * any other, and the refusal — "There is nothing like that in the pack" — arrived
   * after the click, on a window with minutes left on it. The generator cannot help,
   * and should not: a moment is drawn from a region and a seed alone so that attending
   * one never changes what the trip was going to be. That makes *here* the first point
   * at which the price and the pack are both known, so here is where they are compared.
   */
  if (expedition?.moment) {
    const wanted = [
      ...new Set(expedition.moment.options.flatMap((option) => option.consumes ?? [])),
    ];
    if (wanted.length > 0) {
      const { rows: named } = await client.query(
        'select slug, name from items where slug = any($1)',
        [wanted],
      );
      const names = new Map(named.map((row) => [row.slug, row.name]));
      const held = new Set(inventory.map((item) => item.slug));

      for (const option of expedition.moment.options) {
        if (!option.consumes) continue;
        // Any one of them pays: the list is a preference order, not a shopping list.
        option.missing = !option.consumes.some((slug) => held.has(slug));
        option.needs = option.consumes.map((slug) => names.get(slug) ?? slug).join(' or ');
      }
    }
  }

  /**
   * The road: what has been reached, and what the next link wants.
   *
   * Every neighbour is derived here rather than read, so the table holds only what the
   * player did — and a neighbour's fate is derived against `now`, which is why somebody
   * standing last week can be gone on this page load with nothing having run.
   *
   * What a link bought is never repossessed. A destination stays on the dispatch table
   * and a trade post stays open after the people are gone, because otherwise "another
   * camp died, so you lost a shop" would be exactly the cross-camp failure this phase
   * refuses. The fate is news.
   */
  const { rows: roadRows } = await client.query(
    'select link_index, fuel, completed_at from road_links where settlement_id = $1 order by link_index',
    [settlementId],
  );

  const opened = new Set(
    roadRows.filter((row) => row.completed_at !== null).map((row) => Number(row.link_index)),
  );

  /**
   * What a place actually is, so the road can say it before it is paid for.
   *
   * The same facts the dispatch table carries — how far, how dangerous, how much
   * contact — because 70 fuel against an unknown is not a decision. The road already
   * fixes which link opens which region precisely so the player is choosing a known
   * thing; this is the page finally telling them what it is.
   *
   * Read from every region rather than the filtered list, since the whole point is
   * describing places this camp cannot go to yet.
   */
  const placeOf = (slug) => {
    const region = regionRows.find((candidate) => candidate.slug === slug);
    if (!region) return null;

    return {
      name: region.name,
      danger: region.danger,
      travelHours: Number(region.travel_hours),
      moments: momentCount(Number(region.travel_hours)),
      description: region.description,
    };
  };

  const reached = roadRows
    .filter((row) => row.completed_at !== null)
    .map((row) => {
      const who = neighbourFor(WORLD_SEED, Number(row.link_index), now);
      return {
        ...who,
        place: who.region ? placeOf(who.region) : null,
        completedAt: row.completed_at,
      };
    });

  const openRow = roadRows.find((row) => row.completed_at === null);
  const nextIndex = openRow ? Number(openRow.link_index) : reached.length + 1;
  const nextCost = linkCost(nextIndex);

  const road = {
    reached,
    links: LINKS,
    // Null once the seventh is done: the road ends, and the page says so rather than
    // offering an eighth that does not exist.
    next: nextCost === null
      ? null
      : {
          index: nextIndex,
          cost: nextCost,
          fuel: Number(openRow?.fuel ?? 0),
          ...linkGives(nextIndex),
          // Named, because the player is choosing a known thing — but only this one.
          // The links past it are a count rather than a list, so there is a picture of
          // the whole road without reading the end of it first.
          neighbour: neighbourFor(WORLD_SEED, nextIndex, now).name,
          place: linkGives(nextIndex).region ? placeOf(linkGives(nextIndex).region) : null,
        },
    beyond: nextCost === null ? 0 : LINKS - nextIndex,
    // What there is to send. The box asked for a number and never said what the
    // camp had, so the arithmetic was left to the player on the one page that
    // already knew the answer.
    available: Number(state.settlement.resources.fuel?.amount ?? 0),
  };

  /**
   * Where this camp can be sent, and what it will find when it gets there.
   *
   * Two things the list did not used to carry. **Contact**, because where to send
   * someone is the decision that settles whether Phase 6 happens at all, and the table
   * it is made from listed danger, hours and flavour and never once mentioned
   * encounters — nine of the first real camp's fifteen dispatches went to the one
   * region that categorically has no interior. And **the road**, because four of these
   * places are not reachable until a link is made.
   *
   * The moment count comes from the generator's own function, so what the page promises
   * and what the trip holds cannot drift apart.
   */
  const regions = regionRows
    .filter((region) => region.requires_link === null || opened.has(Number(region.requires_link)))
    .map((region) => ({
      ...region,
      moments: momentCount(Number(region.travel_hours)),
    }));

  /**
   * The post on the road, if this camp keeps one.
   *
   * The same offers a caravan carries, always open. That is deliberately *not* a
   * discount — the prices are the crew's usual prices, moved by standing exactly as
   * they are at the gate — because the road buys reliability, which is a different good
   * from cheapness and the only one a missable caravan cannot also sell.
   */
  let post = null;
  if (TRADE_POST_LINKS.some((index) => opened.has(index))) {
    const keeper = postKeeper(standings);
    const spec = FACTIONS[keeper];
    const standing = standingOf(standings, keeper);

    const slugs = spec.offers.map((offer) => offer.item).filter(Boolean);
    const { rows: named } = await client.query(
      'select slug, name from items where slug = any($1)',
      [slugs],
    );
    const names = new Map(named.map((row) => [row.slug, row.name]));

    post = {
      faction: keeper,
      name: spec.name,
      standing,
      offers: spec.offers.map((offer, index) => {
        const costs = priceAt(offer, standing);
        return {
          index,
          what: offer.item ? names.get(offer.item) ?? offer.item : offer.resource,
          qty: offer.qty,
          costs,
          shortBy: shortfall(purse, pack, costs),
        };
      }),
    };
  }


  const rates = productionRates(structures);

  // What the sky is doing to production, and what the survivor takes back out. Both
  // are part of "the rate" as a player experiences it; neither used to be counted.
  const weatherFactors = productionFactors(activeAt(state.worldEvents, now));
  const eats = state.survivor
    ? { food: CONFIG.foodPerHour, water: CONFIG.waterPerHour }
    : {};

  return {
    name: settlements[0].name,
    foundedAt: settlements[0].founded_at,
    // Two numbers, never one: what a raider wants, and what stands in their way.
    wealth: campWealth(structures, state.settlement.resources),
    defence: campDefence(structures),
    // The radio's entire effect. Without it the hour is in the database and none of
    // the player's business; with it, it is the most useful thing on the page.
    raidExpectedAt: fitted.has('radio') ? settlements[0].next_raid_at : null,
    caravan,
    road,
    post,
    standings: Object.entries(FACTIONS).map(([slug, spec]) => ({
      slug,
      name: spec.name,
      standing: standingOf(standings, slug),
    })),
    // Weather is visible to everyone: it is the sky, not a secret.
    weather: activeAt(state.worldEvents, now).map((event) => ({
      kind: event.kind,
      name: WORLD_EVENTS[event.kind]?.name ?? event.kind,
      description: WORLD_EVENTS[event.kind]?.description ?? '',
      endsAt: new Date(event.endsAt),
    })),
    structures: structures.map((s) => {
      const branch = upgradeFor(s.kind);
      return {
        ...s,
        nextCost: upgradeCost(s.kind, s.level),
        // What the next level is short by, or null when the camp can pay for it.
        shortBy: shortfall(purse, pack, upgradeCost(s.kind, s.level) ?? {}),
        // What it does now and what the next level buys, so the page can answer
        // "why would I upgrade this" without the player working it out themselves.
        effect: structureEffect(s.kind, s.level),
        nextEffect: structureEffect(s.kind, s.level + 1),
        summary: STRUCTURES[s.kind]?.summary ?? '',
        // The fuel branch, if this structure has one.
        upgrade: branch
          ? {
              ...branch,
              fitted: fitted.has(branch.slug),
              shortBy: shortfall(purse, pack, { fuel: branch.fuel }),
              fittingUntil:
                beingFitted?.upgrade === branch.slug ? beingFitted.completes_at : null,
            }
          : null,
      };
    }),
    // Builds and fittings share one crew, so either one occupies the queue.
    buildInFlight: structures.some((s) => s.build_completes_at !== null) || beingFitted !== null,
    fallenCount: fallen[0].n,
    events,
    regions,
    inventory,
    recipes: recipes.map((recipe) => ({
      ...recipe,
      shortBy: shortfall(purse, pack, recipe.costs ?? {}, recipe.inputs ?? []),
    })),
    // What the bench can take on is gated by the workshop, so the page has to know
    // its level to explain why a recipe has no button rather than just hiding it.
    workshopLevel: Number(structures.find((s) => s.kind === 'workshop')?.level ?? 0),
    craft: onTheBench[0]
      ? { name: onTheBench[0].name, completesAt: onTheBench[0].completes_at }
      : null,
    expedition,
    survivor: state.survivor ? { ...state.survivor, name: survivorRow[0]?.name } : null,
    // What those numbers are doing to them. Null with nobody in the camp, because a
    // camp with no survivor has no strain, only an empty chair.
    strain: state.survivor
      ? strainOf(
          state.survivor,
          CONFIG.radDecayPerHour * (fitted.has('filtration') ? UPGRADES.filtration.radDecayMultiplier : 1),
        )
      : null,
    /**
     * The rate a player can act on: what the stores will actually do next hour.
     *
     * This used to report gross production, which was wrong in two directions at
     * once. It ignored the survivor eating — a level 1 garden reads +1.2 while the
     * camp nets +0.7 — and it ignored the weather, so during a blight the page
     * promised +1.2 food/h while the true figure was 0.42 gross and *negative* once
     * the survivor was fed. A number that says food is climbing while it falls is
     * worse than no number.
     */
    resources: Object.entries(state.settlement.resources).map(([kind, r]) => ({
      kind,
      amount: r.amount,
      cap: r.cap,
      ratePerHour:
        (rates[kind] ?? 0) * (weatherFactors[kind] ?? 1) - (eats[kind] ?? 0),
    })),
  };
}
