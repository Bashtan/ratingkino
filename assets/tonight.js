/* ═══════════════════════════════════════
   Tonight's Three — SHARED by / (Classic) and /cinematic/.

   One Safe Bet, one Surprise, one Comfort Pick, from POST /api/tonight (the rules are in
   functions/_lib/tonight.js). The picks stay the same all evening unless the visitor asks for
   three others. Films they've already rated are skipped.

   window.FFTonight.mount(host, options) → { load, refresh, relabel, shownIds }
   options: t(key, vars) · lang() TMDB locale · onOpen(row, element) · onPersonal(bool) ·
            onEmpty() no picks to show · genreId(name) optional, for a page that knows its
            genre names in the current language

   Loaded synchronously in <head> by both documents as ?v=<8-char content hash>.
   After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/tonight.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var ROLES = ['safe', 'surprise', 'comfort'];
  var TASTE_KEY = 'rk_taste_v1', TASTE_MIN = 3;   // Classic's rule for "we know your taste"
  var SHUFFLE_KEY = 'ff_t3_shuffle';
  var IMG = 'https://image.tmdb.org/t/p/';
  var IDS = { Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402, Mystery: 9648, Romance: 10749, 'Science Fiction': 878, Thriller: 53, War: 10752, Western: 37 };
  var SHUFFLE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function stored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
  }
  function rated(id) {
    var reviews = stored('rk_rev_' + id, []);
    return Array.isArray(reviews) && reviews.length > 0;
  }

  function mount(host, options) {
    var t = options.t, sets = null, day = '', offset = 0, shown = [], pending = null, details = {};

    // The visitor's two strongest genres, once there's enough to go on.
    function taste() {
      var p = stored(TASTE_KEY, {});
      if (!p.genres || (p.total || 0) < TASTE_MIN) return [];
      return Object.keys(p.genres).sort(function (a, b) { return p.genres[b] - p.genres[a]; })
        .map(function (name) { return Number((options.genreId && options.genreId(name)) || IDS[name]); })
        .filter(function (id) { return Object.keys(IDS).some(function (k) { return IDS[k] === id; }); })
        .slice(0, 2);
    }

    function card(role, m) {
      var year = (m.release_date || '').slice(0, 4);
      var length = m.runtime ? new Intl.NumberFormat(document.documentElement.lang || undefined, { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(m.runtime) : '';
      var meta = [year, length, '★ ' + Number(m.vote_average || 0).toFixed(1)].filter(Boolean).map(esc).join(' · ');
      return '<button class="ff3-card ff3-' + role + '" type="button" data-id="' + m.id + '">' +
        (m.poster_path ? '<img class="ff3-poster" src="' + IMG + 'w185' + esc(m.poster_path) + '" alt="" width="90" height="135" decoding="async">' : '') +
        '<span class="ff3-body">' +
          '<span class="ff3-role">' + esc(t('t3.' + role)) + '</span>' +
          '<span class="ff3-title">' + esc(m.title) + '</span>' +
          '<span class="ff3-meta">' + meta + '</span>' +
          (m.why ? '<span class="ff3-why">' + esc(m.why) + '</span>' : '<span class="ff3-why" hidden></span>') +
          (m.stream ? '<span class="ff3-stream">' + (m.stream.logo ? '<img src="' + IMG + 'w45' + esc(m.stream.logo) + '" alt="" width="18" height="18" loading="lazy">' : '') + esc(t('t3.on', { service: m.stream.name })) + '</span>' : '') +
        '</span></button>';
    }

    function paint() {
      shown = ROLES.map(function (role) {
        var all = sets.map(function (s) { return s[role]; });
        var fresh = all.filter(function (m) { return !rated(m.id); });
        var list = fresh.length ? fresh : all;
        return { role: role, m: list[offset % list.length] };
      });
      var streaming = shown.some(function (p) { return p.m.stream; });
      host.innerHTML = '<div class="ff3-cards">' + shown.map(function (p) { return card(p.role, p.m); }).join('') + '</div>' +
        '<div class="ff3-foot">' + (streaming ? '<span class="ff3-credit">' + esc(t('t3.credit')) + '</span>' : '') +
        '<button class="ff3-shuffle" type="button">' + SHUFFLE_ICON + '<span>' + esc(t('t3.shuffle')) + '</span></button></div>';
      localize();
    }

    // The index is in English: another language gets the title and plot from TMDB.
    function localize() {
      var lang = options.lang();
      if (!lang || /^en/.test(lang)) return;
      shown.forEach(function (p) {
        var key = lang + ':' + p.m.id;
        details[key] = details[key] || fetch('/api/tmdb/movie/' + p.m.id + '?language=' + encodeURIComponent(lang))
          .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        details[key].then(function (d) {
          var el = d && host.querySelector('[data-id="' + p.m.id + '"]');
          if (!el) return;
          if (d.title) el.querySelector('.ff3-title').textContent = d.title;
          if (d.overview) { var why = el.querySelector('.ff3-why'); why.textContent = d.overview; why.hidden = false; }
        });
      });
    }

    host.addEventListener('click', function (e) {
      if (e.target.closest('.ff3-shuffle')) {
        offset += 1;
        try { localStorage.setItem(SHUFFLE_KEY, JSON.stringify({ day: day, n: offset })); } catch (err) { /* blocked: it just won't survive a reload */ }
        paint();
        var btn = host.querySelector('.ff3-shuffle');
        if (btn) btn.focus({ preventScroll: true });
        return;
      }
      var el = e.target.closest('.ff3-card');
      if (!el || el.classList.contains('ff3-skel')) return;
      var pick = shown.filter(function (p) { return String(p.m.id) === el.dataset.id; })[0];
      if (pick) options.onOpen(pick.m, el);
    });

    function load() {
      var now = today();
      if (sets && day === now) { paint(); return Promise.resolve(); }
      if (pending) return pending;
      host.innerHTML = '<div class="ff3-cards" aria-hidden="true">' + ROLES.map(function () { return '<div class="ff3-card ff3-skel"></div>'; }).join('') + '</div>';
      pending = fetch('/api/tonight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genres: taste(), day: now }),
      }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
        pending = null;
        if (!d || !d.sets || !d.sets.length) { sets = null; host.innerHTML = ''; if (options.onEmpty) options.onEmpty(); return; }
        sets = d.sets;
        day = now;
        var saved = stored(SHUFFLE_KEY, {});
        offset = saved.day === day ? saved.n || 0 : 0;
        if (options.onPersonal) options.onPersonal(!!d.personal);
        paint();
      });
      return pending;
    }

    return {
      load: load,
      refresh: function () { sets = null; return load(); },   // the visitor's taste just changed
      relabel: function () { if (sets) paint(); },            // the page's language just changed
      shownIds: function () { return shown.map(function (p) { return p.m.id; }); },
    };
  }

  window.FFTonight = { mount: mount };
})();
