/* ═══════════════════════════════════════════════════════════════════════════
   Fresh pages — SHARED by / (Classic) and /cinematic/.

   An open page keeps running the build it loaded, however many deploys later:
   a home-screen app resumed from memory, a tab left open since yesterday. The
   service worker can't help (it fetches the page network-first, but only when
   the page is loaded), so the page asks for itself:

   - deploy.sh writes /build.json — {"build": "<UTC time>-<commit>"} — on every
     deploy, and sw.js always fetches it from the network.
   - This notes the build that was live when the page loaded and, when the page
     comes back after AWAY_MS in the background (or out of the back/forward
     cache), asks again. A different build means the site was redeployed, so it
     reloads — at most once per build (sessionStorage ff_fresh_reload), so a
     stale copy served offline can't start a loop.

   Nobody is mid-task after ten minutes away, which is what makes a silent
   reload acceptable. Without /build.json (local static dev) it does nothing.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var AWAY_MS = 10 * 60 * 1000;
  var RELOADED_KEY = 'ff_fresh_reload';
  var loadedBuild = null, hiddenAt = 0, checking = false;

  function liveBuild() {
    return fetch('/build.json', { cache: 'no-store' })
      .then(function (r) { return r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null; })
      .then(function (j) { return (j && typeof j.build === 'string') ? j.build : null; })
      .catch(function () { return null; });   // offline: try again next time
  }
  function check() {
    if (checking || !loadedBuild) return;
    checking = true;
    liveBuild().then(function (build) {
      checking = false;
      if (!build || build === loadedBuild) return;
      try {
        if (sessionStorage.getItem(RELOADED_KEY) === build) return;
        sessionStorage.setItem(RELOADED_KEY, build);
      } catch (e) { return; }   // can't remember having reloaded: don't risk a loop
      location.reload();
    });
  }

  function baseline() { liveBuild().then(function (build) { loadedBuild = build; }); }
  if (document.readyState === 'complete') baseline();
  else window.addEventListener('load', baseline);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) check();
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) check(); });
})();
