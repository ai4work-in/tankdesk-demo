/* ==========================================================================
   admin-logbook.js: the Log book screen (#ad-logbook, admin only). Added 2026-10-08.

   The agency's paper log book has one page per vehicle (ગાડી નં.) per day (તારીખ):
     ક્રમાંક (no.) | વર્કરનું નામ (worker) | બિલ્ડિંગ / જગ્યાનું નામ (building) | મેઝરમેન્ટ (measurement)
   and at the bottom the day's costs: એડવાન્સ (advance), પેટ્રોલ (petrol), રીપેર (repair).
   This screen draws the same page from the app's data:
     - the jobs: that team's orders of the day, in time order, with the crew and the
       tank sizes the driver saved at "work done"
     - the costs: typed here by an admin and saved with Save (logbook.setCosts).
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
    const rows = p.rows || [], c = p.costs || {};
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

    return '<article class="card lb-sheet' + (!rows.length && !hasCosts ? ' lb-empty' : '') + '" data-team="' + esc(p.team) + '">' +
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
      '<button class="btn pri" data-act="lb-save" data-team="' + esc(p.team) + '">Save costs</button>' +
      '<span class="sub lb-by" data-by>' + savedBy(c) + '</span></div></div>' +
      '</article>';
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
    el.innerHTML = header() + teamChips +
      (shown.length ? '<div class="lb-list">' + shown.map(p => sheet(p, res.date)).join('') + '</div>'
        : '<div class="empty">No active teams in the Teams tab.</div>');
  }

  function renderLogbook(el) {
    // A day not seen before: show its header and "Loading…" at once (not the old day's pages)
    if (!cacheGet(cacheKey('screen.logbook', calls()))) el.innerHTML = header() + '<div class="empty">Loading…</div>';
    I().loadScreen(el, 'logbook', 'Log book', calls(), draw);
  }

  /* ---------- buttons ---------- */
  const goDate = d => { S.date = d === todayIso() ? '' : d; renderAdmin(); };
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
  });

  // Save costs of one vehicle for the day (logbook.setCosts). Checked here first: numbers, 0 or more.
  onAct('lb-save', async btn => {
    const sh = btn.closest('.lb-sheet'), team = btn.dataset.team, date = dateNow();
    const val = k => sh.querySelector('input[data-k="' + k + '"]').value.trim().replace(/,/g, '');
    const body = { date: date, team: team, advance: val('advance'), petrol: val('petrol'), repair: val('repair'),
      note: sh.querySelector('input[data-k="note"]').value.trim() };
    const badK = ['advance', 'petrol', 'repair'].find(k => body[k] !== '' && !(Number(body[k]) >= 0));
    if (badK) { toast(badK.charAt(0).toUpperCase() + badK.slice(1) + ' must be a number, 0 or more.'); return; }
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const c = await api('logbook.setCosts', body);   // flat reply: {date, team, advance, petrol, repair, note, updated_by, updated_at}
      // Keep the screen's saved copy in step, so going away and back shows the new costs at once
      if (last && last.date === c.date) {
        const p = (last.teams || []).find(x => x.team === c.team);
        if (p) p.costs = { advance: c.advance, petrol: c.petrol, repair: c.repair, note: c.note, updated_by: c.updated_by, updated_at: c.updated_at };
        cachePut(cacheKey('screen.logbook', [['logbook.get', { date: c.date }]]), [last]);
      }
      if (document.body.contains(sh)) {
        sh.querySelector('[data-by]').innerHTML = savedBy(c);
        sh.classList.toggle('lb-empty', !sh.querySelector('.lb-tbl tbody tr:not(.lb-pad):not(.lb-none)') && !(c.advance || c.petrol || c.repair || c.note));
      }
      cacheDrop(['screen.reports']);   // the month's costs on Reports changed
      toast('Costs saved for Team ' + c.team + ', ' + lab(c.date) + '.');
    } catch (e) {
      if (e.message !== 'AUTH') toast(I().errText(e));
    } finally {
      btn.disabled = false; btn.textContent = 'Save costs';
    }
  });

  registerScreen('admin', 'logbook', renderLogbook);
})();
