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
legible, not replace it with graphics.** Think of it as designing a well-set page, a
terminal, or a good instrument panel, rather than a game UI with a HUD.

**Stack:** Node + Express, server-rendered HTML built by string templates. No React, no
Tailwind, no component library, no CSS file — one `STYLE` constant and one inline
`<script>`. **There is no build step, and that is a hard constraint (see §4).**

---

## 2. What you may change freely

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

### 3.2 The auto-reload is mechanical, not cosmetic

**This is the single most important paragraph in this document.**

When a countdown reaches zero, the script reloads the page. That is not a nicety — it
is *how a finished thing becomes visible*. The server is the only thing that knows what
a completed build produced, what an expedition brought home, or whether the survivor
came back at all. The client cannot compute any of it.

A redesign that renders a deadline as its own hand-rolled timer — entirely reasonable
markup, looks correct, reviews clean — silently removes this. The page then sits on
`now` forever, the player waits for a build that already finished, and **nothing fails,
nothing logs, and no test goes red.**

Two subtleties ride along with it:

- **Only timers that were still running at page load may trigger the reload.** One that
  had already expired when the HTML was generated is displaying the server's own "done"
  text; reloading for it would loop forever.
- **Store extrapolation must clamp to `data-cap`.** Without it the page shows amounts
  the database would refuse to store.

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
to be solved by hiding things. Progressive disclosure is welcome; removing information
is not.

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
   must reload by itself and show the finished structure.** This is the check that
   catches the failure in §3.2, and nothing automated catches it today.
2. Leave the camp page open for a minute. Store amounts must climb smoothly and stop at
   the cap.
3. Submit an action that will be refused — send an expedition while one is already out.
   The message must appear in the game's voice, on the page, not as a raw error.
4. Narrow the window to a phone width. The page must stay usable; this is a game people
   check on their phone.

---

## 10. If you want the full reasoning

`docs/PLAN.md` is the project's source of truth and records every load-bearing decision
with its reasoning, including a section titled *The page contract, and what a redesign
must not drop* which is the long form of §3 here. It is worth reading if you want to
know why something is the way it is before changing it.
