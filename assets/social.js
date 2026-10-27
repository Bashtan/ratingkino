/* ═══════════════════════════════════════════════════════════════════════════
   Social links + mascot — SHARED by / (Classic) and /cinematic/.
   Styles and markup notes: /assets/social.css.

   - Every brand link (a[data-ffs]) reports a GA `social_click` with its
     network and its placement (the nearest [data-ffs-place]).
   - window.FFBot: the mascot's moods during AI searches (see Moods below).
   - The corner mascot (#ffm, computers only) comes up once the hero strip
     ([data-ffm-after]) has scrolled out of view above, and goes back down
     while the footer band (.ffs-band, which has its own mascot) is on screen.
     Hover, focus or a click opens its bubble; its close button hides it for
     good in this browser (localStorage ff_mascot_off).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var OFF_KEY = 'ff_mascot_off';

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-ffs]') : null;
    if (!a || typeof window.gtag !== 'function') return;
    var place = a.closest('[data-ffs-place]');
    window.gtag('event', 'social_click', { network: a.getAttribute('data-ffs'), placement: place ? place.getAttribute('data-ffs-place') : '' });
  });

  /* ── Moods (window.FFBot): the mascot reacts to the AI ──────────────────
     FFBot.set('think' | 'idea' | 'success' | 'confused' | 'idle') paints every
     [data-ffb] host, and #ffm (the corner mascot shows more of itself while
     it has a mood). FFBot.found(hasSuggestions) plays the happy ending:
     idea → success → idle, with an idea nudge first when hasSuggestions()
     says the page is offering refinements. The sprite loads on first intent
     (a search field focused, or the first mood); a mood asked for before it
     has arrived waits for it, so a layer is never shown blank — and if it
     can't load, the mascot just stays in its standing pose. Styles: .ffb in
     social.css. The pages call it as window.FFBot?.… (this file is deferred). */
  var MOODS = ['think', 'idea', 'success', 'confused'];
  var SPRITE = '/assets/ff-bot-moods.webp?v=1b892b12';   // = the url() in social.css
  var mood = 'idle', timers = [], sprite = 0, waiting = [];   // sprite: 0 not asked · 1 loading · 2 ready · 3 failed

  function mount(host) {
    if (host.querySelector('.ffb-m')) return;
    MOODS.forEach(function (name) {
      var layer = document.createElement('i');
      layer.className = 'ffb-m';
      layer.setAttribute('data-m', name);
      host.appendChild(layer);
    });
  }
  function paint(name) {
    document.querySelectorAll('[data-ffb]').forEach(function (host) { mount(host); host.setAttribute('data-mood', name); });
    var corner = document.getElementById('ffm');
    if (corner) corner.setAttribute('data-mood', name);
  }
  function warm(then) {
    if (sprite >= 2) { if (then && sprite === 2) then(); return; }
    if (then) waiting.push(then);
    if (sprite === 1) return;
    sprite = 1;
    var img = new Image();
    img.onload = function () {
      sprite = 2;
      document.documentElement.classList.add('ffb-on');
      var queue = waiting; waiting = [];
      queue.forEach(function (fn) { fn(); });
    };
    img.onerror = function () { sprite = 3; waiting = []; };
    img.src = SPRITE;
  }
  function show(name) {
    mood = name;
    if (name === 'idle' || sprite === 2) paint(name);
    else warm(function () { if (mood === name) paint(name); });
  }
  function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function set(name) {
    timers.forEach(clearTimeout); timers = [];
    if (name === 'idle' || MOODS.indexOf(name) >= 0) show(name);
  }
  function found(hasSuggestions) {
    set('idea');
    later(450, function () {
      show('success');
      later(2400, function () {
        if (!(typeof hasSuggestions === 'function' ? hasSuggestions() : hasSuggestions)) { show('idle'); return; }
        show('idea');
        later(1400, function () { show('idle'); });
      });
    });
  }
  window.FFBot = { set: set, found: found, warm: function () { warm(); }, mood: function () { return mood; } };
  document.querySelectorAll('[data-ffb]').forEach(mount);
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.matches && el.matches('input[type="search"], input[type="text"], textarea')) warm();
  });

  var m = document.getElementById('ffm');
  if (!m) return;
  try { if (localStorage.getItem(OFF_KEY) === '1') { m.remove(); return; } } catch (e) { /* storage blocked: show it */ }

  var bot = m.querySelector('.ffm-bot');
  var closeBtn = m.querySelector('.ffm-close');
  var desk = window.matchMedia('(min-width: 1024px) and (hover: hover)');
  var pastHero = false, bandOnScreen = false;

  function setOpen(open) {
    m.classList.toggle('is-open', open);
    if (bot) bot.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function sync() {
    var show = desk.matches && pastHero && !bandOnScreen;
    m.classList.toggle('is-in', show);
    if (!show) {
      setOpen(false);
      if (m.contains(document.activeElement)) document.activeElement.blur();
    }
  }

  if ('IntersectionObserver' in window) {
    var hero = document.querySelector('[data-ffm-after]');
    if (hero) {
      new IntersectionObserver(function (entries) {
        var en = entries[0];
        pastHero = !en.isIntersecting && en.boundingClientRect.bottom < 0;
        sync();
      }).observe(hero);
    } else {
      pastHero = true;
    }
    var band = document.querySelector('.ffs-band');
    if (band) {
      // Counts once 120px of it is up, so its first sliver doesn't chase the mascot off.
      new IntersectionObserver(function (entries) {
        bandOnScreen = entries[0].isIntersecting;
        sync();
      }, { rootMargin: '0px 0px -120px 0px' }).observe(band);
    }
  }
  if (desk.addEventListener) desk.addEventListener('change', sync);
  sync();

  if (bot) bot.addEventListener('click', function () { setOpen(!m.classList.contains('is-open')); });
  if (closeBtn) closeBtn.addEventListener('click', function () {
    try { localStorage.setItem(OFF_KEY, '1'); } catch (e) { /* hide for this visit only */ }
    setOpen(false);
    m.classList.add('is-gone');
    setTimeout(function () { m.remove(); }, 600);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && m.classList.contains('is-open')) { setOpen(false); if (bot) bot.focus(); }
  });
  document.addEventListener('click', function (e) {
    if (m.classList.contains('is-open') && !m.contains(e.target)) setOpen(false);
  });
})();
