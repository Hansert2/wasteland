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

/** Read a settlement and its living survivor into the shape `applyTick` expects. */
export async function loadWorld(client, settlementId) {
  const { rows: settlements } = await client.query(
    'select id, last_tick_at from settlements where id = $1',
    [settlementId],
  );
  const settlement = settlements[0];
  if (!settlement) throw new Error(`no settlement ${settlementId}`);

  const { rows: resourceRows } = await client.query(
    'select kind, amount, production_rate, storage_cap from resources where settlement_id = $1',
    [settlementId],
  );
  const resources = {};
  for (const row of resourceRows) {
    resources[row.kind] = {
      amount: row.amount,
      ratePerHour: row.production_rate,
      cap: row.storage_cap,
    };
  }

  // "The living survivor", singular — the partial unique index guarantees at most one.
  const { rows: characters } = await client.query(
    `select id, health, hunger, radiation, born_at
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
        where ii.character_id = $1`,
      [character.id],
    );

    survivor = {
      id: character.id,
      alive: true,
      health: character.health,
      hunger: character.hunger,
      radiation: character.radiation,
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

    const { rows: active } = await client.query(
      `select id, status from expeditions where character_id = $1 and status = 'active'`,
      [character.id],
    );
    if (active[0]) {
      expedition = { id: active[0].id, status: active[0].status, resolvedAt: null };
    }
  }

  return {
    lastTickAt: settlement.last_tick_at.getTime(),
    settlement: { id: settlement.id, resources },
    survivor,
    expedition,
  };
}

/** Write a post-tick state back. Assumes the caller holds a transaction. */
export async function saveWorld(client, state) {
  const settlementId = state.settlement.id;

  await client.query('update settlements set last_tick_at = $2 where id = $1', [
    settlementId,
    new Date(state.lastTickAt),
  ]);

  for (const [kind, resource] of Object.entries(state.settlement.resources)) {
    await client.query(
      'update resources set amount = $3 where settlement_id = $1 and kind = $2',
      [settlementId, kind, resource.amount],
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
      'update expeditions set status = $2, resolved_at = $3 where id = $1',
      [expedition.id, expedition.status, new Date(expedition.resolvedAt)],
    );
  }
}
