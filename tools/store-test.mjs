/* Tests the guest data layer: assets/store.js + assets/watchlist.js, in a fake browser.
     node tools/store-test.mjs
   What it guards: nobody's saved films or ratings get lost or duplicated on the way in,
   removals are remembered, and a blocked or full localStorage doesn't break the page. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const storeSrc = readFileSync(new URL('../assets/store.js', import.meta.url), 'utf8');
const watchlistSrc = readFileSync(new URL('../assets/watchlist.js', import.meta.url), 'utf8');

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map, failWrites: false, blocked: false,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { if (this.blocked) throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (this.blocked || this.failWrites) throw new Error('quota'); map.set(k, String(v)); },
    removeItem(k) { if (this.blocked) throw new Error('blocked'); map.delete(k); },
  };
}

// One page load against this storage.
function load(localStorage, now) {
  const handlers = [];
  const window = { addEventListener: (type, fn) => handlers.push(fn) };
  const RealDate = Date;
  const context = { window, localStorage, console, JSON, Object, Array, Number, Math, Date: now ? Object.assign(class extends RealDate {}, { now: () => now(), parse: RealDate.parse }) : Date };
  vm.createContext(context);
  vm.runInContext(storeSrc, context);
  context.FFStore = window.FFStore;
  vm.runInContext(watchlistSrc, context);
  return { store: window.FFStore, list: window.FFWatchlist, storageEvent: key => handlers.forEach(fn => fn({ key })) };
}
const raw = (s, c) => JSON.parse(s.getItem('ff_store_' + c));
const films = l => JSON.parse(JSON.stringify(l.list()));
const test = (name, fn) => { fn(); console.log('ok  ', name); };

const OLD = JSON.stringify([{ id: 11, type: 'movie' }, { id: 1396, type: 'tv' }, { id: 1396, type: 'movie' }]);

test('the first run brings the list in, in order, undated', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  assert.deepEqual(films(list), JSON.parse(OLD));
  assert.equal(raw(s, 'watchlist')['tv:1396'].updatedAt, 1);
});

test('bare ids from the oldest format still come in, as movies', () => {
  const s = fakeStorage({ rk_watchlist: '[5,6]' });
  const { list } = load(s);
  assert.deepEqual(films(list), [{ id: 5, type: 'movie' }, { id: 6, type: 'movie' }]);
  assert.deepEqual(JSON.parse(s.getItem('rk_watchlist_v2')), [{ id: 5, type: 'movie' }, { id: 6, type: 'movie' }]);
});

test('loading again changes nothing', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  load(s);
  const before = s.getItem('ff_store_watchlist');
  const { list } = load(s);
  assert.equal(s.getItem('ff_store_watchlist'), before);
  assert.equal(list.count(), 3);
});

test('a removal is remembered with its date, and the old copy follows', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  assert.equal(list.toggle(11, 'movie'), false);
  const gone = raw(s, 'watchlist')['movie:11'];
  assert.ok(gone.deletedAt > 1 && gone.updatedAt === gone.deletedAt && gone.value === null);
  assert.equal(JSON.parse(s.getItem('rk_watchlist_v2')).length, 2);
  assert.equal(load(s).list.has(11, 'movie'), false);
});

test('adding it back puts it last with a new date', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  list.toggle(11, 'movie');
  assert.equal(list.toggle(11, 'movie'), true);
  const f = films(list);
  assert.deepEqual(f[f.length - 1], { id: 11, type: 'movie' });
  assert.equal(raw(s, 'watchlist')['movie:11'].deletedAt, 0);
});

test('the same id as a film and as a series stay separate', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  list.remove(1396, 'tv');
  assert.equal(list.has(1396, 'movie'), true);
  assert.equal(list.has(1396, 'tv'), false);
});

test('clear removes everything and remembers it', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  list.clear();
  assert.equal(list.count(), 0);
  assert.equal(Object.values(raw(s, 'watchlist')).every(x => x.deletedAt > 0), true);
  assert.equal(s.getItem('rk_watchlist_v2'), '[]');
  assert.equal(load(s).list.count(), 0);
});

test('a change made in a tab on the old code counts', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const page = load(s);
  s.setItem('rk_watchlist_v2', JSON.stringify([{ id: 1396, type: 'tv' }, { id: 77, type: 'movie' }]));
  page.storageEvent('rk_watchlist_v2');
  assert.equal(page.list.has(77, 'movie'), true);
  assert.equal(page.list.has(11, 'movie'), false);
  assert.ok(raw(s, 'watchlist')['movie:11'].deletedAt > 1);
});

test('a change from another tab on the new code shows up', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const a = load(s), b = load(s);
  a.list.toggle(99, 'movie');
  assert.equal(b.list.has(99, 'movie'), false);
  b.storageEvent('ff_store_watchlist');
  assert.equal(b.list.has(99, 'movie'), true);
});

test('a clock that moved back still makes a newer change', () => {
  let t = 5000;
  const s = fakeStorage();
  const { store } = load(s, () => t);
  store.put('prefs', 'country', 'US');
  t = 1000;
  store.put('prefs', 'country', 'FR');
  assert.equal(raw(s, 'prefs').country.updatedAt, 5001);
});

const REVIEW = { movieId: 603, stars: 4, userName: null, text: 'Good', createdAt: '2026-01-02T03:04:05.000Z', date: 'Jan 2, 2026' };

test('ratings come in with their real dates, once', () => {
  const s = fakeStorage({ rk_rev_603: JSON.stringify([REVIEW]) });
  load(s);
  const { store } = load(s);
  assert.equal(store.list('reviews').length, 1);
  assert.equal(store.list('reviews')[0].updatedAt, Date.parse(REVIEW.createdAt));
});

test('an old rating shows on either type; a new one only on its own', () => {
  const s = fakeStorage({ rk_rev_603: JSON.stringify([REVIEW]) });
  const { store } = load(s);
  store.addReview(603, 'tv', { stars: 5, text: 'Great', createdAt: '2026-02-02T03:04:05.000Z' });
  assert.equal(store.reviewsFor(603, 'movie').length, 1);
  assert.equal(store.reviewsFor(603, 'tv').length, 2);
  assert.equal(store.reviewsFor(603, null).length, 2);
  assert.equal(store.reviewsFor(603, 'tv')[1].stars, 5);
});

test('a new rating is also kept in the old place, and not counted twice on reload', () => {
  const s = fakeStorage();
  load(s).store.addReview(42, 'movie', { stars: 3, text: '', createdAt: '2026-03-01T00:00:00.000Z' });
  assert.equal(JSON.parse(s.getItem('rk_rev_42')).length, 1);
  assert.equal(load(s).store.reviewsFor(42, 'movie').length, 1);
});

test('a rating with no date, or junk in its slot, breaks nothing', () => {
  const s = fakeStorage({ rk_rev_7: JSON.stringify([{ stars: 2 }, null, 'x']), rk_rev_abc: '[]' });
  const { store } = load(s);
  assert.equal(store.reviewsFor(7, 'movie').length, 1);
  assert.equal(store.list('reviews')[0].updatedAt, 1);
});

test('a setting set to empty is forgotten', () => {
  const s = fakeStorage();
  const { store } = load(s);
  store.setPref('minRating', 7.5);
  assert.equal(load(s).store.pref('minRating'), 7.5);
  store.setPref('minRating', 0);
  assert.equal(load(s).store.pref('minRating'), null);
});

test('blocked storage: the visit carries on from memory', () => {
  const s = fakeStorage();
  s.blocked = true;
  const { list, store } = load(s);
  assert.equal(list.toggle(1, 'movie'), true);
  assert.equal(list.has(1, 'movie'), true);
  store.setPref('country', 'DE');
  assert.equal(store.pref('country'), 'DE');
});

test('full storage: the change still holds for this visit, and the old copy is not left stale', () => {
  const s = fakeStorage({ rk_watchlist_v2: OLD });
  const { list } = load(s);
  s.failWrites = true;
  assert.equal(list.toggle(50, 'movie'), true);
  assert.equal(list.has(50, 'movie'), true);
  assert.equal(s.getItem('rk_watchlist_v2'), null);
});

test('unreadable saved data is not a crash', () => {
  const s = fakeStorage({ ff_store_watchlist: '{broken', rk_watchlist_v2: '[' });
  const { list } = load(s);
  assert.equal(list.count(), 0);
  assert.equal(list.toggle(3, 'movie'), true);
});

console.log('\nAll passed.');
