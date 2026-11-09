-- Accounts: who someone is and how they're signed in. D1 database findfilm-users (binding USERS).
-- Foreign keys cascade, so deleting a row in users removes everything of theirs,
-- including the data tables Stage 3 adds. functions/_lib/account.js is the only reader.

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  email      TEXT,
  name       TEXT,
  created_at INTEGER NOT NULL
);

-- subject is the provider's stable id for the person (the token's `sub`), never their email:
-- an email can change, and Apple can hide it.
CREATE TABLE identities (
  provider   TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_identities_user ON identities(user_id);

-- Only the hash of the session token is stored: a leaked table can't sign anyone in.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Sign-in attempts per hashed IP per ten minutes. Rows are short-lived.
CREATE TABLE rate_limits (
  id         TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
