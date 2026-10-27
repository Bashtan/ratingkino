/* ═══════════════════════════════════════════════════════════════════════════
   Social links + mascot — SHARED by / (Classic) and /cinematic/.
   Styles and markup notes: /assets/social.css.

   - Every brand link (a[data-ffs]) reports a GA `social_click` with its
     network and its placement (the nearest [data-ffs-place]).
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
