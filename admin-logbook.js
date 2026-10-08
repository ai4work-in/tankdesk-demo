/* ==========================================================================
   admin-logbook.js: the Log book screen (#ad-logbook, admin only). Added 2026-10-08.

   The agency's paper log book has one page per vehicle (ગાડી નં.) per day (તારીખ):
     ક્રમાંક (no.) | વર્કરનું નામ (worker) | બિલ્ડિંગ / જગ્યાનું નામ (building) | મેઝરમેન્ટ (measurement)
   and at the bottom the day's costs: એડવાન્સ (advance), પેટ્રોલ (petrol), રીપેર (repair).
   This screen draws the same page from the app's data:
     - the jobs: that team's orders of the day, in time order, with the crew and the
       tank sizes the driver saved at "work done"
     - the costs: typed here by an admin. Each box is SAVED BY ITSELF when the admin leaves
       it (usability round 2026-10-08): one logbook.setCosts per vehicle, a moment after the
       last box was left, then a small "✓ Saved". If a save fails the typed values are kept
       (even when the day or screen changes), the page says "Not saved · Try again", and
       leaving the day or the screen warns first.
       COSTS ARE ADMIN ONLY: drivers and the collector never see them.
   Print prints only the page(s), one per sheet of paper, black on white
   (the print styles are at the end of admin.css, "Log book" part).

   Server calls: logbook.get {date} (all teams of the day), logbook.setCosts {date, team, ...}.
   Uses the shared admin helpers from admin-insights.js (App.ins: loadScreen, tchip, errText).
   Styles: admin.css, class names start with lb-.
   ========================================================================== */

