/* Tests the browser half of sync: several simulated devices, each with its own storage and cookie,
   running the real assets/store.js, watchlist.js and account.js against the real routes and schema.
     node --no-warnings tools/account-sync-test.mjs */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { handleAuth, handleMe } from '../functions/_lib/account.js';
import { fakeD1 } from './fake-d1.mjs';

const src = name => readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
const SOURCES = ['store.js', 'watchlist.js', 'account.js'].map(n => [n, src(n)]);
const db = fakeD1();
const env = { USERS: db };
const ORIGIN = 'https://findfilm.ai';
let ip = 0;

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k),
  };
}

async function route(path, init, jar) {
  const headers = { 'CF-Connecting-IP': `10.2.0.${++ip}`, Origin: ORIGIN };
  if (jar.value) headers.Cookie = jar.value;
  const request = new Request(ORIGIN + path, { method: init?.method || 'GET', headers, body: init?.body });
  const res = path.startsWith('/api/auth/')
    ? await handleAuth({ request, env, params: { path: [path.split('/').pop()] } })
    : await handleMe({ request, env, params: path === '/api/me/sync' ? { path: ['sync'] } : {} });
  for (const c of res.headers.getSetCookie()) {
    if (c.startsWith('__Host-ff_session=')) jar.value = c.includes('Max-Age=0') ? '' : c.split(';')[0];
  }
  return res;
}

// One browser. Pass the same `saved` object to simulate a reload.
function device({ storage = fakeStorage(), jar = { value: '' }, withLocks } = {}) {
  const d = { storage, jar, calls: [], timers: [], net: 'up', failAfter: Infinity };
  const fire = {};
  const window = { addEventListener: (t, fn) => { (fire[t] ||= []).push(fn); } };
  if (withLocks) window.navigator = withLocks;
  const context = {
    window, localStorage: storage, console, document: { visibilityState: 'visible', addEventListener: (t, fn) => { (fire[t] ||= []).push(fn); } },
    navigator: withLocks,
    setTimeout: fn => { d.timers.push(fn); return d.timers.length; }, clearTimeout: () => {},
    fetch: async (path, init) => {
      d.calls.push(path);
      d.onFetch?.();
      if (d.net === 'down' || d.failAfter-- <= 0) throw new Error('network');
      return route(path, init, jar);
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCES[0][1], context);
  context.FFStore = window.FFStore;
  vm.runInContext(SOURCES[1][1], context);
  context.FFWatchlist = window.FFWatchlist;
  vm.runInContext(SOURCES[2][1], context);
  return Object.assign(d, { store: window.FFStore, list: window.FFWatchlist, account: window.FFAccount, fire: t => (fire[t] || []).forEach(fn => fn({})), context });
}

let nextSub = 0;
async function newUserSession() {
  const sub = `u${++nextSub}`, jar = { value: '' };
  const headers = { 'CF-Connecting-IP': `10.3.0.${++ip}`, Origin: ORIGIN, Cookie: '__Host-ff_nonce=nn' };
  const res = await handleAuth({ request: new Request(`${ORIGIN}/api/auth/google`, { method: 'POST', headers, body: '{"credential":"x"}' }), env, params: { path: ['google'] } }, async () => ({ sub, email: `${sub}@x.y`, name: sub }));
  jar.value = res.headers.getSetCookie().find(c => c.startsWith('__Host-ff_session=')).split(';')[0];
  return { user: (await res.json()).user, cookie: jar.value };
}
const signIn = async (d, person) => { d.jar.value = person.cookie; assert.equal(await d.account.adopt(person.user), true); };
const norm = v => JSON.parse(JSON.stringify(v));   // arrays from a simulated device belong to its own realm
const films = d => norm(d.list.list()).map(x => x.id).sort((a, b) => a - b);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const unsent = d => d.store.outgoing(false).length;
const serverItems = async (user, c) => (await db.prepare('SELECT item_key AS k, deleted_at AS d, value AS v, updated_at AS u FROM items WHERE user_id = ?1 AND collection = ?2 ORDER BY k').bind(user.id, c).all()).results;
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log('ok  ', name); };

