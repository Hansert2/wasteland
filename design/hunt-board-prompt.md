# Prompt for Claude Design

Paste this alongside `hunt-board-context.html`.

---

Redesign one block from a browser game called Wasteland: the **hunt board**.

The attached HTML is the block as it ships today, in four states, with the game's real design
tokens at the top of the file. Read those tokens and work inside them — the palette, the three
type stacks, the block anatomy (a bordered panel with a small-caps label strip and a 15px/18px
body) are the rest of the game and must not change. **Match them exactly; do not round the
values or introduce a new grey, a radius, a shadow or a gradient.** This game is built out of
hairlines, small caps and one oxide accent, and everything on it is square-cornered.

## What the block is

A turn-based hunt. The player is stalking an animal at the edge of their camp and presses one
of four things; each press resolves instantly. **Nothing in this block counts down** — it is
the only screen in the game with no timer, and it sits exactly where the last press left it.
It is read on *every* press rather than scanned once a visit, so it has to be legible at a
glance and the next decision has to be obvious.

## What I want from you

**Draw the ground between the survivor and the animal.** Right now distance is a cell reading
`ground 2/2` with two small pips, and it is the one thing on the board that is genuinely
spatial. I want to see the approach — the gap closing, the animal at the far end, the survivor
at the near end — and I want the other readings to sit around that picture instead of being
eight equal cells in a strip.

Give me **3 or 4 genuinely different treatments**, not four shades of one. Explore different
answers to: is it a side-on line, a plan view looked down on, a sequence of named stops,
something else? What carries the animal's attention — a cone, a posture, a colour? Where do
the numbers live once there is a picture?

## The state to draw, in all of them

A boar. Ground 2 of 2 (within reach). Alarm 1 of 3. Its attention is *feeding*, and the next
beat is *lifting*. Wind *across*. Press 2 of 5. Carrying a Hunting Bow (allows 2) and a Hide
Coat (−18% harm). The shot is **clean**. Worth 24 food, 3 hide, 2 sinew.

## The rules, so the numbers mean something

- **Ground** 0–2. Two presses of *Close the distance* to be within reach; you cannot strike
  from further.
- **Alarm** 0–3. At 3 a deer or a hare bolts and the hunt is over. A boar does not run — it
  turns to face you, and then any press but *Back off* takes a charge that can kill.
- **The shot is not a probability.** It lands if ground is 2 *and* alarm is no higher than the
  weapon allows: bare hands 0, scrap spear 1, hunting bow 2. So the weapon buys *slack*, not
  luck.
- **Its attention** runs on a three-beat cycle that turns on every press, including standing
  still: feeding → lifting → watching. Closing costs 0, 1, 2 of its alarm respectively.
- **Wind** is behind / across / ahead, fixed for the hunt, and shifts every closing cost by
  −1 / 0 / +1.
- **Press** — five, then the light goes and the animal is gone.
- **The whole decision:** waiting for a cheap beat is how you close for nothing, and waiting is
  also how you run out of presses.

## Constraints

- Dark only. No light mode.
- No emoji, no icon fonts, no stock illustration. Any figure or animal is inline SVG you draw —
  stroke-based, one consistent weight, and it has to read at 30–60px tall.
- No gradients, no glows, no rounded corners, no drop shadows. Depth in this game comes from
  border weight.
- System fonts only — nothing fetched. The stacks are in the file.
- Desktop first; the real column is about 1030px wide inside a 1280px page.
- The four controls stay: **Take it**, **Close the distance**, **Stand still**, **Back off**.
  *Back off* is always present and must never look like cancelling the screen.
- The turned-boar warning state has to remain unmissable — that screen is the only warning a
  player gets before something can kill them.

## What I am unsure about, so push on it

Whether the picture should replace the readings or sit above them; whether the animal should be
drawn at all or implied; and whether five presses is better shown as a spent budget or as
remaining distance. Show me options that disagree with each other on those.
