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

  /* A section that just changed under the player, because the page updates in place
     rather than reloading. Without a cue, things change while you are reading a
     different part of the page and you never notice — which is worse than the reload
     it replaced. Neutral grey so it works on any ground the redesign chooses. */
  @keyframes changed {
    from { background-color: rgba(127, 127, 127, 0.28); }
    to   { background-color: transparent; }
  }
  section.changed { animation: changed 1.2s ease-out; }
  @media (prefers-reduced-motion: reduce) { section.changed { animation: none; } }
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
/**
 * How long something takes, as a span rather than as a countdown.
 *
 * This used to hand its hours to `clock()`, which is the formatter the live countdowns
 * use — so a static label about a trip that is always exactly eight hours long read
 * "8h 00m 00s", seconds of precision on a number that has never had seconds in it. The
 * same mistake as the elapsed time in the Away report, one layer down: a countdown
 * formatter borrowed for something that is not counting down.
 *
 * `clock()` is left exactly as it is. It is interpolated into the browser script and
 * pinned by a test, and a ticking clock genuinely does want its seconds.
 *
 * Two units at most, and never a unit that is zero. Precision below a minute survives
 * only for spans that are under a minute, where it is the whole answer.
 */
function duration(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 'now';

  const totalMinutes = Math.round(h * 60);
  const days = Math.floor(totalMinutes / 1440);
  const restHours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return restHours > 0 ? `${days}d ${restHours}h` : `${days}d`;
  if (restHours > 0) return minutes > 0 ? `${restHours}h ${minutes}m` : `${restHours}h`;
  if (minutes > 0) return `${minutes}m`;

  return `${Math.round(h * 3600)}s`;
}

/**
 * A span of time as hours, minutes and seconds.
 *
 * Rounded units — "2.1 h", "12 min" — are fine to read once and useless to watch: a
 * countdown that sits on "2.1 h" for six minutes looks broken even when it is not.
 * Seconds are what make a timer legibly alive, so they are always shown below a day.
 *
 * Three units at most. Past a day the seconds are noise nobody is watching tick, and
 * a build cost of "9d 03h 12m" is already at the edge of what fits in a table cell.
 *
 * The client script below cannot import this — it is inline JavaScript with no build
 * step to share modules through — so it is handed this function's own source instead,
 * the same way STORE_DECIMALS is interpolated. There is therefore no second copy to
 * keep in step, and the one rule that makes that work is: **this function must close
 * over nothing.** Only globals. A test evaluates it in an empty scope to prove it.
 */
