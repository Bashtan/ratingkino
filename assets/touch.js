/* ═══════════════════════════════════════════════════════════════════════════
   Touch behaviour — SHARED by / (Classic) and /cinematic/. Styles: touch.css.

   1. :active on iOS. Safari only applies :active to a touched element when a
      touch listener exists on it or an ancestor. One passive no-op listener on
      the document turns on every page's press states, and being passive it
      never delays scrolling.

   2. FFSheet.attach() — drag a bottom sheet down to dismiss it, the way native
      sheets work: from anywhere on the sheet while its content is scrolled to
      the top, and from content scrolled further down a normal scroll happens.
      The sheet tracks the finger 1:1; on release a long pull or a downward
      flick dismisses it, anything else springs back through the sheet's own
      CSS transition.

        FFSheet.attach({
          sheet:     element that moves (its CSS transition animates the release),
          scroller:  the sheet's main vertical scroller (optional),
          handle:    a grab handle that drags even when scrolled down (optional),
          isActive:  () => true while the sheet is open AND shown as a sheet,
          onDismiss: () => close it (synchronously moves it to its closed state)
        });
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  document.addEventListener('touchstart', function () {}, { passive: true });

  // Is a vertical drag starting at `el` meant for something inside the sheet:
  // a field, a horizontal rail, or an inner scroller that is not at its top?
  function claimedInside(el, sheet) {
    for (; el && el !== sheet; el = el.parentElement) {
      if (el.matches('input, textarea, select, [contenteditable], iframe')) return true;
      var cs = getComputedStyle(el);
      if (/auto|scroll/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) return true;
      if (/auto|scroll/.test(cs.overflowY) && el.scrollTop > 0) return true;
    }
    return false;
  }

  function attach(o) {
    var sheet = o.sheet;
    var g = null;                 // the current gesture

    sheet.addEventListener('touchstart', function (e) {
      g = null;
      if (e.touches.length !== 1 || !o.isActive()) return;
      var p = e.touches[0];
      g = { x: p.clientX, y: p.clientY, mode: 0, y0: 0, dy: 0, samples: [] };
      // Decided now, before any scrolling moves things under the finger.
      if (o.handle && o.handle.contains(e.target)) return;
      if (claimedInside(e.target, sheet) || (o.scroller && o.scroller.scrollTop > 0)) g.mode = -1;
    }, { passive: true });

    // Not passive: once a drag is decided the page must not also scroll. The
    // listener returns at once for every gesture that is not a drag.
    sheet.addEventListener('touchmove', function (e) {
      if (!g || g.mode < 0) return;
      var p = e.touches[0];
      var dx = p.clientX - g.x, dy = p.clientY - g.y;
      if (g.mode === 0) {
        // Decide on the first move: browsers ignore preventDefault() once a
        // native scroll has begun. Down and mostly vertical = drag the sheet.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) { g.mode = -1; return; }
        g.mode = 1;
        g.y0 = p.clientY;
        sheet.style.transition = 'none';
      }
      if (e.cancelable) e.preventDefault();
      g.dy = Math.max(0, p.clientY - g.y0);
      sheet.style.transform = 'translateY(' + g.dy + 'px)';
      var now = performance.now();
      g.samples.push({ t: now, y: p.clientY });
      while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    }, { passive: false });

    function end() {
      var d = g;
      g = null;
      if (!d || d.mode !== 1) return;
      sheet.style.transition = '';
      // Release velocity over the last ~100ms (px/ms), not over the whole drag,
      // so a slow pull that ends in a flick still counts as a flick.
      var s = d.samples, v = 0;
      // (At least a frame's time, so two events landing together can't fake a flick.)
      if (s.length > 1) v = (s[s.length - 1].y - s[0].y) / Math.max(16, s[s.length - 1].t - s[0].t);
      var far = d.dy > Math.min(160, sheet.offsetHeight * 0.3);
      if (far || (d.dy > 24 && v > 0.45)) o.onDismiss();
      // Hand the sheet back to CSS: it springs open again, or — dismissed —
      // slides on from where the finger left it.
      sheet.style.transform = '';
    }
    sheet.addEventListener('touchend', end);
    sheet.addEventListener('touchcancel', end);
  }

  window.FFSheet = { attach: attach };
})();
