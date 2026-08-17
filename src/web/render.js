/**
 * Deliberately plain HTML. The interesting question in Phase 1 is whether checking in
 * is fun, and that is answered by the numbers on the page, not by how they look. The
 * styling here exists only to keep the page readable while playing it.
 */

const STYLE = `
  body { font-family: ui-monospace, Consolas, monospace; max-width: 44rem;
         margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  table { border-collapse: collapse; margin: 0.5rem 0 1.5rem; width: 100%; }
  th, td { text-align: left; padding: 0.2rem 0.75rem 0.2rem 0; }
  th { border-bottom: 1px solid currentColor; }
  .events li { margin-bottom: 0.25rem; }
  .error { padding: 0.5rem; border: 1px solid currentColor; }
  form { margin: 1rem 0; }
  label { display: block; margin: 0.5rem 0; }
`;

/** Every interpolation in this file goes through here. */
export function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>${STYLE}</style></head>
<body>${body}<script>${TIMERS}</script></body></html>`;
}

const n = (value, places = 1) => Number(value).toFixed(places);

/**
 * A duration, in whatever unit makes it readable.
 *
 * Everything here used to be hours, so hours were hard-coded everywhere. Since the
 * pacing rescale a build can be thirty seconds and an upgrade nine days, and a fixed
 * unit is wrong at one end or the other — the first camp rendered after the change
 * offered five builds all costing "0.0 h", which is worse than no number at all.
 */
function duration(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 'now';
  if (h < 1 / 60) return `${Math.max(1, Math.round(h * 3600))}s`;
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${n(h)} h`;
  return `${n(h / 24)} days`;
}

/**
 * A duration that keeps counting after the page is rendered.
 *
 * Every timer here used to be a number computed once and then frozen, which was
 * defensible while a build took four hours — you would close the tab and come back
 * tomorrow. The pacing rescale made a first workshop take thirty-six seconds, and a
 * frozen countdown on a thirty-six second build is just wrong: things now finish
 * while you are looking at them. Found by playing it, which is the only way this
 * kind of thing gets found.
 *
 * The element carries the instant rather than the text, so the script below can
 * re-render it every second without knowing what it is counting towards.
 */
function countdown(at, done = 'now') {
  const until = new Date(at).getTime();
  const left = (until - Date.now()) / 3600000;
  return `<span data-until="${until}" data-done="${escape(done)}">${
    escape(left > 0 ? duration(left) : done)
  }</span>`;
}

/**
 * The whole of the client-side JavaScript, and it is meant to stay that way.
 *
 * Ticks every visible timer once a second, and reloads when one runs out — because
 * the server is the only thing that knows what a finished build actually produced.
 * Only timers that were still running at page load can trigger that reload: one that
 * had already expired when the HTML was generated is showing the server's own "done"
 * text, and reloading for it would loop forever.
 */
const TIMERS = `
(() => {
  const fmt = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + ' min';
    if (s < 172800) return (s / 3600).toFixed(1) + ' h';
    return (s / 86400).toFixed(1) + ' days';
  };

  const live = [...document.querySelectorAll('[data-until]')]
    .filter((el) => Number(el.dataset.until) > Date.now());
  if (live.length === 0) return;

  let reloading = false;
  const tick = () => {
    for (const el of live) {
      const left = Number(el.dataset.until) - Date.now();
      if (left > 0) { el.textContent = fmt(left); continue; }
      el.textContent = el.dataset.done;
      if (!reloading) {
        reloading = true;
        // A moment's grace so the server's clock is unambiguously past the hour.
        setTimeout(() => location.reload(), 1200);
      }
    }
  };

  tick();
  setInterval(tick, 1000);
})();
`;