export function clock(totalSeconds) {
  const t = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (t <= 0) return 'now';

  const d = Math.floor(t / 86400);
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (value) => String(value).padStart(2, '0');

  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
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
    // clock(), not duration(): the browser overwrites this every second using
    // clock() itself, so painting it any other way would change format on the first
    // tick. A countdown keeps its seconds; a span does not have any.
    escape(left > 0 ? clock(Math.round(left * 3600)) : done)
  }</span>`;
}

/**
 * How many decimals a store is shown to.
 *
 * One. Three was tried, on the reasoning that a fresh camp gains 0.7 food an hour and
 * a single decimal therefore only moves every eight and a half minutes — a live
 * counter that looks frozen. Three did move, every few seconds, and looked like
 * noise: two digits of precision nobody acts on, on four rows, changing constantly.
 *
 * The rate beside it is what actually answers "is my camp working", and it says so
 * in one legible figure without demanding to be watched. A number that changes
 * slowly because the thing it counts changes slowly is telling the truth.
 *
 * Declared once and interpolated into the script below, so the browser and the server
 * cannot disagree about it the way the two clock formatters could.
 */
const STORE_DECIMALS = 1;

/**
 * The whole of the client-side JavaScript, and it is meant to stay small.
 *
 * It does three things: ticks every visible timer once a second, extrapolates the
 * stores between server states, and — when a timer runs out or the player acts —
 * fetches a fresh copy of the page and swaps in the sections that changed.
 *
 * **The fetch is not optional and never was.** The server is the only thing that knows
 * what a finished build produced, what an expedition brought home, or whether the
 * survivor came back; outcomes roll from seeds server-side and the tick runs during
 * the render. This used to be a full `location.reload()`, and the only thing that has
 * changed is that the new HTML is applied in place instead of replacing the document.
 * Anything that removes the round trip entirely breaks the game.
 *
 * Two invariants that are easy to lose and produce infinite loops if lost:
 *
 * - **Only timers with a future instant are armed.** Re-checked on every swap, not
 *   once at load. An already-expired timer is showing the server's own "done" text,
 *   and asking the server about it again would never stop.
 * - **A response with no sections in it is a full navigation** — an expired session
 *   renders the landing page — so it falls back to a reload rather than swapping
 *   nothing and appearing frozen.
 */
export const TIMERS = `
(() => {
  // clock() itself, injected rather than copied out by hand — the same trick
  // STORE_DECIMALS already uses, so the browser and the server cannot disagree.
  // This is safe only because there is no build step: a minifier would make
  // Function.prototype.toString untrustworthy, and this would have to go back to a
  // second copy kept in step by a test. Keep clock() closing over nothing.
  const clock = ${clock.toString()};
  const fmt = (ms) => clock(ms / 1000);

  let live = [];
  let stores = [];
  let since = Date.now();
  let busy = false;

  // Re-read after every swap, so the future-only rule holds per render rather than
  // once per page.
  const scan = () => {
    live = [...document.querySelectorAll('[data-until]')]
      .filter((el) => Number(el.dataset.until) > Date.now());
    // Stores accrue continuously, so between server states they are extrapolated from
    // the rate the server sent. That rate is already net of the survivor and the
    // weather, which is why this is a straight line and not a simulation — the moment
    // it would need to be more than that, fresh state has arrived anyway.
    stores = [...document.querySelectorAll('[data-amount]')];
    since = Date.now();
  };

  const apply = (html) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const incoming = doc.querySelectorAll('section[id^="s-"]');
    if (incoming.length === 0) { location.reload(); return; }

    for (const next of incoming) {
      const current = document.getElementById(next.id);
      if (!current || current.innerHTML === next.innerHTML) continue;
      current.innerHTML = next.innerHTML;
      if (next.innerHTML.trim() === '') continue;
      // Restart the cue even if it is already running.
      current.classList.remove('changed');
      void current.offsetWidth;
      current.classList.add('changed');
    }

    scan();
    tick();
  };

  const fail = (fallback) => () => fallback();

  // An expired timer still has to ask the server what happened; it just does not throw
  // the document away to do it.
  const pull = () => {
    if (busy) return;
    busy = true;
    fetch(location.pathname, { credentials: 'same-origin' })
      .then((res) => res.text())
      .then(apply)
      .catch(fail(() => location.reload()))
      .finally(() => { busy = false; });
  };

  const tick = () => {
    const elapsedHours = (Date.now() - since) / 3600000;

    for (const el of stores) {
      const projected =
        Number(el.dataset.amount) + Number(el.dataset.rate) * elapsedHours;
      const clamped = Math.max(0, Math.min(Number(el.dataset.cap), projected));
      el.textContent = clamped.toFixed(${STORE_DECIMALS});
    }

    for (const el of live) {
      const left = Number(el.dataset.until) - Date.now();
      if (left > 0) { el.textContent = fmt(left); continue; }
      el.textContent = el.dataset.done;
      pull();
    }
  };

  // Actions post in place too. A form outside a section — logging out, and everything
  // on the landing page — is left alone and navigates as it always did.
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!form.closest('section[id^="s-"]')) return;

    event.preventDefault();
    if (busy) return;
    busy = true;

    const button = event.submitter;
    if (button) button.disabled = true;

    // urlencoded, because that is what the server parses. A refusal comes back as the
    // same page carrying an error, so success and failure need no separate handling.
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      body: new URLSearchParams(new FormData(form)),
    })
      .then((res) => res.text())
      .then(apply)
      .catch(fail(() => form.submit()))
      .finally(() => { busy = false; if (button) button.disabled = false; });
  });

  scan();
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

/**
 * One updatable region of the page.
 *
 * The page updates in place rather than reloading, and the client script does that by
 * comparing these against the same ids in a freshly fetched copy — so an id is a
 * contract, not decoration. Two rules follow from that and are easy to break by
 * accident:
 *
 * - **A section is always rendered, even when it is empty.** A caravan that arrives
 *   while the page is open has to have somewhere to appear. Omitting the empty case
 *   would mean it never shows up until the player navigated.
 * - **Forms inside a section are submitted in place; forms outside one navigate.**
 *   That is how logging out still leaves the page, with no extra markup to remember.
 */
const section = (id, html) => `<section id="s-${id}">${html ?? ''}</section>`;

