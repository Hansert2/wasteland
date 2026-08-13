-- Server-side sessions.
--
-- The cookie carries a random token; this table stores only its SHA-256 hash, so a
-- dump of this table cannot be replayed as a login. Sessions being rows rather than
-- self-signed cookies also means logging out actually revokes access.

create table sessions (
  token_hash text        primary key,
  player_id  bigint      not null references players (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index sessions_player_idx on sessions (player_id);
create index sessions_expiry_idx on sessions (expires_at);
