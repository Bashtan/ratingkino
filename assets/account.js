/* ═══════════════════════════════════════
   The signed-in visitor: keeps this browser and the server in step. SHARED by / (Classic) and /cinematic/.

   A guest never touches the network from here. Once someone has signed in, each change is sent a
   few seconds later, and new changes from other devices arrive on load and when the tab comes back.
   The server decides per item, newest change first (functions/_lib/sync.js), so any step can fail
   and simply run again: nothing is marked as sent until the server has answered.

   The first sync sends everything saved here, including a guest's data, and only then is this
   device recorded as the account's (FFStore.meta().owner). Data belonging to another account is
   cleared rather than merged, so two people sharing a device never mix.

   The taste profile (rk_taste_v1, rk_rated_films) has no dates: it travels with its interaction
   count as its time, so the richer profile wins and a new phone can't wipe a long history.

   window.FFAccount: user · ready · adopt · syncNow · signOut · deleteAccount · onChange

   Loaded synchronously in <head>, after store.js and watchlist.js, by both documents as
   ?v=<8-char content hash>. After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/account.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var MAX_ITEMS = 2000, MAX_CHARS = 1200000;       // below the server's limits (SYNC in sync.js)
  var PUSH_ONLY = Number.MAX_SAFE_INTEGER;         // a `since` that asks for nothing back
  var KEEPALIVE_CHARS = 60000;                     // what browsers allow on a closing page
  var SEND_AFTER_MS = 3000, FOCUS_GAP_MS = 60000, RETRY_MS = 30000, RETRY_MAX_MS = 600000;

  var current = null, listeners = [], running = null, runAgain = false;
  var sendTimer = null, retryTimer = null, retryDelay = RETRY_MS, lastRun = 0;

  function emit() { listeners.slice().forEach(function (fn) { try { fn(current); } catch (e) { /* the rest still run */ } }); }

  function json(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  function tasteTotal() {
    var t = json('rk_taste_v1');
    return t && t.total > 0 ? t.total : 0;
  }

  function profileItems(everything) {
    var total = tasteTotal();
    if (!total || (!everything && total <= (FFStore.meta().tasteSent || 0))) return [];
    return [
      { c: 'profile', k: 'taste', v: json('rk_taste_v1'), a: 1, u: total, d: 0 },
      { c: 'profile', k: 'ratedFilms', v: json('rk_rated_films') || [], a: 1, u: total, d: 0 },
    ];
  }

  function applyProfile(rows) {
    var mine = tasteTotal();
    rows.forEach(function (r) {
      if (r.c !== 'profile' || r.u <= mine || r.v === null) return;
      try { localStorage.setItem(r.k === 'taste' ? 'rk_taste_v1' : 'rk_rated_films', JSON.stringify(r.v)); } catch (e) { /* full: the next sync tries again */ }
    });
  }

  function chunks(items) {
    var out = [], part = [], chars = 0;
    items.forEach(function (x) {
      var size = JSON.stringify(x).length;
      if (part.length && (part.length === MAX_ITEMS || chars + size > MAX_CHARS)) { out.push(part); part = []; chars = 0; }
      part.push(x);
      chars += size;
    });
    if (part.length) out.push(part);
    return out;
  }

  function post(body, keepalive) {
    return fetch('/api/me/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', keepalive: !!keepalive, body: JSON.stringify(body) })
      .then(function (r) {
        if (r.status === 401) { var e = new Error('signed out'); e.signedOut = true; throw e; }
        if (!r.ok) throw new Error('sync ' + r.status);
        return r.json();
      });
  }

  function exchange(user) {
    var first = FFStore.meta().owner !== user.id;
    var parts = chunks(FFStore.outgoing(first).concat(profileItems(first)));
    var last = parts.pop() || [];
    var sentTotal = tasteTotal();

    function sendEarlier(i) {
      if (i === parts.length) return Promise.resolve();
      return post({ since: PUSH_ONLY, items: parts[i] }).then(function () { FFStore.markSent(parts[i]); return sendEarlier(i + 1); });
    }
    function receive(res) {
      FFStore.applyRemote(res.items);
      applyProfile(res.items);
      FFStore.setMeta({ cursor: res.cursor });
      if (res.more) return post({ since: res.cursor, items: [] }).then(receive);
    }
    return sendEarlier(0)
      .then(function () { return post({ since: first ? 0 : FFStore.meta().cursor || 0, items: last }); })
      .then(function (res) { FFStore.markSent(last); return receive(res); })
      .then(function () { FFStore.setMeta({ owner: user.id, tasteSent: Math.max(sentTotal, tasteTotal()) }); });
  }

  // Only one tab talks to the server at a time. Another tab already at it is as good as done.
  function withLock(work) {
    if (!(window.navigator && navigator.locks)) return work();
    return navigator.locks.request('ff-sync', { ifAvailable: true }, function (lock) { return lock ? work() : undefined; });
  }

  function endSession() {
    current = null;
    FFStore.setMeta({ signedIn: false });
    emit();
  }

  // → true when this device and the server are in step.
  function run() {
    if (!current) return Promise.resolve(false);
    if (running) { runAgain = true; return running; }
    clearTimeout(retryTimer);
    lastRun = Date.now();
    var user = current;
    running = Promise.resolve().then(function () { return withLock(function () { return exchange(user); }); }).then(function () {
      retryDelay = RETRY_MS;
      return true;
    }, function (e) {
      if (e && e.signedOut) { endSession(); return false; }
      retryTimer = setTimeout(run, retryDelay);
      retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      return false;
    }).then(function (ok) {
      running = null;
      if (runAgain) { runAgain = false; schedule(); }
      return ok;
    });
    return running;
  }

  function schedule() {
    if (!current) return;
    clearTimeout(sendTimer);
    sendTimer = setTimeout(run, SEND_AFTER_MS);
  }

  // The page is going away: send what's small enough to survive it. If it doesn't, nothing is
  // marked as sent, so the next visit sends it again.
  function flush() {
    if (FFStore.meta().owner !== (current && current.id)) return;
    var items = FFStore.outgoing(false);
    if (!items.length || JSON.stringify(items).length > KEEPALIVE_CHARS) return;
    post({ since: PUSH_ONLY, items: items }, true).then(function () { FFStore.markSent(items); }, function () {});
  }

  function checkSession() {
    if (!FFStore.meta().signedIn) return Promise.resolve();
    return fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.user) { endSession(); return; }
      current = d.user;
      emit();
      return run();
    }, function () { /* offline: this device carries on, and 'online' checks again */ });
  }

  // After a successful sign-in (Stage 4 calls this with the route's { user }).
  function adopt(user) {
    var owner = FFStore.meta().owner;
    if (owner && owner !== user.id) FFStore.clearAll();
    FFStore.setMeta({ signedIn: true });
    current = user;
    emit();
    return run();
  }

  function wipe() {
    clearTimeout(sendTimer);
    clearTimeout(retryTimer);
    current = null;
    FFStore.clearAll();
    emit();
  }

  // Sends what's unsent, then clears this device. false: it couldn't be sent, and force wasn't given.
  function signOut(options) {
    if (!current) return Promise.resolve(true);
    return run().then(function (ok) {
      if (!ok && !(options && options.force)) return false;
      return fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {}).then(function () {
        wipe();
        return true;
      });
    });
  }

  function deleteAccount() {
    return fetch('/api/me', { method: 'DELETE', credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return false;
      wipe();
      return true;
    }, function () { return false; });
  }

  FFStore.onLocalChange(schedule);
  window.addEventListener('online', function () { if (current) run(); else checkSession(); });
  document.addEventListener('visibilitychange', function () {
    if (!current) return;
    if (document.visibilityState === 'hidden') flush();
    else if (Date.now() - lastRun > FOCUS_GAP_MS) run();
  });

  window.FFAccount = {
    user: function () { return current; },
    ready: checkSession(),
    adopt: adopt,
    syncNow: run,
    signOut: signOut,
    deleteAccount: deleteAccount,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
