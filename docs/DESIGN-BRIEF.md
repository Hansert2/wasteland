# Wasteland — brief for a visual redesign

**Read this before changing anything the player sees.**

The current look is scaffolding. It was written to keep the page readable while the
real question — whether checking in on a camp is *fun* — got answered, and it has never
had a design pass. Replacing it is expected and welcome.

The problem is that `src/web/render.js` is not only a view layer. A few things in it
look like decoration and are actually load-bearing, and if they are dropped the game
does not appear broken — it appears *finished*, sitting quietly on a screen that has
stopped updating. This document exists so that does not happen.

---

## 1. What the game is

A post-apocalyptic browser text RPG. You hold one camp and one survivor. The camp is
persistent and outlives its people; the survivor is not, and will eventually die of
something. The loop is checking in, reading what happened while you were gone, and
spending what you have on the next few hours.

It is text-first by design. Numbers, timers and short prose are the entire interface —
there is no map, no avatar, no art. **A redesign should make that text beautiful and
legible rather than replace it with graphics.** Think of it as designing a well-set
page rather than a game UI with a HUD. (One narrow exception has been granted: bars for
gauges and store fill. See §2.1.)

**Stack:** Node + Express, server-rendered HTML built by string templates. No React, no
Tailwind, no component library, no CSS file — one `STYLE` constant and one inline
`<script>`. **There is no build step, and that is a hard constraint (see §4).**

---

## 2. The direction, and what you may change freely

### 2.1 The direction — settled, not open

Four decisions have been made by the game's author. Treat them as the brief rather than
as suggestions.

**Register: quiet and modern, deliberately qualified.** A calm, legible, contemporary
interface — not a themed one. No rust textures, no stencil fonts, no terminal-green, no
"post-apocalyptic" costume on the furniture. The atmosphere lives entirely in the prose,
and the frame's job is to stay out of its way.

That has a specific failure mode, and avoiding it is most of the work: **if the result
could be an analytics dashboard with the words swapped out, it has gone wrong.** The
camp is a place the player is meant to care about, not four numbers to optimise. Three
deliberate concessions keep the frame quiet without letting it go generic:

1. **Warm neutral grounds, never pure white or pure black.** Off-white with a little
   warmth in light mode; a warm dark grey — not blue-black, not `#000` — in dark. This
   is the cheapest and most effective single move, and it is most of what stops the page
   reading as app chrome.
2. **The prose is typeset as prose, not as UI text.** The event log, region and item
   descriptions, faction blurbs and encounter text get their own treatment: larger, more
   line-height, a face with some character to it, a comfortable measure. Labels, numbers
   and controls can be a plain modern sans. **This distinction is the single most
   important typographic decision in the redesign** — it is what stops the writing
   degrading into flavour text nobody reads.
3. **One accent, reserved for meaning.** A single warm accent — oxide, amber, something
   in that family — used *only* for urgency and cost: expiring deadlines, warnings, the
   raid banner. If it never appears decoratively, its appearance always means something.

And one functional requirement that happens to serve the register: **tabular or
monospaced figures for anything that ticks.** Countdowns and store amounts re-render
every second, and proportional digits make them jitter. This is a legibility fix first
and a quiet nod to instrumentation second.

Restraint list, because "modern" drifts into "generic SaaS" without one: no gradients,
no drop shadows, no rounded-everything, no icon set, no illustration, no animation
beyond the timers, no emoji.

**Density: separate views.** The camp page is split into tabs or sibling pages rather
than one long scroll. See §7.3 for the intended split and the constraints on it.

**Encoding: numbers plus restrained bars.** Bars for the three survivor gauges and for
store fill, where a proportion is genuinely the point. The exact number stays beside the
bar — the bar never replaces it. Nothing else gets a chart: no sparklines, no trend
lines, no map diagram.

**Device: desktop first.** Optimise for a wide window — multiple columns, denser tables,
more visible at once. Phone must remain usable but is explicitly the compromise rather
than the target.

