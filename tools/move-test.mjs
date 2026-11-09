/* Tests the move from ratingkino.com to findfilm.ai: the real assets/store.js, watchlist.js and move.js
   in simulated browsers, one on each domain, against the real route and schema.
     node --no-warnings tools/move-test.mjs */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { handleTransfer } from '../functions/_lib/transfer.js';
import { fakeD1 } from './fake-d1.mjs';

const src = name => readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8');
const SOURCES = ['store.js', 'watchlist.js', 'move.js'].map(src);
const db = fakeD1();
const env = { USERS: db };
let ip = 0;

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}
const sleep = (ms = 8) => new Promise(r => setTimeout(r, ms));
const norm = v => JSON.parse(JSON.stringify(v));

function fakeElement() {
  const handlers = {};
  const el = { className: '', textContent: '', setAttribute() {}, set innerHTML(v) { el.children = [fakeElement(), fakeElement(), fakeElement()]; }, children: [], addEventListener: (t, fn) => { handlers[t] = fn; }, click: () => handlers.click?.(), remove() { el.removed = true; } };
  return el;
}

function browser({ host = 'ratingkino.com', path = '/', search = '', hash = '', referrer = '', storage = fakeStorage(), standalone = false, net = 'up' } = {}) {
  const b = { storage, replaced: null, reloaded: 0, calls: [], notes: [], opened: null, net, unhidden: false };
  const origin = `https://${host}`;
  const location = { hostname: host, port: '', pathname: path, search, hash, href: origin + path + search + hash, replace: u => { b.replaced = u; }, reload: () => { b.reloaded += 1; } };
  const style = {};
  Object.defineProperty(style, 'visibility', { get: () => b.vis, set: v => { b.vis = v; } });
  const ready = [];
  const window = { navigator: { standalone }, matchMedia: () => ({ matches: false }), open: u => { b.opened = u; }, addEventListener() {}, stop() {} };
  const context = {
    window, location, localStorage: storage, console, navigator: window.navigator,
    history: { state: null, replaceState: (s, t, u) => { location.search = ''; location.hash = ''; b.urlAfter = u; } },
    setTimeout: () => 1, setInterval: () => 1, clearTimeout() {},
    document: { referrer, readyState: 'loading', documentElement: { style }, addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') ready.push(fn); }, createElement: () => { const el = fakeElement(); b.notes.push(el); return el; }, body: { appendChild() {} } },
    matchMedia: window.matchMedia,
    fetch: async (url, init) => {
      b.calls.push(url);
      if (b.net === 'down') throw new Error('network');
      const parts = url.split('/').filter(Boolean).slice(2);
      const request = new Request(origin + url, { method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': `10.5.0.${++ip}` }, body: init.body });
      return handleTransfer({ request, env, params: { path: parts } });
    },
  };
  vm.createContext(context);
  vm.runInContext(SOURCES[0], context);
  context.FFStore = window.FFStore;
  vm.runInContext(SOURCES[1], context);
  context.FFWatchlist = window.FFWatchlist;
  vm.runInContext(SOURCES[2], context);
  window.FF_I18N = { en: { 'move.moved': 'moved', 'move.open': 'open', 'move.ask': 'ask', 'move.yes': 'yes', 'results.close': 'x' } };   // i18n.js comes after move.js in both pages
  context.document.readyState = 'interactive';
  ready.forEach(fn => fn());
  return Object.assign(b, { store: window.FFStore, list: window.FFWatchlist });
}

const flagged = (initial = {}) => fakeStorage({ ff_flag_move: '1', ...initial });
const codeFrom = url => url.split('#transfer=')[1];
const OLD_REF = 'https://ratingkino.com/';
const arrive = (code, opts = {}) => browser({ host: 'findfilm.ai', hash: `#transfer=${code}`, referrer: OLD_REF, ...opts });
async function move(storage, target = {}) {
  const old = browser({ storage });
  await sleep();
  const fresh = arrive(codeFrom(old.replaced), target);
  await sleep();
  return { old, fresh };
}
const films = b => norm(b.list.list()).map(x => `${x.type}:${x.id}`).sort();
let passed = 0;
const test = async (name, fn) => { await fn(); passed += 1; console.log('ok  ', name); };
const T = n => Date.now() - 1000000 + n;
const item = (over = {}) => JSON.stringify(over);

await test('while switched off, nothing moves', async () => {
  const b = browser({ storage: fakeStorage({ rk_lang: 'uk' }) });
  await sleep();
  assert.equal(b.replaced, null);
  assert.deepEqual(b.calls, []);
});

await test('?move=1 turns it on for that browser', async () => {
  const b = browser({ search: '?move=1', storage: fakeStorage({ rk_lang: 'uk' }) });
  await sleep();
  assert.ok(b.replaced.startsWith('https://findfilm.ai/?move=1#transfer='));
  assert.equal(b.storage.getItem('ff_flag_move'), '1');
});

await test('someone with nothing saved just goes, keeping the page they asked for', async () => {
  const b = browser({ path: '/cinematic/', search: '?movie=603', storage: flagged() });
  await sleep();
  assert.equal(b.replaced, 'https://findfilm.ai/cinematic/?movie=603');
  assert.deepEqual(b.calls, []);
});

await test('everything comes across, even from before dates were recorded', async () => {
  const { fresh } = await move(flagged({
    rk_watchlist_v2: JSON.stringify([{ id: 11, type: 'movie' }, { id: 1396, type: 'tv' }]),
    rk_rev_603: JSON.stringify([{ movieId: 603, stars: 4, userName: 'Me', text: 'Good', createdAt: '2026-01-02T03:04:05.000Z', date: 'Jan 2, 2026' }]),
    rk_taste_v1: JSON.stringify({ genres: { Drama: 5 }, directors: {}, prefs: {}, total: 5 }),
    rk_rated_films: JSON.stringify([{ title: 'A', year: 2000, genres: ['Drama'] }]),
    rk_lang: 'uk', ff_layout: 'cinematic', ff_pitch_voter: 'v-1', ff_pitch_vote_abc: 'yes', rk_visited: '1',
  }));
  assert.deepEqual(films(fresh), ['movie:11', 'tv:1396']);
  assert.equal(fresh.store.reviewsFor(603, 'movie')[0].text, 'Good');
  assert.equal(JSON.parse(fresh.storage.getItem('rk_taste_v1')).total, 5);
  assert.equal(JSON.parse(fresh.storage.getItem('rk_rated_films'))[0].title, 'A');
  for (const [k, v] of [['rk_lang', 'uk'], ['ff_layout', 'cinematic'], ['ff_pitch_voter', 'v-1'], ['ff_pitch_vote_abc', 'yes'], ['rk_visited', '1']]) assert.equal(fresh.storage.getItem(k), v, k);
  assert.equal(fresh.reloaded, 1);
});

await test('the code leaves the address at once', async () => {
  const old = browser({ storage: flagged({ rk_lang: 'de' }) });
  await sleep();
  const fresh = browser({ host: 'findfilm.ai', path: '/', search: '?movie=5', hash: `#transfer=${codeFrom(old.replaced)}`, referrer: OLD_REF });
  assert.equal(fresh.urlAfter, '/?movie=5');
});

await test('a visitor\'s own API keys are never packed', async () => {
  const old = browser({ storage: flagged({ rk_tmdb: 'secret-1', rk_omdb: 'secret-2', rk_lang: 'uk' }) });
  await sleep();
  const row = await db.prepare('SELECT payload FROM transfers ORDER BY rowid DESC LIMIT 1').first('payload');
  assert.equal(/secret-/.test(row), false);
  assert.ok(old.replaced);
});

await test('films already here are kept, and both lists combine', async () => {
  const here = browser({ host: 'findfilm.ai', storage: fakeStorage() });
  here.list.toggle(1, 'movie');
  const { fresh } = await move(flagged({ rk_watchlist_v2: JSON.stringify([{ id: 2, type: 'movie' }]) }), { storage: here.storage });
  assert.deepEqual(films(fresh), ['movie:1', 'movie:2']);
});

await test('a film removed here since, stays removed', async () => {
  const oldStore = flagged({ rk_watchlist_v2: JSON.stringify([{ id: 2, type: 'movie' }]) });
  const first = await move(oldStore);
  first.fresh.list.toggle(2, 'movie');
  await sleep(3);
  const again = await move(oldStore, { storage: first.fresh.storage });
  assert.deepEqual(films(again.fresh), []);
});

await test('the newer change wins, whichever site made it', async () => {
  const here = browser({ host: 'findfilm.ai' });
  here.store.put('prefs', 'country', 'DE');
  const oldStore = flagged();
  browser({ storage: oldStore }).store;
  const sender = browser({ storage: fakeStorage() });
  await sleep(3);
  sender.store.put('prefs', 'country', 'FR');
  oldStore.setItem('ff_store_prefs', sender.storage.getItem('ff_store_prefs'));
  const { fresh } = await move(oldStore, { storage: here.storage });
  assert.equal(fresh.store.pref('country'), 'FR');
});

await test('the richer taste profile wins', async () => {
  const thin = fakeStorage({ rk_taste_v1: JSON.stringify({ genres: { Comedy: 1 }, total: 1 }) });
  const { fresh } = await move(flagged({ rk_taste_v1: JSON.stringify({ genres: { Drama: 40 }, total: 40 }) }), { storage: thin });
  assert.equal(JSON.parse(fresh.storage.getItem('rk_taste_v1')).total, 40);
  const rich = fakeStorage({ rk_taste_v1: JSON.stringify({ genres: { War: 90 }, total: 90 }) });
  const second = await move(flagged({ rk_taste_v1: JSON.stringify({ genres: { Drama: 40 }, total: 40 }) }), { storage: rich });
  assert.equal(JSON.parse(second.fresh.storage.getItem('rk_taste_v1')).total, 90);
});

await test('a setting already made here stays', async () => {
  const { fresh } = await move(flagged({ rk_lang: 'uk', ff_layout: 'cinematic' }), { storage: fakeStorage({ rk_lang: 'de' }) });
  assert.equal(fresh.storage.getItem('rk_lang'), 'de');
  assert.equal(fresh.storage.getItem('ff_layout'), 'cinematic');
});

await test('moved items wait to go up to a signed-in account', async () => {
  const here = fakeStorage({ ff_store_meta: JSON.stringify({ signedIn: true, owner: 'u1', cursor: 3 }) });
  const { fresh } = await move(flagged({ rk_watchlist_v2: JSON.stringify([{ id: 9, type: 'movie' }]) }), { storage: here });
  assert.deepEqual(norm(fresh.store.outgoing(false)).map(x => x.k), ['movie:9']);
});

await test('if the hand-over fails, they stay and see the page', async () => {
  const b = browser({ storage: flagged({ rk_lang: 'uk' }), net: 'down' });
  await sleep();
  assert.equal(b.replaced, null);
  assert.equal(b.vis, '');
});

await test('a code works once', async () => {
  const old = browser({ storage: flagged({ rk_lang: 'uk' }) });
  await sleep();
  const code = codeFrom(old.replaced);
  const a = arrive(code); await sleep();
  assert.equal(a.storage.getItem('rk_lang'), 'uk');
  const b = arrive(code); await sleep();
  assert.equal(b.storage.getItem('rk_lang'), null);
  assert.equal(b.reloaded, 0);
  assert.equal(b.vis, '');
});

await test('an expired code is refused', async () => {
  const old = browser({ storage: flagged({ rk_lang: 'uk' }) });
  await sleep();
  await db.prepare('UPDATE transfers SET expires_at = 1').run();
  const b = arrive(codeFrom(old.replaced)); await sleep();
  assert.equal(b.storage.getItem('rk_lang'), null);
});

const direct = (host, path, body, origin = `https://${host}`) => handleTransfer({ request: new Request(`https://${host}/api/transfer${path}`, { method: 'POST', headers: origin ? { Origin: origin, 'CF-Connecting-IP': `10.6.0.${++ip}` } : {}, body }), env, params: { path: path ? [path.slice(1)] : [] } });

await test('each side only does its own half', async () => {
  assert.equal((await direct('findfilm.ai', '', '{}')).status, 403);
  assert.equal((await direct('ratingkino.com', '/claim', '{"code":"aaaaaaaaaaaaaaaaaaaaaaaa"}')).status, 403);
  assert.equal((await direct('www.ratingkino.com', '', '{"a":1}')).status, 200);
});

await test('another site can\'t call it, and bad requests change nothing', async () => {
  assert.equal((await direct('ratingkino.com', '', '{}', 'https://evil.example')).status, 403);
  assert.equal((await direct('ratingkino.com', '', '{}', '')).status, 403);
  for (const body of ['not json', '[1]', 'null']) assert.equal((await direct('ratingkino.com', '', body)).status, 400, body);
  assert.equal((await direct('ratingkino.com', '', 'x'.repeat(1500001))).status, 413);
  assert.equal((await direct('findfilm.ai', '/claim', '{"code":"short"}')).status, 404);
});

await test('only a hash of the code is stored', async () => {
  const old = browser({ storage: flagged({ rk_lang: 'uk' }) });
  await sleep();
  const code = codeFrom(old.replaced);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE code_hash = ?1').bind(code).first('n'), 0);
});

const crafted = {
  items: [
    { c: 'watchlist', k: 'movie:7', v: { id: 999, type: '<b>' }, a: T(1), u: T(1), d: 0 },
    { c: 'reviews', k: '7:x', v: { stars: 99, userName: '<img src=x onerror=alert(1)>', text: '<script>bad</script>', createdAt: 'x', date: '<svg onload=alert(1)>' }, a: T(1), u: T(1), d: 0 },
    { c: 'prefs', k: 'country', v: '<script>', a: T(1), u: T(1), d: 0 },
    { c: 'rk_tmdb', k: 'k', v: 'x', a: T(1), u: T(1), d: 0 },
    { c: 'constructor', k: 'k', v: 'x', a: T(1), u: T(1), d: 0 },
    { c: 'watchlist', k: 'movie:abc', v: {}, a: T(1), u: T(1), d: 0 },
    null,
  ],
  taste: item({ genres: { '<b>x': 3, Drama: 'lots' }, directors: {}, prefs: { a: '<i>' }, total: 7, extra: 'no' }),
  extras: { rk_lang: 'xx', ff_layout: '<script>', ff_pitch_name: '<b>', rk_tmdb: 'planted', ff_flag_auth: '1', ff_pitch_vote_p1: 'yes', ff_pitch_vote_p2: '<b>', __proto__x: '1' },
};
async function craftedCode() {
  const res = await direct('ratingkino.com', '', JSON.stringify(crafted));
  return (await res.json()).code;
}

await test('a link from anywhere else asks first, and does nothing until told', async () => {
  const b = arrive(await craftedCode(), { referrer: 'https://evil.example/' });
  await sleep();
  assert.equal(b.calls.length, 0);
  assert.equal(b.notes.length, 1);
  assert.equal(b.urlAfter, '/');
  assert.deepEqual(films(b), []);
});

await test('every value is checked before it is used', async () => {
  const b = arrive(await craftedCode());
  await sleep();
  assert.deepEqual(norm(b.list.list()), [{ id: 7, type: 'movie' }]);
  const r = norm(b.store.reviewsFor(7, 'movie'))[0];
  assert.equal(r.stars, 5);
  assert.equal(/[<>]/.test(JSON.stringify(r)), false);
  assert.equal(/[<>]/.test(String(b.store.pref('country'))), false);
  assert.equal(b.storage.getItem('ff_store_rk_tmdb'), null);
  for (const k of ['rk_lang', 'ff_layout', 'ff_pitch_name', 'rk_tmdb', 'ff_flag_auth', 'ff_pitch_vote_p2']) assert.equal(b.storage.getItem(k), null, k);
  assert.equal(b.storage.getItem('ff_pitch_vote_p1'), 'yes');
  const taste = JSON.parse(b.storage.getItem('rk_taste_v1'));
  assert.equal(/[<>]/.test(JSON.stringify(taste)), false);
  assert.equal(taste.extra, undefined);
});

await test('while switched off, an installed app shows nothing and sends nothing', async () => {
  const b = browser({ standalone: true, storage: fakeStorage({ rk_watchlist_v2: JSON.stringify([{ id: 3, type: 'movie' }]) }) });
  await sleep();
  assert.equal(b.replaced, null);
  assert.equal(b.notes.length, 0);
  assert.deepEqual(b.calls, []);
});

await test('an installed app stays put and offers to open the browser, with the code ready', async () => {
  const b = browser({ standalone: true, storage: flagged({ rk_watchlist_v2: JSON.stringify([{ id: 3, type: 'movie' }]) }) });
  await sleep();
  assert.equal(b.replaced, null);
  assert.equal(b.notes.length, 1);
  assert.equal(b.notes[0].children[0].textContent, 'moved');
  assert.equal(b.notes[0].children[1].textContent, 'open');
  b.notes[0].children[1].click();
  assert.ok(b.opened.startsWith('https://findfilm.ai/#transfer='));
});

await test('an ordinary visit to findfilm.ai does nothing', async () => {
  const b = browser({ host: 'findfilm.ai', storage: fakeStorage({ rk_lang: 'uk' }) });
  await sleep();
  assert.deepEqual(b.calls, []);
  assert.equal(b.replaced, null);
});

await test('a code lasts eight minutes, so deletion lands inside the ten the privacy page promises', async () => {
  const before = Date.now();
  await handleTransfer({ request: new Request('https://ratingkino.com/api/transfer', { method: 'POST', headers: { Origin: 'https://ratingkino.com', 'CF-Connecting-IP': 'ttl-test' }, body: '{"a":1}' }), env, params: { path: [] } });
  const { latest } = await db.prepare('SELECT max(expires_at) AS latest FROM transfers').first();
  assert.ok(latest - before >= 479000 && latest - before <= 481000);
});

await test('the per-minute job deletes expired codes, keeps live ones, and runs nothing else', async () => {
  const { default: worker } = await import('../sync-worker.js');
  await db.prepare('DELETE FROM transfers').run();
  await db.prepare("INSERT INTO transfers (code_hash, payload, expires_at) VALUES ('old', '{}', ?1), ('live', '{}', ?2)").bind(Date.now() - 1000, Date.now() + 60000).run();
  const jobs = [];
  await worker.scheduled({ cron: '* * * * *' }, { USERS: db }, { waitUntil: p => jobs.push(p) });
  assert.equal(jobs.length, 1);
  await Promise.all(jobs);
  const { results } = await db.prepare('SELECT code_hash FROM transfers').all();
  assert.deepEqual(results.map(r => r.code_hash), ['live']);
});

console.log(`\nAll ${passed} passed.`);
process.exit(0);
