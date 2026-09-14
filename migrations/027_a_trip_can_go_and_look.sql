-- Phase 16: a trip can be sent to look for somebody who did not come back.
--
-- One nullable column, because the decision belongs to the trip rather than to the camp. A
-- survivor who lies in the Deep Zone can be looked for on one walk there and not on the next,
-- and which of those it was has to survive until the trip resolves — the same reason
-- `departed_at`, `seed` and the frozen sky are all on this row and not read off the camp at
-- resolution.
--
-- ## Why it is not a moment
--
-- `momentsFor` is a pure function of a region and a seed and knows nothing about the camp that
-- sent the trip, so "you come across where Wren stopped" cannot be offered by the machinery
-- that offers everything else out there. That is a real constraint and it points the right
-- way: **the decision belongs before you go.** The search costs hours, and hours are the one
-- thing a player should never find out they have spent after the fact.
--
-- ## Why it is not a column on the camp
--
-- Two trips to the same place could both claim the same body, and the loser would come home
-- having spent the hours for nothing with no record of why. Per trip, and the resolution
-- checks that they are still out there.
--
-- `on delete set null`, so a settlement wiped of its dead does not take its expedition history
-- with it. A trip that was looking for somebody who no longer exists simply looked for nobody.

alter table expeditions
  add column recovering_id bigint references characters (id) on delete set null;

comment on column expeditions.recovering_id is
  'The survivor this trip was also sent to bring home, or null for an ordinary walk. The '
  'search hours are already in returns_at; what comes back is decided at resolution, against '
  'how long they had lain out there by then.';