export function landingPage({ error } = {}) {
  return layout('Wasteland', `
    <h1>Wasteland</h1>
    ${error ? `<p class="error">${escape(error)}</p>` : ''}

    <h2>Return to your camp</h2>
    <form method="post" action="/login">
      <label>Email <input name="email" type="email" required autocomplete="username"></label>
      <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
      <button type="submit">Enter</button>
    </form>

    <h2>Found a new camp</h2>
    <form method="post" action="/register">
      <label>Email <input name="email" type="email" required autocomplete="username"></label>
      <label>Password <input name="password" type="password" required autocomplete="new-password" minlength="8"></label>
      <label>Camp name <input name="settlementName" placeholder="Camp"></label>
      <button type="submit">Begin</button>
    </form>
  `);
}

export function campPage(view, { error } = {}) {
  return layout(view.name, `
    <h1>${escape(view.name)}</h1>
    <p>Wealth ${view.wealth} &middot; defence ${view.defence} &middot; founded
       ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ''}
    ${renderRaidWarning(view.raidExpectedAt)}
    ${renderWeather(view.weather)}

    ${renderEvents(view.events)}
    ${view.survivor ? renderSurvivor(view.survivor) : renderNoSurvivor(view.fallenCount > 0)}
    ${view.survivor ? renderExpeditions(view) : ''}
    ${renderResources(view.resources)}
    ${renderCaravan(view.caravan, Boolean(view.survivor))}
    ${renderInventory(view.inventory)}
    ${renderWorkshop(view)}
    ${renderStandings(view.standings)}
    ${renderStructures(view.structures, view.buildInFlight, Boolean(view.survivor))}
    ${renderRoster(view.fallenCount)}

    <form method="post" action="/logout"><button type="submit">Log out</button></form>
  `);
}

/**
 * Events the trip log already narrates, so the page does not say them twice.
 *
 * `item_found` is really an instruction to the caller — "put this in the pack" — that
 * happens to travel in the same list as the player-facing events. The expedition's
 * own log line already reported the find in the middle of the story, so rendering
 * the event as well reads as a bug rather than as emphasis.
 */
const NARRATED_ELSEWHERE = new Set(['item_found']);

/**
 * What the sky is doing, and for how much longer.
 *
 * Shown to everyone with no upgrade required — this is weather, not intelligence.
 * The hours remaining are the useful half: a storm with four hours left is a reason
 * to wait, and one with three days left is a reason to change plan.
 */
function renderWeather(weather) {
  if (!weather || weather.length === 0) return '';

  const items = weather
    .map((event) => {
      return `<li><strong>${escape(event.name)}</strong> (${countdown(event.endsAt, 'clearing')} left) &mdash;
        ${escape(event.description)}</li>`;
    })
    .join('');

  return `<h2>The sky</h2><ul class="events">${items}</ul>`;
}

/**
 * The radio, and the whole of what it bought.
 *
 * Placed above everything else because it is the only thing on this page with a
 * deadline. Stores are all a raid can take, so the useful response to this is to
 * spend them — which is the point: a warning turns a hoard into a decision.
 */
function renderRaidWarning(expectedAt) {
  if (!expectedAt) return '';

  const hoursLeft = (new Date(expectedAt).getTime() - Date.now()) / 3600000;
  if (hoursLeft <= 0) {
    return '<p class="error">The radio has gone quiet. They are overdue &mdash; reload.</p>';
  }

  return `<p class="error">Radio: raiders expected in ${countdown(expectedAt, 'any moment')}.
    Anything still in the stores is theirs to take.</p>`;
}

function renderEvents(events) {
  const shown = events.filter((event) => !NARRATED_ELSEWHERE.has(event.type));
  if (shown.length === 0) return '';
  const items = shown
    .map((event) => `<li>${escape(describe(event))}</li>`)
    .join('');
  return `<h2>While you were away</h2><ul class="events">${items}</ul>`;
}

