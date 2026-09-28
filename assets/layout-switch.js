/* ═══════════════════════════════════════════════════════════════════════════
   Layout switch (Classic ⇄ Cinematic) — SHARED by / and /cinematic/.

   Each layout is its own document. Choosing the other one saves the choice
   (localStorage `ff_layout`, read by the router at the top of index.html's
   <head>), slides the toggle's thumb, and replaces this page with the other
   layout — location.replace(), so Back never bounces between them. The
   `ff_layout_vt` flag tells the arriving page to opt into the same
   cross-document view transition this page opts into here (Chrome 126+,
   Safari 18.2+; elsewhere it is a plain navigation).
   Markup + styles: .ffl in /assets/layout-switch.css.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var HOME = { classic: '/', cinematic: '/cinematic/' };
  var switching = false;

  // Slide a thumb from the pressed option to `to`. Measured rather than
  // hard-coded, so it fits any label width and any text direction.
  function slide(sw, to) {
    var from = sw.querySelector('.ffl-opt[aria-pressed="true"]');
    var thumb = sw.querySelector('.ffl-thumb');
    if (!from || !thumb || !sw.offsetWidth) return;
    thumb.style.transition = 'none';
    thumb.style.width = from.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + from.offsetLeft + 'px)';
    sw.classList.add('is-sliding');
    void thumb.offsetWidth;                    // commit the start position before animating
    thumb.style.transition = '';
    thumb.style.width = to.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + to.offsetLeft + 'px)';
    from.setAttribute('aria-pressed', 'false');
    to.setAttribute('aria-pressed', 'true');
  }

  function switchTo(layout, btn) {
    if (switching || !HOME[layout]) return;
    switching = true;
    try {
      localStorage.setItem('ff_layout', layout);
      sessionStorage.setItem('ff_layout_vt', '1');
    } catch (e) { /* storage blocked: still switch for this visit */ }
    var sw = btn.closest('.ffl');
    if (sw) slide(sw, btn);
    var vt = document.createElement('style');
    vt.textContent = '@view-transition { navigation: auto; }';
    document.head.appendChild(vt);
    if (typeof window.gtag === 'function') window.gtag('event', 'layout_switch', { layout: layout });
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The query rides along, so an open ?movie= / ?TVShows= title reopens there.
    setTimeout(function () {
      location.replace(HOME[layout] + location.search + location.hash);
    }, reduce ? 0 : 260);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest ? e.target.closest('.ffl-opt[data-layout]') : null;
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    e.preventDefault();
    switchTo(btn.getAttribute('data-layout'), btn);
  });
})();
