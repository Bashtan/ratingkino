/* Tests merging saved data (POST /api/me/sync) through the real route, session and schema.
     node --no-warnings tools/sync-test.mjs
   The one rule under test: per item, the newest change wins, whatever order things arrive in. */
import assert from 'node:assert/strict';
import { handleAuth, handleMe } from '../functions/_lib/account.js';
import { SYNC } from '../functions/_lib/sync.js';
import { fakeD1 } from './fake-d1.mjs';

const db = fakeD1();
const env = { USERS: db };
const ORIGIN = 'https://findfilm.ai';
let ip = 0, nextSub = 0;
const req = (path, { method = 'GET', cookie = '', body, origin = ORIGIN } = {}) => {
  const headers = { 'CF-Connecting-IP': `10.1.0.${++ip}` };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  return new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
};
async function newUser() {
  const sub = `s${++nextSub}`;
  const res = await handleAuth({ request: req('/api/auth/google', { method: 'POST', cookie: '__Host-ff_nonce=nn', body: { credential: 'x' } }), env, params: { path: ['google'] } }, async () => ({ sub, email: `${sub}@x.y`, name: 'T' }));
  return res.headers.getSetCookie().find(c => c.startsWith('__Host-ff_session=')).split(';')[0];
}
const rawSync = (cookie, body, origin) => handleMe({ request: req('/api/me/sync', { method: 'POST', cookie, body, origin }), env, params: { path: ['sync'] } });
const sync = async (cookie, items, since = 0) => { const res = await rawSync(cookie, { since, items }); assert.equal(res.status, 200); return res.json(); };

const NOW = Date.now(), T = n => NOW - 1000000 + n;
const wl = (id, u, extra = {}) => ({ c: 'watchlist', k: `movie:${id}`, v: { id, type: 'movie' }, a: u, u, d: 0, ...extra });
const gone = (id, u, a = 1) => ({ c: 'watchlist', k: `movie:${id}`, v: null, a, u, d: u });
const find = (r, k) => r.items.find(x => x.k === k);
const live = r => r.items.filter(x => !x.d).map(x => x.k).sort();
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log('ok  ', name); };

await test('the first sync merges everything and returns it', async () => {
  const c = await newUser();
  const r = await sync(c, [wl(1, T(1)), wl(2, T(2)), { c: 'prefs', k: 'country', v: 'FR', a: T(3), u: T(3), d: 0 }]);
  assert.equal(r.items.length, 3);
  assert.equal(r.rejected, 0);
  assert.deepEqual(find(r, 'movie:1').v, { id: 1, type: 'movie' });
  assert.equal(find(r, 'country').v, 'FR');
  assert.ok(r.cursor > 0 && r.more === false);
});

await test('sending the same thing again changes nothing', async () => {
  const c = await newUser();
  const batch = [wl(1, T(1)), wl(2, T(2))];
  const first = await sync(c, batch);
  const again = await sync(c, batch, first.cursor);
  assert.equal(again.items.length, 0);
  assert.equal((await sync(c, [], 0)).items.length, 2);
});

await test('a newer change wins', async () => {
  const c = await newUser();
  await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 2 }, a: T(1), u: T(1), d: 0 }]);
  const r = await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 5 }, a: T(1), u: T(2), d: 0 }]);
  assert.equal(find(r, '5:a').v.stars, 5);
});

await test('an older change loses', async () => {
  const c = await newUser();
  await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 5 }, a: T(1), u: T(9), d: 0 }]);
  const r = await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 2 }, a: T(1), u: T(3), d: 0 }]);
  assert.equal(find(r, '5:a').v.stars, 5);
});

await test('a removal beats an older save', async () => {
  const c = await newUser();
  await sync(c, [wl(1, T(1))]);
  const r = await sync(c, [gone(1, T(5))]);
  assert.ok(find(r, 'movie:1').d > 0);
  assert.equal(find(r, 'movie:1').v, null);
});

await test('a removal arriving first still beats an older save arriving later', async () => {
  const c = await newUser();
  await sync(c, [gone(1, T(5))]);
  const r = await sync(c, [wl(1, T(1))]);
  assert.ok(find(r, 'movie:1').d > 0);
});

await test('a newer save brings a removed film back', async () => {
  const c = await newUser();
  await sync(c, [gone(1, T(5))]);
  const r = await sync(c, [wl(1, T(9))]);
  assert.equal(find(r, 'movie:1').d, 0);
  assert.deepEqual(find(r, 'movie:1').v, { id: 1, type: 'movie' });
});

await test('an undated old save is added, but can\'t undo a dated removal', async () => {
  const c = await newUser();
  assert.equal(live(await sync(c, [wl(1, 1, { a: 1 })])).length, 1);
  await sync(c, [gone(2, T(5))]);
  const r = await sync(c, [wl(2, 1, { a: 2 })]);
  assert.ok(find(r, 'movie:2').d > 0);
});

await test('a dated save beats an undated copy', async () => {
  const c = await newUser();
  await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 1 }, a: 1, u: 1, d: 0 }]);
  const r = await sync(c, [{ c: 'reviews', k: '5:a', v: { stars: 4 }, a: T(1), u: T(1), d: 0 }]);
  assert.equal(find(r, '5:a').v.stars, 4);
});

await test('the list keeps its earliest added date; adding back after removal starts fresh', async () => {
  const c = await newUser();
  await sync(c, [wl(1, T(10), { a: T(10) })]);
  assert.equal(find(await sync(c, [wl(1, T(11), { a: T(4) })]), 'movie:1').a, T(4));
  await sync(c, [gone(1, T(12), T(4))]);
  assert.equal(find(await sync(c, [wl(1, T(20), { a: T(20) })]), 'movie:1').a, T(20));
});