function describe(event) {
  const when = new Date(event.at).toISOString().replace('T', ' ').slice(0, 16);
  switch (event.type) {
    case 'survivor_died':
      return `${when} — your survivor died of ${event.cause} after ${n(event.daysSurvived)} days.`;
    case 'auto_consumed':
      return `${when} — with nothing left in the stores, they used a ${event.item}.`;
    case 'expedition_returned':
      return `${when} — ${event.log.join(' ')}`;
    case 'expedition_lost':
      return event.log
        ? `${when} — ${event.log.join(' ')}`
        : `${when} — an expedition never came home.`;
    // Filtered out of the camp page by NARRATED_ELSEWHERE; kept so this stays a
    // total formatter, and so a find reported on its own still has words.
    case 'item_found':
      return `${when} — brought back ${event.qty} × ${event.slug.replaceAll('_', ' ')}.`;
    case 'build_completed':
      return `${when} — the ${event.kind.replaceAll('_', ' ')} reached level ${event.level}.`;
    case 'raid':
    case 'raid_repelled':
      return `${when} — ${event.log.join(' ')}`;
    case 'caravan_arrived':
      return `${when} — a caravan from ${event.name} pulled up at the gate.`;
    case 'caravan_departed':
      return `${when} — the ${event.name} caravan moved on.`;
    case 'upgrade_fitted':
      return `${when} — the crew finished fitting the ${event.name.toLowerCase()}.`;
    case 'craft_delivered':
      return `${when} — the workshop turned out ${event.qty} × ${event.name}.`;
    case 'craft_lost':
      return `${when} — the ${event.name} was finished with nobody left to take it off the bench.`;
    default:
      return `${when} — ${event.type}`;
  }
}

function renderSurvivor(survivor) {
  return `
    <h2>${escape(survivor.name ?? 'Survivor')}</h2>
    <table>
      <tr><th>Health</th><td>${n(survivor.health)}</td></tr>
      <tr><th>Hunger</th><td>${n(survivor.hunger)}</td></tr>
      <tr><th>Radiation</th><td>${n(survivor.radiation)}</td></tr>
    </table>`;
}

/**
 * The empty camp. A camp nobody has ever held is not a camp that has been abandoned,
 * and telling a brand-new player their stores have spoiled would be a lie on the
 * first screen they see.
 */
function renderNoSurvivor(everHeld) {
  const preamble = everHeld
    ? `<p>Structures have fallen into disrepair and much of the store has spoiled or
         been taken. Someone new can take it on.</p>`
    : `<p>Four walls, a garden, and enough water to start. It needs somebody in it.</p>`;

  return `
    <h2>The camp stands empty</h2>
    ${preamble}
    <form method="post" action="/successor">
      <label>Name <input name="name" placeholder="Survivor" required></label>
      <button type="submit">${everHeld ? 'Take over the camp' : 'Move in'}</button>
    </form>`;
}

function renderExpeditions(view) {
  if (view.expedition) {
    const hoursLeft = (new Date(view.expedition.returnsAt).getTime() - Date.now()) / 3600000;
    const due =
      hoursLeft > 0
        ? `due back in ${countdown(view.expedition.returnsAt, 'now')}`
        : 'overdue — reload to see what came back';
    return `<h2>Away</h2>
      <p>${escape(view.expedition.regionName)} — ${due}</p>`;
  }

  const rows = view.regions
    .map(
      (region) => `<tr>
        <th>${escape(region.name)}</th>
        <td>danger ${region.danger}</td>
        <td>${escape(duration(region.travel_hours))}</td>
        <td>
          <form method="post" action="/expedition" style="margin:0">
            <input type="hidden" name="region" value="${escape(region.slug)}">
            <button type="submit">Send</button>
          </form>
        </td>
      </tr>
      <tr><td colspan="4"><small>${escape(region.description ?? '')}</small></td></tr>`,
    )
    .join('');

  return `<h2>Where to send them</h2><table>${rows}</table>`;
}

function renderInventory(inventory) {
  if (!inventory || inventory.length === 0) return '';
  const rows = inventory
    .map((item) => `<tr><th>${escape(item.name)}</th><td>×${item.qty}</td></tr>`)
    .join('');
  return `<h2>Pack</h2><table>${rows}</table>`;
}

