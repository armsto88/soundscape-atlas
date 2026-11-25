-- Session records use their own tables so an hour and its session can share an ID.
CREATE TABLE IF NOT EXISTS session_favorites (
  user_name  TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_name, session_id)
);

CREATE TABLE IF NOT EXISTS session_comments (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_comments_latest ON session_comments (session_id, created_at DESC);
