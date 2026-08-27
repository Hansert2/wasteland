import { UPGRADES, productionRates } from '../game/structures.js';

/**
 * The seam between the database and the pure simulation.
 *
 * The tick knows nothing about Postgres and Postgres knows nothing about the tick;
 * this module translates between them. Names differ deliberately on each side —
 * `production_rate` / `storage_cap` are the schema's vocabulary, `ratePerHour` /
 * `cap` are the simulation's — and this is the only place that has to know both.
 *
 * Every function takes an explicit `client` rather than reaching for the pool, so
 * callers control the transaction and tests can hand in one they intend to roll back.
 */

/** One settlement per account, so this is the account's camp. */
export async function settlementIdForPlayer(client, playerId) {
  const { rows } = await client.query('select id from settlements where player_id = $1', [
    playerId,
  ]);
  return rows[0]?.id ?? null;
}

/** Read a settlement and its living survivor into the shape `applyTick` expects. */
export async function loadWorld(client, settlementId) {
  const { rows: settlements } = await client.query(
    `select id, last_tick_at, raid_seed, raid_count, next_raid_at,
            caravan_seed, caravan_count, next_caravan_at
       from settlements where id = $1`,
    [settlementId],
  );
  const settlement = settlements[0];
  if (!settlement) throw new Error(`no settlement ${settlementId}`);

  // Production is derived from structures rather than read from a column, so it
  // cannot fall out of step with what the camp has actually built. Structures ride
  // along in the state because the tick needs them: a build finishing mid-interval
  // changes the rates from that hour on.
  // Ordered, and every other query here that builds an array is too. Without it the
  // row order is whatever the heap happens to hand back, and `saveWorld` rewrites
  // these rows on every tick — so two loads of an unchanged world can differ in
  // nothing but order. That makes a state comparison intermittently false, which is
  // an unpleasant way to spend an afternoon.
  const { rows: structureRows } = await client.query(
    `select id, kind, level, build_completes_at
       from camp_structures where settlement_id = $1 order by kind`,
    [settlementId],
  );
  const structures = structureRows.map((row) => ({
    id: row.id,
    kind: row.kind,
    level: row.level,
    buildCompletesAt: row.build_completes_at?.getTime() ?? null,
  }));
  const rates = productionRates(structures);

  const { rows: resourceRows } = await client.query(
    'select kind, amount, storage_cap from resources where settlement_id = $1',
    [settlementId],
  );
  const resources = {};
  for (const row of resourceRows) {
    resources[row.kind] = {
      amount: row.amount,
      ratePerHour: rates[row.kind] ?? 0,
      cap: row.storage_cap,
    };
  }

  // "The living survivor", singular — the partial unique index guarantees at most one.
  const { rows: characters } = await client.query(
    `select id, health, hunger, radiation, born_at, skill_scavenging, skill_medicine
       from characters
      where settlement_id = $1 and died_at is null`,
    [settlementId],
  );
  const character = characters[0];

  let survivor = null;
  let expedition = null;

  if (character) {
    const { rows: inventory } = await client.query(
      `select ii.id as row_id, ii.qty, i.slug, i.kind, i.potency
         from inventory_items ii
         join items i on i.id = ii.item_id
        where ii.character_id = $1
        order by i.slug`,
      [character.id],
    );

    survivor = {
      id: character.id,
      alive: true,
      health: character.health,
      hunger: character.hunger,
      radiation: character.radiation,
      skillScavenging: character.skill_scavenging,
      // Read by the tick, not by any generator: medicine moves where a dose starts
      // costing the survivor and never what a trip rolled. See `radThresholdFor`.
      skillMedicine: character.skill_medicine,
      bornAt: character.born_at.getTime(),
      diedAt: null,
      causeOfDeath: null,
      // `id` is the slug because that is what the simulation's events should name;
      // `rowId` is carried along purely so the write-back knows which row to update.
      inventory: inventory.map((row) => ({
        rowId: row.row_id,
        id: row.slug,
        kind: row.kind,
        potency: row.potency,
        qty: row.qty,
      })),
    };

    // The region travels with the expedition because resolution is pure: the tick
    // must be able to roll an outcome without reaching back into the database.
    const { rows: active } = await client.query(
      `select e.id, e.status, e.departed_at, e.returns_at, e.seed, e.choices,
              r.slug, r.name, r.danger, r.travel_hours, r.loot, r.finds, r.radiation_per_trip
         from expeditions e
         join regions r on r.id = e.region_id
        where e.character_id = $1 and e.status = 'active'`,
      [character.id],
    );

    if (active[0]) {
      const row = active[0];
      expedition = {
        id: row.id,
        status: row.status,
        // Carried because the sky is integrated across the trip rather than sampled at
        // its end, and an integral needs both ends. Derivable from `returnsAt` less
        // `travelHours`, and selected anyway: deriving a stored column is how the two
        // come to disagree.
        departedAt: row.departed_at.getTime(),
        returnsAt: row.returns_at.getTime(),
        seed: row.seed,
        // What the player answered while it was in flight. Read-only in the tick: the
        // route writes these, resolution only ever reads them.
        choices: row.choices ?? [],
        resolvedAt: null,
        log: null,
        region: {
          slug: row.slug,
          name: row.name,
          danger: row.danger,
          // Carried because moments are placed across the trip, so resolution cannot
          // work out when anything was offered without knowing how long it was.
          travelHours: Number(row.travel_hours),
          loot: row.loot,
          finds: row.finds,
          radiationPerTrip: row.radiation_per_trip,
        },
      };
    }
  }

  // The craft order hangs off the settlement rather than the character, so it loads
  // whether or not anyone is alive to receive it — that is what the 'lost' status is
  // for. The output travels with the order for the same reason the region travels
  // with an expedition: the tick resolves it without reaching back into the database.
  const { rows: crafting } = await client.query(
    `select co.id, co.status, co.completes_at, rec.name, rec.output_qty, i.slug
       from craft_orders co
       join recipes rec on rec.id = co.recipe_id
       join items i on i.id = rec.output_item_id
      where co.settlement_id = $1 and co.status = 'active'`,
    [settlementId],
  );

  const order = crafting[0];

  // The fuel track. Installed upgrades are capabilities the camp has; the one with a
  // null installed_at is still being fitted, and the partial unique index guarantees
  // there is at most one. What each upgrade *does* lives in code, not here.
  const { rows: upgradeRows } = await client.query(
    `select id, kind, upgrade, completes_at, installed_at
       from structure_upgrades where settlement_id = $1 order by upgrade`,
    [settlementId],
  );
  const pending = upgradeRows.find((row) => row.installed_at === null);

  const { rows: standingRows } = await client.query(
    'select faction, standing from faction_standing where settlement_id = $1 order by faction',
    [settlementId],
  );
  const standings = {};
  for (const row of standingRows) standings[row.faction] = Number(row.standing);

  return {
    lastTickAt: settlement.last_tick_at.getTime(),
    settlement: {
      id: settlement.id,
      resources,
      structures,
      // The raid schedule. `next_raid_at` is null until the tick decides it, which it
      // does from the wealth the camp has at that moment rather than at founding.
      raidSeed: Number(settlement.raid_seed),
      raidCount: settlement.raid_count,
      nextRaidAt: settlement.next_raid_at?.getTime() ?? null,
      caravanSeed: Number(settlement.caravan_seed),
      caravanCount: settlement.caravan_count,
      nextCaravanAt: settlement.next_caravan_at?.getTime() ?? null,
      // The camp's own clock, in minutes ahead of UTC. The tick needs it because a trip
      // is scaled by how much of it happened in daylight, and which hours those were is a
      // question about this camp's sky rather than about Greenwich's.
      clockOffset: Number(settlement.clock_offset_minutes) || 0,
      // Read-only in the tick: standing feeds raid tempering, and only trades and
      // successions write it, so saveWorld deliberately does not carry it back.
      standings,
      upgrades: upgradeRows.filter((row) => row.installed_at !== null).map((row) => row.upgrade),
    },
    survivor,
    expedition,
    craft: order
      ? {
          id: order.id,
          status: order.status,
          completesAt: order.completes_at.getTime(),
          resolvedAt: null,
          name: order.name,
          output: { slug: order.slug, qty: order.output_qty },
        }
      : null,
    fitting: pending
      ? {
          id: pending.id,
          kind: pending.kind,
          upgrade: pending.upgrade,
          name: UPGRADES[pending.upgrade]?.name ?? pending.upgrade,
          completesAt: pending.completes_at.getTime(),
          installedAt: null,
        }
      : null,
  };
}

