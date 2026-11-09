/* ═══════════════════════════════════════════════════════════════════════════
   Watchlist storage — SHARED by / (Classic) and /cinematic/.

   One list for both layouts, kept in FFStore's `watchlist` collection (/assets/store.js)
   with the date of every change. localStorage `rk_watchlist_v2` still holds
   [{ id, type: 'movie' | 'tv' }], oldest first, for rollback. TMDB numbers movies and
   TV shows separately (1396 is both Breaking Bad and the film Mirror), so an id
   alone can name the wrong title: the type always travels with it.

   Classic used to store bare ids under `rk_watchlist`. When the new key does
   not exist yet, those ids are imported once, as movies (the old format never
   recorded the type, so a TV show saved from Classic's TV tab cannot be told
   apart). The old key is left untouched.

   window.FFWatchlist: has · toggle · remove · clear · list · count · onChange
   onChange(fn) returns an unsubscribe function. fn runs after every change,
   including one made in another tab (the `storage` event).

   Loaded synchronously in <head> by both documents as ?v=<8-char content hash>.
   The SW serves /assets/* stale-while-revalidate, so after editing this file
   recompute the hash and bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/watchlist.js | cut -c1-8
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var KEY = 'rk_watchlist_v2';
  var LEGACY = 'rk_watchlist';
  var COLLECTION = 'watchlist';
  var items = [];
  var listeners = [];

  function entry(id, type) {
    var n = Number(id);
    if (!(n > 0) || Math.floor(n) !== n) return null;
    return { id: n, type: type === 'tv' ? 'tv' : 'movie' };
  }

  // Accepts typed entries and bare ids (the legacy shape); drops junk and duplicates.
  function clean(arr) {
    var seen = {}, out = [];
    (Array.isArray(arr) ? arr : []).forEach(function (x) {
      var e = x && typeof x === 'object' ? entry(x.id, x.type) : entry(x, 'movie');
      if (!e) return;
      var k = e.type + ':' + e.id;
      if (seen[k]) return;
      seen[k] = true;
      out.push(e);
    });
    return out;
  }

  function keyOf(e) { return e.type + ':' + e.id; }

  // The rollback copy. A half-written copy would read as changes made in an old tab, so it goes instead.
  function saveOldCopy() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {
      try { localStorage.removeItem(KEY); } catch (e2) { /* storage blocked */ }
    }
  }

  // The older list, or null when there's nothing to read from it.
  function readOld() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
    if (raw !== null) {
      try { return clean(JSON.parse(raw)); } catch (e) { return null; }
    }
    if (FFStore.exists(COLLECTION)) return null;
    try { return clean(JSON.parse(localStorage.getItem(LEGACY) || '[]')); } catch (e) { return []; }
  }

  // The first run brings the older list in, undated and in its order. After that, the only thing
  // that can make the two differ is a tab still running the old code: its changes count.
  function absorbOld() {
    if (FFStore.meta().owner) return;                   // an account's list comes from the server, not an old tab
    var old = readOld();
    if (!old) return;
    if (!FFStore.exists(COLLECTION)) {
      FFStore.seed(COLLECTION, old.map(function (e, i) { return { key: keyOf(e), value: e, addedAt: i + 1, updatedAt: 1 }; }));
      return;
    }
    var live = {}, inOld = {};
    FFStore.list(COLLECTION).forEach(function (x) { live[x.key] = true; });
    old.forEach(function (e) {
      inOld[keyOf(e)] = true;
      if (!live[keyOf(e)]) FFStore.put(COLLECTION, keyOf(e), e);
    });
    Object.keys(live).forEach(function (key) { if (!inOld[key]) FFStore.remove(COLLECTION, key); });
  }

  function indexOf(e) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === e.id && items[i].type === e.type) return i;
    }
    return -1;
  }

  function emit() {
    listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* one bad listener must not block the rest */ } });
  }

  // Another tab may have written since this one last looked.
  function refresh() {
    items = clean(FFStore.list(COLLECTION).map(function (x) { return x.value; }));
  }

  absorbOld();
  refresh();
  if (items.length) saveOldCopy();

  window.addEventListener('storage', function (ev) {
    if (ev.key !== 'ff_store_' + COLLECTION && ev.key !== KEY && ev.key !== null) return;     // key === null: localStorage.clear()
    if (ev.key === KEY) absorbOld();
    refresh();
    emit();
  });

  FFStore.onRemoteChange(function (collection) {        // another device's change, or signing out
    if (collection !== COLLECTION) return;
    refresh();
    saveOldCopy();
    emit();
  });

  window.FFWatchlist = {
    has: function (id, type) {
      var e = entry(id, type);
      return !!e && indexOf(e) !== -1;
    },
    // true when the title is saved afterwards
    toggle: function (id, type) {
      var e = entry(id, type);
      if (!e) return false;
      refresh();
      var absent = indexOf(e) === -1;
      if (absent) FFStore.put(COLLECTION, keyOf(e), e); else FFStore.remove(COLLECTION, keyOf(e));
      refresh();
      saveOldCopy();
      emit();
      return absent;
    },
    remove: function (id, type) {
      var e = entry(id, type);
      if (!e) return;
      refresh();
      if (indexOf(e) === -1) return;
      FFStore.remove(COLLECTION, keyOf(e));
      refresh();
      saveOldCopy();
      emit();
    },
    clear: function () {
      refresh();
      items.forEach(function (e) { FFStore.remove(COLLECTION, keyOf(e)); });
      refresh();
      saveOldCopy();
      emit();
    },
    list: function () {
      return items.map(function (x) { return { id: x.id, type: x.type }; });
    },
    count: function () { return items.length; },
    onChange: function (fn) {
      listeners.push(fn);
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    }
  };
})();
