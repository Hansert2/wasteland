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

export function campPage(view) {
  return layout(view.name, `
    <h1>${escape(view.name)}</h1>
    <p>Camp strength ${view.strength} &middot; founded ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>

    ${renderEvents(view.events)}
    ${view.survivor ? renderSurvivor(view.survivor) : renderNoSurvivor()}
    ${renderResources(view.resources)}
    ${renderStructures(view.structures)}
    ${renderRoster(view.roster)}

    <form method="post" action="/logout"><button type="submit">Log out</button></form>
  `);
}

function renderEvents(events) {
  if (events.length === 0) return '';
  const items = events
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
    case 'expedition_lost':
      return `${when} — an expedition never came home.`;
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

function renderResources(resources) {
  const rows = resources
    .map(
      (r) => `<tr><th>${escape(r.kind)}</th><td>${n(r.amount)} / ${n(r.cap, 0)}</td>
              <td>${r.ratePerHour > 0 ? `+${n(r.ratePerHour)}/h` : '&mdash;'}</td></tr>`,
    )
    .join('');
  return `<h2>Stores</h2><table>${rows}</table>`;
}

function renderStructures(structures) {
  const rows = structures
    .map((s) => `<tr><th>${escape(s.kind.replaceAll('_', ' '))}</th><td>level ${s.level}</td></tr>`)
    .join('');
  return `<h2>Structures</h2><table>${rows}</table>`;
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
