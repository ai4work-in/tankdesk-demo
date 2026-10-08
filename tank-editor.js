/* ==========================================================================
   tank-editor.js: ONE tank editor for every screen (added 2026-10-08).
   Used by:  the driver's "work done" step (Gujarati), the supervisor's survey
             (Gujarati), and the admin New order / Edit order panel (English).

   Each tank:  ઉપરની (OH) / અંડરગ્રાઉન્ડ (UG)    = where it is (for the log book)
               સિમેન્ટ / પ્લાસ્ટિક (cement/plastic) = what it is made of (the PRICE depends on it)
               litres, or the size in metres L × W × H, and how many of that size.
   A partitioned tank with 2 entry points is measured and entered as 2 tanks
   (the hint under the title says so). A plastic tank is at most 5,000 litres
   (Settings: plastic_max_litres). The litres worked out show while typing.
   No money here: the price is worked out by the server (admin only).

   How a screen uses it (key = any short name, one per editor on screen, e.g. 'dr:1041'):
     TankEd.html(key, savedTanks, {lang:'gu'|'en', onChange: fn})   -> HTML to put on the page
     TankEd.out(key)    -> {tanks:[...]} ready for the server, or {error:'message'}
     TankEd.setError(key, text) / TankEd.reset(key) / TankEd.resetAll(prefix)
   Taps redraw only the editor itself (so the page does not jump), typing changes
   only the litres text (so the phone keyboard stays open). onChange(key) runs after
   every change (the admin form uses it to refresh the price).
   Styles: the "dr-tk" part of phone.css (shared), plus a compact admin size in admin.css.
   ========================================================================== */

