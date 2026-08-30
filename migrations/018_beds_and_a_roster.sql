-- A camp can hold more than one person, and a shelter can hold more than one bed.
--
-- Two constraints have been quietly deciding the shape of this game, and both go here.
--
-- ## The one that says a camp is one person
--
-- `characters_one_living_idx` is `unique (settlement_id) where died_at is null`. It is why
-- `loadWorld` said "the living survivor, singular" for as long as it did, and it has been
-- doing honest work: while the code was being taught to carry a roster, the index is what
-- kept that list truthful at length one.
--
-- It is dropped now rather than earlier on purpose. An index that only *permits* a second
-- row is harmless right up until something creates one, and dropping it before the loader
-- could describe two people would have turned a guarantee into an assumption without
-- anything failing to say so.
--
-- ## The one that says a fitting happens once
--
-- `structure_upgrades` is `unique (settlement_id, upgrade)`, which is what makes The Clock
-- and The Glass one-of-each. That is right for an instrument and wrong for a bed: a shelter
-- should hold as many as its level allows.
--
-- So the key gains an **ordinal**. Every fitting standing today becomes ordinal 1 and stays
-- once-only, because `upgradesFor` will not offer an instrument a second time — the schema
-- stops being what enforces that, and the content starts. A second bed is ordinal 2.
--
-- Why an ordinal rather than a quantity column: a bed being built and two beds already
-- standing are three rows in three states, and `completes_at` and `installed_at` are
-- per-row. A `qty` would need a second table to say when the next one lands.
--
-- ## Why beds are scrap
--
-- Fuel buys capabilities and scrap buys structure, and a bed is a thing built into a
-- shelter rather than an instrument bolted to one. It is also the only workable answer:
-- **no region a new camp can reach returns any fuel** — the Fence Line, the Service Road,
-- the Ruined City and the Farmland are scrap, food and water — so a fuel-priced bed could
-- not be bought inside the first day or two, which is the window the whole phase exists to
-- hit. See the note in `docs/PLAN.md`.

alter table structure_upgrades
  add column ordinal integer not null default 1 check (ordinal >= 1);

alter table structure_upgrades
  drop constraint structure_upgrades_settlement_id_upgrade_key;

alter table structure_upgrades
  add constraint structure_upgrades_settlement_id_upgrade_ordinal_key
    unique (settlement_id, upgrade, ordinal);

comment on column structure_upgrades.ordinal is
  'Which one of this fitting: 1 for every instrument, 1..n for beds. The schema allows a '
  'second of anything; what stops a second clock is that nothing offers one.';

drop index characters_one_living_idx;
