# Road plates — image prompts for the eleven regions

One image per region, written to be generated rather than painted. **Every prompt is the
house style below plus that region's paragraph**, in that order. The house style is what
keeps eleven separate renders looking like one set.

Descriptions and stats come from `REGIONS` in `src/db/seed.js`; the palette from
`src/web/render.js`; the register from `docs/LORE.md` §1.

---

## Before generating anything

`docs/DESIGN-BRIEF.md` §2.1 puts illustration on the restraint list, and says the
atmosphere lives entirely in the prose while the frame stays out of its way. That
objection is right about pictures that compete with the writing.

These are written to not be those: flat, unstyled, near-monochrome, no composition worth
admiring — a plate in an instrument rather than art on a wall. **If a render comes back
beautiful, it is wrong**, and the fastest fix is to take something out of the frame
rather than add another rule to the prompt.

---

## The house style — prepend to all eleven

> Documentary photograph, flat and unstyled. Overcast midday, cold even light, no sun and
> no dramatic shadow. Near-monochrome: warm dark greys and bone white, colour desaturated
> almost out — any colour that survives should look accidental. Wide 3:1 letterbox crop,
> eye level, camera static and square to the subject, as if set down where somebody
> stopped walking. No people, no animals, no creatures. No text, no lettering, no signage
> copy, no logos, no watermark. No fire, no smoke, no craters, no scorch: this world was
> left, not bombed. No neon, no glow, no lens flare, no god rays, no rain. Fine digital
> grain of a cheap sensor. Photographic, not illustrated — no concept art, no matte
> painting, no heroic composition.

---

## The seven on the map from the start

In the order the game offers them, which is also the order the trip gets longer and the
ground gets worse. Each is a different *kind of leftover* — that is what makes choosing
between them a choice, and it is what each plate has to show.

### 1. The Fence Line — `the_fence_line`

> As far as the wire and back. Ten minutes, and never nothing.

danger 1 · 10m out · 0 rads · pays scrap, food

**Prompt.** The ground immediately outside a camp's own perimeter. A fence of salvaged
wire on leaning posts runs across the frame; the earth is trodden bare on both sides of
it. Small things pressed half into the mud — a flattened tin, a coil of wire, a single
boot. Low scrub beyond. The horizon is close and completely ordinary.

**Must.** Look boring and safe. This is ten minutes from home; its entire character is
that ground this thoroughly walked over still pays something.

### 2. The Old Service Road — `the_service_road`

> Follows the pylons out and comes back the same way. Picked over, but close.

danger 1 · 45m out · 0 rads · pays scrap, water

**Prompt.** A maintenance track running dead straight beneath a transmission line. Steel
lattice pylons recede to the horizon, cables still strung between them. Grass growing
through the gravel, wheel ruts long dry, verges cut back years ago and never since.
Nothing lying anywhere.

**Must.** Stay intact and dull — nothing collapsed, nothing dropped. The towers still
stand and carry nothing, and the ground is bare because everyone within a day's walk has
already been along it.

### 3. The Ruined City — `ruined_city`

> Picked over a hundred times, but the city is large.

danger 1 · 4h out · 0 rads · pays scrap, food, water

**Prompt.** A street of mid-rise buildings seen straight down its length, every window
dark and empty of glass. Façades whole; floors visibly sagging behind them. Saplings and
grass through the pavement and gutters, two cars settled on flat tyres, a drift of paper
and plaster along one kerb. The street carries on past the frame.

**Must not.** Read as bombed. No rubble fields, no scorch, no collapsed blocks. It was
emptied by people who had somewhere marginally better to be, and the danger left in it is
a floor giving way.

### 4. Irradiated Farmland — `irradiated_farmland`

> Things still grow here. That is the problem.

danger 2 · 6h out · 8 rads · pays food, water

**Prompt.** A grain field standing thick and heavy all the way to the horizon under a
flat pale sky — the healthiest crop anywhere on the map. A combine harvester left mid-row
with its tyres gone soft. Hedgerow, a gate, ordinary farm country.

**Must not.** Signal anything. No wilting, no strange colour, no glow, no drums, no
hazard markings, no dead ground. The whole line depends on the picture looking like a
good harvest; the reader supplies the problem.

### 5. Underground Bunkers — `underground_bunkers`

> Sealed for a reason. Sealed things keep well.

danger 3 · 9h out · 2 rads · pays scrap, fuel, food

**Prompt.** A concrete stair cut down into a hillside, ending at a steel blast door
standing part open. Past the door, in flat cold light, steel racking and stacked sealed
crates, ventilation plant bolted to the wall, everything dry and dusty and undisturbed.
Grass growing right up to the lip of the stair.

**Must.** Be dry and cold — never flooded, never rotted, no growth inside. What is down
there survived because it was shut in time, and the sentence cuts both ways on purpose.

### 6. Coastal Wreckage — `coastal_wreckage`

> Hulls the size of buildings, and whatever lives in them now.