const TankEd = (function () {
  'use strict';
  const MAX = 20;          // at most 20 tanks (same limits as the server, orders.gs cleanTanks_)
  const lists = {};        // key -> the tanks being typed (text, as typed)
  const errs = {};         // key -> an error message shown under the tanks
  const opts = {};         // key -> {lang, onChange, hint}

  const WORDS = {
    gu: { tank: 'ટાંકી', del: '✕ કાઢો', OH: 'ઉપરની (OH)', UG: 'અંડરગ્રાઉન્ડ (UG)', cement: 'સિમેન્ટ', plastic: 'પ્લાસ્ટિક',
      lit: 'લિટર', size: 'માપ (મીટર)', L: 'લંબાઈ', W: 'પહોળાઈ', H: 'ઊંચાઈ', count: 'સંખ્યા', add: 'ટાંકી ઉમેરો', less: 'ઓછી', more: 'વધારે',
      litres: n => litresText(n) + ' લિટર', total: n => 'કુલ ' + litresText(n) + ' લિટર', eg: 'જેમ કે 2000', hint: GU.partition_hint,
      badLit: 'લિટર સાચા લખો (1 થી 2,00,000).', badSide: 'લંબાઈ, પહોળાઈ, ઊંચાઈ ત્રણેય મીટરમાં લખો.', badM: 'માપ 0 થી 20 મીટર વચ્ચે લખો.',
      badPl: max => 'પ્લાસ્ટિકની ટાંકી વધુમાં વધુ ' + litresText(max) + ' લિટરની હોય. મોટી હોય તો સિમેન્ટ પસંદ કરો.' },
    en: { tank: 'Tank', del: '✕ Remove', OH: 'Overhead (OH)', UG: 'Underground (UG)', cement: 'Cement', plastic: 'Plastic',
      lit: 'Litres', size: 'Size (m)', L: 'Length', W: 'Width', H: 'Height', count: 'How many', add: 'Add tank', less: 'Fewer', more: 'More',
      litres: n => litresText(n) + ' L', total: n => 'Total ' + litresText(n) + ' L', eg: 'e.g. 2000',
      hint: 'Partition with 2 entry points: measure each part and enter it as a separate tank.',
      badLit: 'Enter the litres (1 to 2,00,000).', badSide: 'Enter length, width and height in metres.', badM: 'Sizes must be between 0 and 20 metres.',
      badPl: max => 'A plastic tank is at most ' + litresText(max) + ' litres. Pick Cement for a bigger tank.' }
  };
  const W = key => WORDS[(opts[key] || {}).lang === 'en' ? 'en' : 'gu'];
  // The plastic limit from the Settings tab (sent to every role: it is not money)
  const plasticMax = () => { const v = Number(((App.setup || {}).settings || {}).plastic_max_litres); return v > 0 ? v : 5000; };

  const blank = () => ({ type: 'OH', material: 'cement', mode: 'l', litres: '', l: '', w: '', h: '', count: 1 });
  // "1,500" / "1.40" / "1,40" -> a number (NaN if not a number)
  const toNum = (v, isLitres) => { const x = String(v || '').trim(); return x === '' ? NaN : Number(isLitres ? x.replace(/,/g, '') : x.replace(',', '.')); };

  // The typed list for a key, made once from the saved tanks
  function list(key, saved) {
    if (!lists[key]) {
      const str = v => v === null || v === undefined || v === '' ? '' : String(v);
      lists[key] = (saved || []).map(t => ({
        type: t.type === 'UG' ? 'UG' : 'OH', material: tankMat(t), mode: tankHasSize(t) ? 'm' : 'l',
        litres: tankHasSize(t) ? '' : str(t.litres), l: str(t.l), w: str(t.w), h: str(t.h), count: Number(t.count) || 1
      }));
      if (!lists[key].length) lists[key].push(blank());   // nothing saved yet: one empty tank to fill in
    }
    return lists[key];
  }
  // One typed tank as the server wants it. null = still empty.
  function value(t) {
    if (t.mode === 'm') {
      if (!String(t.l).trim() && !String(t.w).trim() && !String(t.h).trim()) return null;
      return { type: t.type, material: t.material, litres: null, l: toNum(t.l), w: toNum(t.w), h: toNum(t.h), count: t.count };
    }
    if (!String(t.litres).trim()) return null;
    return { type: t.type, material: t.material, litres: toNum(t.litres, true), l: null, w: null, h: null, count: t.count };
  }
  // Litres of one typed tank, all of that size together (0 while not complete)
  function litres(t) {
    const v = value(t), ok = x => x > 0 && isFinite(x);
    if (!v) return 0;
    if (v.litres === null && !(ok(v.l) && ok(v.w) && ok(v.h))) return 0;
    if (v.litres !== null && !ok(v.litres)) return 0;
    return tankTotal(v);
  }

  /** Checks the typed tanks -> {tanks} or {error}. Empty tanks are left out. */
  function out(key) {
    const w = W(key), res = [], L = lists[key] || [];
    for (let i = 0; i < L.length; i++) {
      const v = value(L[i]), n = w.tank + ' ' + (i + 1) + ': ';
      if (!v) continue;
      if (v.litres !== null) {
        if (!(v.litres > 0 && v.litres <= 200000)) return { error: n + w.badLit };
      } else {
        const sides = [v.l, v.w, v.h];
        if (sides.some(x => isNaN(x))) return { error: n + w.badSide };
        if (!sides.every(x => x > 0 && x <= 20)) return { error: n + w.badM };
      }
      if (v.material === 'plastic' && tankLitres(v) > plasticMax()) return { error: n + w.badPl(plasticMax()) };
      res.push(v);
    }
    return { tanks: res };
  }

  // The inside of the editor (redrawn after a tap)
  function inner(key) {
    const w = W(key), L = lists[key] || [], k = esc(key);
    const btn = (i, f, v, label, on) => '<button type="button" data-act="tk-set" data-key="' + k + '" data-i="' + i + '" data-f="' + f + '" data-v="' + v + '" aria-pressed="' + on + '">' + label + '</button>';
    const inp = (i, f, val, ph, label) => '<label class="dr-tk-in"><span>' + label + '</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" ' +
      'data-inp="tk" data-key="' + k + '" data-i="' + i + '" data-f="' + f + '" value="' + esc(val) + '" placeholder="' + ph + '"></label>';
    const rows = L.map((t, i) => {
      const lit = litres(t);
      return '<div class="dr-tk">' +
        '<div class="dr-tk-h"><b>' + w.tank + ' ' + (i + 1) + '</b>' +
        '<button type="button" class="dr-tk-x" data-act="tk-del" data-key="' + k + '" data-i="' + i + '" aria-label="' + w.tank + ' ' + (i + 1) + ' ' + w.del + '">' + w.del + '</button></div>' +
        '<div class="dr-seg">' + btn(i, 'type', 'OH', w.OH, t.type === 'OH') + btn(i, 'type', 'UG', w.UG, t.type === 'UG') + '</div>' +
        '<div class="dr-seg tk-mat">' + btn(i, 'material', 'cement', w.cement, t.material === 'cement') + btn(i, 'material', 'plastic', w.plastic, t.material === 'plastic') + '</div>' +
        '<div class="dr-seg">' + btn(i, 'mode', 'l', w.lit, t.mode === 'l') + btn(i, 'mode', 'm', w.size, t.mode === 'm') + '</div>' +
        (t.mode === 'l'
          ? '<div class="dr-tk-row">' + inp(i, 'litres', t.litres, w.eg, w.lit) + '</div>'
          : '<div class="dr-tk-row dr-tk-lwh">' + inp(i, 'l', t.l, '1.40', w.L) + '<i>×</i>' + inp(i, 'w', t.w, '1.60', w.W) + '<i>×</i>' + inp(i, 'h', t.h, '2.10', w.H) + '</div>') +
        '<div class="dr-tk-ft"><span class="dr-step"><span class="dr-lbl">' + w.count + '</span>' +
        '<button type="button" data-act="tk-count" data-key="' + k + '" data-i="' + i + '" data-d="-1" aria-label="' + w.less + '"' + (t.count <= 1 ? ' disabled' : '') + '>−</button>' +
        '<b>' + t.count + '</b>' +
        '<button type="button" data-act="tk-count" data-key="' + k + '" data-i="' + i + '" data-d="1" aria-label="' + w.more + '"' + (t.count >= 20 ? ' disabled' : '') + '>+</button></span>' +
        '<span class="dr-tk-l" data-tkl="' + i + '">' + (lit ? '= ' + w.litres(lit) : '') + '</span></div>' +
        '</div>';
    }).join('');
    const total = L.reduce((a, t) => a + litres(t), 0);
    return ((opts[key] || {}).hint === false ? '' : '<div class="sub tk-hint">' + esc(w.hint) + '</div>') + rows +
      (L.length < MAX ? '<button type="button" class="dr-tk-add" data-act="tk-add" data-key="' + k + '">' + WA.icons.plus + '<span>' + w.add + '</span></button>' : '') +
      '<div class="dr-tk-tot" data-tkt>' + (total ? w.total(total) : '') + '</div>' +
      (errs[key] ? '<div class="box bad" role="alert">' + esc(errs[key]) + '</div>' : '');
  }

  /** The whole editor. saved = the tanks to start from (only used the first time for this key). */
  function html(key, saved, o) {
    opts[key] = Object.assign({ lang: 'gu' }, opts[key] || {}, o || {});
    list(key, saved);
    return '<div class="tk-ed' + (opts[key].lang === 'en' ? ' tk-en' : '') + '" data-tkkey="' + esc(key) + '">' + inner(key) + '</div>';
  }
  // Redraw only this editor (after a tap), then tell the screen
  function redraw(key) {
    const box = Array.from(document.querySelectorAll('[data-tkkey]')).find(b => b.dataset.tkkey === key);
    if (box) box.innerHTML = inner(key);
    changed(key);
  }
  function changed(key) { const f = (opts[key] || {}).onChange; if (f) try { f(key); } catch (e) { console.error(e); } }

  // ---- taps and typing (one handler each for every editor on the page) ----
  const tk = el => { const L = lists[el.dataset.key]; return L ? { L: L, t: L[Number(el.dataset.i)] } : null; };
  onAct('tk-set', el => {
    const x = tk(el);
    if (!x || !x.t) return;
    x.t[el.dataset.f] = el.dataset.v;
    delete errs[el.dataset.key];
    redraw(el.dataset.key);
  });
  onAct('tk-count', el => {
    const x = tk(el);
    if (!x || !x.t) return;
    x.t.count = Math.min(20, Math.max(1, x.t.count + Number(el.dataset.d)));
    redraw(el.dataset.key);
  });
  onAct('tk-add', el => {
    const x = tk(el);
    if (!x || x.L.length >= MAX) return;
    const last = x.L[x.L.length - 1];
    // same kind as the last one (position, material, litres or size): fewer taps
    x.L.push(Object.assign(blank(), last ? { type: last.type, material: last.material, mode: last.mode } : {}));
    redraw(el.dataset.key);
  });
  onAct('tk-del', el => {
    const x = tk(el);
    if (!x) return;
    x.L.splice(Number(el.dataset.i), 1);
    delete errs[el.dataset.key];
    redraw(el.dataset.key);
  });
  // Typing a size: save it and update only the litres text (no redraw, the keyboard stays open)
  onInp('tk', el => {
    const key = el.dataset.key, x = tk(el);
    if (!x || !x.t) return;
    x.t[el.dataset.f] = el.value;
    const box = el.closest('[data-tkkey]');
    if (box) {
      if (errs[key]) { delete errs[key]; const e = box.querySelector('.box.bad'); if (e) e.remove(); }
      const w = W(key), lit = litres(x.t), tl = box.querySelector('[data-tkl="' + el.dataset.i + '"]'), tt = box.querySelector('[data-tkt]');
      if (tl) tl.textContent = lit ? '= ' + w.litres(lit) : '';
      const total = x.L.reduce((a, t) => a + litres(t), 0);
      if (tt) tt.textContent = total ? w.total(total) : '';
    }
    changed(key);
  });

  return {
    html: html, out: out, list: list,
    has: key => !!lists[key],
    // How many tanks are typed (not empty)
    count: key => (lists[key] || []).filter(t => value(t)).length,
    setError: (key, text) => { if (text) errs[key] = text; else delete errs[key]; redraw(key); },
    reset: key => { delete lists[key]; delete errs[key]; },
    resetAll: prefix => Object.keys(lists).forEach(k => { if (!prefix || k.indexOf(prefix) === 0) { delete lists[k]; delete errs[k]; } }),
    // Replace the typed tanks (e.g. the client's saved tanks arrived after the form opened)
    load: (key, saved) => { delete lists[key]; delete errs[key]; list(key, saved); redraw(key); }
  };
})();
