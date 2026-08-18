# Wasteland — the world

Everything here is **derived from prose the game already ships**, not invented alongside
it. Where a claim rests on an existing line, that line is quoted. Where something is
deliberately left unanswered, it says so and gives the reason.

This document exists so that new content — a region, an encounter, an item, a faction —
can be written by someone who has not read every string in `seed.js`, and still come out
sounding like the same world.

---

## 1. How this world talks

The register is already set, and it is the strongest thing the game has. Match it.

> Things still grow here. That is the problem.
> Sealed for a reason. Sealed things keep well.
> Nobody agrees on what is down there. Few go twice.
> Older than you are. Still food.
> The difference between limping home and not coming home.

Four rules, all of them observable in the lines above:

1. **Flat declarative, then a turn.** The second sentence reframes the first. It is never
   a joke and never a flourish.
2. **Nothing is explained.** No line tells you what happened to the world. They describe
   a thing and let the implication sit.
3. **Understatement carries the horror.** "That is the problem" is doing more work than
   any adjective would.
4. **No proper nouns from before.** No countries, no companies, no dates, no war names.
   The old world is referred to by its leavings — pylons, the interchange, road signs —
   never by its names.

**The single biggest way to damage this game is to explain it.** Most of what follows is
background for the writer, not text for the player. Very little of it should ever appear
on screen.

---

## 2. What happened

**It was not a war. It was a failure, and then a much smaller disaster in the wrong
place.**

This is not a stylistic choice; it is forced by what shipped. `ruined_city` has
`radiation_per_trip: 0` — the city is picked over and dangerous and *clean*. Cities were
not burned from the sky. Meanwhile `irradiated_farmland` and `the_deep_zone` are hot, and
they are the only places that are.

So the shape is:

**First the grid went.** The Old Service Road "follows the pylons out and comes back the
same way" — the towers are still standing, still strung, still carrying nothing. Nobody
fought over them. They simply stopped mattering.

**Then supply went.** Not overnight. Long enough that people sealed things properly:
"Camp food, sealed while it was still worth sealing" is a line about a period when
sealing food was a reasonable thing to plan around. And long enough that a great deal of
it survives, which is why a tin can be "older than you are" and still be dinner.

**Then order went**, and the cities emptied rather than burned. "Picked over a hundred
times, but the city is large" is a city that was left, not destroyed — abandoned by
people who had somewhere marginally better to be, and stripped ever since by people who
did not.

**And somewhere in there, something at the Deep Zone let go.** It is the most irradiated
place on the map by a factor of six, it holds more fuel and more salvaged machinery than
anywhere else, and the farmland downwind of it grows food that is not safe. That is a
site, not a battlefield: something industrial, something that needed a great deal of
power and produced a great deal of hazard, and something that failed with nobody left
whose job it was to stop it failing.

**How long ago:** within a lifetime. A survivor can be younger than the tins they eat.
Some people alive now remember lights. Nobody organises around getting them back.

---

## 3. The land

The map is not a set of biomes. Each region is a different *kind of leftover*, and that
is what makes the choice between them a choice.

**The Fence Line** — *"As far as the wire and back. Ten minutes, and never nothing."*
Your own perimeter and the ground immediately past it. That it still pays anything at
all says how much was simply dropped where people stood.

**The Old Service Road** — *"Follows the pylons out and comes back the same way. Picked
over, but close."* The maintenance track under the transmission line. Walkable, mapped,
and worked over by everyone within a day's walk, which is exactly why it is safe.

**The Ruined City** — *"Picked over a hundred times, but the city is large."* Clean, in
the radiological sense, and that is the point: it was emptied rather than struck. The
danger here is structural and human, not invisible. Its hazards are falls and collapsing
floors and other scavengers, and it yields food and water and scrap — household leavings,
not industry.

**Irradiated Farmland** — *"Things still grow here. That is the problem."* Downwind of
the Deep Zone. The most productive land on the map and the reason nobody simply farms
their way out of this. It is the only region where the danger is in the harvest.

**Underground Bunkers** — *"Sealed for a reason. Sealed things keep well."* Cold stores,
civil shelters, plant rooms. The first place fuel appears, and the first place *parts*
appear, because these are the rooms machines lived in. Barely irradiated: they were shut
before anything got in. The phrase cuts both ways and is meant to.

**Coastal Wreckage** — *"Hulls the size of buildings, and whatever lives in them now."*
Ships that came in and never left. Whether they were run aground, abandoned at anchor, or
arrived already empty is not established and should stay that way. Rich in fuel and
water; the water is the tell that these were provisioned for long voyages.