### 2.2 What you may change freely

Essentially all of the appearance:

- every tag, class, id and layout decision
- all CSS, including the whole `STYLE` constant
- typography, colour, spacing, density, dark/light handling
- how tables, forms and lists are structured
- page-level composition and the order of blocks, with one exception noted in §5
- adding a stylesheet, adding CSS custom properties, adding modest inline SVG

You do **not** need to preserve the monospace font, the 44rem column, the bare tables,
or any class name currently in the file. `class="error"` in particular is not a semantic
commitment — it is just what the box looked like on day one.

---

## 3. Hard constraints — the invisible mechanics

This is the part the rest of the document exists for. **Everything here is behaviour,
not style.** Breaking any of it produces a page that looks fine and quietly stops
working.

### 3.1 The data-attribute contract

The inline script is the entire client-side JavaScript. It does not know about your
markup; it finds its work by querying for attributes. Whatever you build must keep
emitting these, on some element, wherever the corresponding value appears:

| Attributes | Meaning |
|---|---|
| `data-until` (epoch ms), `data-done` (text) | A live countdown. Re-rendered every second; shows `data-done` when it expires. |
| `data-amount`, `data-rate` (per hour), `data-cap` | A store that accrues. Extrapolated along a straight line between page loads and clamped to `[0, cap]`. |

The server helper `countdown(at, done)` emits the first pair. `renderResources` emits
the second set. **Route every deadline and every store through those helpers rather
than writing the attributes by hand**, and the contract takes care of itself.

### 3.2 The round trip is mechanical, not cosmetic

**This is the single most important paragraph in this document.**

When a countdown reaches zero, the script **fetches a fresh copy of the page and swaps
in the sections that changed**. The same happens when the player submits an action. That
round trip is not a nicety — it is *how a finished thing becomes visible*. The server is
the only thing that knows what a completed build produced, what an expedition brought
home, or whether the survivor came back at all. The client cannot compute any of it, and
must never try.

A redesign that renders a deadline as its own hand-rolled timer — entirely reasonable
markup, looks correct, reviews clean — silently removes this. The page then sits on
`now` forever, the player waits for a build that already finished, and **nothing fails,
nothing logs, and no test goes red.**

### 3.2.1 The section contract

The swap works by matching `<section id="s-…">` elements against the same ids in the
fetched copy. **Those ids are an interface.** You may restructure everything inside a
section, move sections around, and restyle them completely — but:

- **Every section must always be rendered, even when empty.** A caravan that arrives
  while the page is open needs somewhere to appear. Omit the empty case and it never
  shows up until the player navigates.
- **Keep the ids, or update the server helper and the client together.** They are
  matched by string.
- **A form inside a section is submitted in place; a form outside one navigates.** That
  is how logging out still leaves the page with no special marking. If you move the
  logout form inside a section it will stop working properly.

Three more invariants that are easy to lose and produce infinite loops or dead pages:

- **Only timers with a future instant are armed, re-checked after every swap.** An
  already-expired timer is displaying the server's own "done" text; asking about it
  again would never stop.
- **A response containing no sections means a real navigation** — an expired session
  renders the landing page — and must fall back to a full reload rather than swapping
  nothing and appearing frozen.
- **Store extrapolation must clamp to `data-cap`.** Without it the page shows amounts
  the database would refuse to store.

### 3.2.2 The change cue

A section that has just been swapped gets `class="changed"` for about a second. Without
some cue, a fluid update means things change while the player is reading a different
part of the page and they never notice — which is worse than the reload it replaced.
Restyle the animation freely; it currently honours `prefers-reduced-motion`. Please keep
*something*, and keep the `aria-live` on the event log.

### 3.3 Escaping

Every interpolation of dynamic content goes through `escape()`. Camp names, survivor
names and item names are player-supplied. There is no template engine doing this for
you — it is manual, and it must stay manual-but-total.

