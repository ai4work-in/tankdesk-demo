/* ==========================================================================
   tank-editor.js: ONE tank editor for every screen (added 2026-10-08).
   Used by:  the supervisor's survey (Gujarati or English) and the admin
             New order / Edit order panel (English). (The driver no longer edits tanks.)

   Each tank:  ઉપરની (OH) / અંડરગ્રાઉન્ડ (UG)    = where it is (for the log book)
               સિમેન્ટ / પ્લાસ્ટિક (cement/plastic) = what it is made of (the PRICE depends on it)
               litres, or the size L × W × H (in metres, or in feet: converted to metres),
               and how many of that size.
   A partitioned tank with 2 entry points is measured and entered as 2 tanks; the
   second one can be marked "same tank, part 2" (part_of = the first tank's number).
   A plastic tank is at most 5,000 litres (Settings: plastic_max_litres).
   The litres worked out show while typing. No money here: the price is worked out
   by the server (admin only).

   Usability round (8 Oct 2026):
     - a very large tank (a side over 4 m, or over 30,000 L) or a very small one
       (under 100 L) shows an amber warning; it must be accepted with a tap
       ("Yes, the size is right") before the tanks can be sent. A "feet" toggle
       converts feet to metres (1 ft = 0.3048 m).
     - "1.500" in the litres box (3 digits after the dot) means 1,500 litres.
     - an empty tank between filled ones is no longer dropped silently: "Tank 2 is empty".
     - Remove asks first ("Remove tank 3? Yes / No") when the tank has sizes typed.
     - the tank with a problem gets a red border and is scrolled into view.
     - with {save:true} the typed tanks are kept on the phone (localStorage) and come
       back when the screen opens again (the phone may close the browser after a call).

   How a screen uses it (key = any short name, one per editor on screen, e.g. 'sv:1041'):
     TankEd.html(key, savedTanks, {lang:'gu'|'en', onChange: fn, hint, save})  -> HTML to put on the page
        save: true = keep what is typed on this phone until TankEd.clear(key)
     TankEd.out(key)    -> {tanks:[...]} ready for the server, or {error:'message'}
     TankEd.setError(key, text) / TankEd.reset(key) / TankEd.resetAll(prefix)
     TankEd.clear(key)  -> forget the typed tanks AND the copy kept on the phone (after a successful send)
   Taps redraw only the editor itself (so the page does not jump), typing changes
   only the litres text (so the phone keyboard stays open). onChange(key) runs after
   every change (the admin form uses it to refresh the price).
   Styles: the "dr-tk" and "tank editor" parts of phone.css, plus a compact admin size in admin.css.
   ========================================================================== */