await test('a clock in the future is capped to the server\'s', async () => {
  const c = await newUser();
  const year = NOW + 365 * 86400000;
  const r = await sync(c, [wl(1, year, { a: year })]);
  assert.ok(find(r, 'movie:1').u <= Date.now() && find(r, 'movie:1').a <= Date.now());
  // Capped, so a device with a correct clock can still change it afterwards.
  await new Promise(r => setTimeout(r, 5));
  const later = Date.now();
  assert.ok(find(await sync(c, [gone(1, later)]), 'movie:1').d > 0);
});

await test('two devices: each gets only what\'s new, and a wrong clock doesn\'t hide a change', async () => {
  const c = await newUser();
  const a = await sync(c, [wl(1, T(50))]);
  const b = await sync(c, [wl(2, T(1))]);              // B's clock is far behind A's
  assert.equal(b.items.length, 2);
  const seenByA = await sync(c, [], a.cursor);
  assert.deepEqual(seenByA.items.map(x => x.k), ['movie:2']);
  assert.equal((await sync(c, [], seenByA.cursor)).items.length, 0);
});

await test('more than a page arrives complete, each item once, across pages', async () => {
  const c = await newUser();
  for (let i = 0; i < 6; i++) await sync(c, Array.from({ length: SYNC.MAX_BATCH }, (_, n) => wl(i * SYNC.MAX_BATCH + n + 1, T(1))), 1e15);
  const seen = new Set();
  let since = 0, pages = 0, res;
  do {
    res = await sync(c, [], since);
    res.items.forEach(x => { assert.equal(seen.has(x.k), false); seen.add(x.k); });
    since = res.cursor;
    pages += 1;
  } while (res.more);
  assert.equal(seen.size, 6 * SYNC.MAX_BATCH);
  assert.equal(pages, 3);
});

await test('only known kinds of data are stored; one bad item doesn\'t stop the rest', async () => {
  const c = await newUser();
  const bad = [
    { c: 'rk_tmdb', k: 'key', v: 'secret', a: T(1), u: T(1), d: 0 },
    { c: 'prefs', k: 'rk_omdb', v: 'secret', a: T(1), u: T(1), d: 0 },
    { c: 'constructor', k: 'x', v: 1, a: T(1), u: T(1), d: 0 },
    { c: 'watchlist', k: 'movie:abc', v: {}, a: T(1), u: T(1), d: 0 },
    { c: 'watchlist', k: 'movie:1', v: { id: 1 }, a: T(1), u: 0, d: 0 },
    { c: 'watchlist', k: 'movie:2', v: { id: 2 }, a: T(1), u: 'soon', d: 0 },
    { c: 'watchlist', k: 'movie:3', a: T(1), u: T(1), d: 0 },
    { c: 'reviews', k: '1:x', v: 'y'.repeat(9000), a: T(1), u: T(1), d: 0 },
    null, 'nope',
  ];
  const r = await sync(c, [...bad, wl(9, T(1))]);
  assert.equal(r.rejected, bad.length);
  assert.deepEqual(r.items.map(x => x.k), ['movie:9']);
});

await test('one person\'s data is invisible to another, even with the same keys', async () => {
  const a = await newUser(), b = await newUser();
  await sync(a, [wl(1, T(5))]);
  assert.equal((await sync(b, [])).items.length, 0);
  await sync(b, [gone(1, T(9))]);
  assert.equal(find(await sync(a, []), 'movie:1').d, 0);
});

await test('not signed in, or from another site, is refused', async () => {
  assert.equal((await rawSync('', { items: [] })).status, 401);
  assert.equal((await rawSync('__Host-ff_session=made-up', { items: [] })).status, 401);
  assert.equal((await rawSync(await newUser(), { items: [] }, 'https://evil.example')).status, 403);
});

await test('malformed or oversized requests are refused and change nothing', async () => {
  const c = await newUser();
  for (const body of ['not json', '[1]', '{"items":"x"}']) assert.equal((await rawSync(c, body)).status, 400, body);
  assert.equal((await rawSync(c, { items: Array(SYNC.MAX_BATCH + 1).fill(wl(1, T(1))) })).status, 413);
  assert.equal((await rawSync(c, 'x'.repeat(SYNC.MAX_BODY + 1))).status, 413);
  assert.equal((await sync(c, [])).items.length, 0);
});

await test('nobody can hold more than the limit', async () => {
  const c = await newUser();
  for (let i = 0; i < 10; i++) await sync(c, Array.from({ length: SYNC.MAX_BATCH }, (_, n) => wl(i * SYNC.MAX_BATCH + n + 1, T(1))), 1e15);
  assert.equal((await rawSync(c, { since: 1e15, items: [wl(999999, T(2))] })).status, 413);
});

await test('deleting the account deletes the saved data', async () => {
  const c = await newUser(), keep = await newUser();
  await sync(c, [wl(1, T(1)), wl(2, T(2))]);
  await sync(keep, [wl(3, T(3))]);
  const before = await db.prepare('SELECT COUNT(*) AS n FROM items').first('n');
  assert.equal((await handleMe({ request: req('/api/me', { method: 'DELETE', cookie: c }), env, params: {} })).status, 200);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM items').first('n'), before - 2);
  assert.equal((await sync(keep, [])).items.length, 1);
});

await test('too many syncs in ten minutes are refused', async () => {
  const c = await newUser();
  let last;
  for (let i = 0; i < 301; i++) last = await rawSync(c, { items: [] });
  assert.equal(last.status, 429);
});

console.log(`\nAll ${passed} passed.`);