danger 4 · 12h out · 4 rads · pays scrap, fuel, water

**Prompt.** Cargo ships aground on a grey tidal flat, hulls the size of office blocks,
each leaning at its own angle. Low tide, wet mud, sheets of standing water. Plating pitted
and streaked; hull doors and companionways standing open onto black interiors. Flat sea
behind, no horizon worth speaking of.

**Must.** Be aground and abandoned rather than sunk or broken up. Nothing may be visible
inside the openings — the openings are the point, and whatever uses them stays out of
frame.

### 7. The Deep Zone — `the_deep_zone`

> Nobody agrees on what is down there. Few go twice.

danger 5 · 18h out · 25 rads · pays scrap, fuel

**Prompt.** An industrial site far too large to take in at once: concrete structures,
pipework and cooling plant spread across open ground under a low grey ceiling of cloud,
seen from a distance. Everything is intact. There is no damage anywhere that could be
pointed at. Nothing is moving.

**Must not.** Explain itself. No reactor iconography, no hazard trefoil, no green light,
no crater, no creature, no ruin. It is frightening because it is enormous, undamaged,
silent and unnamed — the hazard table already refuses to make it a monster, and so should
this.

---

## The four the road opens

Locked until the road reaches them, and deliberately not stronger than the Deep Zone so
much as *other*. Each pays in a mix nothing else does, so each plate wants a subject
nothing else on the map has: running water, counted shafts, working plant, and an end.

### 8. The Millrace — `the_millrace` (link 1)

> The wheel still turns. Somebody kept it turning for a long time.

danger 3 · 8h out · 1 rad · pays water, scrap, food

**Prompt.** A stone mill building on a fast narrow race, water bright and moving as it
runs under a large timber wheel. The wheel is mid-turn. The timber is sound and recently
replaced in places; the iron axle is greased and clean. The mill door stands open on
darkness. Nobody is there.

**Must.** Show upkeep, which is the whole subject. Everything else on this map is
decaying and this one thing has been maintained — recently, carefully, and by somebody who
is not in the picture.

### 9. Sixteen Wells — `sixteen_wells` (link 3)

> Sixteen shafts, and the water in them has never seen the sky.

danger 4 · 14h out · 6 rads · pays water, scrap, fuel

**Prompt.** A bare yard of well-heads in even rows, each a low concrete ring under a small
steel winch frame, receding across dry flat ground. One cap has been lifted and set aside;
the shaft below it is black. No buildings, no fence, nothing growing.

**Must.** Read as counted. The repetition and the rows are the subject — this is a site
somebody laid out on a plan, not a village that happened to have wells in it.

### 10. The Waterworks — `the_waterworks` (link 5)

> Pumps the size of houses, and something still drawing power to them.

danger 5 · 20h out · 30 rads · pays fuel, scrap, water

**Prompt.** The pump hall of a waterworks: cast pumps the size of small houses in a row
down an enormous concrete floor, pipework and gantries overhead, flat cold daylight
falling from high clerestory windows. The machinery is clean-lined, painted, and
completely undamaged. One dull work-lamp is burning far down the hall — the only lit thing
in the frame.

**Must.** Hold that lamp to one small, dim, unremarkable point. It is the only lit thing
anywhere in this set and it is doing the work of the second sentence; brighten it and the
plate becomes science fiction.

### 11. Harrow End — `harrow_end` (link 7)

> The far end of the road, and the reason there is a road.

danger 5 · 26h out · 28 rads · pays scrap, fuel

**Prompt.** A road ending. Cracked tarmac runs from the bottom of the frame and simply
stops at a wide gate in a long perimeter wall. Beyond the wall, low structures go back
further than the eye follows. Empty flat country on both sides, no other road, no other
building.

**Must.** Read as a destination and never as a discovery. Nothing wrecked, nothing
besieged, nothing to identify it. The road was built to reach this, which is the only fact
the plate is allowed to carry.

---

## Practicalities

- **Render all eleven in one sitting.** Consistency across the set matters more than any
  single plate. Same model, same settings, same session — and if you can pin a seed
  family, pin it. A set generated over three evenings will look like three sets.
- **3:1, and small.** These sit beside a table row, not behind it. Something like
  1200×400 is plenty; anything taller starts competing with the prose for the column,
  which is the failure §2.1 is warning about.
- **Name them by slug.** `the_fence_line.webp`, `ruined_city.webp`, and so on, matching
  `REGIONS` in `src/db/seed.js` — then the render can find a plate by the slug it already
  has, and a region with no file simply shows no image.
- **Push them back, hard.** On the page they want to sit under the prose at low contrast,
  cropped short. If a plate ever reads as the first thing on the row, it has taken the
  place the writing was holding.
- **The two that will fight you.** Irradiated Farmland and the Deep Zone. Every generator
  wants to make the first one sickly and the second one a monster movie, because that is
  what the training data calls a wasteland. Expect to re-roll both several times, and to
  win by deleting words rather than adding them.
