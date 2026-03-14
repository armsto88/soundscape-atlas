-- Add password support to users table
-- Run: wrangler d1 execute soundscape-comments --remote --file schema/d1_migrate_passwords.sql
-- Local:  wrangler d1 execute soundscape-comments --local  --file schema/d1_migrate_passwords.sql

ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_salt TEXT;