### 3.4 Forms are plain POST, and redirect

Every action is a `<form method="post">` to a route, which redirects back to the page.
No `fetch`, no JSON endpoints, no client-side state. Please keep it that way — the
whole design of the game assumes the server is authoritative and the page is a
render of it. Styling a form as anything you like is fine; replacing it with a
JavaScript submission is not.

---

## 4. The technical envelope, and one trick that depends on it

**There is no build step. No bundler, no minifier, no transpiler.**

That is not incidental. The inline script cannot `import` the server's duration
formatter, so the server injects the function's own source via
`Function.prototype.toString()`. This works only because nothing renames or rewrites
the code between authoring and serving.

**If a redesign introduces a bundler or minifier, that trick breaks silently and every
timer in the game formats as garbage.** If you need a build step, say so explicitly as
part of your proposal — it is not forbidden, but it requires reverting that
optimisation to a second hand-maintained copy plus the test that used to guard it.
Do not introduce one incidentally by reaching for a framework.

For the same reason: no CDN links, no web fonts fetched at runtime, no external CSS.
Self-contained or nothing.

---

## 5. Design principles that should survive

These are about how the game *communicates*. They are not tied to the current look and
should hold in any redesign.

1. **The thing with a deadline goes first.** The raid warning sits above everything
   else because it is the only item on the page the player must act on before it
   expires. Anything else that acquires a deadline joins it at the top.
2. **A priced choice shows its price beside it.** Every action the player can take
   displays its cost in the same row as the button. Never make someone hunt for what
   something costs.
3. **The facts a decision needs sit next to the decision.** If a choice depends on the
   survivor's health, that number belongs beside the choice, not in a panel further
   down the page.
4. **Match animation to the thing being counted.** A timer that will expire while you
   are looking at it must tick, with seconds visible — a countdown reading `2.1 h` for
   six minutes looks broken. A store that gains 0.7/h is shown to one decimal and moves
   slowly *because the thing it counts moves slowly*, and that is honest rather than
   dead. Do not animate something to look alive.
5. **A refusal speaks in the game's voice.** Errors are sentences, not codes:
   "There is nobody here to send." "They are already out there."
6. **Density matters more than polish.** This is a page people check several times a
   day for thirty seconds. Scanning it quickly is the whole job.

---

## 6. The voice

The prose has an established register and the visual design should sit with it rather
than fight it: flat declarative, then a turn. Understated. Never melodramatic.

> Things still grow here. That is the problem.
> Sealed for a reason. Sealed things keep well.
> Nobody agrees on what is down there. Few go twice.
> Older than you are. Still food.
> The difference between limping home and not coming home.

The world is bleak, worn and matter-of-fact. It is not neon, not glitchy, not
"cyberpunk". If you reach for a palette, reach for dust, rust, faded paper and cold
light rather than terminal-green-on-black — though a deliberate, well-made terminal
look is defensible if it is *chosen* rather than defaulted into.

---

## 7. What is on the page

Three pages exist. The camp page is where essentially all the design effort belongs.

**Landing** (`landingPage`) — log in, or found a new camp. Two forms.

**Camp** (`campPage`) — in current order:

| Block | Notes |
|---|---|
| Header | Camp name, wealth, defence, founded date |
| Error box | Only when an action was refused |
| Raid warning | Only with the radio upgrade fitted. Has a deadline; sits first |
| The sky | Active world events, each with a countdown |
| While you were away | Narrative log of what happened since last visit |
| Survivor | Health, hunger, radiation — or a prompt to raise a successor |
| Away / Where to send them | Expedition in flight with a countdown, or the region table |
| Stores | Four resources: live amount, cap, rate per hour |
| Caravan | Only when one is visiting or on the road. Offers table with prices |
| Inventory | What the survivor is carrying |
| Workshop | Craft recipes and the bench |
| Standings | Reputation with two rival factions |
| Structures | Five buildings: level, effect, next cost, build button, fuel upgrade |
| Roster | One line pointing at the graveyard |
| Log out | |