(function () {
  'use strict';

  const I = () => App.ins;               // helpers from admin-insights.js (loaded before this file)
  const S = { date: '', team: '' };      // date on screen ('' = today), team chip ('' = all teams)
  let last = null;                       // the last logbook.get answer drawn (to update costs after Save)
  /* Costs saved box by box (usability round 2026-10-08):
     drafts["date|team"] = {body, state: 'waiting'|'saving'|'failed', why} while typed costs are not saved yet;
     justSaved["date|team"] = true after a save, for the "✓ Saved" note. */
  const drafts = {}, justSaved = {}, timers = {};
  const dkey = (date, team) => date + '|' + team;
  let warnedLeave = '';                  // the leave that was already warned about (a second try goes)

  const dateNow = () => S.date || todayIso();
  // '2026-10-06' -> '06/10/26' (as written on the paper page)
  const dmy = s => s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(2, 4);
  const calls = () => [['logbook.get', { date: dateNow() }]];
  // Status of a job that is not finished yet (a finished job needs no word)
  const STATUS = { new: 'Not assigned', assigned: 'Not started', delayed: 'Running late', reached: 'At site', moved: 'Moved' };
  // A money box value: 0 shows as empty, so the admin just types
  const money = v => Number(v) ? String(v) : '';

  /* ---------- screen header: title, date picker, print ---------- */
  function header() {
    const d = dateNow(), t = todayIso();
    return '<header><div><h2>Log book</h2><p class="sub">One page per vehicle per day, like the paper book. Crew and tank sizes come from the drivers; costs are typed here (admins only).</p></div>' +
      '<div class="lb-ctl" role="group" aria-label="Choose day">' +
      '<button class="btn sm" data-act="lb-day" data-d="-1" aria-label="Previous day">‹</button>' +
      '<input type="date" class="fsel lb-dt" data-chg="lb-date" aria-label="Date" value="' + esc(d) + '">' +
      '<button class="btn sm" data-act="lb-day" data-d="1" aria-label="Next day">›</button>' +
      (d !== t ? '<button class="btn sm" data-act="lb-today">Today</button>' : '') +
      '<button class="btn pri sm lb-print" data-act="lb-print">Print</button>' +
      '</div></header>';
  }

  /* ---------- one paper page (one vehicle, one day) ---------- */
  function sheet(p, date) {
    // Costs typed but not saved yet (a failed save, or still waiting) win over the saved ones
    const dr = drafts[dkey(date, p.team)];
    const rows = p.rows || [], c = dr ? Object.assign({}, p.costs || {}, dr.body) : p.costs || {};
    const litres = rows.reduce((a, r) => a + tanksTotal(r.tanks), 0);
    const hasCosts = !!(Number(c.advance) || Number(c.petrol) || Number(c.repair) || c.note);
    const body = rows.map(r => '<tr>' +
      '<td class="lb-sr num">' + r.sr + '</td>' +
      '<td class="lb-crew">' + ((r.crew || []).length ? r.crew.map(n => '<span>' + esc(n) + '</span>').join('') : '<span class="sub lb-dash">-</span>') + '</td>' +
      '<td class="lb-bld"><b>' + esc(r.client_name) + '</b><div class="sub">' + esc(r.address) + '</div>' +
        (r.status !== 'done' && STATUS[r.status] ? '<span class="pill warn lb-st">' + esc(STATUS[r.status]) + '</span>' : '') + '</td>' +
      '<td class="lb-ms">' + ((r.tanks || []).length ? r.tanks.map(t => '<span class="num">' + esc(tankText(t)) + '</span>').join('')
        : '<span class="sub">' + (r.status === 'done' ? 'Not measured' : '-') + '</span>') + '</td></tr>').join('');
    // Empty ruled lines, printed only, so a short day still looks like the paper page (5 lines)
    let pad = '';
    for (let i = rows.length; i < 5; i++) pad += '<tr class="lb-pad"><td class="lb-sr num">' + (i + 1) + '</td><td></td><td></td><td></td></tr>';
    const fld = (k, gu, en) => '<label class="lb-f"><span class="lb-fl">' + gu + ' <span class="sub">/ ' + en + '</span></span>' +
      '<span class="lb-in"><i>₹</i><input type="text" inputmode="decimal" autocomplete="off" data-k="' + k + '" data-inp="lb-cost" value="' + esc(money(c[k])) + '" placeholder="0" aria-label="' + en + '"></span>' +
      '<b class="lb-pv num" data-pv="' + k + '">' + (Number(c[k]) ? esc(inr(c[k])) : '') + '</b></label>';
    const total = (Number(c.advance) || 0) + (Number(c.petrol) || 0) + (Number(c.repair) || 0);

    return '<article class="card lb-sheet' + (!rows.length && !hasCosts ? ' lb-empty' : '') + '" data-team="' + esc(p.team) + '" data-date="' + esc(date) + '">' +
      '<div class="lb-top">' +
      '<span class="lb-veh">ગાડી નં. <span class="sub">/ Vehicle</span> <b>' + esc(p.vehicle_no || '—') + '</b></span>' +
      '<h3 class="lb-title">LOG BOOK</h3>' +
      '<span class="lb-date">તારીખ <span class="sub">/ Date</span> <b class="num">' + esc(dmy(date)) + '</b></span></div>' +
      '<div class="lb-who">' + I().tchip(p.team) + ' <span>' + esc(p.driver_name || '') + '</span>' +
      ((p.worker_names || []).length ? ' <span class="sub">· Workers: ' + esc(p.worker_names.join(', ')) + '</span>' : '') +
      '<span class="lb-sum sub">' + rows.length + ' job' + (rows.length === 1 ? '' : 's') + (litres ? ' · ' + esc(litresText(litres)) + ' L' : '') + '</span></div>' +
      '<div class="lb-tw"><table class="lb-tbl"><thead><tr>' +
      '<th class="lb-sr">ક્રમાંક<small>No.</small></th><th>વર્કરનું નામ<small>Worker</small></th>' +
      '<th>બિલ્ડિંગ / જગ્યાનું નામ<small>Building / place</small></th><th>મેઝરમેન્ટ<small>Measurement</small></th></tr></thead>' +
      '<tbody>' + (rows.length ? body : '<tr class="lb-none"><td colspan="4"><div class="empty">No jobs for this vehicle on this day.</div></td></tr>') + pad + '</tbody>' +
      (litres ? '<tfoot><tr><td colspan="3" class="lb-tl">Total / કુલ</td><td class="num"><b>' + esc(litresText(litres)) + ' L</b></td></tr></tfoot>' : '') +
      '</table></div>' +
      // Costs of the day (admin only)
      '<div class="lb-costs">' + fld('advance', 'એડવાન્સ', 'Advance') + fld('petrol', 'પેટ્રોલ', 'Petrol') + fld('repair', 'રીપેર', 'Repair') +
      '<label class="lb-f lb-note"><span class="lb-fl">નોંધ <span class="sub">/ Note</span></span>' +
      '<input type="text" class="fsel" maxlength="500" data-k="note" data-inp="lb-cost" value="' + esc(c.note || '') + '" placeholder="Optional">' +
      '<b class="lb-pv" data-pv="note">' + esc(c.note || '') + '</b></label>' +
      '<div class="lb-save"><span class="lb-tot">Total <b class="num" data-tot>' + esc(inr(total)) + '</b></span>' +
      '<span class="lb-ss" data-ss role="status" aria-live="polite">' + stateHtml(date, p.team) + '</span>' +
      '<span class="sub lb-by" data-by>' + savedBy(c) + '</span></div></div>' +
      '</article>';
  }
  // The small save note of one vehicle: "✓ Saved", "Saving…", or "Not saved · Try again"
  function stateHtml(date, team) {
    const d = drafts[dkey(date, team)];
    if (!d) return justSaved[dkey(date, team)] ? '<span class="lb-ok">✓ Saved</span>' : '<span class="sub">Saved as you type</span>';
    if (d.state === 'saving') return '<span class="sub">Saving…</span>';
    if (d.state === 'failed') return '<span class="lb-bad">Not saved' + (d.why ? ': ' + esc(d.why) : '') + '</span> ' +
      '<button class="btn sm pri" data-act="lb-save" data-team="' + esc(team) + '" data-date="' + esc(date) + '">Try again</button>';
    return '<span class="sub">Not saved yet…</span>';
  }
  const savedBy = c => c && c.updated_by ? 'Saved by ' + esc(c.updated_by) + (c.updated_at ? ', ' + esc(lab(String(c.updated_at).slice(0, 10))) + ' ' + esc(fm(mins(c.updated_at))) : '') : 'Not saved yet';

  /* ---------- the whole screen ---------- */
  function draw(el, r) {
    const res = r[0];
    last = res;
    const pages = res.teams || [];
    if (S.team && !pages.some(p => p.team === S.team)) S.team = '';
    const shown = pages.filter(p => !S.team || p.team === S.team);
    const teamChips = '<div class="chips lb-teams" role="group" aria-label="Team">' +
      '<button class="chip" data-act="lb-team" data-t="" aria-pressed="' + !S.team + '">All teams</button>' +
      pages.map(p => '<button class="chip" data-act="lb-team" data-t="' + esc(p.team) + '" aria-pressed="' + (S.team === p.team) + '">Team ' + esc(p.team) +
        ' <span class="sub">' + (p.rows || []).length + '</span></button>').join('') + '</div>';
    el.innerHTML = header() + '<div id="lb-warn" role="alert">' + warnHtml() + '</div>' + teamChips +
      (shown.length ? '<div class="lb-list">' + shown.map(p => sheet(p, res.date)).join('') + '</div>'
        : '<div class="empty">No active teams in the Teams tab.</div>');
  }

  function renderLogbook(el) {
    // A day not seen before: show its header and "Loading…" at once (not the old day's pages)
    if (!cacheGet(cacheKey('screen.logbook', calls()))) el.innerHTML = header() + '<div class="empty">Loading…</div>';
    I().loadScreen(el, 'logbook', 'Log book', calls(), draw);
  }

  /* ---------- unsaved costs: the warning box and leaving the day or the screen ---------- */
  const failed = () => Object.keys(drafts).filter(k => drafts[k].state === 'failed');
  // "Costs for Team B, Tue 6 Oct could not be saved." + Try again (all) + the way out
  function warnHtml(leaving) {
    const f = failed();
    if (!f.length) return '';
    const what = f.map(k => { const p = k.split('|'); return 'Team ' + esc(p[1]) + ', ' + esc(lab(p[0])); }).join('; ');
    return '<div class="box warn lb-warn"><b>Costs not saved: ' + what + '.</b> ' +
      (leaving ? 'Leave anyway? The typed costs are kept on this screen until you close the app. ' : 'The typed costs are kept here. ') +
      '<button class="btn sm pri" data-act="lb-retry-all">Try again</button>' +
      (leaving ? ' <button class="btn sm" data-act="lb-leave">Leave anyway</button>' : '') + '</div>';
  }
  function showWarn(leaving) { const w = $('#lb-warn'); if (w) w.innerHTML = warnHtml(leaving); }

  /* Before leaving this screen or day: a save that failed is pointed out ONCE (the same
     leave tried again goes ahead). Boxes still being typed in are saved first.
     App.leaveGuard(target) is asked by app.js before another menu item opens. */
  let pendingLeave = null;
  function mayLeave(target, go) {
    flushAll();
    if (!failed().length || warnedLeave === target) { warnedLeave = ''; return true; }
    warnedLeave = target; pendingLeave = go;
    showWarn(true);
    const w = $('#lb-warn'); if (w && w.scrollIntoView) w.scrollIntoView({ block: 'center' });
    return false;
  }
  App.leaveGuard = target => App.adminTab !== 'logbook' || mayLeave('tab:' + target, () => { App.adminTab = target; renderAdmin(); });
  onAct('lb-leave', () => { const go = pendingLeave; pendingLeave = null; if (go) go(); });
  // Closing the browser tab with unsaved costs: the browser's own "Leave site?" question
  window.addEventListener('beforeunload', e => { if (Object.keys(drafts).length) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- buttons ---------- */
  const goDate = d => {
    if (!mayLeave('day:' + d, () => goDate(d))) { const i = $('.lb-dt'); if (i) i.value = dateNow(); return; }
    warnedLeave = '';
    S.date = d === todayIso() ? '' : d; renderAdmin();
  };
  onAct('lb-day', el => goDate(addD(dateNow(), Number(el.dataset.d))));
  onAct('lb-today', () => goDate(todayIso()));
  onChg('lb-date', el => { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value)) goDate(el.value); });
  onAct('lb-team', el => { S.team = el.dataset.t || ''; if (last) draw($('#ad-logbook'), [last]); });
  // Print: the browser's print box; admin.css prints only the pages (empty ones are left out)
  onAct('lb-print', () => window.print());

  // Typing a cost: the printed value and the total follow at once
  onInp('lb-cost', el => {
    const sh = el.closest('.lb-sheet');
    if (!sh) return;
    const k = el.dataset.k, pv = sh.querySelector('[data-pv="' + k + '"]');
    if (pv) pv.textContent = k === 'note' ? el.value : (Number(el.value) ? inr(el.value) : '');
    const sum = ['advance', 'petrol', 'repair'].reduce((a, x) => a + (Number(sh.querySelector('input[data-k="' + x + '"]').value) || 0), 0);
    sh.querySelector('[data-tot]').textContent = inr(sum);
    // Remember what is typed (not saved yet); it is saved when the box is left
    const date = sh.dataset.date, team = sh.dataset.team, d = drafts[dkey(date, team)];
    drafts[dkey(date, team)] = { body: bodyOf(sh), state: d && d.state === 'failed' ? 'failed' : 'waiting', why: d ? d.why : '' };
    delete justSaved[dkey(date, team)];
    clearTimeout(timers[dkey(date, team)]);   // still typing: no save yet
  });

  // The costs of one page as logbook.setCosts wants them
  function bodyOf(sh) {
    const val = k => sh.querySelector('input[data-k="' + k + '"]').value.trim().replace(/,/g, '');
    return { date: sh.dataset.date, team: sh.dataset.team, advance: val('advance'), petrol: val('petrol'), repair: val('repair'),
      note: sh.querySelector('input[data-k="note"]').value.trim() };
  }
  // Redraw the save note of one page (if it is on screen)
  function paintState(date, team) {
    const sh = document.querySelector('#ad-logbook .lb-sheet[data-team="' + team + '"][data-date="' + date + '"]');
    if (sh) sh.querySelector('[data-ss]').innerHTML = stateHtml(date, team);
    showWarn(false);
  }

  /* Leaving a cost box saves that vehicle's costs: a short wait first (600 ms), so moving on to
     the next box of the same page gives ONE save, not one per box. */
  document.addEventListener('focusout', e => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('#ad-logbook input[data-inp="lb-cost"]')) return;
    const sh = el.closest('.lb-sheet');
    if (!sh) return;
    const k = dkey(sh.dataset.date, sh.dataset.team);
    if (!drafts[k] || drafts[k].state === 'saving') return;   // nothing new typed
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => saveCosts(k), 600);
    paintState(sh.dataset.date, sh.dataset.team);   // "Not saved yet…" for that moment
  });
  // Typing again in the same page before the wait is over: wait for that box too
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (!el || !el.matches || !el.matches('#ad-logbook input[data-inp="lb-cost"]')) return;
    const sh = el.closest('.lb-sheet');
    if (sh) clearTimeout(timers[dkey(sh.dataset.date, sh.dataset.team)]);
  });
  // Save at once whatever is waiting (before the day or the screen changes)
  function flushAll() {
    Object.keys(drafts).forEach(k => { if (drafts[k].state === 'waiting') { clearTimeout(timers[k]); saveCosts(k); } });
  }

  // Save the costs of one vehicle for one day (logbook.setCosts). Checked here first: numbers, 0 or more.
  async function saveCosts(k) {
    const d = drafts[k];
    if (!d || d.state === 'saving') return;
    const body = d.body, p = k.split('|');
    const badK = ['advance', 'petrol', 'repair'].find(x => body[x] !== '' && !(Number(body[x]) >= 0));
    if (badK) { d.state = 'failed'; d.why = badK.charAt(0).toUpperCase() + badK.slice(1) + ' must be a number, 0 or more'; paintState(p[0], p[1]); return; }
    d.state = 'saving'; d.why = '';
    paintState(p[0], p[1]);
    try {
      const c = await api('logbook.setCosts', body);   // flat reply: {date, team, advance, petrol, repair, note, updated_by, updated_at}
      // Typed again while saving: keep the newer values for the next save
      if (drafts[k] === d && JSON.stringify(d.body) === JSON.stringify(body)) { delete drafts[k]; justSaved[k] = true; }
      else if (drafts[k]) drafts[k].state = 'waiting';
      // Keep the screen's saved copy in step, so going away and back shows the new costs at once
      if (last && last.date === c.date) {
        const pg = (last.teams || []).find(x => x.team === c.team);
        if (pg) pg.costs = { advance: c.advance, petrol: c.petrol, repair: c.repair, note: c.note, updated_by: c.updated_by, updated_at: c.updated_at };
        cachePut(cacheKey('screen.logbook', [['logbook.get', { date: c.date }]]), [last]);
      } else cacheDrop(['screen.logbook']);
      const sh = document.querySelector('#ad-logbook .lb-sheet[data-team="' + c.team + '"][data-date="' + c.date + '"]');
      if (sh) {
        sh.querySelector('[data-by]').innerHTML = savedBy(c);
        sh.classList.toggle('lb-empty', !sh.querySelector('.lb-tbl tbody tr:not(.lb-pad):not(.lb-none)') && !(c.advance || c.petrol || c.repair || c.note));
      }
      cacheDrop(['screen.reports']);   // the month's costs on Reports changed
      paintState(p[0], p[1]);
      if (drafts[k] && drafts[k].state === 'waiting') saveCosts(k);   // the newer values
    } catch (e) {
      if (drafts[k] === d) { d.state = 'failed'; d.why = e.message === 'AUTH' ? '' : I().errText(e); }
      paintState(p[0], p[1]);
      // Not on the Log book any more: say so, the typed costs are kept
      if (App.adminTab !== 'logbook' && e.message !== 'AUTH') toast('Log book costs for Team ' + p[1] + ', ' + lab(p[0]) + ' were not saved. Open Log book to try again.');
    }
  }
  onAct('lb-save', btn => { const k = dkey(btn.dataset.date, btn.dataset.team); if (drafts[k]) { drafts[k].state = 'waiting'; saveCosts(k); } });
  onAct('lb-retry-all', () => { failed().forEach(k => { drafts[k].state = 'waiting'; saveCosts(k); }); warnedLeave = ''; });

  registerScreen('admin', 'logbook', renderLogbook);
})();
