-- Work belongs to a person, so the work has to say which one.
--
-- The rule, from the user on 2026-08-31: **a survivor who is building cannot dispatch, and
-- two survivors who are both free can both go.** That is per-person occupation, and none of
-- these three tables can express it — a build is a timestamp on a structure, a fitting is a
-- row against a camp, and a craft order hangs off the settlement. Every one of them records
-- that the camp is busy and none records who is busy.
--
-- It could not have been otherwise. A camp held one survivor, so "the camp is building" and
-- "the survivor is building" were the same sentence, and `characters_one_living_idx` made
-- sure of it. Migration `018` dropped that index; this is the half of the consequence that
-- had not been dealt with yet.
--
-- **Nullable, and null means the camp.** Every build, fitting and craft standing right now
-- was started when there was one pair of hands and nobody needed naming. Backfilling them to
-- whoever is living would be inventing a fact — the person who started that build may be in
-- the graveyard — so an unowned job is one that occupies nobody, which is exactly what it
-- has been doing since it was started.
--
-- **`on delete set null` rather than cascade.** A character row is never deleted today, but
-- if one ever were, losing a half-built shelter with it would be a strange way to find out.
-- The job outlives the worker; that is what an unowned job means.

alter table camp_structures
  add column built_by bigint references characters(id) on delete set null;

alter table structure_upgrades
  add column fitted_by bigint references characters(id) on delete set null;

alter table craft_orders
  add column crafted_by bigint references characters(id) on delete set null;

comment on column camp_structures.built_by is
  'Who is raising this level, and therefore who cannot leave until it is done. Null for a '
  'job started before work belonged to anybody, which occupies nobody.';

comment on column structure_upgrades.fitted_by is
  'Who is fitting this. Null means the same as it does on camp_structures.built_by.';

comment on column craft_orders.crafted_by is
  'Who is at the bench. Null means the same as it does on camp_structures.built_by.';