/**
 * The camp page, in the order a check-in actually reads.
 *
 * Nothing here is styling — the look is still scaffolding — but the *sequence* is not
 * decoration, and it had drifted into the order things were built in rather than the
 * order they are used in. Four groups, and the reasoning is worth keeping because a
 * redesign will want to move all of it:
 *
 * 1. **Anything with a deadline**, which is the rule the top slot already had: a moment
 *    closing, raiders due. The sky sits with them because it changes what a trip is
 *    worth right now.
 * 2. **What happened while you were gone**, then the person it happened to and what
 *    they are carrying. The pack moved up beside the survivor: it hangs off the
 *    character, dies with them, and reading it three sections away from their health
 *    made it look like camp stores.
 * 3. **What the camp is spending on** — stores, then the two things fuel can go to.
 *    Structures and the road are now adjacent on purpose: a fitting and a link are the
 *    same 60-to-70 fuel, and the whole decision Phase 8 adds is choosing between them.
 *    Putting them a screen apart hid the only interesting question in the phase.
 * 4. **Who you can trade with**, together at last — the caravan at the gate, the post on
 *    the road, and the standings that price both. Those three were scattered across
 *    three separate places, which made a post look like a second unrelated shop.
 *
 * The graveyard stays at the bottom. It is the one thing on the page that is finished.
 */
