/* ═══════════════════════════════════════
   The guest's saved data — SHARED by / (Classic) and /cinematic/.

   Everything stays in this browser. Each item records when it was added, changed
   and removed, so that signing in later can merge devices with "the newest change
   wins". A removed item stays as a dated tombstone, or an older copy from another
   device would bring it back.

   localStorage `ff_store_<collection>`: { key: { value, addedAt, updatedAt, deletedAt } }
     watchlist   key "movie:27205"           value { id, type }   (assets/watchlist.js)
     reviews     key "<film id>:<createdAt>" value the review, with its type
     prefs       key "country", "minRating"  value the setting

   Saves from before this file have no dates: they import with updatedAt 1, so they
   are kept but can't undo a dated removal. Ratings always had a date and keep it.
   The older keys (rk_watchlist_v2, rk_rev_<id>) are still written, for rollback.

   If storage is blocked or full, this visit carries on from memory.

   window.FFStore: list · get · put · remove · seed · exists · reviewsFor · addReview · pref · setPref

   Loaded synchronously in <head>, before watchlist.js, by both documents as
   ?v=<8-char content hash>. After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/store.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var PREFIX = 'ff_store_', REVIEW_PREFIX = 'rk_rev_';
  var memory = {}, unsaved = {};

  // Always read fresh: another tab may have written since this one last looked.
  function read(collection) {
    if (unsaved[collection]) return memory[collection];
    var raw;
    try { raw = localStorage.getItem(PREFIX + collection); } catch (e) { return memory[collection] || (memory[collection] = {}); }
    if (raw === null) return (memory[collection] = {});
    try {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) memory[collection] = parsed;
    } catch (e) { /* unreadable: carry on with what this visit already has */ }
    return memory[collection] || (memory[collection] = {});
  }

  function write(collection) {
    try {
      localStorage.setItem(PREFIX + collection, JSON.stringify(memory[collection]));
      unsaved[collection] = false;
    } catch (e) {
      unsaved[collection] = true;
    }
  }

  function exists(collection) {
    try { return localStorage.getItem(PREFIX + collection) !== null; } catch (e) { return !!memory[collection]; }
  }

  // Live items, oldest first.
  function list(collection) {
    var items = read(collection);
    return Object.keys(items).filter(function (key) { return !items[key].deletedAt; }).map(function (key) {
      var item = items[key];
      return { key: key, value: item.value, addedAt: item.addedAt, updatedAt: item.updatedAt };
    }).sort(function (a, b) { return a.addedAt - b.addedAt || (a.key < b.key ? -1 : 1); });
  }

  function get(collection, key) {
    var item = read(collection)[key];
    return item && !item.deletedAt ? item.value : null;
  }

  function put(collection, key, value) {
    var items = read(collection), old = items[key], now = Date.now();
    items[key] = {
      value: value,
      addedAt: old && !old.deletedAt ? old.addedAt : now,
      updatedAt: old ? Math.max(now, old.updatedAt + 1) : now,   // always newer than what it replaces, even if the clock moved back
      deletedAt: 0,
    };
    write(collection);
  }

  function remove(collection, key) {
    var items = read(collection), old = items[key];
    if (!old || old.deletedAt) return;
    var now = Math.max(Date.now(), old.updatedAt + 1);
    items[key] = { value: null, addedAt: old.addedAt, updatedAt: now, deletedAt: now };
    write(collection);
  }

  // Bring in older data with the dates it came with: [{ key, value, addedAt, updatedAt }].
  // A key already known here, removed or not, is left alone.
  function seed(collection, rows) {
    var items = read(collection), changed = false;
    rows.forEach(function (row) {
      if (items[row.key]) return;
      items[row.key] = { value: row.value, addedAt: row.addedAt, updatedAt: row.updatedAt, deletedAt: 0 };
      changed = true;
    });
    if (changed) write(collection);
  }

  /* ── Ratings ── rk_rev_<id> is a film's list of reviews, with no movie/TV type (TMDB reuses ids
     across the two). Reviews from then keep type null and show on either. */
  function reviewKey(id, createdAt) { return id + ':' + createdAt; }

  // What rk_rev_<id> holds that isn't here yet: everything on the first run, then whatever an old tab added.
  function absorbOldReviews() {
    var rows = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var name = localStorage.key(i);
        if (name.indexOf(REVIEW_PREFIX) !== 0) continue;
        var id = Number(name.slice(REVIEW_PREFIX.length)), reviews = JSON.parse(localStorage.getItem(name) || '[]');
        if (!(id > 0) || !Array.isArray(reviews)) continue;
        reviews.forEach(function (r, n) {
          if (!r || typeof r !== 'object') return;
          var when = Date.parse(r.createdAt) || 1;
          rows.push({ key: reviewKey(id, r.createdAt || 'old' + n), value: Object.assign({}, r, { movieId: id, type: r.type || null }), addedAt: when, updatedAt: when });
        });
      }
    } catch (e) { return; /* storage blocked or a bad entry: the rest of the site still works */ }
    if (rows.length) seed('reviews', rows);
  }

  // A film's reviews, oldest first. type null: don't tell films and series apart.
  function reviewsFor(id, type) {
    return list('reviews').map(function (x) { return x.value; }).filter(function (r) {
      return r.movieId === id && (!type || !r.type || r.type === type);
    });
  }

  function addReview(id, type, review) {
    var full = Object.assign({}, review, { movieId: id, type: type || null });
    put('reviews', reviewKey(id, review.createdAt), full);
    try {
      var old = JSON.parse(localStorage.getItem(REVIEW_PREFIX + id) || '[]');
      old.push(full);
      localStorage.setItem(REVIEW_PREFIX + id, JSON.stringify(old));
    } catch (e) { /* the old copy is only for rollback */ }
  }

  absorbOldReviews();

  window.FFStore = {
    list: list, get: get, put: put, remove: remove, seed: seed, exists: exists,
    reviewsFor: reviewsFor, addReview: addReview,
    pref: function (name) { return get('prefs', name); },
    // An empty value forgets the setting.
    setPref: function (name, value) {
      if (value === '' || value === 0 || value == null) { remove('prefs', name); return; }
      if (get('prefs', name) !== value) put('prefs', name, value);
    },
  };
})();
