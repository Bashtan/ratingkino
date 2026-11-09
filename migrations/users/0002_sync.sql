-- A signed-in visitor's saved data: FFStore's items (assets/store.js), one row each.
-- functions/_lib/sync.js is the only reader.

-- Counts every accepted change for this person. A device asks for what's newer than the last
-- number it saw, so a device with a wrong clock still gets everything.
ALTER TABLE users ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE items (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  item_key   TEXT NOT NULL,
  value      TEXT,                          -- JSON; NULL once removed
  added_at   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER NOT NULL DEFAULT 0,
  seq        INTEGER NOT NULL,
  PRIMARY KEY (user_id, collection, item_key)
);
CREATE INDEX idx_items_seq ON items(user_id, seq);