await test('a guest never touches the network', async () => {
  const d = device();
  d.list.toggle(1, 'movie');
  await d.account.ready;
  assert.deepEqual(d.calls, []);
  assert.equal(d.timers.length, 0);
});

await test('first sign-in carries a guest\'s data up, and nothing is left unsent', async () => {
  const me = await newUserSession(), d = device();
  d.list.toggle(1, 'movie'); d.list.toggle(2, 'tv');
  d.store.addReview(5, 'movie', { stars: 4, text: 'good', createdAt: '2026-01-01T00:00:00.000Z' });
  d.store.setPref('country', 'FR');
  d.storage.setItem('rk_taste_v1', JSON.stringify({ genres: { Drama: 9 }, total: 9 }));
  await signIn(d, me);
  assert.equal(unsent(d), 0);
  assert.equal(d.store.meta().owner, me.user.id);
  assert.deepEqual((await serverItems(me.user, 'watchlist')).map(x => x.k), ['movie:1', 'tv:2']);
  assert.equal((await serverItems(me.user, 'reviews')).length, 1);
  assert.equal((await serverItems(me.user, 'prefs'))[0].k, 'country');
  assert.equal((await serverItems(me.user, 'profile')).length, 2);
});

await test('undated saves from before Stage 1 go up too', async () => {
  const me = await newUserSession();
  const d = device({ storage: fakeStorage({ rk_watchlist_v2: JSON.stringify([{ id: 7, type: 'movie' }]) }) });
  await signIn(d, me);
  assert.equal((await serverItems(me.user, 'watchlist'))[0].u, 1);
});

await test('a second device merges its own guest data, and both end up the same', async () => {
  const me = await newUserSession(), a = device(), b = device();
  a.list.toggle(1, 'movie'); await signIn(a, me);
  b.list.toggle(2, 'movie'); await signIn(b, me);
  await a.account.syncNow();
  assert.deepEqual(films(a), [1, 2]);
  assert.deepEqual(films(b), [1, 2]);
});

await test('a removal reaches the other device, and the page hears about it', async () => {
  const me = await newUserSession(), a = device(), b = device();
  a.list.toggle(1, 'movie'); await signIn(a, me); await signIn(b, me);
  let heard = 0; b.list.onChange(() => { heard += 1; });
  a.list.toggle(1, 'movie'); await a.account.syncNow();
  await b.account.syncNow();
  assert.deepEqual(films(b), []);
  assert.equal(heard, 1);
  assert.equal(b.storage.getItem('rk_watchlist_v2'), '[]');
});

await test('two devices edit the same rating: both settle on the newest', async () => {
  const me = await newUserSession(), a = device(), b = device();
  await signIn(a, me); await signIn(b, me);
  a.store.put('prefs', 'minRating', 5);
  await sleep(3);
  b.store.put('prefs', 'minRating', 8);
  await a.account.syncNow(); await b.account.syncNow(); await a.account.syncNow();
  assert.equal(a.store.pref('minRating'), 8);
  assert.equal(b.store.pref('minRating'), 8);
});

await test('an older change sent last still loses', async () => {
  const me = await newUserSession(), a = device(), b = device();
  await signIn(a, me); await signIn(b, me);
  a.store.put('prefs', 'minRating', 5);
  await sleep(3);
  b.store.put('prefs', 'minRating', 8);
  await b.account.syncNow(); await a.account.syncNow();
  assert.equal(a.store.pref('minRating'), 8);
});

await test('a change made while a sync is in flight is kept and sent next', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.store.put('prefs', 'minRating', 5);
  d.onFetch = () => { d.onFetch = null; d.store.put('prefs', 'minRating', 9); };   // the request has left; the answer hasn't come
  await d.account.syncNow();
  assert.equal(d.store.pref('minRating'), 9);
  assert.ok(unsent(d) >= 1);
  await d.account.syncNow();
  assert.equal(unsent(d), 0);
  assert.equal(norm(JSON.parse((await serverItems(me.user, 'prefs'))[0].v)), 9);
});

