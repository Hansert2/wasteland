# Wasteland — brief for a visual redesign

**Read this before changing anything the player sees.**

**Answered, 2026-08-23.** The scaffolding is gone and the page now carries direction
**2a, "cold instrument"** — eight colours, three system faces, depth from border weight
rather than shade, and one accent that is only ever a clock, a price you cannot pay, or
a warning. The rules it was built to are `HANDOFF.md` in the Claude Design project
*Wasteland Visual Identity*; the reasoning that survived into code is in the comments at
the top of `src/web/render.js`.

This document is still the brief rather than a record of it. Everything below is what
the *next* pass has to hold to, and §3 in particular is load-bearing whoever is doing
the changing. The paragraph that follows is why.

The look that preceded this was scaffolding. It was written to keep the page readable
while the real question — whether checking in on a camp is *fun* — got answered, and it
never had a design pass.

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

**Camp** (`campPage`) — nineteen blocks, in four groups. **The order is argued, not
incidental**, and the argument is in the comment above `campPage` as well as here. A
redesign may move all of it, but should know what it is moving.

Every block is a `<section id="s-…">` and **is rendered even when it has nothing to say**
— see §3.2.1, this is load-bearing rather than tidy.

*Group 1 — anything with a deadline. It expires, so it goes first.*

| Block | id | Notes |
|---|---|---|
| Header | `head` | Camp name, wealth, defence, founded date |
| Error box | `error` | Only when an action was refused |
| **Contact** | `moment` | **The most time-critical thing on the page.** A situation, the trip so far, and two to four options each with a cost and a closing countdown. An invitation, not an alarm — except the warned variant. Only while a window is open |
| Raid warning | `raid` | Only with the radio fitted. Has a deadline |
| The sky | `sky` | World events in force, each with a countdown, the prose, and **what it costs** — split into what the stores are doing and what a trip would cost. A "Together" line when two stack. Absent about three visits in four |

*Group 2 — what happened while you were gone, then the person it happened to.*

| Block | id | Notes |
|---|---|---|
| While you were away | `events` | Narrative log since the last visit |
| Survivor | `survivor` | Name, what they are known for, health, hunger, radiation — or, when the camp is empty, **the wanderer standing at the gate** with their two sentences and one button. There is no name box and nothing to reroll |
| Inventory | `inventory` | What the survivor is carrying. Beside the survivor because it dies with them |
| **Next** | `direction` | One sentence. Teaches a new camp the game and then leaves for good; after that it reads the camp's own numbers and says the first thing that is objectively true and objectively bad. Frequently empty, and that is correct |
| Away / Where to send them | `expedition` | A trip in flight with its report and countdown, or the dispatch table — name, danger, hours, contact count |

*Group 3 — what the camp is spending on. Structures and the road are adjacent on purpose: a fitting and a link are the same 60–70 fuel, and choosing between them is the whole decision the fuel track adds.*

| Block | id | Notes |
|---|---|---|
| Stores | `stores` | Four resources: live amount, cap, net rate per hour |
| Structures | `structures` | Five buildings: level, effect, next cost, build button, and the fuel upgrade branch |
| The road | `road` | Seven links. What has been reached, who is at the end of it, and what the next link costs |
| Workshop | `workshop` | Craft recipes and the bench |

*Group 4 — who you can trade with, together, because standings price both.*

| Block | id | Notes |
|---|---|---|
| Caravan | `caravan` | Only when one is visiting or on the road. Offers with prices and shortfalls |
| Trade post | `post` | The standing shop on the road, once a link opens one. Same offers, always there |
| Standings | `standings` | Reputation with two rival factions |
| Roster | `roster` | One line pointing at the graveyard |
| Log out | — | Not a section; a bare form, and the client script leaves it alone deliberately |

**Graveyard** (`graveyardPage`) — the roster of the dead, with causes and lifespans.

The camp page is long and information-dense, and that is inherent rather than a defect
to be solved by hiding things. Splitting it across views is welcome; removing
information is not.

### 7.3 The intended split, and two constraints on it

A reasonable division of the blocks above — treat the grouping as a starting point and
the two constraints below as requirements:

| View | Blocks |
|---|---|
| **Camp** (default) | Raid warning, the sky, while you were away, Next, structures and builds |
| **Survivor** | Health/hunger/radiation, away or where to send them, inventory, workshop |
| **Road** | The seven links, who is at the end of them, and the trade post they open |
| **Trade** | Caravan and its offers, faction standings |
| **Records** | Graveyard, camp history |
| *(every view)* | Contact, the error box, the camp's identity, the stores |

Two of those are on every view by not being in the stream at all: the identity and the
stores live in the rail, which the per-view filter does not reach. The stores are there
rather than listed five times because a view is a subject — the camp, the person, the
road, the market — and how much food is left is not one of those. It is the number every
one of those subjects is decided against.

**Contact goes on every view**, and this is the strongest single placement claim in this
document. It has a countdown measured in tens of minutes, it is the only block in the
game that is gone if you do not answer it, and it appears without warning while a trip is
out. A player who has to click through to find it will find it closed.

> **Amended after the split shipped.** This originally read *"the default view and
> nowhere else"*, and the second half was wrong. The claim it was making — a player must
> not have to go looking — argues for being on the view they land on; it never argued for
> being absent from the others. And "nowhere else" cost exactly what the claim was
> written to prevent. The hidden alarm that fetches an arriving moment is armed on every
> view, so a player watching the trip from **Survivor** — the view holding the countdown,
> the health, and the radio's *next contact in…* line — was sent the box and shown a
> hidden section. The page went and got the thing, then hid it from the person most
> likely to be waiting for it.
>
> It is now revealed by a blanket rule rather than listed per view, so a sixth view
> cannot be defined without it. The empty state is a separate question and stayed where
> it was: *"Nobody is on the wire"* is information on the check-in view, which is a view
> about what is and is not happening, and on Trade it is a line about the absence of
> something nobody asked about. The box goes everywhere; the placeholder does not.

