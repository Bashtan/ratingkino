/* ═══════════════════════════════════════════════════════════════════════════
   Social links + mascot — SHARED by / (Classic) and /cinematic/.
   Styles and markup notes: /assets/social.css.

   - Every brand link (a[data-ffs]) reports a GA `social_click` with its
     network and its placement (the nearest [data-ffs-place]).
   - window.FFBot: the mascot's moods during AI searches (see Moods below),
     and FFBot.welcome(): a first visit's tip pointing at the AI search.
   - Classic's hero mascot (#ffh) and the one peeking over "Your Taste DNA"
     (.ffp), computers only: see their sections below.
   - The corner mascot (#ffm, computers only) comes up once the hero strip
     ([data-ffm-after]) has scrolled out of view above, and goes back down
     while the footer band (.ffs-band, which has its own mascot) is on screen.
     Hover, focus or a click opens its bubble; its close button hides it for
     good in this browser (localStorage ff_mascot_off). Five quick clicks: a
     spin (the easter egg, below).
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
  /* ── Welcome tip (FFBot.welcome): a first visit only ───────────────────
     A speech bubble from the mascot, under the AI search, once per browser
     (localStorage ff_welcome_seen). The page calls FFBot.welcome(target, onTry)
     when it knows this is a first visit; the tip then waits (up to
     WELCOME_WAIT_MS) until the target is on screen and nothing covers it — the
     first-visit intro, the taste quiz. It goes on ×, Escape, "Try it" (runs
     onTry, else focuses the target's field), as soon as the search is used, once
     the page scrolls, or after WELCOME_SHOW_MS. Strings: mascot.welcome / mascot.try / results.close
     in /assets/i18n.js. Styles: .ffw in social.css. */
  var WELCOME_KEY = 'ff_welcome_seen', WELCOME_WAIT_MS = 90000, WELCOME_SHOW_MS = 15000;
  var welcoming = false, welcomed = false;   // a tip waiting or up · shown on this page view (for hello below)
  function say(key) {
    var all = window.FF_I18N || {}, lang;
    try { lang = localStorage.getItem('rk_lang'); } catch (e) { /* storage blocked */ }
    lang = lang || document.documentElement.lang || 'en';
    return (all[lang] && all[lang][key]) || (all.en && all.en[key]) || '';
  }
  function uncovered(el) {
    var b = el.getBoundingClientRect();
    if (!b.width || b.top < 0 || b.bottom > window.innerHeight) return false;
    var hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }
  function welcome(target, onTry) {
    if (!target) return;
    try { if (localStorage.getItem(WELCOME_KEY)) return; } catch (e) { return; }   // can't remember it: don't show it every visit
    var since = Date.now();
    welcoming = true;
    (function wait() {
      if (Date.now() - since > WELCOME_WAIT_MS) { welcoming = false; return; }
      if (document.visibilityState === 'visible' && uncovered(target)) showWelcome(target, onTry);
      else setTimeout(wait, 500);
    })();
  }
  function showWelcome(target, onTry) {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) { /* shown this once anyway */ }
    welcomed = true;
    var tip = document.createElement('div');
    tip.className = 'ffw';
    tip.setAttribute('role', 'status');
    tip.innerHTML = '<span class="ffb ffw-bot" aria-hidden="true"><img class="ffb-idle" src="/assets/ff-bot.webp" alt="" width="35" height="60"></span>'
      + '<p class="ffw-text"></p><button class="ffw-try" type="button"></button>'
      + '<button class="ffw-close" type="button"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
    tip.querySelector('.ffw-text').textContent = say('mascot.welcome');
    tip.querySelector('.ffw-try').textContent = say('mascot.try');
    tip.querySelector('.ffw-close').setAttribute('aria-label', say('results.close'));
    document.body.appendChild(tip);

    // Below the target, the tail pointing at where you type (its start edge).
    function place() {
      var b = target.getBoundingClientRect(), w = tip.offsetWidth;
      var vw = document.documentElement.clientWidth;
      var rtl = getComputedStyle(target).direction === 'rtl';
      var at = rtl ? Math.max(b.right - 56, b.left + 24) : Math.min(b.left + 56, b.right - 24);
      var left = Math.min(Math.max(rtl ? at + 40 - w : at - 40, 16), vw - w - 16);
      tip.style.left = Math.round(left + window.scrollX) + 'px';
      tip.style.top = Math.round(b.bottom + window.scrollY + 14) + 'px';
      tip.style.setProperty('--ffw-tail', Math.round(at - left) + 'px');
    }
    place();
    requestAnimationFrame(function () { tip.classList.add('is-in'); });
    // It holds up the "idea" pose (finger up, bulb on) once the mood sprite is in.
    var bot = tip.querySelector('.ffw-bot');
    warm(function () {
      var layer = document.createElement('i');
      layer.className = 'ffb-m';
      layer.setAttribute('data-m', 'idea');
      bot.appendChild(layer);
      bot.setAttribute('data-mood', 'idea');
    });

    var ro = 'ResizeObserver' in window ? new ResizeObserver(place) : null;   // the page grows above it as images load
    if (ro) ro.observe(document.body);
    var timer = setTimeout(hide, WELCOME_SHOW_MS);
    var fromY = window.scrollY;
    function onKey(e) { if (e.key === 'Escape') hide(); }
    function onScroll() { if (Math.abs(window.scrollY - fromY) > 120) hide(); }   // moved on: and sticky bars must not slide under it
    function hide() {
      if (!tip.parentNode || tip.classList.contains('is-out')) return;
      clearTimeout(timer);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      target.removeEventListener('focusin', hide);
      welcoming = false;
      tip.classList.remove('is-in');
      tip.classList.add('is-out');
      setTimeout(function () { tip.remove(); }, 300);
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKey);
    target.addEventListener('focusin', hide);          // they found the search on their own
    tip.querySelector('.ffw-close').addEventListener('click', hide);
    tip.querySelector('.ffw-try').addEventListener('click', function () {
      hide();
      if (onTry) onTry();
      else { var field = target.querySelector('input, textarea'); if (field) field.focus(); }
    });
  }

  window.FFBot = { set: set, found: found, warm: function (then) { warm(then); }, welcome: welcome, mood: function () { return mood; } };
  document.querySelectorAll('[data-ffb]').forEach(mount);
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.matches && el.matches('input[type="search"], input[type="text"], textarea')) warm();
  });

  function track(placement) {
    if (typeof window.gtag === 'function') window.gtag('event', 'mascot_click', { placement: placement });
  }

  /* ── Hero mascot (#ffh, Classic, computers ≥1200px) ────────────────────
     Beside the search. It fades in once the sprite is in (.is-ready); hover
     and focus make it wave and talk (CSS), and so does a first visit's
     welcome tip, minus its bubble. On its own it says hello once per browser
     (.is-hi for HELLO_SHOW_MS, localStorage ff_hello_seen): once it's on
     screen and uncovered, and never on a page view that had the welcome tip,
     so a visit gets one greeting (a first visit's is the tip; the hello comes
     on the next). If the search is already in use it needn't say it at all.
     Its click (the page's onclick) opens the AI search: mascot_click hero.
     Strings: mascot.hello in /assets/i18n.js. Styles: .ffh in social.css. */
  var HELLO_KEY = 'ff_hello_seen', HELLO_SHOW_MS = 6000;
  var heroBot = document.getElementById('ffh');
  var heroDesk = window.matchMedia('(min-width: 1200px) and (hover: hover)');
  function heroUp() {
    if (heroDesk.matches && !heroBot.classList.contains('is-ready')) warm(function () { heroBot.classList.add('is-ready'); hello(); });
  }
  function hello() {
    try { if (localStorage.getItem(HELLO_KEY)) return; } catch (e) { return; }
    var since = Date.now(), field = heroBot.parentNode.querySelector('input');
    (function wait() {
      if (welcomed || Date.now() - since > WELCOME_WAIT_MS) return;   // greeted already, or try again next visit
      if (field && (field.value || document.activeElement === field)) { sayHello(false); return; }
      if (!welcoming && heroDesk.matches && document.visibilityState === 'visible' && uncovered(heroBot)) sayHello(true);
      else setTimeout(wait, 500);
    })();
  }
  function sayHello(out) {
    try { localStorage.setItem(HELLO_KEY, '1'); } catch (e) { /* once on this page anyway */ }
    if (!out) return;
    var timer = setTimeout(bye, HELLO_SHOW_MS);
    function bye() {
      clearTimeout(timer);
      heroBot.classList.remove('is-hi');
      heroBot.parentNode.removeEventListener('focusin', bye);
    }
    heroBot.classList.add('is-hi');
    heroBot.parentNode.addEventListener('focusin', bye);   // the search took over (or the mascot's own click)
  }
  if (heroBot) {
    heroBot.addEventListener('click', function () { track('hero'); });
    if (heroDesk.addEventListener) heroDesk.addEventListener('change', heroUp);
    heroUp();
  }

  /* ── Peeking mascot (.ffp, Classic's "Your Taste DNA" button) ──────────
     It rises over its button the first time the button is on screen on a
     computer (.is-in, once the sprite is in), hopping twice the first time
     it's actually up (.is-hop). It ducks while its row (data-ffp-edge) slides
     under the sticky bar (data-ffp-under), which it would otherwise be drawn
     over. Its click opens Taste DNA (the button's): mascot_click dna. */
  var desk = window.matchMedia('(min-width: 1024px) and (hover: hover)');
  document.querySelectorAll('.ffp').forEach(function (p) {
    var bar = document.querySelector(p.getAttribute('data-ffp-under'));
    var edge = document.querySelector(p.getAttribute('data-ffp-edge'));
    var frame = 0, hopped = false;
    function duck() {
      frame = 0;
      var under = !!bar && !!edge && edge.getBoundingClientRect().top < bar.getBoundingClientRect().bottom - 1;
      p.classList.toggle('is-ducked', under);
      if (!under && !hopped) { hopped = true; p.classList.add('is-hop'); }
    }
    function soon() { if (!frame && p.classList.contains('is-in')) frame = requestAnimationFrame(duck); }
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    p.querySelector('.ffp-bot').addEventListener('click', function () { track('dna'); });
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting || !desk.matches) return;
      io.disconnect();
      warm(function () { p.classList.add('is-in'); duck(); });
    });
    io.observe(p.parentNode);
  });

  var m = document.getElementById('ffm');
  if (!m) return;
  try { if (localStorage.getItem(OFF_KEY) === '1') { m.remove(); return; } } catch (e) { /* storage blocked: show it */ }

  var bot = m.querySelector('.ffm-bot');
  var closeBtn = m.querySelector('.ffm-close');
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

  /* Easter egg: five quick clicks (each within EGG_GAP_MS of the last) and the
     mascot crouches, jumps with a full spin and lands — cheering (the success
     pose) if it wasn't busy with a search. Only the first click of a run
     toggles the bubble, so the run doesn't flicker it; the spin hides it.
     Styles: .ffm.is-egg in social.css (reduced motion: the pose only). */
  var EGG_CLICKS = 5, EGG_GAP_MS = 500, EGG_MS = 1600;
  var streak = 0, lastClick = 0, egging = false;
  function egg() {
    egging = true;
    setOpen(false);
    m.classList.add('is-egg');
    var cheer = mood === 'idle';
    if (cheer) set('success');
    if (typeof window.gtag === 'function') window.gtag('event', 'mascot_egg');
    setTimeout(function () {
      m.classList.remove('is-egg');
      egging = false;
      if (cheer && mood === 'success') set('idle');
    }, EGG_MS);
  }
  if (bot) bot.addEventListener('click', function () {
    if (egging) return;
    var now = Date.now();
    streak = now - lastClick <= EGG_GAP_MS ? streak + 1 : 1;
    lastClick = now;
    if (streak === 1) setOpen(!m.classList.contains('is-open'));
    if (streak === 3) warm();                       // the cheer's pose, ready in time
    if (streak >= EGG_CLICKS) { streak = 0; egg(); }
  });
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
