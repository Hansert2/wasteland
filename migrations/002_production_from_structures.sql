-- Production becomes derived rather than stored.
--
-- `resources.production_rate` had to be manually resynced on every build, upgrade
-- and raid, and getting it wrong fails silently: production is simply incorrect,
-- with nothing to catch it. It is now computed from camp_structures at load time.
--
-- `storage_cap` deliberately stays put. Keeping it lets the database enforce
-- amount <= storage_cap as a real invariant, which is worth more than symmetry.

alter table resources drop column production_rate;

-- The plan's structure list had no food producer, which would make starvation
-- inevitable rather than a consequence of neglect, and the offline-death design
-- depends on a camp being able to run food-positive.
alter table camp_structures drop constraint camp_structures_kind_check;
alter table camp_structures add constraint camp_structures_kind_check
  check (kind in ('shelter', 'garden', 'water_purifier', 'workshop', 'watchtower'));
