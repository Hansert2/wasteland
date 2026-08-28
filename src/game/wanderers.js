/**
 * Who walks in when the camp is empty.
 *
 * A survivor used to be a name the player typed into a box and four columns left at
 * their defaults. Two people, ten camps apart, were the same person with different
 * spelling — and `skill_scavenging` has had a live reader worth ten percent a point
 * since Phase 1 and has never once been written to.
 *
 * The lore already had the mechanism and the game had never used it. `docs/LORE.md`:
 * *"**Wanderers.** People between camps: the ones whose holding failed, or who were put
 * out, or who never settled. They are how a camp gains people, and their existence is
 * why a survivor arrives rather than being born."*
 *
 * **Nobody is chosen.** `wandererFor` derives who turns up from the camp's own seed and
 * how many have come before it, the same trick `caravanVisit` uses — so there is no
 * reroll, no draft and no best pick. Someone arrives, the place is empty, and they stay.
 * The moment a player can shop for a survivor the backstory becomes a stat block, which
 * is the failure this content is written to avoid.
 *
 * **What the numbers are allowed to be about is measured, not chosen.**
 * `tools/skill-sensitivity.mjs` asked every moment on every trip twice, once for each of
 * two survivors, and counted how often the right answer moved:
 *
 *     radiation   0 -> 75     44%        scavenging  1 -> 8      10%
 *     radiation   0 -> 55     37%        health    100 -> 30      8%
 *     scavenging  1 -> 20     18%        health    100 -> 60      0%
 *
 * So a wanderer who is *tough* is scenery — zero occasions in thirty-four thousand,
 * because the game already guarantees a healthy survivor cannot die on a trip. The two
 * axes that move a decision are what they carry home and what the dose does to them, and
 * those are the only two things written down here.
 */

/**
 * The baseline both skills are measured against, and **the number that keeps this a
 * personality system rather than a pay rise.**
 *
 * The first draft ran the skills from 1 to 6 and read fine. It was also a silent 25%
 * loot buff on every trip ever taken again: `rollLoot` scored a survivor against 1, the
 * old column default, so an average arrival at 3.5 walked home a quarter heavier than
 * anybody had before — a balance change of the sort this project makes with a
 * measurement and an argument, arriving instead inside a content file about backstories.
 *
 * So the scale centres. Four is ordinary, the seven wanderers run 1 through 7 with an
 * average of **exactly four**, and `rollLoot` scores against this constant rather than
 * against one. The average arrival is precisely the survivor the game has always had,
 * a good one is up thirty percent and a poor one down thirty, and the economy does not
 * move. Being *worse* than ordinary is expressible at all, which the old floor of one
 * made impossible — a one and a zero were the same person.
 */
export const ORDINARY = 4;

/*
 * Each wanderer used to carry a `knownFor` line as well — "comes back heavy, and should not
 * linger where the counter climbs" — and it is gone rather than merely unrendered.
 *
 * It was the mechanical claim written as prose, and prose cannot carry a magnitude: the
 * same sentence covered a haul at x1.3 and one at x0.7, and a dose biting at 45 read like
 * one biting at 75. `skillsOf` prints the figures instead. The `arrival` lines stay and are
 * untouched, because those are the person rather than the numbers, and that distinction is
 * the reason only one of the two was replaced.
 */

/**
 * Seven of them, and every one is strong in one axis and poor in the other.
 *
 * Seven because the arithmetic wants it. Three mirrored pairs — 1/7, 2/6, 3/5 — plus one
 * survivor at 4 and 4 gives an average of exactly `ORDINARY` on both axes, which is what
 * makes the spread free. Six could not: any six of these average off-centre, and the
 * difference is a permanent economy change nobody asked for. It is also prime, so a camp
 * meets all seven before it meets anyone twice.
 *
 * That shape is the point rather than a symmetry: if a wanderer were simply good,
 * arrivals would sort into better and worse and the player would be waiting for a good
 * one. Strong-in-one means **who is out there changes which option wins** — the
 * dose-hardened one walks through the hot room the careful one waits out — which is what
 * the 44% figure above describes and what a bigger multiplier could never buy.
 *
 * The prose follows `docs/LORE.md` section 7: two sentences, statement then turn.
 * Leavings rather than events. Third person, because the survivor is not you. Nothing
 * here says what happened to anyone — a wanderer is somebody whose last place did not
 * work out, and the game never confirms more than that.
 */
