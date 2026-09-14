# Hunt plates — image prompts for the three quarry

One image per animal, written the same way `docs/ROAD-PLATES.md` writes the eleven regions:
**the house style below plus that animal's paragraph**, in that order. The house style is what
keeps three separate renders looking like one set, and looking like the eleven that already
exist.

Content comes from `QUARRY` in `src/game/hunting.js`; the palette from `src/web/render.js`; the
register from `docs/LORE.md` §1.

---

## The one clause that changes

The road plates' house style says **"no people, no animals, no creatures"** — because out there
the leftover *is* the subject and anything alive in the frame would become the subject instead.
Here the animal is the subject, so that clause is lifted for these three and for nothing else.
Everything the rest of it says still holds, and the standing warning holds hardest:

> **If a render comes back beautiful, it is wrong**, and the fastest fix is to take something
> out of the frame rather than add another rule to the prompt.

There is a second failure mode these have that the roads did not. Every generator wants a
wasteland animal to be a *mutant* — scarred, oversized, red-eyed, snarling at the lens. **None
of these are mutants.** They are ordinary animals in a country nobody farms any more, and the
boar is dangerous for the reason a boar has always been dangerous. Expect to re-roll, and to
win by deleting words rather than adding them.

---

## The house style — prepend to all three

> Documentary photograph, flat and unstyled. Overcast midday, cold even light, no sun and no
> dramatic shadow. Near-monochrome: warm dark greys and bone white, colour desaturated almost
> out — any colour that survives should look accidental. Wide 3:1 letterbox crop, eye level,
> camera static and square to the subject, as if set down where somebody stopped walking. One
> ordinary animal, small in the frame, seen at the distance you would first see it from. No
> people. No text, no lettering, no signage copy, no logos, no watermark. No fire, no smoke, no
> craters, no scorch: this world was left, not bombed. No neon, no glow, no lens flare, no god
> rays, no rain. Fine digital grain of a cheap sensor. Photographic, not illustrated — no
> concept art, no matte painting, no heroic composition, no wildlife-photography portrait, no
> shallow depth of field.

---

## 1. The hare — `hare`

danger 0 · pays 4 food, 1 hide · the disappointment

> Something moves in the scrub at the edge of the cleared ground, and stops when the survivor
> does.

**Prompt.** Rough grass and low scrub at the edge of ground that has been cleared and walked
over. A hare sitting still among the stems, side-on, most of the way across the frame and small
enough that the grass nearly has it. Flat dead vegetation, a few bare patches of trodden earth
nearer the camera. Nothing else in the frame.

**Must.** Be easy to miss. This is the animal that is not worth the day, and the plate's whole
job is that a player glancing at it feels mildly let down. If the hare is the first thing the
eye lands on, it is too big or too centred.

---

## 2. The thin deer — `deer`

danger 1 · pays 15 food, 2 hide, 1 sinew · the one worth having

> It is standing in the open with its head down, and it has not seen anybody yet. There is not
> much on it, and there is more on it than there is in the larder.

**Prompt.** Open flat ground, grass gone to seed and lying over. A single thin deer standing in
the middle distance with its head down, feeding, turned three-quarters away from the camera. A
treeline far off and low. Nothing between the camera and the animal.

**Must.** Be unaware. The head stays down and the eye never finds the lens — the entire value
of this plate is that the animal does not know anybody is there, because that is the state the
player is trying to keep it in. It should also read as *lean*: this is a poor animal in a poor
country, not a stag.

---

## 3. The boar — `boar`

danger 4 · pays 24 food, 3 hide, 2 sinew · the one that can kill somebody

> It is rooting along the fence line and it has not moved off, which is the part worth noticing.
> It knows the survivor is there.

**Prompt.** A run of salvaged wire fence on leaning posts, the same fence as the camp's own
perimeter, with churned mud along the base of it. A boar standing broadside in front of the
wire, head up and turned toward the camera, stopped mid-feed. Trodden ground, a scatter of
turned earth where it has been rooting. Overcast, flat, close horizon.

**Must.** Be looking, and be doing nothing about it. **This is the only one of the three that
meets the camera**, and that single fact is its whole character — it has seen the survivor and
it has not moved, which is what makes it dangerous. It must not snarl, charge, lower its head
to threaten, or be lit to look monstrous; the tension is that it is standing perfectly still
and calm. A boar that looks like a horror-film animal is a failed render, however good it is.

---

## Practicalities

- **Render all three in one sitting**, the way the eleven were — same model, same settings,
  same session. And if you can, put one of the existing region plates in front of the model
  first as a reference for the light: these have to sit beside eleven images that already
  exist, not just beside each other.
- **3:1, and small.** 1200×400 like the plates. The animal being small in a wide frame is not a
  compromise — it is the point, because distance is what the hunt board is about, and a plate
  that reads as a portrait would be arguing with the block it sits in.
- **Name them by key**: `hare.png`, `deer.png`, `boar.png`, matching `QUARRY` in
  `src/game/hunting.js`.
- **`tools/plates.py` needs the three names adding to its `NAMES` map** before it will convert
  them; a file in `img/` that is not in the map is skipped and named rather than silently
  dropped, so it will tell you.
- **Push them back, hard.** Same rule as the roads: low contrast, cropped short, under the
  block's own readings. The hunt board is an instrument that is read on every press, and a
  picture that competes with the figures has taken the place the figures were holding.

---

## Not yet decided

**Whether these ship at all.** `docs/DESIGN-BRIEF.md` §2.1 puts illustration on the restraint
list, and the argument that admitted the road plates — a plate in an instrument rather than art
on a wall — has to be made again here rather than assumed. The hunt board is denser than a
region row and has less room to give away.

**Where one would sit** is open until the board's layout is settled. A 3:1 band across the top
of the block is the shape that matches the rest of the game; a smaller inset beside the
readings is the shape that leaves the figures in charge.
