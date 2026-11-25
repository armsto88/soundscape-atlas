-- Apply once after d1_library.sql. Existing comments keep their whole-session scope.
ALTER TABLE session_comments ADD COLUMN segment_id TEXT;
ALTER TABLE session_comments ADD COLUMN sec REAL;
