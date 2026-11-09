/* Merging a signed-in visitor's saved data: POST /api/me/sync (routed in functions/_lib/account.js).
   No onRequest export, so Pages makes no route of this file. Tests: tools/sync-test.mjs.

   One call does both directions, and the first sign-in is the same call with since: 0:
     POST /api/me/sync  { since, items: [{ c, k, v, a, u, d }] }
     → { items: [...same shape, changed since `since`], cursor, more, rejected }
   c collection · k key · v value · a added · u updated · d removed (0 if not), times in ms.

   The rule is per item: the newest change wins. So a retry, or the same data sent twice, changes
   nothing, and a client can safely resend after any failure. A removal is a change like any other,
   so it beats an older save and loses to a newer one. Saves from before dates were recorded arrive
   with u = 1: kept, but they can't undo a dated removal.

   Only what's in RULES is stored, so a device can't push anything else (rk_tmdb and rk_omdb can hold
   a visitor's own API keys). One bad item is skipped and counted; the rest still go through.
   A time much later than the server's clock is capped to it. */

const RULES = new Map([
  ['watchlist', { key: /^(movie|tv):\d{1,10}$/, max: 200 }],
  ['reviews',   { key: /^\d{1,10}:[^\s]{1,40}$/, max: 8000 }],
  ['prefs',     { key: /^(country|minRating)$/, max: 50 }],
  // The taste blobs have no dates: the client sends their interaction count as u, so the richer one wins.
  ['profile',   { key: /^(taste|ratedFilms)$/, max: 64000 }],
]);

// A device a moment ahead is normal. Capping exactly at the server's clock could make a quick second
// change tie with the first, and a tie doesn't overwrite.
const CLOCK_SLACK_MS = 5000;

export const SYNC = {
  MAX_BATCH: 2000,        // items per request: a client with more sends them in turn
  PAGE: 5000,             // items per response
  MAX_ITEMS: 20000,       // per person
  MAX_BODY: 1500000,      // one bound value in D1 is at most 2 MB
};

function cleanItem(x, now) {
  if (!x || typeof x !== 'object') return null;
  const rule = RULES.get(x.c);
  if (!rule || typeof x.k !== 'string' || !rule.key.test(x.k)) return null;
  const time = n => (Number.isSafeInteger(n) && n > 0 ? Math.min(n, now + CLOCK_SLACK_MS) : 0);
  const u = time(x.u), d = time(x.d);
  if (!u) return null;
  if (d) return { c: x.c, k: x.k, v: null, a: time(x.a) || u, u, d };
  if (x.v === undefined || x.v === null) return null;
  const v = JSON.stringify(x.v);
  if (v.length > rule.max) return null;
  return { c: x.c, k: x.k, v, a: time(x.a) || u, u, d: 0 };
}

// → { items, rejected }
export function cleanItems(raw, now) {
  const items = [];
  let rejected = 0;
  for (const x of raw) {
    const item = cleanItem(x, now);
    if (item) items.push(item); else rejected += 1;
  }
  return { items, rejected };
}

// All in one transaction. Only a strictly newer change is written, and only that gets a new seq.
export async function mergeItems(db, userId, items) {
  if (!items.length) return;
  await db.batch([
    db.prepare(`
      INSERT INTO items (user_id, collection, item_key, value, added_at, updated_at, deleted_at, seq)
      SELECT ?1, json_extract(j.value, '$.c'), json_extract(j.value, '$.k'), json_extract(j.value, '$.v'),
             json_extract(j.value, '$.a'), json_extract(j.value, '$.u'), json_extract(j.value, '$.d'),
             (SELECT seq FROM users WHERE id = ?1) + j.key + 1
      FROM json_each(?2) AS j WHERE true
      ON CONFLICT (user_id, collection, item_key) DO UPDATE SET
        value      = excluded.value,
        added_at   = CASE WHEN items.deleted_at > 0 THEN excluded.added_at ELSE MIN(items.added_at, excluded.added_at) END,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at,
        seq        = excluded.seq
      WHERE excluded.updated_at > items.updated_at
    `).bind(userId, JSON.stringify(items)),
    db.prepare('UPDATE users SET seq = seq + ?2 WHERE id = ?1').bind(userId, items.length),
  ]);
}

// What changed after `since`, oldest first. The cursor is the last row returned, never further,
// so a change another device commits at the same moment can't be stepped over.
export async function changesSince(db, userId, since) {
  const { results } = await db.prepare(
    'SELECT collection AS c, item_key AS k, value AS v, added_at AS a, updated_at AS u, deleted_at AS d, seq FROM items WHERE user_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3'
  ).bind(userId, since, SYNC.PAGE).all();
  return {
    items: results.map(({ seq, v, ...row }) => ({ ...row, v: v === null ? null : JSON.parse(v) })),
    cursor: results.length ? results[results.length - 1].seq : since,
    more: results.length === SYNC.PAGE,
  };
}

// → [status, body]
export async function syncRequest(db, userId, text, now) {
  if (text.length > SYNC.MAX_BODY) return [413, { error: 'Too much at once' }];
  let body;
  try { body = JSON.parse(text); } catch { return [400, { error: 'Bad request' }]; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [400, { error: 'Bad request' }];
  const raw = body.items === undefined ? [] : body.items;
  if (!Array.isArray(raw)) return [400, { error: 'Bad request' }];
  if (raw.length > SYNC.MAX_BATCH) return [413, { error: 'Too much at once' }];

  const since = Number.isSafeInteger(body.since) && body.since > 0 ? body.since : 0;
  const { items, rejected } = cleanItems(raw, now);
  if (items.length) {
    const held = await db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?1').bind(userId).first('n');
    if (held + items.length > SYNC.MAX_ITEMS) return [413, { error: 'Too many saved items' }];
  }
  await mergeItems(db, userId, items);
  return [200, { ...(await changesSince(db, userId, since)), rejected }];
}
