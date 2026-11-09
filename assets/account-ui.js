/* ═══════════════════════════════════════
   Sign-in, the save-and-sync prompts and the account sheet — SHARED by / (Classic) and /cinematic/.
   The engine underneath is assets/account.js.

   Nobody is asked to sign in up front. It's offered where it's worth something: a strip in the
   watchlist, and one note after the 5th saved film. Google's script loads only when the sheet
   opens, so a visitor who never signs in never contacts Google.

   PUBLIC is the off switch: false hides all of this again, and then ?auth=1 turns it on for one
   browser (?auth=0 off), for testing.

   window.FFAccountUI: setup({ t, host, lang }) · relabel · enabled
     host: the element the strip is drawn in. lang(): the page's language code.

   Loaded synchronously in <head>, after account.js, by both documents as ?v=<8-char content hash>.
   After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/account-ui.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var PUBLIC = true;
  var FLAG_KEY = 'ff_flag_auth', NUDGED_KEY = 'ff_acct_nudged', NUDGE_AT = 5, NOTE_MS = 12000;
  var t, host, lang, sheet = null, opener = null, resumeAfter = null, gis = null, note = null;

  (function readFlag() {
    var m = /[?&]auth=([01])/.exec(location.search);
    if (!m) return;
    try { if (m[1] === '1') localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch (e) { /* storage blocked */ }
    var url = new URL(location.href);
    url.searchParams.delete('auth');
    history.replaceState(history.state, '', url);
  })();

  // ratingkino.com keeps its own browser storage, so the server refuses sign-in there. Hidden rather than broken.
  var OLD_DOMAIN = /(^|\.)ratingkino\.com$/.test(location.hostname);

  function enabled() {
    if (OLD_DOMAIN) return false;
    if (PUBLIC || FFAccount.user() || FFStore.meta().signedIn) return true;
    try { return localStorage.getItem(FLAG_KEY) === '1'; } catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ── The strip in the watchlist ── */
  function paint() {
    document.querySelectorAll('[data-ffa-link]').forEach(function (el) { el.hidden = !enabled(); });
    if (!host) return;
    if (!enabled()) { host.innerHTML = ''; return; }
    var user = FFAccount.user();
    host.innerHTML = user
      ? '<div class="ffa-strip"><span class="ffa-avatar" aria-hidden="true">' + esc((user.name || user.email || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div class="ffa-strip-text"><strong>' + esc(user.name || user.email) + '</strong><span>' + esc(t('acct.synced')) + '</span></div>' +
        '<button class="ffa-link" type="button" data-ffa="account">' + esc(t('acct.account')) + '</button></div>'
      : '<div class="ffa-strip"><div class="ffa-strip-text"><strong>' + esc(t('acct.stripTitle')) + '</strong><span>' + esc(t('acct.stripSub')) + '</span></div>' +
        '<button class="ffa-btn" type="button" data-ffa="signin">' + esc(t('acct.save')) + '</button></div>';
  }

  /* ── The sheet ── */
  function buildSheet() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'ffa-back';
    sheet.hidden = true;
    sheet.innerHTML = '<div class="ffa-sheet" role="dialog" aria-modal="true" aria-labelledby="ffaTitle"><button class="ffa-x" type="button" data-ffa="close" aria-label="' + esc(t('results.close')) + '">✕</button><div class="ffa-content"></div></div>';
    document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
  }

  function show(html) {
    buildSheet();
    sheet.querySelector('.ffa-content').innerHTML = html;
    if (sheet.hidden) {
      sheet.hidden = false;
      document.documentElement.classList.add('ffa-open');
      opener = document.activeElement;
    }
    var first = sheet.querySelector('.ffa-content button, .ffa-x');
    if (first) first.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    document.documentElement.classList.remove('ffa-open');
    resumeAfter = null;
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  }

  function status(text) {
    var el = sheet && sheet.querySelector('.ffa-status');
    if (el) el.textContent = text;
  }

  function loadGoogle() {
    if (gis) return gis;
    gis = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = resolve;
      s.onerror = function () { gis = null; reject(new Error('google')); };
      document.head.appendChild(s);
    });
    return gis;
  }

  // A nonce ties the token to this browser and works once, so every attempt gets a new one.
  function drawGoogleButton() {
    var slot = sheet.querySelector('.ffa-google');
    if (!slot) return;
    Promise.all([loadGoogle(), fetch('/api/auth/nonce', { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('nonce'); return r.json(); })]).then(function (r) {
      if (!sheet.querySelector('.ffa-google')) return;
      google.accounts.id.initialize({ client_id: r[1].google, nonce: r[1].nonce, callback: gotCredential, ux_mode: 'popup', auto_select: false, itp_support: true });
      slot.innerHTML = '';
      google.accounts.id.renderButton(slot, { type: 'standard', theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center', width: Math.min(320, slot.clientWidth || 320), locale: lang() });
    }).catch(function () { status(t('acct.noGoogle')); });
  }

  function gotCredential(response) {
    status(t('acct.signingIn'));
    var resume = resumeAfter;
    fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ credential: response.credential }) })
      .then(function (r) {
        if (r.ok) return r.json();
        var e = new Error('sign-in'); e.status = r.status; throw e;
      })
      .then(function (d) { return FFAccount.adopt(d.user); })
      .then(function () {
        closeSheet();
        toast(t('acct.signedIn'));
        if (resume) resume();
      })
      .catch(function (e) {
        status(t(e.status === 429 ? 'acct.tooMany' : 'acct.failed'));
        drawGoogleButton();
      });
  }

  function openSignIn(resume) {
    hideNote();
    resumeAfter = resume || null;
    show('<h2 id="ffaTitle" class="ffa-title">' + esc(t('acct.sheetTitle')) + '</h2>' +
      '<p class="ffa-sub">' + esc(t('acct.sheetSub')) + '</p>' +
      '<div class="ffa-google"></div>' +
      '<p class="ffa-status" role="status"></p>' +
      '<p class="ffa-small">' + esc(t('acct.small')) + ' <a href="/privacy/" target="_blank" rel="noopener">' + esc(t('acct.privacy')) + '</a></p>');
    drawGoogleButton();
  }

  function openAccount() {
    var user = FFAccount.user();
    if (!user) return;
    show('<h2 id="ffaTitle" class="ffa-title">' + esc(user.name || t('acct.account')) + '</h2>' +
      (user.email ? '<p class="ffa-sub">' + esc(user.email) + '</p>' : '') +
      '<div class="ffa-actions">' +
        '<button class="ffa-btn ffa-wide" type="button" data-ffa="signout">' + esc(t('acct.signOut')) + '</button>' +
        '<button class="ffa-quiet ffa-wide" type="button" data-ffa="ask-delete">' + esc(t('acct.delete')) + '</button>' +
      '</div>' +
      '<p class="ffa-status" role="status"></p>' +
      '<p class="ffa-small"><a href="/privacy/" target="_blank" rel="noopener">' + esc(t('acct.privacy')) + '</a></p>');
  }

  function signOut(force) {
    FFAccount.signOut(force ? { force: true } : undefined).then(function (done) {
      if (done) { closeSheet(); toast(t('acct.signedOut')); return; }
      show('<h2 id="ffaTitle" class="ffa-title">' + esc(t('acct.signOut')) + '</h2><p class="ffa-sub">' + esc(t('acct.offlineOut')) + '</p>' +
        '<div class="ffa-actions"><button class="ffa-danger ffa-wide" type="button" data-ffa="signout-force">' + esc(t('acct.signOutAnyway')) + '</button>' +
        '<button class="ffa-quiet ffa-wide" type="button" data-ffa="account">' + esc(t('acct.cancel')) + '</button></div>');
    });
  }

  function askDelete() {
    show('<h2 id="ffaTitle" class="ffa-title">' + esc(t('acct.deleteTitle')) + '</h2><p class="ffa-sub">' + esc(t('acct.deleteSub')) + '</p>' +
      '<div class="ffa-actions"><button class="ffa-quiet ffa-wide" type="button" data-ffa="account">' + esc(t('acct.cancel')) + '</button>' +
      '<button class="ffa-danger ffa-wide" type="button" data-ffa="delete">' + esc(t('acct.delete')) + '</button></div>' +
      '<p class="ffa-status" role="status"></p>');
  }

  function deleteAccount() {
    FFAccount.deleteAccount().then(function (done) {
      if (done) { closeSheet(); toast(t('acct.deleted')); } else status(t('acct.failed'));
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-ffa]') : null;
    if (!el) return;
    var action = el.getAttribute('data-ffa');
    if (action === 'signin') openSignIn();
    else if (action === 'account') openAccount();
    else if (action === 'close') closeSheet();
    else if (action === 'signout') signOut(false);
    else if (action === 'signout-force') signOut(true);
    else if (action === 'ask-delete') askDelete();
    else if (action === 'delete') deleteAccount();
    else if (action === 'nudge-yes') openSignIn();
    else if (action === 'nudge-no') hideNote();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  /* ── Small messages ── */
  function hideNote() {
    if (note) { note.remove(); note = null; }
  }
  function placeNote(html) {
    hideNote();
    note = document.createElement('div');
    note.className = 'ffa-note';
    note.setAttribute('role', 'status');
    note.innerHTML = html;
    document.body.appendChild(note);
    var el = note;
    setTimeout(function () { if (note === el) hideNote(); }, NOTE_MS);
  }
  function toast(text) { placeNote('<span>' + esc(text) + '</span>'); }

  // Once, after the 5th saved film.
  function maybeNudge() {
    if (!enabled() || FFAccount.user() || FFStore.meta().signedIn || FFWatchlist.count() < NUDGE_AT) return;
    try {
      if (localStorage.getItem(NUDGED_KEY)) return;
      localStorage.setItem(NUDGED_KEY, '1');
    } catch (e) { return; }
    placeNote('<span>' + esc(t('acct.nudge', { n: FFWatchlist.count() })) + '</span>' +
      '<button class="ffa-btn" type="button" data-ffa="nudge-yes">' + esc(t('acct.save')) + '</button>' +
      '<button class="ffa-x-small" type="button" data-ffa="nudge-no" aria-label="' + esc(t('results.close')) + '">✕</button>');
  }

  window.FFAccountUI = {
    enabled: enabled,
    relabel: paint,
    setup: function (options) {
      t = options.t;
      host = options.host;
      lang = options.lang;
      paint();
      FFAccount.onChange(paint);
      FFWatchlist.onChange(maybeNudge);
    },
  };
})();