**Graveyard** (`graveyardPage`) — the roster of the dead, with causes and lifespans.

The camp page is long and information-dense, and that is inherent rather than a defect
to be solved by hiding things. Splitting it across views is welcome; removing
information is not.

### 7.3 The intended split, and two constraints on it

A reasonable division of the blocks above — treat the grouping as a starting point and
the two constraints below as requirements:

| View | Blocks |
|---|---|
| **Camp** (default) | Raid warning, the sky, while you were away, stores, structures and builds |
| **Survivor** | Health/hunger/radiation, away or where to send them, inventory, workshop |
| **Trade** | Caravan and its offers, faction standings |
| **Records** | Graveyard, camp history |

**Constraint one: the check-in must land on everything that changed.** *While you were
away* and the raid warning belong on the default view. The entire loop of this game is
arriving and reading what happened; if that is behind a click, the redesign has broken
the game rather than restyled it.

**Constraint two: the auto-reload must return the player to the view they were on.**
This is a genuine hazard that tabs introduce and that §3.2 does not cover. When a
countdown expires the page reloads — if views are separate URLs, that is fine, but if
the reload drops the player back on Camp while they were reading Trade, the game will
yank them out of what they were doing at unpredictable intervals. Whatever mechanism you
use, the reload must preserve the current view. Test it by starting a short build and
then sitting on a different tab until it finishes.

A related note for whoever implements it: timers only exist on the view being rendered,
so a build finishing while the player is on Trade will not reload anything until they
navigate. That is acceptable — the server recomputes everything on the next page load —
but it means the Camp view must never assume it was reloaded the instant something
completed.

---

## 8. What is coming, so the design can accommodate it

Two changes are designed and not yet built. Designing around them now is cheaper than
retrofitting.

**Field encounters.** An expedition will surface *moments* — a situation, a short report
of the trip so far, and two to four options each with a cost, one of which may carry a
danger warning. It appears in the top slot beside the raid warning, has its own closing
countdown, and is the most time-critical thing on the page when present. It needs to
read as an invitation rather than an alarm — except the warned variant, which should
read as exactly what it is.

The *Away* block also grows from two lines into a report: what the survivor is carrying,
what has happened to them, and when the next contact is due.

**More than one survivor.** The Survivor block will eventually repeat per person, with
jobs assigned between them. Do not design it as a fixed singular panel.

---

## 9. How to check you have not broken anything

```
npm test        # 125 unit tests, no database needed
npm run test:db # 93 tests against a real Postgres
npm run dev     # http://localhost:3000
```

A green suite is necessary and **not sufficient** — it says almost nothing about the
rendered page. Check these by hand:

1. Start a build that takes under a minute. Watch the countdown reach zero. **The page
   must update itself in place and show the finished structure**, without navigating and
   without you touching anything. This is the check that catches the failure in §3.2,
   and nothing automated catches it today.
2. Submit an action — a build, a dispatch. The page must update without navigating, and
   the changed sections must show the cue.
2. Leave the camp page open for a minute. Store amounts must climb smoothly and stop at
   the cap.
3. Submit an action that will be refused — send an expedition while one is already out.
   The message must appear in the game's voice, on the page, not as a raw error.
4. Start a short build, then move to a different view and wait for it to finish. **The
   reload must leave you where you were**, not on Camp. See §7.3.
5. Narrow the window to a phone width. The page must stay *usable* — desktop is the
   target, but a check-in from a phone must not be broken.

---

## 10. If you want the full reasoning

`docs/PLAN.md` is the project's source of truth and records every load-bearing decision
with its reasoning, including a section titled *The page contract, and what a redesign
must not drop* which is the long form of §3 here. It is worth reading if you want to
know why something is the way it is before changing it.
