/* ═══════════════════════════════════════════════════════════════════════════
   Watchlist storage — SHARED by / (Classic) and /cinematic/.

   One list for both layouts. localStorage `rk_watchlist_v2` holds
   [{ id, type: 'movie' | 'tv' }], oldest first. TMDB numbers movies and TV
   shows separately (1396 is both Breaking Bad and the film Mirror), so an id
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

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* storage blocked: the list lasts for this visit */ }
  }

  // The stored list, or null when storage cannot be read at all.
  function read() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
    if (raw !== null) {
      try { return clean(JSON.parse(raw)); } catch (e) { return []; }
    }
    try { return clean(JSON.parse(localStorage.getItem(LEGACY) || '[]')); } catch (e) { return []; }
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
    var fresh = read();
    if (fresh) items = fresh;
  }

  refresh();
  var imported = false;
  try { imported = localStorage.getItem(KEY) === null && items.length > 0; } catch (e) { /* unreadable */ }
  if (imported) save();

  window.addEventListener('storage', function (ev) {
    if (ev.key !== KEY && ev.key !== null) return;     // key === null: localStorage.clear()
    refresh();
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
      var i = indexOf(e);
      if (i === -1) items.push(e); else items.splice(i, 1);
      save();
      emit();
      return i === -1;
    },
    remove: function (id, type) {
      var e = entry(id, type);
      if (!e) return;
      refresh();
      var i = indexOf(e);
      if (i === -1) return;
      items.splice(i, 1);
      save();
      emit();
    },
    clear: function () {
      items = [];
      save();
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
