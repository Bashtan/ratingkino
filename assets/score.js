/* ═══════════════════════════════════════
   The FindFilm score — SHARED by / (Classic) and /cinematic/.

   One number from three sources: 50% IMDb, 25% Rotten Tomatoes, 25% Metacritic
   (the owner's decision, 2026-11-08). A source with no rating yet is left out
   and the others keep their proportions. Two other runtimes carry the same
   formula: unifiedRating() in tv/index.html and score() in functions/og/[[path]].js.

   window.FFScore: value · parts · mix · fromOmdb · seen · introduce · introduceWhenStill
   Ratings are { imdb: 0–10, rt: 0–100, mc: 0–100 }; a movie object from either
   page already has that shape.

   Loaded synchronously in <head> by both documents as ?v=<8-char content hash>.
   The SW serves /assets/* stale-while-revalidate, so after editing this file
   recompute the hash and bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/score.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var SOURCES = [
    { key: 'imdb', name: 'IMDb',            weight: 0.5,  toTen: 1 },
    { key: 'rt',   name: 'Rotten Tomatoes', weight: 0.25, toTen: 0.1 },
    { key: 'mc',   name: 'Metacritic',      weight: 0.25, toTen: 0.1 },
  ];
  var SEEN_KEY = 'ff_score_intro_seen';
  var TIP_MS = 14000, SCROLL_GRACE_MS = 1200;

  function present(r) {
    return SOURCES.filter(function (s) { return Number(r && r[s.key]) > 0; });
  }

  // The sources this title has, each with its share of the score (they add up to 1).
  function parts(r) {
    var have = present(r);
    var total = have.reduce(function (sum, s) { return sum + s.weight; }, 0);
    return have.map(function (s) { return { key: s.key, name: s.name, share: s.weight / total }; });
  }

  // The score as a number on a 10-point scale, or null with no source.
  function value(r) {
    var have = present(r);
    if (!have.length) return null;
    var total = have.reduce(function (sum, s) { return sum + s.weight; }, 0);
    return have.reduce(function (sum, s) { return sum + Number(r[s.key]) * s.toTen * s.weight; }, 0) / total;
  }

  // "50% IMDb · 25% Rotten Tomatoes · 25% Metacritic"; '' with fewer than two sources.
  function mix(r, locale) {
    var list = parts(r);
    if (list.length < 2) return '';
    var pct = new Intl.NumberFormat(locale, { style: 'percent' });
    return list.map(function (p) { return pct.format(p.share) + ' ' + p.name; }).join(' · ');
  }

  // An OMDb answer → ratings; null when it has none of the three.
  function fromOmdb(od) {
    if (!od) return null;
    var rt = (od.Ratings || []).filter(function (x) { return x.Source === 'Rotten Tomatoes'; })[0];
    var r = { imdb: parseFloat(od.imdbRating) || 0, rt: rt ? parseInt(rt.Value, 10) || 0 : 0, mc: parseInt(od.Metascore, 10) || 0 };
    return present(r).length ? r : null;
  }

  function seen() {
    try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return true; /* storage blocked: it could never stay dismissed */ }
  }

  /* First exposure: a small tip beside the first score this browser shows, once. Non-blocking:
     it goes on "Got it", on a tap anywhere, on a scroll after a moment, or by itself. */
  var tip = null;
  function introduce(anchor, text, gotIt) {
    if (tip || !anchor || seen()) return;
    var a = anchor.getBoundingClientRect();
    if (!a.height || a.bottom < 0 || a.top > innerHeight) return;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { return; }

    var el = document.createElement('div');
    el.className = 'ffsc-tip';
    el.setAttribute('role', 'status');
    var p = document.createElement('p');
    p.textContent = text;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = gotIt;
    el.appendChild(p);
    el.appendChild(btn);
    document.body.appendChild(el);
    tip = el;

    var GAP = 10, EDGE = 12, w = el.offsetWidth, h = el.offsetHeight;
    var centre = a.left + a.width / 2;
    var left = Math.max(EDGE, Math.min(centre - w / 2, innerWidth - w - EDGE));
    var above = a.top - h - GAP >= EDGE;
    el.style.left = left + 'px';
    el.style.top = (above ? a.top - h - GAP : a.bottom + GAP) + 'px';
    el.style.setProperty('--ffsc-arrow', Math.max(18, Math.min(centre - left, w - 18)) + 'px');
    el.classList.add(above ? 'is-above' : 'is-below');
    requestAnimationFrame(function () { el.classList.add('show'); });

    var shownAt = Date.now();
    var timer = setTimeout(close, TIP_MS);
    function onScroll() { if (Date.now() - shownAt > SCROLL_GRACE_MS) close(); }
    function onPress(e) { if (!el.contains(e.target)) close(); }
    function close() {
      clearTimeout(timer);
      removeEventListener('scroll', onScroll, true);
      removeEventListener('pointerdown', onPress, true);
      removeEventListener('resize', close);
      tip = null;
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 200);
    }
    btn.addEventListener('click', close);
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('pointerdown', onPress, true);
    addEventListener('resize', close);
  }

  // For a score inside a sheet that is still sliding in: waits until getAnchor()'s element stops
  // moving. getAnchor returns null once the sheet has closed or moved on.
  function introduceWhenStill(getAnchor, text, gotIt) {
    var tries = 0, lastTop = null;
    (function check() {
      var el = seen() ? null : getAnchor();
      if (!el || ++tries > 24) return;
      var top = el.getBoundingClientRect().top;
      if (lastTop !== null && Math.abs(top - lastTop) < 1) { introduce(el, text, gotIt); return; }
      lastTop = top;
      setTimeout(check, 150);
    })();
  }

  window.FFScore = { value: value, parts: parts, mix: mix, fromOmdb: fromOmdb, seen: seen, introduce: introduce, introduceWhenStill: introduceWhenStill };
})();