export const WANDERERS = [
  {
    key: 'the_dosimetrist',
    name: 'Wren',
    scavenging: 1,
    medicine: 7,
    arrival:
      'She came in reading a counter she had built herself out of two others. She has ' +
      'been further into the hot ground than anyone who talks about it.',
  },
  {
    key: 'the_stripper',
    name: 'Alder',
    scavenging: 7,
    medicine: 1,
    arrival:
      'He arrived with a pack that did not match his condition, and gave no account of ' +
      'either. Whatever he walks past, he has already priced.',
  },
  {
    key: 'the_orderly',
    name: 'Sesh',
    scavenging: 2,
    medicine: 6,
    arrival:
      'They kept a camp of eleven alive for a winter and will not be drawn on the ' +
      'twelfth. The kit on their belt is arranged the way people arrange things they ' +
      'reach for in the dark.',
  },
  {
    key: 'the_lister',
    name: 'Corr',
    scavenging: 6,
    medicine: 2,
    arrival:
      'She walked up the road with an inventory of it, written small and folded twice. ' +
      'The last four entries are places she is not going back to.',
  },
  {
    key: 'the_quiet_one',
    name: 'Faye',
    scavenging: 3,
    medicine: 5,
    arrival:
      'She was the last one out of a holding two valleys over and did not hurry. She ' +
      'has done every job in a camp and has opinions about most of them.',
  },
  {
    key: 'the_hauler',
    name: 'Odd',
    scavenging: 5,
    medicine: 3,
    arrival:
      'He came up the road under more than he should have been carrying and put it down ' +
      'without comment. He has been paid in salvage his whole life and counts in it.',
  },
  {
    key: 'the_walker',
    name: 'Nim',
    scavenging: 4,
    medicine: 4,
    arrival:
      'He has been between camps long enough that nobody asks which one was his. He is ' +
      'good at all of it and remarkable at none, which is why he is still here.',
  },
];

/**
 * Which wanderer walks into this camp next.
 *
 * Derived from the camp's seed and the count of everyone who has held it, so the
 * sequence is fixed the moment a camp is founded and replays identically however the
 * database is restored. Deliberately the same shape as `caravanVisit(seed, index)`,
 * because it is the same kind of fact: something the world does on its own schedule that
 * the player does not get a vote on.
 *
 * **Not random per call**, which is the property that matters. A refresh must not
 * produce a different person, or the empty-camp page becomes a slot machine and every
 * word above about not shopping for a survivor stops being true.
 */
export function wandererFor(seed, index) {
  const at = Number(seed) + Number(index) * 7919;
  return WANDERERS[Math.abs(at) % WANDERERS.length];
}

/**
 * How much dose this survivor carries before it starts costing them.
 *
 * `CONFIG.radThreshold` is where a survivor stops mending and starts taking damage, and
 * it is the most decision-moving number in the game — radiation moved the right answer
 * on 44% of moments against 0% for health. So medicine moves *that*, rather than
 * softening hits, which the same measurement calls scenery.
 *
 * Five points a level, so the ordinary wanderer sits exactly where every survivor has
 * sat since the constant was written, and the spread runs from five under to twenty
 * over. The threshold is read by the tick alone; nothing here touches a generator, so a
 * trip rolls exactly as it always did and only what the dose costs at home moves.
 */
export function radThresholdFor(base, medicine) {
  return Number(base) + ((Number(medicine) || ORDINARY) - ORDINARY) * 5;
}

/**
 * What a level of scavenging multiplies a haul by.
 *
 * Lifted out of `rollLoot` so the page and the roll read the same curve. It was inline
 * there, and a display that recomputed it would have been a second copy free to drift from
 * the one the simulation actually uses — which is the failure this whole file exists to
 * avoid for names and now avoids for numbers.
 *
 * Floored well above zero: a survivor is competent, and a trip that comes home with almost
 * nothing is a different kind of game.
 */
export function scavengingMultiplier(level) {
  const value = Number(level);
  return Math.max(0.5, 1 + ((Number.isFinite(value) ? value : ORDINARY) - ORDINARY) * 0.1);
}

/**
 * What a survivor's two numbers buy, as figures rather than as a sentence.
 *
 * `knownFor` said "comes back heavy, and should not linger where the counter climbs",
 * which gives a player the *sign* of both skills and the size of neither. Whether that is a
 * tenth more haul or a third of it, and whether the dose bites fifteen rads early or five,
 * were the two things the sentence could not say and the two the decision turns on.
 *
 * Derived here rather than in the page because the same pair describes a survivor standing
 * in the camp and a wanderer still at the gate, and two renderings of one pair is how the
 * gate comes to promise something the camp does not deliver.
 *
 * The arithmetic is called rather than restated: `scavengingMultiplier` is what `rollLoot`
 * uses and `radThresholdFor` is what the tick uses.
 */
export function skillsOf(survivor, radThreshold) {
  const scavenging = Number(survivor?.skillScavenging ?? survivor?.scavenging);
  const medicine = Number(survivor?.skillMedicine ?? survivor?.medicine);

  const rows = [];

  if (Number.isFinite(scavenging)) {
    rows.push({
      name: 'scavenging',
      level: scavenging,
      ordinary: ORDINARY,
      // Trimmed: x1.3 rather than x1.30, but x0.95 kept whole.
      multiplier: Number(scavengingMultiplier(scavenging).toFixed(2)),
    });
  }

  if (Number.isFinite(medicine)) {
    rows.push({
      name: 'medicine',
      level: medicine,
      ordinary: ORDINARY,
      bitesAt: Math.round(radThresholdFor(radThreshold, medicine)),
    });
  }

  return rows;
}