On the default view it belongs beside the raid warning, because they are the same kind of
thing.

*Next* goes on the default view for a weaker but real reason: it exists to tell a new
player what this game is, and a new player does not know there are other views.

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

**Built 2026-08-23, and the split turned out to cost neither of the two things above.**
The five views are a *filter*, not five pages: `campPage` emits every section in the
order it always has, and CSS generated from `PANES` in `render.js` reveals the ones
belonging to `<body data-pane="…">`. Each view is its own URL (`/camp`,
`/camp/survivor`, `/camp/road`, `/camp/trade`, and `/graveyard` for Records), so the
script's fetch of `location.pathname` returns the view the player is on and constraint
two holds without a mechanism. The note above is simply no longer true: every timer on
the page is armed whichever view is showing, because every timer is still *on* the page.

Two things follow that are worth knowing before moving anything:

- **A block that is not listed in `PANES` renders onto no view at all** — valid markup,
  every attribute intact, invisible. `test/db/page-contract.test.js` closes it, in the
  same shape as the rest of that file.
- `s-error` is on every view and `s-head` is in the rail. A refusal that renders into a
  hidden section is a button that appears to have done nothing.

---

## 8. What is coming, so the design can accommodate it

Both items this section used to describe have since happened. **Field encounters
shipped** and are the Contact block in §7; the *Away* block grew into the report
described there. They are listed as current rather than future now, which is the only
correct place for them — but the note about the Contact box reading as an invitation
rather than an alarm was right and still applies.

What is genuinely ahead, and how confident each is:

**Certain — more people, described.** `src/game/wanderers.js` holds seven, and the set
will grow. Nothing structural changes: one arrives, the camp gets them, and the Survivor
block shows a name, two sentences and what they are known for.

**Likely — journals and side quests.** A found item leading to a situation at a named
place on the road, resolving as a Contact-shaped encounter somewhere specific. If built,
it adds one block: something the camp is *holding* that points at somewhere to go. Leave
room near the road for a thing that is neither a structure nor a store.

**Uncertain, and this is a correction.** This section used to say *"the Survivor block
will eventually repeat per person… do not design it as a fixed singular panel."* That
was written for a multi-survivor phase which has since been **retired by measurement** —
a check-in is never empty, every camp verb guards on *alive* rather than *home*, and
"more hands" answered a problem the game did not have. It may return on a different
justification: a survivor earned by playing an encounter well, rather than hired.

So the guidance softens rather than reverses. **Do not hard-code the Survivor block to
exactly one person**, but do not contort the layout around a roster that may never
arrive either. One panel that could become a list is the right amount of preparation.

**Not coming.** A broadcast from an organised somewhere, in any form — see §6. The radio
picks up chatter and nothing else. No global news feed, no message from elsewhere, no
weather *report*: the sky is something a person standing in a camp looks up at.

---

## 9. How to check you have not broken anything

```
npm test        # 235 unit tests, no database needed
npm run test:db # 138 tests against a real Postgres
npm run dev     # http://localhost:3000
```

A green suite is necessary and **not sufficient** — it says almost nothing about the
rendered page, and every real fault this project has found in its own presentation was
found by looking at it. Check these by hand:

1. Start a build that takes under a minute. Watch the countdown reach zero. **The page
   must update itself in place and show the finished structure**, without navigating and
   without you touching anything. This is the check that catches the failure in §3.2,
   and nothing automated catches it today.
2. Submit an action — a build, a dispatch. The page must update without navigating, and
   the changed sections must show the cue.
3. Leave the camp page open for a minute. Store amounts must climb smoothly and stop at
   the cap.
4. Submit an action that will be refused — send an expedition while one is already out.
   The message must appear in the game's voice, on the page, not as a raw error.
5. Start a short build, then move to a different view and wait for it to finish. **The
   reload must leave you where you were**, not on Camp. See §7.3.
6. **Send someone to a region with contact, leave the tab open, and do not touch it.**
   The Contact box must appear on its own when the window opens. It is armed by a
   *hidden* `countdown()` span in the Away block with no visible text — the easiest
   thing on this page for a redesign to delete without noticing, and its absence is
   silent.
7. Narrow the window to a phone width. The page must stay *usable* — desktop is the
   target, but a check-in from a phone must not be broken.

### 9.1 States to check, not just pages

The camp page is mostly conditional blocks, and a layout that only ever gets looked at
in one state will be wrong in the others. These six cover everything structural, and
they are worth rendering as fixtures rather than waiting to meet by chance:

| State | How to reach it |
|---|---|
| Empty camp, wanderer at the gate | A fresh account, before pressing the button |
| Home, nothing pressing | Survivor in camp, stores healthy, clear sky |
| Away, mid-trip | Dispatch anywhere over four hours |
| **Contact open** | Both variants — an ordinary one, and one whose worst case exceeds current health, which renders warned |
| Sky in force | Two events at once, so the "Together" line appears |
| Dead survivor | The graveyard, and the empty camp that follows |

---

## 10. If you want the full reasoning

`docs/PLAN.md` is the project's source of truth and records every load-bearing decision
with its reasoning, including a section titled *The page contract, and what a redesign
must not drop* which is the long form of §3 here. It is worth reading if you want to
know why something is the way it is before changing it.