await test('offline changes wait, and arrive once back online', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.net = 'down';
  d.list.toggle(1, 'movie');
  assert.equal(await d.account.syncNow(), false);
  assert.equal(unsent(d), 1);
  d.net = 'up';
  assert.equal(await d.account.syncNow(), true);
  assert.equal(unsent(d), 0);
  assert.equal((await serverItems(me.user, 'watchlist')).length, 1);
});

await test('a first sync cut off midway loses nothing and finishes on retry', async () => {
  const me = await newUserSession(), d = device();
  for (let i = 1; i <= 2500; i++) d.list.toggle(i, 'movie');
  d.jar.value = me.cookie;
  d.failAfter = 1;
  assert.equal(await d.account.adopt(me.user), false);
  assert.equal(d.store.meta().owner, undefined);
  assert.equal(d.list.count(), 2500);
  d.failAfter = Infinity;
  assert.equal(await d.account.syncNow(), true);
  assert.equal(d.store.meta().owner, me.user.id);
  assert.equal((await serverItems(me.user, 'watchlist')).length, 2500);
  assert.equal(unsent(d), 0);
});

await test('reloading the page carries on as the same signed-in person', async () => {
  const me = await newUserSession(), a = device();
  a.list.toggle(1, 'movie'); await signIn(a, me);
  const reloaded = device({ storage: a.storage, jar: a.jar });
  await reloaded.account.ready;
  assert.equal(reloaded.account.user().id, me.user.id);
  assert.deepEqual(films(reloaded), [1]);
});

await test('another account on this device never gets the first one\'s data', async () => {
  const x = await newUserSession(), y = await newUserSession(), d = device();
  d.list.toggle(1, 'movie'); await signIn(d, x);
  await signIn(d, y);
  assert.deepEqual(films(d), []);
  assert.equal((await serverItems(y.user, 'watchlist')).length, 0);
  assert.equal((await serverItems(x.user, 'watchlist')).length, 1);
});

await test('signing out sends what\'s unsent, then clears this device', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.list.toggle(1, 'movie');
  d.store.addReview(5, 'movie', { stars: 3, text: '', createdAt: '2026-01-01T00:00:00.000Z' });
  d.storage.setItem('rk_taste_v1', JSON.stringify({ genres: {}, total: 3 }));
  d.storage.setItem('rk_tmdb', 'my-own-key'); d.storage.setItem('rk_lang', 'uk');
  assert.equal(await d.account.signOut(), true);
  assert.equal((await serverItems(me.user, 'watchlist')).length, 1);
  assert.equal(d.account.user(), null);
  assert.equal(d.list.count(), 0);
  for (const k of ['rk_rev_5', 'rk_taste_v1', 'ff_store_watchlist', 'ff_store_meta']) assert.equal(d.storage.getItem(k), null, k);
  assert.equal(JSON.parse(d.storage.getItem('rk_watchlist_v2') || '[]').length, 0);
  assert.equal(d.storage.getItem('rk_tmdb'), 'my-own-key');
  assert.equal(d.storage.getItem('rk_lang'), 'uk');
  const next = device({ storage: d.storage });
  assert.equal(next.store.reviewsFor(5, 'movie').length, 0);
  await next.account.ready;
  assert.equal(next.account.user(), null);
});

await test('signing out offline refuses unless forced, so nothing is lost by accident', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.list.toggle(1, 'movie');
  d.net = 'down';
  assert.equal(await d.account.signOut(), false);
  assert.equal(d.list.count(), 1);
  assert.equal(await d.account.signOut({ force: true }), true);
  assert.equal(d.list.count(), 0);
});

await test('an expired session signs this device out but keeps its data for when they return', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.list.toggle(1, 'movie');
  await db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?1').bind(me.user.id).run();
  assert.equal(await d.account.syncNow(), false);
  assert.equal(d.account.user(), null);
  assert.equal(d.list.count(), 1);
  const again = await newUserSessionFor(me);
  await signIn(d, again);
  assert.equal((await serverItems(me.user, 'watchlist')).length, 1);
});
async function newUserSessionFor(person) {
  const token = `t${++nextSub}x`, hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('INSERT INTO sessions VALUES (?1, ?2, 1, ?3, ?4)').bind(hash, person.user.id, Date.now(), Date.now() + 1e9).run();
  return { user: person.user, cookie: `__Host-ff_session=${token}` };
}

