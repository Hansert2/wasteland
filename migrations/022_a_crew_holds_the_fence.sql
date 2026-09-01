-- Everybody who stands, stands.
--
-- Phase 12 shipped with one defender and left the question open in the plan: whether a crew
-- holds a fence better than one person. Played on 2026-09-01 and answered immediately — with
-- four names on the block and only one of them able to press anything, the block was asking
-- the wrong question.
--
-- ## Why this cannot stay a column
--
-- `raids.stood_by` is a single reference, and what a raid needs to record now is a set of
-- people *and what each of them took*. The damage is per person by decision rather than by
-- accident: each defender rolls their own, because splitting one raid's worth between them
-- would make committing the whole camp strictly better than committing one and there would be
-- no decision left to make.
--
-- So the fact belongs in a table, one row per survivor who stood, carrying what it cost them.
-- `raids.damage` keeps the total for the row and the event; this is where the detail lives.
--
-- ## The old column's rows come with it
--
-- Anything already answered under the single-defender build is one person who stood, and the
-- raid's own `damage` is what they took. Copied rather than dropped: a camp that answered a
-- raid yesterday should still be able to say who went out.

create table raid_stands (
  raid_id      bigint not null references raids(id) on delete cascade,
  character_id bigint not null references characters(id) on delete cascade,
  damage       integer not null default 0 check (damage >= 0),

  primary key (raid_id, character_id)
);

insert into raid_stands (raid_id, character_id, damage)
select id, stood_by, damage from raids where stood_by is not null;

alter table raids drop column stood_by;

comment on table raid_stands is
  'Who went out to meet a raid, and what it cost each of them. Several rows per raid: '
  'everybody who stands takes their own injury, which is what keeps "how many do I send" a '
  'question rather than an answer.';

-- `on delete cascade` on the survivor rather than `set null`, unlike every other job a person
-- can be given. A build outlives its builder because the beam is still half-raised; a raid is
-- over the moment it is over, and a row saying somebody who no longer exists took fourteen
-- damage in it is a fact about nobody.
