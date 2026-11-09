/* ═══════════════════════════════════════════════════════════════════════════
   Social links + mascot — SHARED by / (Classic) and /cinematic/.
   Styles and markup notes: /assets/social.css.

   - window.FFBot: the mascot's moods during AI searches (see Moods below),
     FFBot.welcome(): a first visit's tip pointing at the AI search, and
     FFBot.watch(): the mascot reacting to a trailer as it plays.
   - Classic's mascot peeking over "Your Taste DNA" (.ffp), computers only:
     see its section below.
   - The corner mascot (#ffm, computers only) comes up once the search area
     ([data-ffm-after]) has scrolled out of view above, and goes back down
     while the footer band (.ffs-band, which has its own mascot) is on screen.
     Hover, focus or a click opens its bubble; its close button hides it for
     good in this browser (localStorage ff_mascot_off). Five quick clicks: a
     spin (the easter egg, below).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var OFF_KEY = 'ff_mascot_off';

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
  var welcoming = false;   // a tip waiting or up
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

  /* ── Trailer reactions (FFBot.watch): FF Bot watches a trailer with you ──
     FFBot.watch(iframe, { genres: [TMDB genre ids], seed: video key,
     film: 'movie:<id>' | 'tv:<id>' }) puts a
     reacting mascot (.trb, styles in social.css) in the bottom-left corner of
     a YouTube embed, whose src needs enablejsapi=1 (and origin=). The page
     follows the player over YouTube's postMessage protocol (what the IFrame
     Player API speaks, without loading it): it says "listening" until the
     player answers, and the player then reports its state and time
     (infoDelivery). The bot rises in once playback starts, so a player that
     never answers never shows a bot that can't react; it ducks out of the
     way while paused and after its cheer at the end, and is removed once the
     iframe leaves the page or loads something else.
     Reactions: watch, curious, tense, wow, hyped, laughing, shocked, teary,
     the same names the TikTok/Shorts bot uses (findfilm-tiktok-bot,
     bot-moods.py). Each wears a pose (RX): the calm ones the search moods'
     poses, the others their own, from ff-bot-reactions.webp (REACTIONS),
     fetched once a trailer bot exists (html.ffr-on). Until it's in, or if it
     can't load, a reaction wears today's stand-in (STAND_IN). tense has no
     pose of its own yet: it wears think. Where reactions fall comes from an
     arc, [share of the trailer, reaction] beats: the film's own (filmArc),
     which the 70B writes nightly for the Trending and Top Rated titles from
     their story and tone (sync-worker.js, /api/rx/<type>/<id>), else the one
     for its kind of film (ARCS, picked by genre, nudged per video so no two
     trailers match beat for beat). The bot's data-arc says which: film or
     genre. Neither is timed to the trailer's actual cuts. */
  var RX = { watch: 'idle', curious: 'think', tense: 'think', wow: 'idea', hyped: 'hyped', laughing: 'laughing', shocked: 'shocked', teary: 'teary' };
  var REACTIONS = ['shocked', 'laughing', 'teary', 'hyped'];
  var STAND_IN = { shocked: 'confused', laughing: 'success', teary: 'confused', hyped: 'success' };
  var RX_SPRITE = '/assets/ff-bot-reactions.webp?v=5d7e7399';   // = the url() in social.css
  var rxSprite = 0, rxWaiting = [];   // as sprite: 0 not asked · 1 loading · 2 ready · 3 failed
  // A trailer's usual shape: logos, setup, the hook, rising stakes, the montage, the title card, a last sting.
  var ARCS = {
    horror:  [[0, 'watch'], [0.08, 'curious'], [0.22, 'tense'], [0.36, 'shocked'], [0.42, 'tense'], [0.6, 'curious'], [0.68, 'tense'], [0.8, 'shocked'], [0.86, 'tense'], [0.94, 'shocked']],
    tension: [[0, 'watch'], [0.1, 'curious'], [0.28, 'tense'], [0.44, 'wow'], [0.52, 'tense'], [0.7, 'shocked'], [0.78, 'tense'], [0.9, 'wow']],
    action:  [[0, 'watch'], [0.1, 'curious'], [0.24, 'wow'], [0.36, 'tense'], [0.5, 'hyped'], [0.66, 'wow'], [0.74, 'hyped'], [0.9, 'hyped']],
    comedy:  [[0, 'watch'], [0.12, 'laughing'], [0.2, 'watch'], [0.32, 'laughing'], [0.42, 'wow'], [0.52, 'laughing'], [0.64, 'watch'], [0.72, 'laughing'], [0.88, 'laughing']],
    heart:   [[0, 'watch'], [0.12, 'curious'], [0.3, 'wow'], [0.44, 'teary'], [0.58, 'tense'], [0.72, 'teary'], [0.84, 'wow'], [0.94, 'watch']],
    real:    [[0, 'watch'], [0.14, 'curious'], [0.34, 'wow'], [0.5, 'curious'], [0.68, 'wow'], [0.86, 'curious']]
  };
  var KIND_OF = {   // TMDB genre ids, movies and TV
    27: 'horror', 53: 'tension', 9648: 'tension', 80: 'tension',
    28: 'action', 12: 'action', 878: 'action', 14: 'action', 10752: 'action', 37: 'action', 10759: 'action', 10765: 'action', 10768: 'action',
    35: 'comedy', 16: 'comedy', 10751: 'comedy', 10762: 'comedy',
    18: 'heart', 10749: 'heart', 10402: 'heart', 10766: 'heart',
    99: 'real', 36: 'real', 10763: 'real', 10764: 'real'
  };
  var SIGNATURE = { horror: 'shocked', tension: 'tense', action: 'hyped', comedy: 'laughing', heart: 'teary', real: 'wow' };
  var YT_ORIGIN = /^https:\/\/www\.youtube(-nocookie)?\.com/;
  var RX_LEAD = 0.15, RX_GUESS_S = 150, RX_CHEER_MS = 4000;   // land a beat just ahead of its moment · a trailer's length until the player says · the cheer at the end
  var watching = [], watchTick = 0, watchIds = 0;

  function arcFor(genres, seed) {
    var kinds = [];
    (genres || []).forEach(function (g) { var k = KIND_OF[g]; if (k && kinds.indexOf(k) < 0) kinds.push(k); });
    var scary = kinds.indexOf('horror');
    if (scary > 0) kinds.unshift(kinds.splice(scary, 1)[0]);   // a scare sets the tone wherever it's listed
    var h = 0, i;
    for (i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    var arc = ARCS[kinds[0] || 'action'].map(function (beat, n) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      return [n ? beat[0] + ((h >>> 16) % 41 - 20) / 1000 : 0, beat[1]];   // ±2%: beats stay in order (they're ≥6% apart)
    });
    if (kinds[1]) {   // an action comedy: the second kind takes the middle beat
      var mid = 1;
      for (i = 1; i < arc.length; i++) if (Math.abs(arc[i][0] - 0.5) < Math.abs(arc[mid][0] - 0.5)) mid = i;
      arc[mid] = [arc[mid][0], SIGNATURE[kinds[1]]];
    }
    return arc;
  }
  // The film's own arc ({ arc } from /api/rx, null for a title without one)
  // replaces the genre's whenever it comes, even mid-trailer.
  function filmArc(w, film) {
    fetch('/api/rx/' + film.replace(':', '/')).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      var arc = d && Array.isArray(d.arc) ? d.arc.filter(function (b) { return Array.isArray(b) && typeof b[0] === 'number' && RX[b[1]]; }) : [];
      if (arc.length < 2) return;
      w.arc = arc;
      w.bot.setAttribute('data-arc', 'film');
      react(w);
    }).catch(function () { /* offline, or no arc: the genre's stays */ });
  }
  function playhead(w) {
    return w.time + (w.state === 1 ? (performance.now() - w.at) / 1000 * w.rate : 0);
  }
  function reactionOf(w) {
    if (w.state === 0) return performance.now() - w.endedAt < RX_CHEER_MS ? 'hyped' : 'watch';
    if (w.state !== 1 && w.state !== 3) return 'watch';   // paused, cued: it waits with you
    var share = (playhead(w) + RX_LEAD) / (w.dur || RX_GUESS_S), rx = 'watch';
    for (var i = 0; i < w.arc.length && w.arc[i][0] <= share; i++) rx = w.arc[i][1];
    return rx;
  }
  function poseOf(rx) {
    var pose = RX[rx];
    if (REACTIONS.indexOf(pose) >= 0 && rxSprite !== 2) pose = STAND_IN[pose];
    return REACTIONS.indexOf(pose) >= 0 || sprite === 2 ? pose : 'idle';   // a layer is never shown blank
  }
  function warmRx(then) {
    if (rxSprite >= 2) { if (rxSprite === 2) then(); return; }
    rxWaiting.push(then);
    if (rxSprite === 1) return;
    rxSprite = 1;
    var img = new Image();
    img.onload = function () {
      rxSprite = 2;
      document.documentElement.classList.add('ffr-on');
      var queue = rxWaiting; rxWaiting = [];
      queue.forEach(function (fn) { fn(); });
    };
    img.onerror = function () { rxSprite = 3; rxWaiting = []; };
    img.src = RX_SPRITE;
  }
  function react(w) {
    var rx = reactionOf(w), pose = poseOf(rx);
    if (w.bot.getAttribute('data-rx') !== rx) w.bot.setAttribute('data-rx', rx);
    if (w.bot.getAttribute('data-mood') !== pose) w.bot.setAttribute('data-mood', pose);
    w.box.classList.toggle('is-up', w.started);
    w.box.classList.toggle('is-away', w.state === 2 || (w.state === 0 && rx === 'watch'));   // YouTube's controls stay up
  }
  function tellPlayer(w, msg) {
    msg.id = w.id; msg.channel = 'widget';
    try { w.frame.contentWindow.postMessage(JSON.stringify(msg), w.origin); } catch (e) { /* mid-navigation */ }
  }
  function setState(w, state) {
    if (state === w.state) return;
    w.time = playhead(w); w.at = performance.now();   // freeze or restart the clock where it is
    if (state === 1) w.started = true;
    if (state === 0) w.endedAt = performance.now();
    w.state = state;
  }
  function watchAll() {
    watching = watching.filter(function (w) {
      if (w.frame.isConnected && w.frame.getAttribute('src') === w.src) return true;
      w.box.remove();
      return false;
    });
    watching.forEach(function (w) {
      if (!w.heard) {
        tellPlayer(w, { event: 'listening' });
        tellPlayer(w, { event: 'command', func: 'addEventListener', args: ['onStateChange'] });
      }
      react(w);
    });
    if (!watching.length) { clearInterval(watchTick); watchTick = 0; }
  }
  window.addEventListener('message', function (e) {
    if (!watching.length || !YT_ORIGIN.test(e.origin)) return;
    var w = null, data, info;
    for (var i = 0; i < watching.length; i++) if (watching[i].frame.contentWindow === e.source) w = watching[i];
    if (!w) return;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (x) { return; }
    if (!data || !data.event) return;
    w.heard = true;
    info = data.info;
    if (data.event === 'onStateChange' && typeof info === 'number') setState(w, info);
    if ((data.event === 'infoDelivery' || data.event === 'initialDelivery') && info) {
      if (info.duration > 0) w.dur = info.duration;
      if (info.playbackRate > 0) w.rate = info.playbackRate;
      if (typeof info.currentTime === 'number') { w.time = info.currentTime; w.at = performance.now(); }
      if (typeof info.playerState === 'number') setState(w, info.playerState);
    }
    react(w);
  });
  function watch(frame, opts) {
    var src = frame && frame.getAttribute('src') || '';
    var origin = (src.match(YT_ORIGIN) || [])[0];
    if (!origin || !frame.parentNode) return;
    opts = opts || {};
    var box = document.createElement('div');
    box.className = 'trb';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="ffb trb-bot" data-rx="watch" data-mood="idle" data-arc="genre"><img class="ffb-idle" src="/assets/ff-bot.webp" alt="" width="186" height="320"></div>';
    var w = { frame: frame, src: src, origin: origin, box: box, bot: box.firstChild, id: ++watchIds,
      arc: arcFor(opts.genres, opts.seed || src), state: -1, time: 0, at: 0, dur: 0, rate: 1, endedAt: 0, heard: false, started: false };
    mount(w.bot);
    REACTIONS.forEach(function (name) {
      var layer = document.createElement('i');
      layer.className = 'ffb-m ffb-r';
      layer.setAttribute('data-m', name);
      w.bot.appendChild(layer);
    });
    frame.parentNode.appendChild(box);
    watching.push(w);
    warm(function () { react(w); });
    warmRx(function () { react(w); });
    if (/^(movie|tv):\d+$/.test(opts.film || '')) filmArc(w, opts.film);
    if (!watchTick) watchTick = setInterval(watchAll, 250);
    watchAll();
  }

  window.FFBot = { set: set, found: found, warm: function (then) { warm(then); }, welcome: welcome, watch: watch, mood: function () { return mood; } };
  document.querySelectorAll('[data-ffb]').forEach(mount);
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.matches && el.matches('input[type="search"], input[type="text"], textarea')) warm();
  });

  /* ── Peeking mascot (.ffp, Classic's "Your Taste DNA" button) ──────────
     It rises over its button the first time the button is on screen on a
     computer (.is-in, once the sprite is in), hopping twice the first time
     it's actually up (.is-hop). It ducks while its row (data-ffp-edge) slides
     under the sticky bar (data-ffp-under), which it would otherwise be drawn
     over. Its click opens Taste DNA (the button's). */
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