**The Deep Zone** — *"Nobody agrees on what is down there. Few go twice."* The source.
Six times the radiation of anywhere else, the most fuel, the most machinery, and no food
or water at all — nothing was ever meant to live there. **What it actually is must never
be settled.** The hazard table already names its top entry "the Deep Zone itself", which
is the most frightening thing in the game precisely because it refuses to be a monster.

---

## 4. The two crews

Both trade. Both raid. **This is the load-bearing fact and it is not cynicism — it is
what a relationship looks like when there is no third party to appeal to.** A crew that
sells to you in spring and takes from you in autumn is not being hypocritical; it is
being the only kind of neighbour available.

### The Junction Crews

> Salvage barons of the old interchange. Their caravans smell of diesel, and their
> raiders carry good boots.

They hold a road junction, which in a world with no grid and no state is the closest
thing to holding a country. Everything that moves any distance moves through them or
around them at cost.

They deal in **things**: tablets, weapons, parts, armour. Their fuel-priced offer for
parts is the tell — they have fuel, and they know you do not, because nothing in your
camp makes any.

*Diesel and good boots.* They are the crew that maintains equipment. Their raiders are
shod because raiding is a job with an outfitter behind it. There is nothing improvised
about them, and that is what makes them frightening.

### The Green River Provisioners

> Farm collectives from up the valley. Their caravans smell of bread, and their raiders
> know exactly which storehouse is yours.

Not a gang that farms — **farms that had to become a gang.** The valley is upstream and
out of the wind, which is why their ground grows food that is safe and yours does not.

They deal in **sustenance**: stew, meals, bulk food, chelation. The relief-shaped
inventory is deliberate — they sell most to camps that have just been hit.

*They know which storehouse is yours.* That line is the sharpest in the game and should
be understood exactly as written: they know because they have been inside it, invited,
counting. The bread and the raid are the same visit at different temperatures.

### The rivalry

Neither can become the other. The Crews cannot grow food — their ground is road. The
Provisioners cannot make fuel or parts — their valley has no industry in it. Each holds
precisely what the other lacks, permanently, and there is no arrangement in which one
absorbs the other.

**Your camp is a third thing: small, fixed, and in possession of a functioning garden.**
That is why both of them keep coming back, in both moods.

---

## 5. The people

**Camps.** Yours is not unique or special. It is one of many small holdings with a
shelter, a garden, a purifier, a bench and a tower — a survivable configuration that
people converged on because it works, not because anyone designed it. Neighbouring camps
exist; you can see their smoke.

**Survivors.** People who take on a camp rather than travel. There is no ceremony to it
and no title — someone arrives, the place is empty or the last one is dead, and they stay.
They are not chosen and not heroes. The game's own framing is exact: *the camp is
persistent and outlives its people.*

**The dead.** They are kept — the graveyard records what each one was carrying and where
they last went. That is not sentiment; it is a ledger. Camps keep the ledger because a
camp that forgets how its last four people died makes it five.

**Wanderers.** People between camps: the ones whose holding failed, or who were put out,
or who never settled. They are how a camp gains people, and their existence is why a
survivor arrives rather than being born. Nobody in this world has children on the page.

**Nobody is in charge.** No government, no army, no relief, no radio voice from
elsewhere. The radio upgrade picks up chatter — raiders coordinating, crews moving — and
nothing else, which is the whole point of it. If a broadcast from an organised somewhere
ever appears in this game, that is a different game.

---

## 6. Deliberately unanswered

These are load-bearing absences. Filling them in would cost more than it adds:

- **What the Deep Zone was.** The game says nobody agrees. Keep it that way. The hazard
  named "the Deep Zone itself" is the best writing in the project and it works because it
  names nothing.
- **What happened to everyone.** Not a body count, not a date, not a cause with a name.
- **Whether anywhere else survived.** No news arrives from outside because no mechanism
  in the game delivers any.
- **What lives in the coastal hulls.** "Whatever lives in them now" is complete.
- **Why the bunkers were sealed.** "Sealed for a reason" is complete.

---

## 7. Writing new content

A checklist for anything player-facing:

1. **Two sentences, usually.** Statement, then turn.
2. **Describe leavings, not events.** What is in front of the survivor, not what befell
   it.
3. **No proper nouns from before the collapse**, and no numbers with authority — no
   years, no casualty figures, no acronyms.
4. **Nobody is evil.** The crews raid you for the same reason you scavenge the city.
5. **The survivor is competent.** They are not an idiot, they do not panic, and the tick
   already assumes as much. Fear should come from the situation, never from their
   reaction to it.
6. **Second person is the camp; third person is the survivor.** The game says "your
   camp" and "they walked home." Keep the distance — you are not out there.
7. **If a line explains the world, cut it.** The one rule that protects all the others.
