import test from 'node:test';
import assert from 'node:assert/strict';

import { postKeeper,
  FACTIONS,
  caravanVisit,
  priceAt,
  priceMultiplier,
  raidFaction,
  raidTempo,
  raidTemper,
  rivalOf,
  standingsAfterTrade,
} from '../../src/game/factions.js';

test('no offer ever grants fuel — the constraint the plan could only write in prose', () => {
  // Fuel is danger money, the one resource nothing in the camp produces, and the
  // whole fuel track is priced against that. The old guard asserted no *structure*
  // produces fuel and warned that a trader would walk straight past it. This is the
  // code to point that warning at.
  for (const [slug, spec] of Object.entries(FACTIONS)) {
    for (const offer of spec.offers) {
      assert.notEqual(offer.resource, 'fuel', `${slug} sells fuel`);
    }
  }
});

test('offers may cost fuel, and some do — a sink is the opposite of a faucet', () => {
  const fuelPriced = Object.values(FACTIONS)
    .flatMap((spec) => spec.offers)
    .filter((offer) => (offer.costs?.fuel ?? 0) > 0);
  assert.ok(fuelPriced.length > 0, 'danger money should have something to buy');
});

test('the rivalry is mutual, and every offer names a real rival and real goods', () => {
  for (const [slug, spec] of Object.entries(FACTIONS)) {
    assert.equal(rivalOf(spec.rival), slug, `${slug} and ${spec.rival} disagree about their feud`);
    assert.notEqual(spec.rival, slug, 'nobody is their own rival');

    for (const offer of spec.offers) {
      assert.ok(offer.item || offer.resource, `${slug} has an offer selling nothing`);
      assert.ok(offer.qty > 0);
      assert.ok(Object.keys(offer.costs).length > 0, `${slug} gives something away`);
    }
  }
});

test('strangers pay list price, friends pay less, enemies pay more — within bounds', () => {
  assert.equal(priceMultiplier(0), 1);
  assert.equal(priceMultiplier(100), 0.6);
  assert.equal(priceMultiplier(-100), 1.4);
  assert.equal(priceMultiplier(-4000), 1.4, 'clamped: hostility has a price ceiling');

  const offer = { item: 'rad_x', qty: 2, costs: { scrap: 25 } };
  assert.deepEqual(priceAt(offer, 0), { scrap: 25 });
  assert.deepEqual(priceAt(offer, 100), { scrap: 15 });
  assert.deepEqual(priceAt(offer, -100), { scrap: 35 });
  // Rounded up: the caravan does not do change.
  assert.deepEqual(priceAt({ costs: { scrap: 21 } }, 100), { scrap: 13 });
});

test('a trade warms the seller and cools the rival, half as much', () => {
  const after = standingsAfterTrade({}, 'junction_crews');
  assert.equal(after.junction_crews, 6);
  assert.equal(after.green_river, -3);

  // Clamped at the rails on both sides.
  const maxed = standingsAfterTrade({ junction_crews: 99, green_river: -99 }, 'junction_crews');
  assert.equal(maxed.junction_crews, 100);
  assert.equal(maxed.green_river, -100);
});

test('visits and raid allegiances derive from seed and count, identically every time', () => {
  for (const i of [0, 1, 7, 40]) {
    assert.deepStrictEqual(caravanVisit(123, i), caravanVisit(123, i));
    assert.equal(raidFaction(123, i), raidFaction(123, i));
  }

  const factions = new Set([...Array(40).keys()].map((i) => caravanVisit(9, i).faction));
  assert.equal(factions.size, 2, 'both crews come to the gate over time');

  const raiders = new Set([...Array(40).keys()].map((i) => raidFaction(9, i)));
  assert.equal(raiders.size, 2, 'and both send raiders');
});

test('the hostile crew still visits — that is the road back', () => {
  // Standing is deliberately absent from caravanVisit's signature. If a hostile
  // faction stopped visiting, trading with them — the only way to recover standing —
  // would be impossible, and the rivalry would be a one-way ratchet.
  assert.equal(caravanVisit.length, 2, 'visit derivation takes seed and index, nothing else');
});

test('standing stretches raid gaps for friends and compresses them for enemies', () => {
  assert.equal(raidTempo(0), 1);
  assert.equal(raidTempo(100), 2, 'a trusted camp hears from that crew half as often');
  assert.ok(raidTempo(-100) < 0.7 && raidTempo(-100) > 0.5, 'a hated one hears more');

  const friendly = raidTemper(80);
  const hostile = raidTemper(-80);
  assert.ok(friendly.repelBonus > 0 && friendly.softening > 0 && friendly.shareBoost === 1);
  assert.ok(hostile.repelBonus === 0 && hostile.softening === 0 && hostile.shareBoost > 1);
  assert.deepEqual(raidTemper(0), { repelBonus: 0, softening: 0, shareBoost: 1 });
});

test('the post on the road is kept by whichever crew the camp stands better with', () => {
  // Derived rather than stored, so burning a crew does not close the post — the rival
  // takes it over. A road that could be talked out of trading with you would be selling
  // the one thing it has, which is that somebody is always there.
  assert.equal(postKeeper({ junction_crews: 40, green_river: -10 }), 'junction_crews');
  assert.equal(postKeeper({ junction_crews: -80, green_river: 5 }), 'green_river');

  // A fresh camp stands at zero with both, and the post is still kept by somebody.
  assert.ok(postKeeper({}) in FACTIONS);
  assert.ok(postKeeper({ junction_crews: 0, green_river: 0 }) in FACTIONS);
});
