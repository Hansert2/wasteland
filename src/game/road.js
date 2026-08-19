import { makeRandom, intBetween, mix } from './random.js';
import { WORLD_EPOCH } from './world-events.js';

/**
 * The road: the region reconnecting, one link at a time.
 *
 * Two pure pieces and nothing else — what a link costs, and who is at the end of it.
 * Neither touches the database, a clock it was not handed, or a settlement. That is
 * deliberate and it is the same shape as `moments.js` and `world-events.js`: the whole
 * of what is novel about a phase gets to be a function of its inputs, testable without
 * a schema, before anything is written down that would be expensive to change.
 *
 * The road is a *soft* goal. Reaching the end of it takes nothing away and resets
 * nothing — see docs/PLAN.md, which also carries the reasoning for every constant here.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many links the road has. Finite, so the page can say "three of seven". */
export const LINKS = 7;

/**
 * What the first link costs, and how fast that grows.
 *
 * Priced off a measurement rather than a feeling: the first real camp held 51 fuel
 * after six days and had never once afforded a fitting, the cheapest of which is 55.
 * So the first link is about one fitting — two or three Deep Zone trips — and the road
 * as a whole is 2252 fuel, which is months at any honest play rate.
 *
 * Growth was 1.8 in the first draft, which put the seven links at 5270 fuel and the far
 * end past a year. The multiplier is a constant, not a design: if link five reads as a
 * wall in play, this is the number to move.
 */
export const FIRST_LINK_FUEL = 70;
const GROWTH = 1.5;

/**
 * What link `index` costs in fuel, or null past the end of the road.
 *
 * One-based, because the player counts links from one and the page says "3 of 7".
 * Null rather than a throw for an out-of-range index: "is there another link" is a
 * question the page asks every render, and it should not have to guard a throw to ask.
 */
export function linkCost(index) {
  const n = Number(index);
  if (!Number.isInteger(n) || n < 1 || n > LINKS) return null;

  return Math.round(FIRST_LINK_FUEL * GROWTH ** (n - 1));
}

/** Every link, from here to the end of the road. */
export function roadCost() {
  let total = 0;
  for (let i = 1; i <= LINKS; i += 1) total += linkCost(i);
  return total;
}

/**
 * What a link brings, beyond the sight of somebody out there.
 *
 * Fixed by index rather than rolled, so the page can always say what the next link
 * gives and the player is choosing a known thing. Four of the seven are destinations,
 * two of those also carry a standing trade post, and three are worth only the news —
 * because a road where every step pays is a shop rather than a road.
 *
 * The first link is a destination on purpose: it is the player's first taste of what
 * the road is for, and 70 fuel is too much to spend on a sentence.
 */
/**
 * The four the road can actually be walked to, and the region each one becomes.
 *
 * A destination's name is authored rather than drawn, because the place on the other
 * end of the link *is* the region — its loot, its hours, its prose and the moments that
 * name its slug are all written content, and content cannot be written for a name that
 * changes per world. What varies by world is everything else about them: how many
 * people, whether they are still there, and what the road reports.
 *
 * The other three links keep generated names, which is what stops the road being the
 * same seven sentences in every world.
 */
const DESTINATIONS = {
  1: { slug: 'the_millrace', name: 'The Millrace' },
  3: { slug: 'sixteen_wells', name: 'Sixteen Wells' },
  5: { slug: 'the_waterworks', name: 'The Waterworks' },
  7: { slug: 'harrow_end', name: 'Harrow End' },
};

/** Which links keep a post open. Both are destinations: nowhere to go, nothing to buy. */
const TRADE_POSTS = new Set([3, 7]);

/** The same set, for the service that has to ask the database about them. */
export const TRADE_POST_LINKS = [...TRADE_POSTS];

export function linkGives(index) {
  if (linkCost(index) === null) return null;
  const n = Number(index);

  return {
    destination: Boolean(DESTINATIONS[n]),
    tradePost: TRADE_POSTS.has(n),
    // The region slug a destination opens, so the caller never has to know the map.
    region: DESTINATIONS[n]?.slug ?? null,
  };
}

/** Every region the road can open, whether or not any camp has reached it. */
export function roadRegions() {
  return Object.values(DESTINATIONS).map((where) => where.slug);
}

/**
 * The places the road reaches, in the voice of somewhere that names things after what
 * they used to do.
 *
 * Content, so it lives here beside the code that draws from it, the same way `MOMENTS`
 * does. Longer than `LINKS` so which seven a world gets is itself part of the world.
 */