export function campPage(view, { error } = {}) {
  return layout(view.name, `
    ${section('head', `
      <h1>${escape(view.name)}</h1>
      <p>Wealth ${view.wealth} &middot; defence ${view.defence} &middot; founded
         ${escape(view.foundedAt.toISOString().slice(0, 10))}</p>`)}
    ${section('error', error ? `<p class="error">${escape(error)}</p>` : '')}

    ${section('moment', renderMoment(view.expedition))}
    ${section('raid', renderRaidWarning(view.raidExpectedAt))}
    ${section('sky', renderWeather(view.weather))}

    ${section('events', renderEvents(view.events))}
    ${section(
      'survivor',
      view.survivor
        ? renderSurvivor(view.survivor, view.strain)
        : renderNoSurvivor(view.fallenCount > 0, view.arriving),
    )}
    ${section('inventory', renderInventory(view.inventory))}
    ${section('direction', renderDirection(view.direction))}
    ${section('expedition', view.survivor ? renderExpeditions(view) : '')}

    ${section('stores', renderResources(view.resources))}
    ${section(
      'structures',
      renderStructures(view.structures, view.buildInFlight, Boolean(view.survivor)),
    )}
    ${section('road', renderRoad(view.road))}
    ${section('workshop', renderWorkshop(view))}

    ${section('caravan', renderCaravan(view.caravan, Boolean(view.survivor)))}
    ${section('post', renderPost(view.post, Boolean(view.survivor)))}
    ${section('standings', renderStandings(view.standings))}

    ${section('roster', renderRoster(view.fallenCount))}

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
    .map(
      (event) => `<li><strong>${escape(event.name)}</strong> (${countdown(event.endsAt, 'clearing')} left) &mdash;
        ${escape(event.description)}${effectLine(event.effects)}</li>`,
    )
    .join('');

  // Two blights are worse than one, and the page had no way to say so. Only shown when
  // something is actually stacking, because for one event it would restate the line
  // directly above it.
  const together = weather.length > 1 ? `<p><small>Together: ${escape(stacked(weather))}.</small></p>` : '';

  return `<h2>The sky</h2><ul class="events">${items}</ul>${together}`;
}

/**
 * What an event costs, under the sentence about what it looks like.
 *
 * The sky used to be prose and a countdown, and prose is the wrong instrument for this:
 * a blight is on for days and slows the garden to a third, and a player was left to
 * infer that from a stores figure drifting. **The whole decision the weather offers is
 * when to spend survivor-hours** — send them under Caravan Season, keep them home under
 * a Rad Storm — and a multiplier nobody can see is not a decision.
 *
 * Multipliers rather than adjectives, because they are exact and because the page is
 * already numeric one section down. `docs/LORE.md` bars numbers with authority from the
 * *prose*, and this deliberately is not prose: it sits under the sentence, in small, in
 * the same register as "danger 4" on the dispatch table.
 */
function effectLine(effects) {
  if (!effects || effects.length === 0) return '';

  const here = effects.filter((e) => e.where === 'camp').map(factor);
  const there = effects.filter((e) => e.where === 'road').map(factor);

  const parts = [];
  if (here.length > 0) parts.push(`in camp ${here.join(', ')}`);
  if (there.length > 0) parts.push(`out there ${there.join(', ')}`);

  return `<br><small>${escape(parts.join(' &middot; '))}</small>`.replace('&amp;middot;', '&middot;');
}

const factor = (effect) => `${effect.what} ×${effect.factor}`;

/** Everything in force, multiplied out — which is what the tick actually applies. */
function stacked(weather) {
  const totals = new Map();
  for (const event of weather) {
    for (const effect of event.effects ?? []) {
      const seen = totals.get(effect.what) ?? { ...effect, factor: 1 };
      totals.set(effect.what, { ...seen, factor: seen.factor * effect.factor });
    }
  }

  return [...totals.values()]
    .map((effect) => `${effect.what} ×${Math.round(effect.factor * 100) / 100}`)
    .join(', ');
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
  // aria-live because this list now grows without the page navigating: a build that
  // finishes while the player is reading is announced rather than silently appearing.
  return `<h2>While you were away</h2><ul class="events" aria-live="polite">${items}</ul>`;
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

/**
 * The consequence of a radiation figure, in the same cell as the figure.
 *
 * Not `class="error"`: that box is the alarm idiom and belongs to raids. A survivor
 * cooking gently is a thing to plan around, not an alarm — and the numbers say how
 * urgent it is far better than a colour would.
 */
function strainNote(strain) {
  if (!strain || strain.state === 'mending') return '';

  const clear = `clear in ${duration(strain.hoursToMending)}`;

  if (strain.state === 'burning') {
    return ` &mdash; <small>past ${strain.threshold}: losing ${n(strain.damagePerHour)} health an hour, under ${strain.threshold} in ${duration(strain.hoursToSafe)}, ${clear}</small>`;
  }

  return ` &mdash; <small>not healing until this is down, ${clear}</small>`;
}

function renderSurvivor(survivor, strain) {
  // What this one is, under how they are doing. Without it the skills are two hidden
  // multipliers and the arrival prose was a thing the player read once and never saw
  // the consequences of — which is the failure the whole feature exists to avoid.
  const who = survivor.knownFor
    ? `<p><small>${escape(survivor.knownFor)}.</small></p>`
    : '';

  return `
    <h2>${escape(survivor.name ?? 'Survivor')}</h2>
    ${who}
    <table>
      <tr><th>Health</th><td>${n(survivor.health)}</td></tr>
      <tr><th>Hunger</th><td>${n(survivor.hunger)}</td></tr>
      <tr><th>Radiation</th><td>${n(survivor.radiation)}${strainNote(strain)}</td></tr>
    </table>`;
}

/**
 * The empty camp. A camp nobody has ever held is not a camp that has been abandoned,
 * and telling a brand-new player their stores have spoiled would be a lie on the
 * first screen they see.
 */
function renderNoSurvivor(everHeld, arriving) {
  const preamble = everHeld
    ? `<p>Structures have fallen into disrepair and much of the store has spoiled or
         been taken.</p>`
    : `<p>Four walls, a garden, and enough water to start. It needs somebody in it.</p>`;

  // Who is at the gate, named before the button rather than after it. The name box that
  // used to sit here is gone: a survivor is somebody who turned up, and the page says so
  // by telling the player who *has* turned up and offering one button about it. There is
  // deliberately nothing to reroll — reloading shows the same person, because
  // `wandererFor` derives them from the camp and the count of everyone before them.
  const atTheGate = arriving
    ? `<p><strong>${escape(arriving.name)}</strong> is at the gate.
         ${escape(arriving.arrival)}</p>
       <p><small>Known for: ${escape(arriving.knownFor)}.</small></p>`
    : '';

  return `
    <h2>The camp stands empty</h2>
    ${preamble}
    ${atTheGate}
    <form method="post" action="/successor">
      <button type="submit">${everHeld ? 'Let them take it on' : 'Let them stay'}</button>
    </form>`;
}

/**
 * A moment, in the top slot beside the raid warning.
 *
 * That slot's rule is that the only thing on the page with a deadline goes first, and a
 * closing window is the second thing to qualify. It is deliberately *not* given
 * `class="error"` — that box is the alarm idiom and a moment is an invitation. A warned
 * option is the exception, and carries its warning where every other option carries its
 * price.
 *
 * The one-line context sentence duplicates what the Away section says further down, on
 * purpose: a decision needs its facts beside it, and making somebody scroll to find out
 * whether 34 health is bad would be the whole design failing at the last inch.
 */
/**
 * The button, or the reason there isn't one.
 *
 * Same shape as the bench, deliberately: a recipe you cannot afford keeps its row and
 * says which workshop level it wants, because hiding it hides the goal. An option
 * priced in a dose the survivor is not carrying is the same case — it is a real option
 * on a real trip, and what it is missing is a thing you can go and craft. What it must
 * never do is look identical to an option you can take and refuse after the click,
 * which is what it did until 2026-08-19, on a window with eleven minutes left on it.
 */
function momentAction(moment, option) {
  if (option.missing) return `<small>needs ${escape(option.needs)}</small>`;

  return `<form method="post" action="/moment" style="margin:0">
            <input type="hidden" name="index" value="${moment.index}">
            <input type="hidden" name="option" value="${escape(option.key)}">
            <button type="submit">Choose</button>
          </form>`;
}

function renderMoment(expedition) {
  const moment = expedition?.moment;
  if (!moment) return '';

  const rows = moment.options
    .map(
      (option) => `<tr>
        <th>${escape(option.label)}</th>
        <td>${option.warned ? '&#9888; ' : ''}${escape(option.detail)}</td>
        <td>${momentAction(moment, option)}</td>
      </tr>`,
    )
    .join('');

  return `<h2>Contact &mdash; ${countdown(moment.closesAt, 'gone')} to answer</h2>
    <p>${escape(condition(expedition))}</p>
    <p><strong>${escape(moment.prose)}</strong></p>
    <table>${rows}</table>`;
}

/** "Six hours into the Deep Zone, carrying 22 scrap, at 61 health." */
/**
 * How long they have been gone, in hours and deliberately not in seconds.
 *
 * This used to be `duration()`, which is a countdown formatter, so the page printed
 * "17m 08s into The Millrace" directly beneath a due-back timer that was actually
 * ticking: one live clock and one frozen one, and the frozen one reads as broken.
 *
 * Wiring it to tick would have been the wrong fix. The two would then be counting the
 * same span from opposite ends — two timers to say one thing — and the page contract
 * has exactly one job for a live countdown, which is to fetch fresh state when it
 * expires. Elapsed time never expires.
 *
 * Rounded to hours it changes about as slowly as the thing it measures, which is the
 * argument the haul is already rendered on: a number that changes slowly because the
 * thing it counts changes slowly is telling the truth.
 */
function elapsed(hoursOut, region) {
  // Under a few minutes there is nothing to round to, and "0 hours in" is a worse
  // answer than saying what actually happened.
  if (hoursOut < 0.05) {
    return region ? `Just set out for ${region}` : 'Just set out';
  }

  const into = region ? ` into ${region}` : ' in';
  if (hoursOut < 1) return `Less than an hour${into}`;

  const whole = Math.floor(hoursOut);
  return `${whole} hour${whole === 1 ? '' : 's'}${into}`;
}

/**
 * The one-line state of a trip.
 *
 * The region is named only where the surrounding block has not already said it. In the
 * moment box it has not — that heading is "Contact", and a decision needs to know where
 * they are. In the Away report the heading *is* the region, so naming it here put the
 * same words twice in two consecutive lines.
 */
function condition(expedition, { region = true } = {}) {
  const carried = Object.entries(expedition.carrying)
    .map(([kind, amount]) => `${amount} ${kind}`)
    .join(', ');

  return [
    elapsed(expedition.hoursOut, region ? expedition.regionName : null),
    carried ? `carrying ${carried}` : 'carrying nothing yet',
    `at ${n(expedition.health, 0)} health`,
  ].join(', ') + '.';
}

function renderExpeditions(view) {
  if (view.expedition) {
    const trip = view.expedition;
    const hoursLeft = (new Date(trip.returnsAt).getTime() - Date.now()) / 3600000;
    const due =
      hoursLeft > 0
        ? `due back in ${countdown(trip.returnsAt, 'now')}`
        : 'overdue — reload to see what came back';

    // The report, which is what makes a check-in that catches no window worth making.
    // Rendered once and not animated: the haul steps by a whole unit about once an
    // hour, so a live counter would buy nothing and would cost the client script a copy
    // of the progress curve.
    const lines = [
      `${escape(trip.regionName)} — ${due}`,
      escape(condition(trip, { region: false })),
    ];

    if (trip.damage > 0) {
      lines.push(`Hurt out there${trip.cause ? ` — ${escape(trip.cause)}` : ''}.`);
    }
    if (trip.radiation > 0) lines.push(`${n(trip.radiation)} rads so far.`);
    if (trip.findCount > 0) {
      lines.push(`${trip.findCount} thing${trip.findCount === 1 ? '' : 's'} worth keeping.`);
    }
    if (trip.nextMomentAt) {
      lines.push(`Radio: next contact in ${countdown(trip.nextMomentAt, 'any moment')}.`);
    }

    // What has already been answered, and — the part that was missing — the fact that
    // it has not happened yet. Answering records a choice and nothing more; the trip is
    // still rolled at the return, with the answers as an input. Without this the moment
    // box simply vanished on submit and the page said nothing at all until the survivor
    // walked back through the gate, which reads exactly like a button that did nothing.
    for (const answer of trip.settled ?? []) {
      lines.push(`${escape(answer.title)}, ${duration(answer.atHour)} in — ${escape(answer.label)}.`);
    }
    if ((trip.settled ?? []).length > 0) {
      lines.push('What came of that comes home with them.');
    }

    return `<h2>Away</h2><p>${lines.join('<br>')}</p>${momentAlarm(trip)}`;
  }

  const rows = view.regions
    .map(
      (region) => `<tr>
        <th>${escape(region.name)}</th>
        <td>danger ${region.danger}</td>
        <td>${escape(duration(region.travel_hours))}</td>
        <td>${escape(contact(region.moments))}</td>
        <td>${escape(meanwhile(region.openWhileAway))}</td>
        <td>
          <form method="post" action="/expedition" style="margin:0">
            <input type="hidden" name="region" value="${escape(region.slug)}">
            <button type="submit">Send</button>
          </form>
        </td>
      </tr>
      <tr><td colspan="6"><small>${escape(region.description ?? '')}</small></td></tr>`,
    )
    .join('');

  return `<h2>Where to send them</h2><table>${rows}</table>`;
}

/**
 * One line telling a new camp what this game is, directly above the table where the
 * mistake gets made.
 *
 * Placed last in the group that ends with the dispatch decision, because that is the
 * decision it is about: a new player reads the region table top to bottom, finds the
 * interesting names at the dangerous end, and buys twelve hours of a page that cannot
 * change. The advice has to arrive before their eye does.
 *
 * Deliberately not in the top slot with the raid warning and the closing moment. Those
 * are there because they expire; this does not, and putting a permanent line among the
 * things that vanish would teach the player to stop reading that corner of the page.
 *
 * Understated on purpose — one heading, one sentence, no list, no progress bar, no
 * count of steps remaining. See `docs/DESIGN-BRIEF.md` on the voice. It disappears for
 * good once the camp has been round the loop, which is the other half of not being a
 * quest log: a quest log is proud of itself and this leaves without saying goodbye.
 */
function renderDirection(direction) {
  if (!direction) return '';
  return `<h2>Next</h2><p>${escape(direction.line)}</p>`;
}

/**
 * A timer set for the instant the next window opens, so the box arrives on its own.
 *
 * The page is not a document that sits still — every deadline on it is armed, and when
 * one runs out the script fetches fresh state and swaps in whatever changed. A build
 * finishing, a craft coming off the bench, a caravan reaching the gate, the survivor
 * walking back through it: all of them appear without anybody pressing anything.
 *
 * A moment opening did not, and the reason is an accident worth writing down. The
 * radio's line is rendered with `countdown()`, which emits `data-until`, which the
 * script arms like any other — so a camp with a radio fitted has *always* had its
 * moment box appear by itself, and a camp without one has been sitting on a page that
 * silently declined to update. That is not the radio being worth its fuel. That is the
 * only upgrade-gated refresh on the page, gated by nobody's decision.
 *
 * **So this is not gated, and the radio keeps the job it was sold for.** It tells you
 * *when* — which is what lets you decide to wait, or to go and do something else and
 * come back. Without it the window simply arrives unannounced, exactly as a moment met
 * by reloading at the right minute always did, minus the reloading. A player sitting on
 * the page watching has attended either way; making them press F5 to prove it was never
 * a design, it was static HTML.
 *
 * Silent, and hidden, because announcing it *is* the radio. `data-done` is empty for
 * the same reason: when it fires there is nothing to say, only something to fetch.
 *
 * Skipped entirely when the radio line is up, since that line already carries a timer
 * for this instant and two spans would arm two timers for one fetch.
 */
function momentAlarm(trip) {
  if (trip.nextMomentAt) return '';

  const opensAt = (trip.upcoming ?? [])[0];
  if (!opensAt) return '';

  return `<span hidden>${countdown(opensAt, '')}</span>`;
}

/**
 * What the camp can do while they are gone, on the table where the trip is still a
 * choice.
 *
 * **A count, and it must stay a count.** There was a companion to this in the Away
 * report — the same plan rendered as a list of four doors and the hour each opened —
 * and it was removed on 2026-08-21 after being read beside the Next block, which
 * disagreed with it out loud. Three faults, and the third is the one that matters:
 *
 * - The plan's door list had no fittings in it, so the advice offered the Radio while
 *   the list beneath said the camp could pay for nothing. Fixed, and it was a real bug
 *   — this column was wrong too.
 * - An overdue trip has negative hours left, so every door filtered out and the block
 *   announced a dead evening to a camp whose survivor was already home.
 * - **`planFor` is greedy cheapest-first, which is honest for a count and misleading as
 *   a list.** Spending ten fuel on a Rad Scrubber puts the Radio out of reach, so the
 *   Radio is dropped — correct, since the camp cannot have both, and useless to read,
 *   since it silently picks one branch of a fork and never mentions the other.
 *
 * A count survives all three, because "will this evening have anything in it" does not
 * depend on which branch is taken. Anything above zero means yes; zero means the camp
 * goes quiet the moment you click Send, and that is worth knowing *before* the click
 * rather than four hours into finding out. The Next block says the same thing in words
 * once the trip is actually out.
 */
function meanwhile(count) {
  const n = Number(count) || 0;
  if (n === 0) return 'nothing to do meanwhile';
  return n === 1 ? '1 thing to do meanwhile' : `${n} things to do meanwhile`;
}

/**
 * What the trip holds, in the word the rest of the page already uses for it.
 *
 * "Contact" is what the radio line and the moment box call an encounter, so the
 * dispatch table says it the same way rather than inventing a second name for the
 * same thing. A region with none says *why* — the reason is a fact about the trip's
 * length, and a player who knows it can choose against it deliberately instead of
 * discovering over fifteen dispatches that nothing ever happens on a ten-minute run.
 */
function contact(count) {
  const n = Number(count) || 0;
  if (n === 0) return 'too short for contact';
  return n === 1 ? '1 contact' : `${n} contacts`;
}

/**
 * The road, which is the only thing on this page that measures years.
 *
 * Everything else here is about the next few hours: what is finishing, what is due
 * back, what the stores will do by morning. This section is the one place the camp
 * gets to be older than its survivor, so it reads as a list of places rather than as
 * a progress bar with a number on it — the neighbours are the point, and the fuel is
 * how you get to them.
 *
 * Reached links carry their news, which is derived fresh every render: somebody
 * standing last week can be gone on this load. What they gave is not taken back.
 */
/**
 * The post on the road: the same goods a caravan carries, and no deadline on them.
 *
 * Rendered as its own section rather than folded into the caravan, because the two are
 * different things wearing the same table. A caravan is a window and reads as one — it
 * arrives, it has a countdown, it goes. A post has no countdown at all, and giving it
 * one would be inventing urgency the road exists to remove.
 */
function renderPost(post, alive) {
  if (!post) return '';

  const rows = post.offers
    .map(
      (offer) => `<tr>
        <th>${offer.qty} &times; ${escape(String(offer.what).replaceAll('_', ' '))}</th>
        <td>${escape(
          Object.entries(offer.costs).map(([kind, amount]) => `${amount} ${kind}`).join(', '),
        )}</td>
        <td>${offer.shortBy
          ? `<small>${escape(offer.shortBy)}</small>`
          : alive
          ? `<form method="post" action="/trade" style="margin:0">
              <input type="hidden" name="faction" value="${escape(post.faction)}">
              <input type="hidden" name="offer" value="${offer.index}">
              <button type="submit">Buy</button>
            </form>`
          : ''}</td>
      </tr>`,
    )
    .join('');

  return `<h2>The post on the road</h2>
    <p>${escape(post.name)} keep it. Standing ${Math.round(post.standing)}.</p>
    <table>${rows}</table>`;
}

/**
 * The box that puts fuel toward the next link.
 *
 * "Send fuel up the road" was a metaphor doing a mechanic's job. Nothing is sent
 * anywhere: fuel comes out of the stores and stays on the link until the link is paid
 * for. So the button says what it does, and the sentence that explains the rule lives
 * above the table rather than inside the form, where it was competing with the numbers.
 *
 * With no fuel at all there is no form, for the same reason a recipe you cannot afford
 * has no button: an input that can only be refused is not an offer.
 */
function addFuel(road) {
  const wanted = road.next.cost - road.next.fuel;
  const most = Math.floor(Math.min(road.available, wanted));

  if (most < 1) {
    return `<p><small>No fuel in the stores. Only expeditions bring it back.</small></p>`;
  }

  return `<form method="post" action="/road">
      <input type="number" name="fuel" min="1" max="${most}" step="1"
             value="${most}" required>
      <button type="submit">Add fuel</button>
    </form>`;
}

/**
 * What reaching a place gets the camp, said as a reward rather than as a category.
 *
 * "Somewhere to go" told the player which box the link was in; it did not tell them
 * whether 70 fuel was worth spending. A destination is worth exactly what a region is
 * worth, so it says the things a region is judged on — how far, how dangerous, how much
 * there is to answer out there — in the same words the dispatch table uses.
 *
 * And a link that brings only news says so plainly. Three of the seven pay in nothing
 * but the sight of somebody else out there, which is deliberate — a road where every
 * step pays is a shop, not a road — and dressing that up would be the page lying about
 * the design.
 */
function linkGot(link) {
  const parts = [];

  if (link.place) {
    const contact =
      link.place.moments > 0
        ? `${link.place.moments} contact${link.place.moments === 1 ? '' : 's'}`
        : 'no contact';

    parts.push(
      `somewhere new to send people &mdash; ${escape(duration(link.place.travelHours))} out, danger ${link.place.danger}, ${contact}`,
    );
  }

  if (link.tradePost) parts.push('a trader who never moves on, unlike a caravan');

  return parts.join('<br>') || 'word of who else is out there, and nothing more';
}
function renderRoad(road) {
  if (!road) return '';

  const reached = road.reached
    .map(
      (link) => `<tr>
        <th>${escape(link.name)}</th>
        <td>${link.stillThere ? `${link.size} people` : 'nobody left'}</td>
        <td>${linkGot(link)}</td>
      </tr>
      <tr><td colspan="3"><small>${escape(link.news)}</small></td></tr>`,
    )
    .join('');

  // The end of the road is a standing fact about the camp, not a win: nothing resets
  // and nothing is taken away, so it says so plainly and stops asking for fuel.
  if (!road.next) {
    return `<h2>The road &mdash; all ${road.links} reached</h2>
      <p>The region is as reconnected as this camp can make it.</p>
      <table>${reached}</table>`;
  }

  // Said once, while it is still news. After a link or two the rule is obvious from
  // having done it, and a page that keeps explaining itself is a page nobody reads.
  const rule =
    road.reached.length === 0
      ? `<p>Fuel you put toward a place is spent — you cannot take it back. It counts
           toward reaching that place, and once the cost is covered it stays reached.</p>`
      : '';

  const beyond =
    road.beyond > 0
      ? `<p><small>${road.beyond} more after that.</small></p>`
      : '<p><small>The last one.</small></p>';

  return `<h2>The road &mdash; ${road.reached.length} of ${road.links} reached</h2>
    ${rule}
    ${reached ? `<table>${reached}</table>` : ''}
    <p>Working toward <strong>${escape(road.next.neighbour)}</strong> &mdash;
       ${linkGot(road.next)}.<br>
       Paid so far: ${n(road.next.fuel, 0)} of ${n(road.next.cost, 0)} fuel.
       You have ${n(road.available, 0)}.</p>
    ${addFuel(road)}
    ${beyond}`;
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
  // And the same rule the workshop level already follows: keep the row, drop the
  // button, say what it wants. Hiding it would hide the goal.
  if (recipe.shortBy) return `<small>${escape(recipe.shortBy)}</small>`;

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
      // A caravan is at the gate for a few hours, so an offer the stores cannot
      // cover is worth naming rather than leaving to be discovered by clicking.
      const buy = offer.shortBy
        ? `<small>${escape(offer.shortBy)}</small>`
        : someoneAlive
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

/**
 * The stores, climbing or falling in front of you.
 *
 * The amount carries its rate and cap so the script can extrapolate between loads,
 * which is what an idle game's numbers are supposed to do — a camp that visibly
 * fills is the whole feedback loop, and a static number made it look stalled.
 *
 * The rate is net: production, scaled by whatever the weather is doing, minus what
 * the survivor eats. A negative one is shown rather than hidden, because a store
 * quietly draining is the single most useful thing this table can tell you.
 */
function renderResources(resources) {
  const rows = resources
    .map((r) => {
      const rate =
        r.ratePerHour === 0
          ? '&mdash;'
          : `${r.ratePerHour > 0 ? '+' : ''}${n(r.ratePerHour)}/h`;

      return `<tr><th>${escape(r.kind)}</th>
        <td><span data-amount="${r.amount}" data-rate="${r.ratePerHour}"
                  data-cap="${r.cap}">${n(r.amount, STORE_DECIMALS)}</span>
            / ${n(r.cap, 0)}</td>
        <td>${rate}</td></tr>`;
    })
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
    upgrade.shortBy
      ? `<small>${escape(upgrade.shortBy)}</small>`
      : buildInFlight || !someoneAlive
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

  if (structure.shortBy) {
    return `<td>${escape(cost)}</td><td><small>${escape(structure.shortBy)}</small></td>`;
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
