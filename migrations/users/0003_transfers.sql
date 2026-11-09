-- Saved data on its way from ratingkino.com to findfilm.ai. A row lives for at most ten minutes and is
-- deleted when claimed. Only the hash of the one-time code is stored. functions/_lib/transfer.js is the only reader.
CREATE TABLE transfers (
  code_hash  TEXT PRIMARY KEY,
  payload    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
