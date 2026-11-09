/* ═══════════════════════════════════════
   Moving from ratingkino.com to findfilm.ai — SHARED by / (Classic) and /cinematic/.

   Browser storage belongs to one site, so a guest's saved films would be stranded on the old address.
   On the old domain this packs up what's saved, hands it to the server for a one-time code, and sends the
   visitor to the same page on findfilm.ai with the code in the URL fragment (never sent to a server). If
   nothing is saved it just redirects. If the hand-over fails they stay put, and the next visit tries again.

   On arrival the data is merged: per item the newest change wins, the taste profile with more history
   wins, and a setting already made on findfilm.ai stays. Every visit to the old domain sends again, which
   is harmless for the same reason. A link that didn't come from the old domain asks first, and every
   value is checked before use, so nobody can plant data with a crafted link.

   An installed app can't move site: it stays where it is and offers to open findfilm.ai in the browser.

   Loaded synchronously in <head>, after store.js and watchlist.js, by both documents as ?v=<8-char hash>.
   After editing, bump ?v= in index.html and cinematic/index.html:  shasum -a 256 assets/move.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var LIVE = false;                       // true: everyone on the old domain moves, installed apps included. false: only with ?move=1 once.
  var FLAG_KEY = 'ff_flag_move', VOTE = 'ff_pitch_vote_', KEEP_CODE_MS = 480000, SHOW_ANYWAY_MS = 5000;
  var LOCAL_TEST = location.hostname === 'old.localhost';
  var ON_OLD_DOMAIN = LOCAL_TEST || /(^|\.)ratingkino\.com$/.test(location.hostname);
  var HOME = LOCAL_TEST ? 'http://localhost:' + location.port : 'https://findfilm.ai';
  var FROM_OLD_DOMAIN = /^https?:\/\/((www\.)?ratingkino\.com|old\.localhost(:\d+)?)(\/|$)/;

  var ANY = /^.{1,40}$/;
  var EXTRAS = {
    rk_lang: /^(en|es|fr|zh|ar|uk|de|sv|no)$/, ff_layout: /^(classic|cinematic)$/, ff_search_mode: /^(ai|title)$/,
    rk_visited: ANY, hasSeenOnboarding: ANY, rk_onboard_quiz_done: ANY, rk_install_banner_dismissed: ANY,
    rk_ios_pwa_dismissed: ANY, ff_mascot_off: ANY, ff_welcome_seen: ANY, ff_score_intro_seen: ANY,
    ff_pitch_voter: /^[\w-]{1,80}$/, ff_pitch_name: /^[^<>]{1,80}$/,
  };

  function get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* full or blocked: this one stays behind */ } }
  function hide() { document.documentElement.style.visibility = 'hidden'; setTimeout(show, SHOW_ANYWAY_MS); }
  function show() { document.documentElement.style.visibility = ''; }
  function say(key) {
    var dict = window.FF_I18N || {}, lang = get('rk_lang') || 'en';
    return (dict[lang] && dict[lang][key]) || (dict.en && dict.en[key]) || key;
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw new Error('move ' + r.status); return r.json(); });
  }

  function note(text, button, action) {
    function place() {
      var el = document.createElement('div');
      el.className = 'ffa-note';
      el.setAttribute('role', 'status');
      el.innerHTML = '<span></span><button class="ffa-btn" type="button"></button><button class="ffa-x-small" type="button" aria-label="' + say('results.close') + '">✕</button>';
      el.children[0].textContent = text;
      el.children[1].textContent = button;
      el.children[1].addEventListener('click', function () { el.remove(); action(); });
      el.children[2].addEventListener('click', function () { el.remove(); });
      document.body.appendChild(el);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
  }

  /* ── On the old domain ── */
  function pack() {
    var extras = {}, count = 0;
    Object.keys(EXTRAS).forEach(function (key) { var v = get(key); if (v !== null) { extras[key] = v; count += 1; } });
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var name = localStorage.key(i);
        if (name.indexOf(VOTE) === 0) { extras[name] = localStorage.getItem(name); count += 1; }
      }
    } catch (e) { /* storage blocked: there's nothing to pack */ }
    var items = FFStore.outgoing(true), taste = get('rk_taste_v1');
    if (!items.length && !taste && !count) return null;
    return { items: items, taste: taste, ratedFilms: get('rk_rated_films'), extras: extras };
  }

  function leave() {
    var target = HOME + location.pathname + location.search;
    var data = pack();
    if (window.navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(function (all) { all.forEach(function (r) { r.unregister(); }); }, function () {});
    if (!data) { try { window.stop(); } catch (e) {} location.replace(target); return; }
    hide();
    post('/api/transfer', data).then(function (d) { location.replace(target + '#transfer=' + d.code); }, show);
  }

  // Safari only opens from the tap itself, with no waiting in between, so the code is ready beforehand.
  function offerFromInstalledApp() {
    var data = pack(), code = '';
    function refresh() { if (data) post('/api/transfer', data).then(function (d) { code = d.code; }, function () {}); }
    refresh();
    setInterval(refresh, KEEP_CODE_MS);
    note(say('move.moved'), say('move.open'), function () {
      window.open(HOME + '/' + (code ? '#transfer=' + code : ''), '_blank');
    });
  }

  /* ── On findfilm.ai ── */
  var short = function (v, max) { return typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, max) : ''; };

  function cleanValue(r) {
    if (r.d) return null;
    var v = r.v || {};
    if (r.c === 'watchlist') {
      var parts = r.k.split(':');
      return { id: Number(parts[1]), type: parts[0] };
    }
    if (r.c === 'prefs') return r.k === 'country' ? short(v, 2) : Math.min(10, Math.max(0, Number(v) || 0));
    return { movieId: Number(r.k.split(':')[0]), type: v.type === 'tv' ? 'tv' : v.type === 'movie' ? 'movie' : null, stars: Math.min(5, Math.max(1, Number(v.stars) || 1)), userName: short(v.userName, 80) || null, text: short(v.text, 4000), createdAt: short(v.createdAt, 40), date: short(v.date, 30) };
  }

  var KEYS = { watchlist: /^(movie|tv):\d{1,10}$/, reviews: /^\d{1,10}:[^\s<>]{1,40}$/, prefs: /^(country|minRating)$/ };
  var time = function (n) { return Number.isSafeInteger(n) && n > 0 ? Math.min(n, Date.now()) : 0; };

  function cleanItems(raw) {
    return (Array.isArray(raw) ? raw : []).map(function (r) {
      if (!r || !KEYS[r.c] || !Object.prototype.hasOwnProperty.call(KEYS, r.c) || typeof r.k !== 'string' || !KEYS[r.c].test(r.k) || !time(r.u)) return null;
      var d = time(r.d);
      return { c: r.c, k: r.k, a: time(r.a) || time(r.u), u: time(r.u), d: d, v: cleanValue({ c: r.c, k: r.k, d: d, v: r.v }) };
    }).filter(Boolean);
  }

  function cleanTaste(text) {
    var t;
    try { t = JSON.parse(text); } catch (e) { return null; }
    if (!t || !(t.total > 0)) return null;
    var counts = function (o) {
      var out = {};
      Object.keys(o && typeof o === 'object' ? o : {}).slice(0, 200).forEach(function (k) { var n = Number(o[k]); if (n > 0) out[short(k, 80)] = n; });
      return out;
    };
    var prefs = {};
    Object.keys(t.prefs && typeof t.prefs === 'object' ? t.prefs : {}).slice(0, 20).forEach(function (k) { if (typeof t.prefs[k] === 'string') prefs[short(k, 30)] = short(t.prefs[k], 40); });
    return { genres: counts(t.genres), directors: counts(t.directors), prefs: prefs, total: Math.min(100000, Math.floor(Number(t.total))) };
  }

  function cleanRated(text) {
    var list;
    try { list = JSON.parse(text); } catch (e) { return null; }
    if (!Array.isArray(list)) return null;
    return list.slice(0, 40).filter(function (f) { return f && typeof f.title === 'string'; }).map(function (f) {
      return { title: short(f.title, 200), year: Number(f.year) || null, rating: Number(f.rating) || null, genres: (Array.isArray(f.genres) ? f.genres : []).slice(0, 3).map(function (g) { return short(g, 40); }), director: short(f.director, 120) || null };
    });
  }

  function bringIn(data, had) {
    if (!data || typeof data !== 'object') return;
    FFStore.mergeIn(cleanItems(data.items));
    var taste = data.taste ? cleanTaste(data.taste) : null, mine = 0;
    try { mine = (JSON.parse(get('rk_taste_v1')) || {}).total || 0; } catch (e) { /* unreadable: anything is richer */ }
    if (taste && taste.total > mine) {
      set('rk_taste_v1', JSON.stringify(taste));
      var rated = data.ratedFilms ? cleanRated(data.ratedFilms) : null;
      if (rated) set('rk_rated_films', JSON.stringify(rated));
    }
    Object.keys(data.extras && typeof data.extras === 'object' ? data.extras : {}).forEach(function (key) {
      var value = data.extras[key];
      if (typeof value !== 'string' || had[key]) return;
      var rule = Object.prototype.hasOwnProperty.call(EXTRAS, key) ? EXTRAS[key] : /^ff_pitch_vote_[\w-]{1,40}$/.test(key) ? /^(yes|maybe|no)$/ : null;
      if (rule && rule.test(value)) set(key, value);
    });
  }

  function arrive() {
    var match = /^#transfer=([\w-]{20,100})$/.exec(location.hash);
    if (!match) return;
    // A setting made here before the move stays, and language detection is about to write one.
    var had = {};
    Object.keys(EXTRAS).forEach(function (key) { if (get(key) !== null) had[key] = true; });
    try {
      for (var i = 0; i < localStorage.length; i++) { var name = localStorage.key(i); if (name.indexOf(VOTE) === 0) had[name] = true; }
    } catch (e) { /* storage blocked: nothing can be kept anyway */ }
    history.replaceState(history.state, '', location.pathname + location.search);   // the code never stays in the address

    function claim() {
      return post('/api/transfer/claim', { code: match[1] }).then(function (data) { bringIn(data, had); location.reload(); });
    }
    if (FROM_OLD_DOMAIN.test(document.referrer)) { hide(); claim().catch(show); }
    else note(say('move.ask'), say('move.yes'), function () { claim().catch(function () {}); });
  }

  if (!ON_OLD_DOMAIN) { arrive(); return; }
  if (/[?&]move=1/.test(location.search)) set(FLAG_KEY, '1');
  if (!LIVE && get(FLAG_KEY) !== '1') return;
  if (window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) { offerFromInstalledApp(); return; }
  leave();
})();
