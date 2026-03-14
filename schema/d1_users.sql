-- D1 schema: users and likes tables
-- Run: wrangler d1 execute soundscape-comments --remote --file schema/d1_users.sql
-- Local:  wrangler d1 execute soundscape-comments --local  --file schema/d1_users.sql

CREATE TABLE IF NOT EXISTS users (
  name        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS likes (
  user_name   TEXT NOT NULL,
  segment_id  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (user_name, segment_id)
);

CREATE INDEX IF NOT EXISTS idx_likes_user_name  ON likes (user_name);
CREATE INDEX IF NOT EXISTS idx_likes_segment_id ON likes (segment_id);
