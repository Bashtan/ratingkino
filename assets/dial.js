/* ═══════════════════════════════════════
   The Vibe Dial — SHARED by / (Classic) and /cinematic/.

   "Set the mood": three sliders with 5 stops each (Cozy ↔ Intense, Funny ↔ Serious,
   Familiar ↔ Experimental). Native range inputs, so keyboards, screen readers and
   Arabic's right-to-left all work. The page runs the search (POST /api/vibe-dial).

   FFDial.mount(host, { t, toggleHost, toggleClass, onChange(dial), onReset(), onSee() })
     t          the page's translator
     toggleHost the row of chips the "Set the mood" button joins (it's first in the row);
     toggleClass that row's chip class. The panel opens in host, under the row
     onChange   a slider was let go; dial = { mood, tone, novelty }, -2 to 2, not all 0
     onReset    every slider is back in the middle
     onSee      "See the films" was pressed (for phones, where the results are below the fold)
   FFDial: value · summary · isSet · reset({silent}) · setVisible · setSee · relabel · placeToggle

   Loaded synchronously in <head> by both documents as ?v=<8-char content hash>.
   After editing, bump ?v= in index.html and cinematic/index.html:
     shasum -a 256 assets/dial.js | cut -c1-8
   ═══════════════════════════════════════ */
(function () {
  'use strict';
  var AXES = [
    { key: 'mood',    neg: 'dial.cozy',     pos: 'dial.intense' },
    { key: 'tone',    neg: 'dial.funny',    pos: 'dial.serious' },
    { key: 'novelty', neg: 'dial.familiar', pos: 'dial.experimental' },
  ];
  var SETTLE_MS = 120;   // a held arrow key sends many changes: search once it rests
  var ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/></svg>';

  var root, panel, toggle, resetBtn, seeBtn, opts, timer = 0, ranges = {};

  function value() {
    var d = {};
    AXES.forEach(function (a) { d[a.key] = Number(ranges[a.key].value); });
    return d;
  }
  function isSet() {
    var d = value();
    return AXES.some(function (a) { return d[a.key] !== 0; });
  }
  // "Cozy · Funny": the end each moved slider leans to.
  function summary() {
    var d = value();
    return AXES.filter(function (a) { return d[a.key]; })
      .map(function (a) { return opts.t(d[a.key] < 0 ? a.neg : a.pos); }).join(' · ');
  }
  function paint() {
    AXES.forEach(function (a) {
      var input = ranges[a.key], v = Number(input.value), row = input.parentNode;
      row.querySelector('[data-end="neg"]').classList.toggle('on', v < 0);
      row.querySelector('[data-end="pos"]').classList.toggle('on', v > 0);
      input.setAttribute('aria-valuetext', v === 0 ? opts.t(a.neg) + ' – ' + opts.t(a.pos) : opts.t(v < 0 ? a.neg : a.pos) + ' ' + Math.abs(v) + '/2');
    });
    resetBtn.hidden = !isSet();
    toggle.classList.toggle('on', isSet());
  }
  function settled() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (isSet()) opts.onChange(value());
      else { setSee(false); opts.onReset(); }
    }, SETTLE_MS);
  }
  function relabel() {
    toggle.querySelector('span').textContent = opts.t('dial.open');
    resetBtn.textContent = opts.t('dial.reset');
    seeBtn.textContent = opts.t('dial.see');
    AXES.forEach(function (a) {
      var input = ranges[a.key], row = input.parentNode;
      row.querySelector('[data-end="neg"]').textContent = opts.t(a.neg);
      row.querySelector('[data-end="pos"]').textContent = opts.t(a.pos);
      input.setAttribute('aria-label', opts.t(a.neg) + ' – ' + opts.t(a.pos));
    });
    paint();
  }
  function reset(o) {
    AXES.forEach(function (a) { ranges[a.key].value = '0'; });
    paint();
    clearTimeout(timer);
    setSee(false);
    if (!(o && o.silent)) opts.onReset();
  }
  function setSee(on) { seeBtn.hidden = !on; }
  function setVisible(on) {
    root.hidden = toggle.hidden = !on;
    if (!on) { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  }
  // Puts the button first in a chip row; for a page that rebuilds that row.
  function placeToggle(row) {
    if (toggle) row.insertBefore(toggle, row.firstChild);
  }

  function mount(host, options) {
    opts = options;
    root = host;
    root.classList.add('ffd');
    root.innerHTML =
      '<button class="ffd-toggle ' + options.toggleClass + '" type="button" aria-expanded="false" aria-controls="ffdPanel">' + ICON + '<span></span></button>' +
      '<div class="ffd-panel" id="ffdPanel" hidden>' +
        AXES.map(function (a) {
          return '<div class="ffd-row"><span class="ffd-end" data-end="neg"></span>' +
            '<input class="ffd-range" type="range" min="-2" max="2" step="1" value="0" data-axis="' + a.key + '">' +
            '<span class="ffd-end" data-end="pos"></span></div>';
        }).join('') +
        '<div class="ffd-foot"><button class="ffd-see" type="button" hidden></button><button class="ffd-reset" type="button" hidden></button></div>' +
      '</div>';
    panel = root.querySelector('.ffd-panel');
    toggle = root.querySelector('.ffd-toggle');
    resetBtn = root.querySelector('.ffd-reset');
    seeBtn = root.querySelector('.ffd-see');
    placeToggle(options.toggleHost);
    root.querySelectorAll('.ffd-range').forEach(function (input) {
      ranges[input.dataset.axis] = input;
      input.addEventListener('input', paint);
      input.addEventListener('change', settled);
    });
    toggle.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    resetBtn.addEventListener('click', function () { reset(); });
    seeBtn.addEventListener('click', function () { opts.onSee(); });
    relabel();
  }

  window.FFDial = { mount: mount, value: value, summary: summary, isSet: isSet, reset: reset, setVisible: setVisible, setSee: setSee, relabel: relabel, placeToggle: placeToggle };
})();