/**
 * The bench. A recipe with no button keeps its row and says why — a workshop level
 * you have not reached yet is a thing to build towards, and hiding it hides the goal.
 */
function renderWorkshop(view) {
  if (view.craft) {
    const hoursLeft = (new Date(view.craft.completesAt).getTime() - Date.now()) / 3600000;
    const due = hoursLeft > 0 ? `ready in ${countdown(view.craft.completesAt, 'now')}` : 'ready — reload to collect it';
    return `<h2>On the bench</h2>
      <p>${escape(view.craft.name)} — ${due}</p>`;
  }

  if (!view.recipes || view.recipes.length === 0) return '';

  const rows = view.recipes
    .map((recipe) => {
      // Most recipes are named after what they make, so naming it twice reads as a
      // bug. Only the quantity is news in that case.
      const yields =
        recipe.output_name === recipe.name
          ? recipe.output_qty > 1
            ? `× ${recipe.output_qty}`
            : ''
          : `${recipe.output_qty} × ${escape(recipe.output_name)}`;
      const price = escape(`${priceOf(recipe)}, ${duration(recipe.craft_hours)}`);
      return `<tr>
        <th>${escape(recipe.name)}</th>
        <td>${yields}</td>
        <td>${price}</td>
        <td>${craftCell(recipe, view)}</td>
      </tr>
      <tr><td colspan="4"><small>${escape(recipe.description ?? '')}</small></td></tr>`;
    })
    .join('');

  return `<h2>Workshop</h2><table>${rows}</table>`;
}

/** Stores and carried materials read as one price, because that is how they are paid. */
function priceOf(recipe) {
  const parts = Object.entries(recipe.costs ?? {}).map(([kind, amount]) => `${amount} ${kind}`);
  for (const input of recipe.inputs ?? []) {
    parts.push(`${input.qty} × ${input.slug.replaceAll('_', ' ')}`);
  }
  return parts.join(', ');
}

function craftCell(recipe, view) {
  if (view.workshopLevel < recipe.requires_workshop) {
    return `<small>needs workshop ${recipe.requires_workshop}</small>`;
  }
  // Starting work needs living hands, the same rule builds follow.
  if (!view.survivor) return '';

  return `<form method="post" action="/craft" style="margin:0">
      <input type="hidden" name="recipe" value="${escape(recipe.slug)}">
      <button type="submit">Make</button>
    </form>`;
}

/**
 * The caravan — at the gate with its shopfront open, or on the road with an ETA.
 *
 * The ETA is shown to everyone, unlike the raid hour: caravans send word ahead
 * because they want you at the gate with scrap in hand, and a visit that can be
 * planned for is a reason to come back. Missing one still costs you the window.
 */
function renderCaravan(caravan, someoneAlive) {
  if (!caravan) return '';

  if (!caravan.visiting) {
    const hoursOut = (new Date(caravan.arrivesAt).getTime() - Date.now()) / 3600000;
    const when = hoursOut > 0 ? `expected in ${countdown(caravan.arrivesAt, 'now')}` : 'expected — reload';
    return `<h2>On the road</h2>
      <p>A caravan from ${escape(caravan.name)}, ${when}.</p>`;
  }

  const hoursLeft = (new Date(caravan.departsAt).getTime() - Date.now()) / 3600000;
  const rows = caravan.offers
    .map((offer) => {
      const price = Object.entries(offer.costs)
        .map(([kind, amount]) => `${amount} ${kind}`)
        .join(', ');
      const buy =
        someoneAlive
          ? `<form method="post" action="/trade" style="margin:0">
              <input type="hidden" name="faction" value="${escape(caravan.faction)}">
              <input type="hidden" name="offer" value="${offer.index}">
              <button type="submit">Buy</button>
            </form>`
          : '';
      return `<tr>
        <th>${offer.qty} × ${escape(offer.what)}</th>
        <td>${escape(price)}</td>
        <td>${buy}</td>
      </tr>`;
    })
    .join('');

  return `<h2>${escape(caravan.name)} — at the gate</h2>
    <p><small>${escape(caravan.description)}</small><br>
       Moving on in ${countdown(caravan.departsAt, 'now')}. Standing ${describeStanding(caravan.standing)}
       ${caravan.standing < 0 ? '&mdash; their prices show it.' : caravan.standing > 0 ? '&mdash; the rates are friendly.' : '&mdash; strangers pay list price.'}</p>
    <table>${rows}</table>`;
}

