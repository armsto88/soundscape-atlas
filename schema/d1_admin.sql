-- Grant access by inserting the exact name of an existing account.
CREATE TABLE IF NOT EXISTS administrators (
  user_name TEXT PRIMARY KEY NOT NULL REFERENCES users(name) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_comments_user ON session_comments (user);
