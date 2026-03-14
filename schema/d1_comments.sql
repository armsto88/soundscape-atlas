-- D1 schema: comments table
-- Run once to initialise: wrangler d1 execute soundscape-comments --file schema/d1_comments.sql

CREATE TABLE IF NOT EXISTS comments (
  id          TEXT PRIMARY KEY,
  segment_id  TEXT NOT NULL,
  user        TEXT NOT NULL,
  text        TEXT NOT NULL,
  sec         REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_segment_id ON comments (segment_id);
CREATE INDEX IF NOT EXISTS idx_comments_user        ON comments (user);