const NAMES = [
  'Tannery Row', 'Coldharbour', 'The Long Yard', 'Ashfield', 'Sennen Cross',
  'Drybank', 'Fallowmoor', 'Kettle Bridge', 'The Sidings', 'Saltmarsh', 'The Cut',
];

/**
 * What a camp looks like from the road, standing and otherwise.
 *
 * Both pools are longer than `LINKS` on purpose, and the draw below is a shuffle
 * rather than a roll, so no road ever tells you the same thing twice. The first
 * version had four of each and rolled independently per link — which put "children,
 * which is the rarest thing on this road" on three of one road's seven neighbours and
 * made the whole world sound like one place. Pigeonhole, not bad luck.
 */
const STANDING = [
  'Smoke from three chimneys, and somebody watching the road.',
  'Fields under cultivation, and a fence mended more than once.',
  'They keep a light burning. Whether that is a welcome or a warning is not clear.',
  'Children, which is the rarest thing on this road.',
  'A wall going up, slowly, by people who expect to be here a while.',
  'Someone is running a still. You can smell it from the turning.',
  'Dogs, and the kind of quiet that means somebody is awake.',
  'They wave. Nobody comes out to meet the road.',
];

const GONE = [
  'Nobody has answered since the spring. The gate stands open.',
  'Picked over twice — once by them leaving, once by somebody else.',
  'The roofs are down. Whatever happened, it happened quickly.',
  'Still there in every way except the one that counts.',
  'The fields have gone back to whatever they were before.',
  'Somebody stacked the doors neatly before they left. That is the worst of it.',
  'A name on a board, and nothing behind it.',
  'Burned, and not recently.',
];

/**
 * A pool put in an order this world agrees on.
 *
 * Everything drawn per link — names, news — is taken from a shuffled pool by index
 * rather than rolled independently, which is what makes a draw *without replacement*:
 * no road reaches the same place twice or says the same thing twice. Derived from the
 * world seed alone, so every camp in a world agrees about who is out there — the same
 * property that lets weather be "global" with nothing coordinating it.
 */
function shuffle(items, worldSeed, salt) {
  const random = makeRandom(mix(worldSeed, `road:${salt}`));
  const out = [...items];

  // Fisher-Yates, from the end, so the draw is uniform rather than merely jumbled.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/**
 * Who is at the end of link `index`, as of `now`.
 *
 * The one function the phase's "generated or real" question lives behind. Everything
 * above it takes a neighbour and does not ask where it came from, so swapping this for
 * a read over real settlements later changes this and nothing else.
 *
 * **A fate is an instant, not a coin flip per look.** Deriving "are they still there"
 * by rolling against `now` would make a neighbour flicker in and out as the page
 * refreshed. Instead each one gets an hour at which they end — or never — so the answer
 * is monotone: somebody holding on when you linked to them can be gone when you look
 * again, and never the other way round. That is the whole trick, and it needs no row and
 * nothing running.
 */
export function neighbourFor(worldSeed, index, now = Date.now()) {
  if (linkCost(index) === null) return null;

  const random = makeRandom(mix(worldSeed, `road:${index}`));
  const gives = linkGives(index);
  // A destination is named by its content; everywhere else is named by the world.
  const name = gives.region
    ? DESTINATIONS[Number(index)].name
    : shuffle(NAMES, worldSeed, 'names')[Number(index) - 1];
  const size = intBetween(random, 6, 80);

  // Two in five do not make it. The window opens before the world's first day and runs
  // out past any camp's lifetime, so some neighbours are already gone the first time
  // anybody looks — which is the honest shape of "whether they are still there at all".
  const ends = random() < 0.4;
  const endsAt = ends ? WORLD_EPOCH + intBetween(random, 60, 900) * DAY_MS : null;
  const stillThere = endsAt === null || Number(now) < endsAt;

  // Indexed by link rather than rolled, off a pool shuffled once per world, so the
  // seven neighbours of one road never repeat a line — see the note above the pools.
  const words = shuffle(stillThere ? STANDING : GONE, worldSeed, stillThere ? 'standing' : 'gone');

  return {
    index: Number(index),
    name,
    size,
    stillThere,
    endsAt,
    news: words[(Number(index) - 1) % words.length],
    ...gives,
  };
}