/** Where the camp sits with each crew. One line each; the numbers earn no table. */
function renderStandings(standings) {
  if (!standings || standings.every((s) => s.standing === 0)) return '';
  const parts = standings
    .map((s) => `${escape(s.name)}: ${describeStanding(s.standing)}`)
    .join(' &middot; ');
  return `<h2>Standing</h2><p>${parts}</p>`;
}

function describeStanding(standing) {
  const word =
    standing <= -50 ? 'hated' :
    standing <= -15 ? 'unwelcome' :
    standing < 15 ? 'strangers' :
    standing < 50 ? 'known' : 'trusted';
  return `${word} (${standing > 0 ? '+' : ''}${n(standing, 0)})`;
}

function renderResources(resources) {
  const rows = resources
    .map(
      (r) => `<tr><th>${escape(r.kind)}</th><td>${n(r.amount)} / ${n(r.cap, 0)}</td>
              <td>${r.ratePerHour > 0 ? `+${n(r.ratePerHour)}/h` : '&mdash;'}</td></tr>`,
    )
    .join('');
  return `<h2>Stores</h2><table>${rows}</table>`;
}

function renderStructures(structures, buildInFlight, someoneAlive) {
  const rows = structures
    .map((s) => {
      const name = escape(s.kind.replaceAll('_', ' '));
      const status = statusCell(s, buildInFlight, someoneAlive);
      // An unbuilt structure produces nothing, and saying so is more useful than
      // an empty cell the player has to interpret.
      const doing = s.effect ? escape(s.effect) : '<small>nothing yet</small>';
      return `<tr>
        <th>${name}</th>
        <td>level ${s.level}</td>
        <td>${doing}</td>
        ${status}
      </tr>
      <tr><td colspan="5"><small>${escape(purposeOf(s))}</small></td></tr>
      ${upgradeRow(s, buildInFlight, someoneAlive)}`;
    })
    .join('');
  return `<h2>Structures</h2><table>${rows}</table>`;
}

/**
 * The fuel branch, where a structure has one.
 *
 * Kept on its own row rather than folded into the level track, because that is the
 * point: scrap makes the thing bigger and fuel makes it do something new, and the
 * page should not make those look like the same purchase.
 */
function upgradeRow(structure, buildInFlight, someoneAlive) {
  const upgrade = structure.upgrade;
  if (!upgrade) return '';

  const label = `${escape(upgrade.name)} &mdash; ${escape(upgrade.summary)}`;

  if (upgrade.fitted) {
    return `<tr><td colspan="5"><small>${label} <em>(fitted)</em></small></td></tr>`;
  }

  if (upgrade.fittingUntil) {
    const hoursLeft = (new Date(upgrade.fittingUntil).getTime() - Date.now()) / 3600000;
    const when = hoursLeft > 0 ? `being fitted, ${countdown(upgrade.fittingUntil, 'now')} left` : 'fitted, reload';
    return `<tr><td colspan="5"><small>${label} <em>(${when})</em></small></td></tr>`;
  }

  if (structure.level < upgrade.requiresLevel) {
    return `<tr><td colspan="5"><small>${label}
      <em>(needs level ${upgrade.requiresLevel})</em></small></td></tr>`;
  }

  // Fuel only comes home from expeditions, so the cost is worth spelling out.
  const cost = escape(`${upgrade.fuel} fuel, ${duration(upgrade.hours)}`);
  const button =
    buildInFlight || !someoneAlive
      ? ''
      : `<form method="post" action="/upgrade" style="margin:0">
          <input type="hidden" name="upgrade" value="${escape(upgrade.slug)}">
          <button type="submit">Fit</button>
        </form>`;

  return `<tr><td colspan="3"><small>${label}</small></td>
    <td><small>${cost}</small></td><td>${button}</td></tr>`;
}

