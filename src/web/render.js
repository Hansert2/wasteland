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
<body>${body}</body></html>`;
}

const n = (value, places = 1) => Number(value).toFixed(places);

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
      <label>Survivor name <input name="survivorName" placeholder="Survivor"></label>
      <button type="submit">Begin</button>
    </form>
  `);
}

export function campPage(view, { error } = {}) {
  return layout(view.name, `
    <h1>${escape(view.name)}</h1>
    <p>Camp strength ${view.strength} &middot; founded ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>
    ${error ? `<p class="error">${escape(error)}</p>` : ''}

    ${renderEvents(view.events)}
    ${view.survivor ? renderSurvivor(view.survivor) : renderNoSurvivor()}
    ${view.survivor ? renderExpeditions(view) : ''}
    ${renderResources(view.resources)}
    ${renderInventory(view.inventory)}
    ${renderWorkshop(view)}
    ${renderStructures(view.structures, view.buildInFlight, Boolean(view.survivor))}
    ${renderRoster(view.roster)}

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

function renderNoSurvivor() {
  return `
    <h2>The camp stands empty</h2>
    <p>Structures have fallen into disrepair and much of the store has spoiled or been
       taken. Someone new can take it on.</p>
    <form method="post" action="/successor">
      <label>Name <input name="name" placeholder="Survivor" required></label>
      <button type="submit">Take over the camp</button>
    </form>`;
}

function renderExpeditions(view) {
  if (view.expedition) {
    const hoursLeft = (new Date(view.expedition.returnsAt).getTime() - Date.now()) / 3600000;
    const due =
      hoursLeft > 0
        ? `due back in ${n(hoursLeft)} h`
        : 'overdue — reload to see what came back';
    return `<h2>Away</h2>
      <p>${escape(view.expedition.regionName)} — ${escape(due)}</p>`;
  }

  const rows = view.regions
    .map(
      (region) => `<tr>
        <th>${escape(region.name)}</th>
        <td>danger ${region.danger}</td>
        <td>${n(region.travel_hours, 0)} h</td>
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
    const due = hoursLeft > 0 ? `ready in ${n(hoursLeft)} h` : 'ready — reload to collect it';
    return `<h2>On the bench</h2>
      <p>${escape(view.craft.name)} — ${escape(due)}</p>`;
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
      const price = escape(`${priceOf(recipe)}, ${n(recipe.craft_hours)} h`);
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
    const when = hoursLeft > 0 ? `being fitted, ${n(hoursLeft)} h left` : 'fitted, reload';
    return `<tr><td colspan="5"><small>${label} <em>(${escape(when)})</em></small></td></tr>`;
  }

  if (structure.level < upgrade.requiresLevel) {
    return `<tr><td colspan="5"><small>${label}
      <em>(needs level ${upgrade.requiresLevel})</em></small></td></tr>`;
  }

  // Fuel only comes home from expeditions, so the cost is worth spelling out.
  const cost = escape(`${upgrade.fuel} fuel, ${n(upgrade.hours)} h`);
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
    const when = hoursLeft > 0 ? `done in ${n(hoursLeft)} h` : 'done — reload';
    return `<td colspan="2">building level ${structure.level + 1}, ${escape(when)}</td>`;
  }

  if (!structure.nextCost) return '<td></td><td></td>';

  const cost = `${structure.nextCost.scrap} scrap, ${n(structure.nextCost.hours)} h`;
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

function renderRoster(roster) {
  if (roster.length === 0) return '';
  const rows = roster
    .map(
      (r) => `<tr><th>${escape(r.name)}</th><td>${escape(r.cause_of_death)}</td>
              <td>${n(r.days_survived)} days</td></tr>`,
    )
    .join('');
  return `<h2>Those who held this camp</h2><table>
    <tr><th>Name</th><th>Cause</th><th>Survived</th></tr>${rows}</table>`;
}
