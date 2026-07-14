-- FindFilm.ai — "Movie Pitch" shared voting + discussion (Stage 2 Pass 2)
-- D1 database: findfilm-pitch  (binding: DB)
-- Apply:  npx wrangler d1 execute findfilm-pitch --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS pitches (
  id         TEXT PRIMARY KEY,          -- 8-char base62 short id
  movie_id   INTEGER NOT NULL,
  title      TEXT NOT NULL,
  year       TEXT,
  poster     TEXT,                      -- TMDB poster path (e.g. /abc.jpg)
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  pitch_id   TEXT NOT NULL,
  voter      TEXT NOT NULL,             -- anonymous localStorage id
  vote       TEXT NOT NULL CHECK (vote IN ('yes','maybe','no')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pitch_id, voter)         -- one vote per person; re-vote = upsert
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pitch_id   TEXT NOT NULL,
  name       TEXT,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_votes_pitch    ON votes(pitch_id);
CREATE INDEX IF NOT EXISTS idx_comments_pitch ON comments(pitch_id);
