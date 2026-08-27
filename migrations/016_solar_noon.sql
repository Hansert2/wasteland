-- Where the sun sits against the camp's clock, which is not the same thing as the clock.
--
-- Migration `015` gave each camp its own hour so that dark outside and dark in the game
-- would be the same dark. It got the clock right and the sun wrong, because one number was
-- doing two jobs.
--
-- **What time is it here** is the timezone offset, and a browser knows it.
-- **Where is the sun against that clock** is a different quantity, and a browser cannot
-- know it: it depends on how far the camp sits from its timezone's meridian, plus whatever
-- summer time is doing. `daylight.js` assumed the two coincide — solar noon at 12:00 — and
-- that is only true for a camp sitting exactly on its meridian.
--
-- Measured against the real sky on 2026-08-28: the model put sunrise at 05:24 where
-- Amsterdam's was 06:47. The day *length* was close, 13.2 hours against 13.8 — the whole
-- day was simply centred an hour and twenty-five minutes early, because Amsterdam's solar
-- noon is 13:40, being roughly twenty minutes west of the CEST meridian and an hour into
-- summer time.
--
-- So: minutes past midnight, on this camp's own clock, at which the sun is highest. The
-- default of 720 is noon, which is the idealised world and correct for a camp on its
-- meridian; a camp that wants its sky to match a real window sets its own.

alter table settlements
  add column solar_noon_minutes integer not null default 720
    check (solar_noon_minutes between 0 and 1439);

comment on column settlements.solar_noon_minutes is
  'Minutes past midnight, on this camp''s clock, when the sun is highest. 720 is noon and '
  'suits a camp on its timezone''s meridian; Amsterdam in summer is about 820.';