await test('the richer taste profile wins, so a new phone can\'t wipe a long history', async () => {
  const me = await newUserSession(), old = device(), phone = device();
  old.storage.setItem('rk_taste_v1', JSON.stringify({ genres: { Drama: 40 }, total: 40 }));
  old.storage.setItem('rk_rated_films', JSON.stringify([{ title: 'A' }]));
  await signIn(old, me);
  phone.storage.setItem('rk_taste_v1', JSON.stringify({ genres: { Comedy: 1 }, total: 1 }));
  await signIn(phone, me);
  assert.equal(JSON.parse(phone.storage.getItem('rk_taste_v1')).total, 40);
  assert.equal(JSON.parse(phone.storage.getItem('rk_rated_films'))[0].title, 'A');
  await old.account.syncNow();
  assert.equal(JSON.parse(old.storage.getItem('rk_taste_v1')).total, 40);
});

await test('a taste profile that grows gets sent again', async () => {
  const me = await newUserSession(), d = device();
  d.storage.setItem('rk_taste_v1', JSON.stringify({ genres: {}, total: 3 }));
  await signIn(d, me);
  d.storage.setItem('rk_taste_v1', JSON.stringify({ genres: { War: 1 }, total: 4 }));
  await d.account.syncNow();
  assert.equal((await serverItems(me.user, 'profile')).find(x => x.k === 'taste').u, 4);
});

await test('a device with a future clock settles on the server\'s time', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.store.seed('prefs', [{ key: 'country', value: 'DE', addedAt: Date.now() + 1e10, updatedAt: Date.now() + 1e10 }]);
  await d.account.syncNow();
  assert.equal(unsent(d), 0);
  assert.ok(JSON.parse(d.storage.getItem('ff_store_prefs')).country.updatedAt <= Date.now() + 5000);
});

await test('deleting the account clears the server and this device', async () => {
  const me = await newUserSession(), d = device();
  d.list.toggle(1, 'movie'); await signIn(d, me);
  assert.equal(await d.account.deleteAccount(), true);
  assert.equal(d.list.count(), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?1').bind(me.user.id).first('n'), 0);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ?1').bind(me.user.id).first('n'), 0);
});

await test('a save schedules a send a few seconds later', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  const before = d.timers.length;
  d.list.toggle(1, 'movie');
  assert.equal(d.timers.length, before + 1);
  await d.timers[d.timers.length - 1]();
  assert.equal(unsent(d), 0);
});

await test('leaving the page sends what\'s unsent', async () => {
  const me = await newUserSession(), d = device();
  await signIn(d, me);
  d.list.toggle(1, 'movie');
  d.context.document.visibilityState = 'hidden';
  d.fire('visibilitychange');
  await sleep(10);
  assert.equal((await serverItems(me.user, 'watchlist')).length, 1);
});

await test('with Web Locks, a tab that can\'t get the lock leaves the work to the other', async () => {
  const me = await newUserSession();
  let held = false;
  const locks = { locks: { request: async (name, opts, cb) => { if (held) return cb(null); held = true; try { return await cb({}); } finally { held = false; } } } };
  const d = device({ withLocks: locks });
  await signIn(d, me);
  d.list.toggle(1, 'movie');
  held = true;
  const callsBefore = d.calls.length;
  assert.equal(await d.account.syncNow(), true);
  assert.equal(d.calls.length, callsBefore);
  held = false;
  await d.account.syncNow();
  assert.equal(unsent(d), 0);
});

await test('a stale old-format copy can\'t undo an account\'s list', async () => {
  const me = await newUserSession(), d = device();
  d.list.toggle(1, 'movie'); await signIn(d, me);
  d.storage.setItem('rk_watchlist_v2', '[]');
  const reloaded = device({ storage: d.storage, jar: d.jar });
  await reloaded.account.ready;
  assert.deepEqual(films(reloaded), [1]);
});

console.log(`\nAll ${passed} passed.`);
process.exit(0);