/** What it is for, plus what the next level actually buys. */
function purposeOf(structure) {
  const summary = structure.summary ?? '';
  if (!structure.nextEffect) return summary;
  return `${summary} Level ${structure.level + 1} makes that ${structure.nextEffect}.`;
}

function statusCell(structure, buildInFlight, someoneAlive) {
  if (structure.build_completes_at) {
    const hoursLeft = (new Date(structure.build_completes_at).getTime() - Date.now()) / 3600000;
    const when = hoursLeft > 0 ? `done in ${countdown(structure.build_completes_at, 'now')}` : 'done — reload';
    return `<td colspan="2">building level ${structure.level + 1}, ${when}</td>`;
  }

  if (!structure.nextCost) return '<td></td><td></td>';

  const cost = `${structure.nextCost.scrap} scrap, ${duration(structure.nextCost.hours)}`;
  // The queue holds one build, and starting work needs living hands.
  if (buildInFlight || !someoneAlive) {
    return `<td>${escape(cost)}</td><td></td>`;
  }

  return `<td>${escape(cost)}</td>
    <td><form method="post" action="/build" style="margin:0">
      <input type="hidden" name="kind" value="${escape(structure.kind)}">
      <button type="submit">Build</button>
    </form></td>`;
}

/**
 * A pointer rather than a table. The detail — what they were carrying, where they
 * went last — belongs somewhere it can be read properly, and the camp page is long
 * enough already.
 */
function renderRoster(fallenCount) {
  if (fallenCount === 0) return '';
  const who = fallenCount === 1 ? 'One survivor has' : `${fallenCount} survivors have`;
  return `<h2>Those who held this camp</h2>
    <p>${who} held this camp before. <a href="/graveyard">The graveyard</a>.</p>`;
}

/** The memorial. Deliberately not a table: these are people, not rows. */
export function graveyardPage(view) {
  const stones = view.fallen.map(headstone).join('');

  const holding = view.holding
    ? `<p>${escape(view.holding.name)} holds the camp now, since
       ${escape(new Date(view.holding.bornAt).toISOString().slice(0, 10))}.</p>`
    : '<p>Nobody holds the camp.</p>';

  return layout(`${view.name} — the fallen`, `
    <h1>The fallen of ${escape(view.name)}</h1>
    <p>Founded ${escape(view.foundedAt.toISOString().slice(0, 10))}. The camp outlives
       its people.</p>
    ${holding}

    ${view.fallen.length === 0 ? '<p>Nobody has died here yet.</p>' : stones}

    <p><a href="/camp">Back to camp</a></p>
  `);
}

function headstone(person) {
  const died = new Date(person.diedAt).toISOString().slice(0, 10);

  const trips =
    person.trips === 0
      ? 'Never left the camp.'
      : `Made ${person.trips} ${person.trips === 1 ? 'trip' : 'trips'}${
          person.lastRegion ? `, the last to ${escape(person.lastRegion)}` : ''
        }.`;

  // The detail that stings, and it was free: nothing cleans up after the dead, so
  // their pack is still there to be read.
  const carrying =
    person.carrying.length === 0
      ? 'Carrying nothing at all.'
      : `Carrying ${listOf(person.carrying.map((i) => `${i.qty} × ${escape(i.name)}`))}.`;

  return `
    <h2>${escape(person.name)}</h2>
    <p>Held the camp ${n(person.daysSurvived)} days, and died of
       ${escape(String(person.cause ?? 'unknown causes').replaceAll('_', ' '))} on ${escape(died)}.<br>
       ${trips}<br>
       ${carrying}</p>`;
}

/** "a, b and c" — an inventory should read like someone describing it. */
function listOf(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