const TankEd = (function () {
  'use strict';
  const MAX = 20;          // at most 20 tanks (same limits as the server, orders.gs cleanTanks_)
  const BIG_SIDE = 4;      // a side over 4 m: "measured in feet?"
  const BIG_LITRES = 30000;   // one tank over 30,000 L: "measured in feet?"
  const SMALL_LITRES = 100;   // one tank under 100 L: "check the size"
  const FT = 0.3048;       // 1 foot in metres
  const STORE = 'tankdesk-tk:';   // localStorage name prefix (one entry per editor key)
  const lists = {};        // key -> the tanks being typed (text, as typed)
  const errs = {};         // key -> an error message shown under the tanks
  const bad = {};          // key -> {i, kind} the tank with the problem (red border)
  const ask = {};          // key -> index of the tank whose "Remove?" question is showing
  const opts = {};         // key -> {lang, onChange, hint, save}
  const restored = {};     // key -> true when the typed tanks came back from the phone's memory

  // Small pictures: a tank on a roof (overhead), a tank under the ground line (underground),
  // a tank with a wall in the middle (partition)
  const SVG = {
    OH: '<svg class="tk-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2" width="10" height="7" rx="1.5" fill="currentColor"/>' +
      '<path d="M3 13l9-4 9 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M5 12.5V22h14v-9.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    UG: '<svg class="tk-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 8h22" stroke="currentColor" stroke-width="2.4"/>' +
      '<path d="M4 4l2-2M9 4l2-2M14 4l2-2M19 4l2-2" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="12" width="14" height="9" rx="1.5" fill="currentColor"/></svg>',
    part: '<svg class="tk-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 5v14" stroke="currentColor" stroke-width="2" stroke-dasharray="2.5 2"/><path d="M6 5V2.5M17 5V2.5" stroke="currentColor" stroke-width="2"/></svg>'
  };

  const WORDS = {
    gu: { tank: 'ટાંકી', del: '✕ કાઢો', OH: 'ઉપરની', UG: 'અંડરગ્રાઉન્ડ', cement: 'સિમેન્ટ', plastic: 'પ્લાસ્ટિક',
      lit: 'લિટર', size: 'માપ', m: 'મીટર', ft: 'ફૂટ', mShort: 'મી.', ftShort: 'ફૂટ',
      L: 'લંબાઈ', W: 'પહોળાઈ', H: 'ઊંચાઈ', D: 'ઊંડાઈ', count: 'સંખ્યા', add: 'ટાંકી ઉમેરો', less: 'એક ટાંકી ઓછી કરો', more: 'એક ટાંકી વધારો',
      litres: n => litresText(n) + ' લિટર', total: n => 'કુલ ' + litresText(n) + ' લિટર',
      hint: 'બે ભાગ (પાર્ટિશન)? દરેક ભાગ અલગ ટાંકી તરીકે લખો.',
      empty: n => 'ટાંકી ' + n + ' ખાલી છે: માપ લખો અથવા કાઢી નાખો.',
      badLit: 'લિટર સાચા લખો (1 થી 2,00,000).', badSide: 'લંબાઈ, પહોળાઈ, ઊંચાઈ ત્રણેય લખો.', badM: 'માપ 0 થી 20 મીટર વચ્ચે લખો.',
      badPl: max => 'પ્લાસ્ટિકની ટાંકી વધુમાં વધુ ' + litresText(max) + ' લિટરની હોય. મોટી હોય તો સિમેન્ટ પસંદ કરો.',
      big: 'આટલી મોટી ટાંકી? ફૂટમાં માપ્યું હોય તો મીટરમાં લખો (અથવા "ફૂટ" દબાવો).', bigLit: 'આટલી મોટી ટાંકી? લિટર ફરી જુઓ.',
      small: n => 'ફક્ત ' + litresText(n) + ' લિટર? બહુ નાની ટાંકી. માપ ફરી જુઓ.',
      isFeet: 'ફૂટમાં છે', okSize: 'હા, માપ સાચું છે',
      askDel: n => 'ટાંકી ' + n + ' કાઢી નાખવી?', yesDel: 'હા, કાઢો', noDel: 'ના',
      partLink: (root, k) => 'એ જ ટાંકી ' + root + ' નો ભાગ ' + k + ' છે', partOf: (root, k) => 'ટાંકી ' + root + ' નો ભાગ ' + k,
      unlink: 'અલગ ટાંકી છે', restored: 'તમે પહેલાં લખેલું માપ પાછું આવ્યું.' },
    en: { tank: 'Tank', del: '✕ Remove', OH: 'Overhead', UG: 'Underground', cement: 'Cement', plastic: 'Plastic',
      lit: 'Litres', size: 'Size', m: 'Metres', ft: 'Feet', mShort: 'm', ftShort: 'ft',
      L: 'Length', W: 'Width', H: 'Height', D: 'Depth', count: 'How many', add: 'Add tank', less: 'One tank fewer', more: 'One tank more',
      litres: n => litresText(n) + ' L', total: n => 'Total ' + litresText(n) + ' L',
      hint: 'Partition? Enter each part as its own tank.',
      empty: n => 'Tank ' + n + ' is empty: enter its size or remove it.',
      badLit: 'Enter the litres (1 to 2,00,000).', badSide: 'Enter all three: length, width and height.', badM: 'Sizes must be between 0 and 20 metres.',
      badPl: max => 'A plastic tank is at most ' + litresText(max) + ' litres. Pick Cement for a bigger tank.',
      big: 'Very large tank. Measured in feet? Enter metres (or tap "Feet").', bigLit: 'Very large tank. Please check the litres.',
      small: n => 'Only ' + litresText(n) + ' litres? Very small tank. Please check the size.',
      isFeet: 'It is in feet', okSize: 'Yes, the size is right',
      askDel: n => 'Remove tank ' + n + '?', yesDel: 'Yes, remove', noDel: 'No',
      partLink: (root, k) => 'Same tank as tank ' + root + ', part ' + k, partOf: (root, k) => 'part ' + k + ' of tank ' + root,
      unlink: 'Separate tank', restored: 'The sizes you typed before are back.' }
  };
  const W = key => WORDS[(opts[key] || {}).lang === 'en' ? 'en' : 'gu'];
  // The plastic limit from the Settings tab (sent to every role: it is not money)
  const plasticMax = () => { const v = Number(((App.setup || {}).settings || {}).plastic_max_litres); return v > 0 ? v : 5000; };

  const blank = () => ({ type: 'OH', material: 'cement', mode: 'l', unit: 'm', litres: '', l: '', w: '', h: '', count: 1, part_of: null, okw: '' });
  // A size as typed -> a number (NaN if not a number). "1,40" -> 1.4
  const toNum = v => { const x = String(v || '').trim(); return x === '' ? NaN : Number(x.replace(',', '.')); };
  // Litres as typed -> a number. "1,500" -> 1500, and "1.500" (exactly 3 digits after the dot,
  // the way many people write thousands) -> 1500 too.
  const toLitres = v => {
    let x = String(v || '').trim().replace(/,/g, '');
    if (x === '') return NaN;
    if (/^\d+\.\d{3}$/.test(x)) x = x.replace('.', '');
    return Number(x);
  };

  /* ---------- keeping the typed tanks on the phone (only for editors opened with save:true) ---------- */
  function store(key) {
    if (!(opts[key] || {}).save) return;
    try { localStorage.setItem(STORE + key, JSON.stringify(lists[key] || [])); } catch (e) { /* private mode or full: works until the page closes */ }
  }
  function stored(key) {
    try {
      const v = JSON.parse(localStorage.getItem(STORE + key) || 'null');
      const L = Array.isArray(v) ? v.map(t => Object.assign(blank(), t)).slice(0, MAX) : [];
      return L.some(t => value(t)) ? L : null;   // only when something was typed
    } catch (e) { return null; }
  }
  function unstore(key) { try { localStorage.removeItem(STORE + key); } catch (e) { /* nothing kept */ } }

  // The typed list for a key, made once: from the phone's memory (save:true), else from the saved tanks
  function list(key, saved) {
    if (!lists[key]) {
      const kept = (opts[key] || {}).save ? stored(key) : null;
      if (kept) { lists[key] = kept; restored[key] = true; return kept; }
      const str = v => v === null || v === undefined || v === '' ? '' : String(v);
      lists[key] = (saved || []).map(t => Object.assign(blank(), {
        type: t.type === 'UG' ? 'UG' : 'OH', material: tankMat(t), mode: tankHasSize(t) ? 'm' : 'l',
        litres: tankHasSize(t) ? '' : str(t.litres), l: str(t.l), w: str(t.w), h: str(t.h), count: Number(t.count) || 1,
        part_of: Number(t.part_of) > 0 ? Number(t.part_of) : null
      }));
      if (!lists[key].length) lists[key].push(blank());   // nothing saved yet: one empty tank to fill in
    }
    return lists[key];
  }
  // One side in metres (a size typed in feet is converted, 2 decimals like on paper)
  const side = (t, v) => { const n = toNum(v); return t.unit === 'ft' && isFinite(n) ? Math.round(n * FT * 100) / 100 : n; };
  // One typed tank as the server wants it. null = still empty.
  function value(t) {
    let v;
    if (t.mode === 'm') {
      if (!String(t.l).trim() && !String(t.w).trim() && !String(t.h).trim()) return null;
      v = { type: t.type, material: t.material, litres: null, l: side(t, t.l), w: side(t, t.w), h: side(t, t.h), count: t.count };
    } else {
      if (!String(t.litres).trim()) return null;
      v = { type: t.type, material: t.material, litres: toLitres(t.litres), l: null, w: null, h: null, count: t.count };
    }
    if (t.part_of) v.part_of = t.part_of;
    return v;
  }
  // Litres of one typed tank, all of that size together (0 while not complete)
  function litres(t) {
    const v = value(t), ok = x => x > 0 && isFinite(x);
    if (!v) return 0;
    if (v.litres === null && !(ok(v.l) && ok(v.w) && ok(v.h))) return 0;
    if (v.litres !== null && !ok(v.litres)) return 0;
    return tankTotal(v);
  }
  // A hard error of one filled tank (the server would refuse it), or ''
  function hardError(w, v) {
    if (v.litres !== null) {
      if (!(v.litres > 0 && v.litres <= 200000)) return w.badLit;
    } else {
      const sides = [v.l, v.w, v.h];
      if (sides.some(x => isNaN(x))) return w.badSide;
      if (!sides.every(x => x > 0 && x <= 20)) return w.badM;
    }
    if (v.material === 'plastic' && tankLitres(v) > plasticMax()) return w.badPl(plasticMax());
    return '';
  }
  // A size that looks wrong (accepted with a tap): {kind:'big'|'small', sig} or null.
  // sig = what was typed: changing the size asks again.
  function warning(t) {
    const v = value(t);
    if (!v) return null;
    const one = tankLitres(v), sig = [t.mode, t.unit, t.litres, t.l, t.w, t.h].join('|');
    const sidesBig = v.litres === null && [v.l, v.w, v.h].some(x => x > BIG_SIDE);
    if (sidesBig || one > BIG_LITRES) return { kind: 'big', sig: sig };
    if (one > 0 && one < SMALL_LITRES) return { kind: 'small', sig: sig, litres: one };
    return null;
  }
  const openWarning = t => { const x = warning(t); return x && t.okw !== x.sig ? x : null; };
  // The words of a warning: "measured in feet?" only for a size typed in metres
  const warnText = (w, t, x) => x.kind === 'small' ? w.small(x.litres) : (t.mode === 'm' && t.unit !== 'ft' ? w.big : w.bigLit);

  // Partition: the first tank of the group this tank belongs to, and which part this one is
  const rootOf = (L, i) => L[i] && L[i].part_of ? L[i].part_of : i + 1;
  function partNo(L, i) {
    const root = L[i].part_of;
    if (!root) return 0;
    let k = 1;   // the first tank is part 1
    for (let j = 0; j < i; j++) if (L[j].part_of === root) k++;
    return k + 1;
  }

  /** Checks the typed tanks -> {tanks} or {error}. All tanks empty -> {tanks: []}. */
  function out(key) {
    const w = W(key), res = [], L = lists[key] || [];
    delete bad[key];
    const vals = L.map(value);
    if (!vals.some(v => v)) return { tanks: [] };
    for (let i = 0; i < L.length; i++) {
      const v = vals[i], n = w.tank + ' ' + (i + 1) + ': ';
      if (!v) { bad[key] = { i: i, kind: 'empty' }; return { error: w.empty(i + 1) }; }
      const e = hardError(w, v);
      if (e) { bad[key] = { i: i, kind: 'bad' }; markBad(key); return { error: n + e }; }
      const x = openWarning(L[i]);
      if (x) { bad[key] = { i: i, kind: 'warn' }; markBad(key); return { error: n + warnText(w, L[i], x), warn: true }; }
      if (v.part_of && !(v.part_of >= 1 && v.part_of <= i)) delete v.part_of;   // only an earlier tank
      if (v.part_of) v.part_no = partNo(L, i);
      res.push(v);
    }
    markBad(key);
    return { tanks: res };
  }

  // The amber "is this size right?" box of one tank ('' when the size looks fine or was accepted)
  function warnHtml(key, i) {
    const t = (lists[key] || [])[i], w = W(key), k = esc(key);
    const x = t && openWarning(t);
    if (!x) return '';
    const b = (act, label, extra) => '<button type="button" data-act="' + act + '" data-key="' + k + '" data-i="' + i + '"' + (extra || '') + '>' + label + '</button>';
    return '<div class="box warn tk-warn" role="alert"><div>' + esc(warnText(w, t, x)) + '</div><div class="tk-warn-b">' +
      (x.kind === 'big' && t.mode === 'm' && t.unit !== 'ft' ? b('tk-set', esc(w.isFeet), ' data-f="unit" data-v="ft"') : '') +
      b('tk-ok', '✓ ' + esc(w.okSize)) + '</div></div>';
  }
  // The litres line of one tank: "= 4,704 લિટર" (in feet also the metres it comes to)
  function litHtml(key, t) {
    const w = W(key), lit = litres(t);
    if (!lit) return '';
    const v = value(t);
    return (t.mode === 'm' && t.unit === 'ft' ? '= ' + metres(v.l) + ' × ' + metres(v.w) + ' × ' + metres(v.h) + ' ' + w.mShort + ' ' : '') + '= ' + w.litres(lit);
  }

  // The inside of the editor (redrawn after a tap)
  function inner(key) {
    const w = W(key), L = lists[key] || [], k = esc(key), b = bad[key];
    const btn = (i, f, v, label, on, aria) => '<button type="button" data-act="tk-set" data-key="' + k + '" data-i="' + i + '" data-f="' + f + '" data-v="' + v + '" aria-pressed="' + on + '"' +
      (aria ? ' aria-label="' + esc(aria) + '"' : '') + '>' + label + '</button>';
    // Inputs have a label above and no example placeholder (an example looks like a value already typed)
    const inp = (i, f, val, label) => '<label class="dr-tk-in"><span>' + label + '</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" ' +
      'data-inp="tk" data-key="' + k + '" data-i="' + i + '" data-f="' + f + '" value="' + esc(val) + '"></label>';
    const rows = L.map((t, i) => {
      const no = i + 1, u = t.unit === 'ft' ? w.ftShort : w.mShort, pn = partNo(L, i);
      const cls = 'dr-tk' + (b && b.i === i ? (b.kind === 'warn' ? ' tk-warnb' : ' tk-bad') : '');
      // Header: "ટાંકી 3" (+ "ટાંકી 2 નો ભાગ 2") and Remove, or the "Remove tank 3?" question
      const head = ask[key] === i
        ? '<div class="dr-tk-h tk-ask" role="alert"><b>' + esc(w.askDel(no)) + '</b><span>' +
          '<button type="button" class="tk-yes" data-act="tk-del-yes" data-key="' + k + '" data-i="' + i + '">' + esc(w.yesDel) + '</button>' +
          '<button type="button" class="tk-no" data-act="tk-del-no" data-key="' + k + '">' + esc(w.noDel) + '</button></span></div>'
        : '<div class="dr-tk-h"><b>' + w.tank + ' ' + no + (pn ? ' <span class="tk-part">· ' + esc(w.partOf(t.part_of, pn)) + '</span>' : '') + '</b>' +
          '<button type="button" class="dr-tk-x" data-act="tk-del" data-key="' + k + '" data-i="' + i + '" aria-label="' + esc(w.tank + ' ' + no + ' ' + w.del) + '">' + w.del + '</button></div>';
      // Partition link: "same tank, part 2" (any tank after the first), or "separate tank" to undo it
      let part = '';
      if (pn) part = '<button type="button" class="tk-link" data-act="tk-part" data-key="' + k + '" data-i="' + i + '" data-v="0">' + esc(w.unlink) + '</button>';
      else if (i > 0) {
        const root = rootOf(L, i - 1);
        let parts = 1;
        for (let j = 0; j < i; j++) if (L[j].part_of === root) parts++;
        part = '<button type="button" class="tk-link" data-act="tk-part" data-key="' + k + '" data-i="' + i + '" data-v="' + root + '">' + SVG.part + '<span>' + esc(w.partLink(root, parts + 1)) + '</span></button>';
      }
      const hName = t.type === 'UG' ? w.D : w.H;   // an underground tank has a depth, not a height
      return '<div class="' + cls + '" data-tki="' + i + '">' + head +
        '<div class="dr-seg tk-type">' + btn(i, 'type', 'OH', SVG.OH + '<span>' + w.OH + '</span>', t.type === 'OH', w.OH) + btn(i, 'type', 'UG', SVG.UG + '<span>' + w.UG + '</span>', t.type === 'UG', w.UG) + '</div>' +
        '<div class="dr-seg tk-mat">' + btn(i, 'material', 'cement', w.cement, t.material === 'cement') + btn(i, 'material', 'plastic', w.plastic, t.material === 'plastic') + '</div>' +
        '<div class="dr-seg">' + btn(i, 'mode', 'l', w.lit, t.mode === 'l') + btn(i, 'mode', 'm', w.size, t.mode === 'm') + '</div>' +
        (t.mode === 'l'
          ? '<div class="dr-tk-row">' + inp(i, 'litres', t.litres, w.lit) + '</div>'
          : '<div class="dr-seg tk-unit">' + btn(i, 'unit', 'm', w.m, t.unit !== 'ft') + btn(i, 'unit', 'ft', w.ft, t.unit === 'ft') + '</div>' +
            '<div class="dr-tk-row dr-tk-lwh">' + inp(i, 'l', t.l, w.L + ' (' + u + ')') + '<i>×</i>' + inp(i, 'w', t.w, w.W + ' (' + u + ')') + '<i>×</i>' + inp(i, 'h', t.h, hName + ' (' + u + ')') + '</div>') +
        '<div class="dr-tk-ft"><span class="dr-step"><span class="dr-lbl">' + w.count + '</span>' +
        '<button type="button" data-act="tk-count" data-key="' + k + '" data-i="' + i + '" data-d="-1" aria-label="' + w.less + '"' + (t.count <= 1 ? ' disabled' : '') + '>−</button>' +
        '<b>' + t.count + '</b>' +
        '<button type="button" data-act="tk-count" data-key="' + k + '" data-i="' + i + '" data-d="1" aria-label="' + w.more + '"' + (t.count >= 20 ? ' disabled' : '') + '>+</button></span>' +
        '<span class="dr-tk-l" data-tkl="' + i + '">' + litHtml(key, t) + '</span></div>' +
        '<div data-tkw="' + i + '">' + warnHtml(key, i) + '</div>' + part +
        '</div>';
    }).join('');
    const total = L.reduce((a, t) => a + litres(t), 0);
    return (restored[key] ? '<div class="box ok tk-rest">' + esc(w.restored) + '</div>' : '') +
      ((opts[key] || {}).hint === false ? '' : '<div class="sub tk-hint">' + SVG.part + '<span>' + esc(w.hint) + '</span></div>') + rows +
      (L.length < MAX ? '<button type="button" class="dr-tk-add" data-act="tk-add" data-key="' + k + '">' + WA.icons.plus + '<span>' + w.add + '</span></button>' : '') +
      '<div class="dr-tk-tot" data-tkt>' + (total ? w.total(total) : '') + '</div>' +
      // the error box (an amber warning already shows inside its own tank, so not twice)
      (errs[key] && !(b && b.kind === 'warn') ? '<div class="box bad" role="alert">' + esc(errs[key]) + '</div>' : '');
  }

  /** The whole editor. saved = the tanks to start from (only used the first time for this key). */
  function html(key, saved, o) {
    opts[key] = Object.assign({ lang: 'gu' }, opts[key] || {}, o || {});
    list(key, saved);
    // tk-en = the compact office size (admin.css); a supervisor reading English keeps the big phone size
    const office = !App.session || App.session.role === 'admin';
    return '<div class="tk-ed' + (opts[key].lang === 'en' && office ? ' tk-en' : '') + '" data-tkkey="' + esc(key) + '">' + inner(key) + '</div>';
  }
  const boxOf = key => Array.from(document.querySelectorAll('[data-tkkey]')).find(b => b.dataset.tkkey === key);
  // Redraw only this editor (after a tap), keep it on the phone, then tell the screen
  function redraw(key) {
    const box = boxOf(key);
    if (box) box.innerHTML = inner(key);
    changed(key);
  }
  function changed(key) {
    store(key);
    const f = (opts[key] || {}).onChange;
    if (f) try { f(key); } catch (e) { console.error(e); }
  }
  // Red (or amber) border on the tank with the problem, without redrawing (the keyboard stays open).
  // An empty tank is only marked by setError (the admin form checks while a new tank is still empty).
  function markBad(key) {
    const box = boxOf(key), b = bad[key];
    if (!box) return;
    box.querySelectorAll('[data-tki]').forEach(el => {
      const on = !!b && b.kind !== 'empty' && Number(el.dataset.tki) === b.i;
      el.classList.toggle('tk-bad', on && b.kind === 'bad');
      el.classList.toggle('tk-warnb', on && b.kind === 'warn');
    });
  }
  // Scroll the tank with the problem (or the error box) into view
  function showBad(key) {
    const box = boxOf(key), b = bad[key];
    if (!box) return;
    const el = (b && box.querySelector('[data-tki="' + b.i + '"]')) || box.querySelector('.box.bad');
    if (el && el.scrollIntoView) try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
  }
  // Something was typed or tapped: the "restored" note and the error are no longer needed
  function touched(key) { delete errs[key]; delete restored[key]; }

  // ---- taps and typing (one handler each for every editor on the page) ----
  const tk = el => { const L = lists[el.dataset.key]; return L ? { L: L, t: L[Number(el.dataset.i)] } : null; };
  onAct('tk-set', el => {
    const x = tk(el);
    if (!x || !x.t) return;
    x.t[el.dataset.f] = el.dataset.v;
    touched(el.dataset.key);
    if (bad[el.dataset.key] && bad[el.dataset.key].i === Number(el.dataset.i)) delete bad[el.dataset.key];
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
    // same kind as the last one (position, material, litres or size, metres or feet): fewer taps
    x.L.push(Object.assign(blank(), last ? { type: last.type, material: last.material, mode: last.mode, unit: last.unit } : {}));
    touched(el.dataset.key);
    redraw(el.dataset.key);
  });
  // "Yes, the size is right": the warning is accepted for exactly this size
  onAct('tk-ok', el => {
    const x = tk(el), key = el.dataset.key;
    if (!x || !x.t) return;
    const wn = warning(x.t);
    x.t.okw = wn ? wn.sig : '';
    touched(key);
    delete bad[key];
    redraw(key);
  });
  // Partition: part_of = the first tank's number (data-v), or 0 = a separate tank again
  onAct('tk-part', el => {
    const x = tk(el), key = el.dataset.key, root = Number(el.dataset.v) || null;
    if (!x || !x.t) return;
    x.t.part_of = root;
    // a part has the same position and material as the first part
    if (root && x.L[root - 1]) { x.t.type = x.L[root - 1].type; x.t.material = x.L[root - 1].material; }
    touched(key);
    redraw(key);
  });
  // Remove: a tank with sizes typed asks first ("Remove tank 3? Yes / No"); an empty one goes at once
  function removeAt(key, i) {
    const L = lists[key];
    if (!L || !L[i]) return;
    L.splice(i, 1);
    // tanks marked "part of" a later tank number move up by one; parts of the removed tank become separate tanks
    L.forEach(t => { if (t.part_of === i + 1) t.part_of = null; else if (t.part_of > i + 1) t.part_of--; });
    delete ask[key]; delete bad[key];
    touched(key);
    redraw(key);
  }
  onAct('tk-del', el => {
    const x = tk(el), key = el.dataset.key, i = Number(el.dataset.i);
    if (!x || !x.t) return;
    if (!value(x.t)) return removeAt(key, i);
    ask[key] = i;
    redraw(key);
  });
  onAct('tk-del-yes', el => removeAt(el.dataset.key, Number(el.dataset.i)));
  onAct('tk-del-no', el => { delete ask[el.dataset.key]; redraw(el.dataset.key); });

  // Typing a size: save it and update only the litres text (no redraw, the keyboard stays open).
  // The "is this size right?" box follows a moment after typing stops (not on every key).
  const warnTimers = {};
  onInp('tk', el => {
    const key = el.dataset.key, x = tk(el), i = el.dataset.i;
    if (!x || !x.t) return;
    x.t[el.dataset.f] = el.value;
    const box = el.closest('[data-tkkey]');
    if (box) {
      if (errs[key] || restored[key]) {
        touched(key);
        box.querySelectorAll('.box.bad,.tk-rest').forEach(e => e.remove());
      }
      const w = W(key), tl = box.querySelector('[data-tkl="' + i + '"]'), tt = box.querySelector('[data-tkt]');
      if (tl) tl.textContent = litHtml(key, x.t);
      const total = x.L.reduce((a, t) => a + litres(t), 0);
      if (tt) tt.textContent = total ? w.total(total) : '';
      clearTimeout(warnTimers[key + ':' + i]);
      warnTimers[key + ':' + i] = setTimeout(() => {
        const slot = box.querySelector('[data-tkw="' + i + '"]');
        if (slot && box.isConnected) slot.innerHTML = warnHtml(key, Number(i));
      }, 900);
    }
    changed(key);
  });

  return {
    html: html, out: out, list: list,
    has: key => !!lists[key],
    // How many tanks are typed (not empty)
    count: key => (lists[key] || []).filter(t => value(t)).length,
    // Show an error under the tanks (the tank with the problem gets a border and is scrolled into view)
    setError: (key, text) => { if (text) errs[key] = text; else { delete errs[key]; delete bad[key]; } redraw(key); if (text) showBad(key); },
    reset: key => { delete lists[key]; delete errs[key]; delete bad[key]; delete ask[key]; delete restored[key]; },
    resetAll: prefix => Object.keys(lists).forEach(k => { if (!prefix || k.indexOf(prefix) === 0) { delete lists[k]; delete errs[k]; delete bad[k]; delete ask[k]; delete restored[k]; } }),
    // Forget the typed tanks AND the copy kept on this phone (after a successful send / save)
    clear: key => { delete lists[key]; delete errs[key]; delete bad[key]; delete ask[key]; delete restored[key]; unstore(key); },
    // Replace the typed tanks (e.g. the client's saved tanks arrived after the form opened)
    load: (key, saved) => { delete lists[key]; delete errs[key]; delete bad[key]; delete ask[key]; delete restored[key]; unstore(key); list(key, saved); redraw(key); }
  };
})();
