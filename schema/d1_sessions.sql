-- Server-side sign-in sessions. The browser holds a random token in an
-- HttpOnly cookie; only its SHA-256 hash is stored here.
-- Run: wrangler d1 execute soundscape-comments --remote --file schema/d1_sessions.sql
-- Local:  wrangler d1 execute soundscape-comments --local  --file schema/d1_sessions.sql

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_name   TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_name  ON sessions (user_name);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);