/** Write a post-tick state back. Assumes the caller holds a transaction. */
export async function saveWorld(client, state) {
  const settlementId = state.settlement.id;

  await client.query(
    `update settlements
        set last_tick_at = $2, raid_count = $3, next_raid_at = $4,
            caravan_count = $5, next_caravan_at = $6
      where id = $1`,
    [
      settlementId,
      new Date(state.lastTickAt),
      state.settlement.raidCount ?? 0,
      state.settlement.nextRaidAt == null ? null : new Date(state.settlement.nextRaidAt),
      state.settlement.caravanCount ?? 0,
      state.settlement.nextCaravanAt == null ? null : new Date(state.settlement.nextCaravanAt),
    ],
  );

  for (const [kind, resource] of Object.entries(state.settlement.resources)) {
    // The cap is written back too: a shelter that finished building mid-interval
    // raised it, and the stored column is what the check constraint enforces against.
    await client.query(
      'update resources set amount = $3, storage_cap = $4 where settlement_id = $1 and kind = $2',
      [settlementId, kind, resource.amount, resource.cap],
    );
  }

  for (const structure of state.settlement.structures ?? []) {
    await client.query(
      'update camp_structures set level = $2, build_completes_at = $3 where id = $1',
      [
        structure.id,
        structure.level,
        structure.buildCompletesAt === null ? null : new Date(structure.buildCompletesAt),
      ],
    );
  }

  const survivor = state.survivor;
  if (survivor) {
    // Setting died_at is what retires the character: the partial unique index stops
    // matching them, so the next load returns no survivor and the camp ticks on alone.
    await client.query(
      `update characters
          set health = $2, hunger = $3, radiation = $4,
              died_at = $5, cause_of_death = $6
        where id = $1`,
      [
        survivor.id,
        survivor.health,
        survivor.hunger,
        survivor.radiation,
        survivor.diedAt === null ? null : new Date(survivor.diedAt),
        survivor.causeOfDeath ?? null,
      ],
    );

    for (const item of survivor.inventory) {
      await client.query('update inventory_items set qty = $2 where id = $1', [
        item.rowId,
        item.qty,
      ]);
    }
  }

  const expedition = state.expedition;
  if (expedition && expedition.status !== 'active') {
    await client.query(
      'update expeditions set status = $2, resolved_at = $3, log = $4 where id = $1',
      [
        expedition.id,
        expedition.status,
        new Date(expedition.resolvedAt),
        expedition.log ? JSON.stringify(expedition.log) : null,
      ],
    );
  }

  const fitting = state.fitting;
  if (fitting && fitting.installedAt != null) {
    await client.query('update structure_upgrades set installed_at = $2 where id = $1', [
      fitting.id,
      new Date(fitting.installedAt),
    ]);
  }

  const craft = state.craft;
  if (craft && craft.status !== 'active') {
    // Only the resolution is written back; nothing about an order changes while it
    // is still on the bench. The check constraint wants both columns or neither.
    await client.query('update craft_orders set status = $2, resolved_at = $3 where id = $1', [
      craft.id,
      craft.status,
      new Date(craft.resolvedAt),
    ]);
  }
}

/**
 * Add found items to a survivor's pack. Separate from saveWorld because the tick
 * deals in slugs and knows nothing of item ids — resolving one is a database concern.
 */
export async function grantItems(client, characterId, grants) {
  for (const { slug, qty } of grants) {
    await client.query(
      `insert into inventory_items (character_id, item_id, qty)
       select $1, i.id, $3 from items i where i.slug = $2
       on conflict (character_id, item_id)
         do update set qty = inventory_items.qty + excluded.qty`,
      [characterId, slug, qty],
    );
  }
}
