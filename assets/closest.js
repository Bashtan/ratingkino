/* ═══════════════════════════════════════
   The closest films to a query that matched nothing — SHARED by / (Classic)
   and /cinematic/.

   window.FFClosest.find(query, signal) → { movies, reasons } or null.
   movies are TMDB-shaped rows; reasons is { id: line }. It never rejects: null
   means "no honest answer" (vibe search called it a non-request, match: 'none',
   as it does for keyboard mash; or it failed or timed out), and the page shows
   popular titles instead. Films only: the vibe index has no series yet.

   Loaded synchronously in <head> by both documents as ?v=<8-char content hash>.
   After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/closest.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var TIMEOUT_MS = 15000;

  function find(query, signal) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, TIMEOUT_MS);
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', function () { ctl.abort(); }, { once: true });
    }
    return fetch('/api/vibe-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query }),
      signal: ctl.signal,
    }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (d) {
      if (!d || d.match === 'none' || !Array.isArray(d.movies) || !d.movies.length) return null;
      return { movies: d.movies, reasons: d.reasons || {} };
    }).catch(function () {
      return null;
    }).finally(function () {
      clearTimeout(timer);
    });
  }

  window.FFClosest = { find: find };
})();
