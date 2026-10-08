/* ==========================================================================
   collector.js: the PAYMENT COLLECTOR screens (Gujarati, or English when chosen), in chat style.
   Staff already know WhatsApp, so the screens work the same way:
     todo ("કલેક્શન લેજર")   a chat list: ONE row per client (phone number) with the
                             total still to pay and the number of jobs ("2 કામ").
                             A search box (name or phone) and a Call button on each row.
                             Tap a row -> a chat opens, money is "sent" from the
                             message box at the bottom.
     done ("આજનું કલેક્શન")  a chat list of the payments taken today, with the cash
                             to hand over to the office in one big line.

   One client, several jobs (added 2026-10-08): the chat shows each unpaid job
   (date and balance). A payment can be up to the client's TOTAL; the server
   splits it over the jobs, OLDEST JOB FIRST (payment.add with phone, ledger.gs).

   PRIVACY: the collector sees only name, phone, address, area, job date and balance.
   The server sends nothing else, and this file never shows services.

   Uses shared helpers:
     chat.js   WA.row, WA.bubble, WA.openChat ... (the chat look)
     driver.js guErr, telUrl, Phone.reload (loaded before this file)
     common.js labT, tr, TX (the words in Gujarati or English)
     app.js    setTabCount, renderPhone
   Styles: the "collector" sections of phone.css.
   ========================================================================== */

const CO = {
  data: null,      // reply of ledger.get: {rows, total, today_payments} (null = not loaded yet)
  loading: false,
  error: '',
  busy: false,     // true while a payment is on its way to the server (stops double taps)
  sending: null,   // the payment on its way (null = none)
  lockUntil: 0,    // after "હા, સેવ કરો" every send/confirm button stays off until this time (ms), against double taps
  ask: null,       // the payment shown in the confirm sheet, waiting for "હા, સેવ કરો" (null = no sheet open)
  area: '',        // area chip picked on the list ('' = all areas)
  q: '',           // search text on the list (name or phone)
  chat: null,      // the open chat: {phone, name, address, area, balance, jobs, amt, mode, note, noWa}
  failed: null,    // a payment that did not reach the server (network): it is sent again by itself
  retryTimer: 0,
  again: false,    // a reload was asked for while one was already running: run once more after it
  token: ''        // which login the data belongs to
};
const CO_MODES = ['cash', 'upi', 'cheque', 'bank', 'other'];
const CO_RETRY_MS = 8000;   // a payment that failed on the network is sent again every 8 seconds
// (the office's messages show TX.office as the sender)

const coArea = r => r.area || 'other';
// Area name in the chosen language (name_gu or name_en)
const coAreaT = k => { const a = (App.setup.areas || []).find(x => x.key === k); return a ? nameOf(a) : TX.other_area; };
// "3 ગ્રાહક" / "3 customers"
const coCust = n => tr(n + ' ગ્રાહક', n + (n === 1 ? ' customer' : ' customers'));
// "2 કામ" / "2 jobs"
const coJobsT = n => tr(n + ' કામ', n + (n === 1 ? ' job' : ' jobs'));
const coTime = t => (t ? fm(mins(t)) : '');   // "14:05" -> "2:05 PM"
const coNowTime = () => fm(nowMin());
const coModeT = k => lbl(MODE[k] || MODE.other);   // payment mode in the chosen language
const coRound = n => Math.round(Number(n) * 100) / 100;
// Client without WhatsApp (whatsapp 'no'): no thank-you WhatsApp is sent, the collector says the receipt in person
const coNoWa = r => !!r && String(r.whatsapp || '').toLowerCase() === 'no';
// The receipt words to say: "₹1,000 મળ્યા, આભાર. બાકી ₹500." (same as the payment_thanks template).
// Always Gujarati (the customer hears it); in English mode the meaning shows under it. Returns HTML.
const coSayReceipt = (amt, bal) => guText(esc('«' + inr(amt) + ' મળ્યા, આભાર.' + (bal > 0 ? ' બાકી ' + inr(bal) + '.' : ' પૂરું ચૂકવાઈ ગયું.') + '»')) +
  enMean(esc(CUST_EN.receipt(amt, bal)));
// A job's date for the collector ("સોમ 20 સપ્ટે"), or its number when the date is missing
const coJobDate = j => (j.sched_date ? labT(j.sched_date) : '#' + j.order_id);
// Oldest job first (date, then order number): the same order the server pays them in
const coJobSort = (a, b) => (a.sched_date || '') < (b.sched_date || '') ? -1 : (a.sched_date || '') > (b.sched_date || '') ? 1 : a.order_id - b.order_id;

/* ---------- one line per client ----------
   The server sends one row per JOB. Here they are put together per phone number:
   {phone, name, address, area, balance (total), whatsapp, jobs: [{order_id, sched_date, balance}] oldest first} */
function coClients() {
  const by = {};
  ((CO.data && CO.data.rows) || []).filter(r => r.balance > 0).forEach(r => {
    const k = String(r.phone || '#' + r.order_id);
    (by[k] = by[k] || []).push(r);
  });
  return Object.keys(by).map(k => {
    const jobs = by[k].slice().sort(coJobSort);
    const last = jobs[jobs.length - 1];   // the newest job has the latest name and address
    return {
      phone: k, name: last.client_name, address: last.address || '', area: coArea(last),
      whatsapp: jobs.some(coNoWa) ? 'no' : 'yes',
      balance: coRound(jobs.reduce((a, j) => a + j.balance, 0)),
      jobs: jobs.map(j => ({ order_id: j.order_id, sched_date: j.sched_date || '', balance: j.balance }))
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
const coClient = phone => coClients().find(c => c.phone === String(phone));

/* ---------- how a payment is split over the jobs (same rule as the server) ----------
   Oldest job first, each job filled up before the next one.
   Returns [{order_id, sched_date, take, left}] for the jobs the money reaches. */
function coSplit(jobs, amt) {
  let rest = Number(amt) || 0;
  const out = [];
  for (const j of jobs) {
    if (rest <= 0) break;
    const take = coRound(Math.min(rest, j.balance));
    rest = coRound(rest - take);
    out.push({ order_id: j.order_id, sched_date: j.sched_date, take, left: coRound(j.balance - take) });
  }
  return out;
}

/* ---------- load the to-collect list ----------
   Speed: apiCached() first draws the copy saved on the phone (instant), then asks
   the server (1-2 seconds on mobile data) and redraws only if something changed.
   While the server is being asked, the total line says "updating…". */
const coUpdating = () => TX.updating;

// Redraw the open tab. An open chat sits on top of the list, so it is not disturbed.
function coRedraw() {
  if (!App.session || App.session.role !== 'collector' || $('#v-phone').hidden) return;
  const el = $('#ph-body'), top = el.scrollTop;
  renderPhone();
  el.scrollTop = top;
}
// Show or hide the quiet "updating…" mark in the total line (no full redraw)
function coMarkUpdating(on) {
  const t = $('.co-total'), old = $('.co-upd');
  if (old && !on) old.remove();
  if (t && on && !old) t.insertAdjacentHTML('beforeend', '<span class="co-upd"> · ' + coUpdating() + '</span>');
}

async function coLoad() {
  if (CO.loading) { CO.again = true; return; }
  CO.again = false;
  CO.loading = true;
  const tok = App.session && App.session.token;
  let sync = true;        // true while apiCached is drawing the saved copy (we may be inside a redraw already)
  let redrawn = false;
  const draw = data => {
    if (!App.session || App.session.token !== tok) return;
    CO.data = data; CO.token = tok; CO.error = '';
    if (!sync) { redrawn = true; CO.loading = false; coRedraw(); }
  };
  const job = apiCached('ledger.get', {}, draw);
  sync = false;
  coMarkUpdating(true);
  try {
    await job;
  } catch (e) {
    if (e.message === 'AUTH') { CO.loading = false; return; }
    CO.error = guErr(e);
    redrawn = false;
  }
  CO.loading = false;
  if (!redrawn) coRedraw();   // nothing new (or an error): just take away the "updating…" mark
  if (CO.again) coLoad();     // something changed while we were loading (a payment): load once more
}
// Refresh button, 60-second timer and coming back to the app: skip while a chat is open,
// so the collector is never interrupted in the middle of typing an amount.
Phone.reload.collector = () => { if (!WA.chatOpen()) coLoad(); };
// Language switched (app.js): redraw an open chat in the new words, keeping what was typed.
// Not while a payment is being checked or saved (nothing must be lost there).
Phone.relang.collector = () => {
  const c = CO.chat, cl = c && coClient(c.phone);
  if (!c || !cl || !WA.chatOpen() || CO.ask || CO.busy || CO.failed || $('#co-pend')) return;
  const keep = { amt: c.amt, mode: c.mode, note: c.note };
  coOpenChat(cl);
  Object.assign(CO.chat, keep);
  if (CO.chat.balance > 0) { coSetBottom(coComposer()); coSync(); }
};

// The "updating…" mark for the total line while the server is being asked
const coUpd = () => (CO.loading ? '<span class="co-upd"> · ' + coUpdating() + '</span>' : '');

// Common start of every collector page: loading / error / data
function coReady(el) {
  if (CO.token !== App.session.token) {
    clearTimeout(CO.retryTimer);
    Object.assign(CO, { data: null, error: '', chat: null, failed: null, sending: null, area: '', q: '', token: App.session.token });
  }
  if (!WA.chatOpen()) CO.chat = null;   // the chat was closed some other way (menu, tab)
  if (!CO.data && !CO.loading && !CO.error) coLoad();   // draws the saved copy at once if there is one
  if (CO.data) return true;
  if (CO.error) el.innerHTML = '<div class="co-pad"><div class="box bad">' + esc(CO.error) + '</div>' +
    '<button class="btn lg" data-act="ph-refresh">' + TX.try_again + '</button></div>';
  else el.innerHTML = '<div class="empty">' + TX.loading + '</div>';
  return false;
}

/* ==========================================================================
   TAB 1: TO COLLECT (chat list, one row per client)
   ========================================================================== */
registerScreen('collector', 'todo', el => {
  if (!coReady(el)) return;
  const L = coClients();
  setTabCount('todo', L.length);
  // Areas that have someone to collect from, in alphabetical order ("other" last)
  const areas = Array.from(new Set(L.map(c => c.area))).sort((x, y) => (x === 'other') - (y === 'other') || coAreaT(x).localeCompare(coAreaT(y)));
  const af = areas.includes(CO.area) ? CO.area : '';
  const LL = af ? L.filter(c => c.area === af) : L;
  const sum = list => list.reduce((a, c) => a + c.balance, 0);

  let h = '';
  if (CO.error) h += '<div class="co-pad"><div class="box bad">' + esc(CO.error) + '</div></div>';
  // Search box: name or phone. Filters the rows below at once (no reload).
  h += '<div class="co-search"><input type="search" id="co-q" autocomplete="off" enterkeyhint="search" data-inp="co-q" value="' + esc(CO.q) + '"' +
    ' placeholder="' + esc(tr('નામ અથવા ફોન નંબર શોધો', 'Search name or phone')) + '" aria-label="' + esc(tr('ગ્રાહક શોધો', 'Search client')) + '"></div>';
  // Area filter chips (scroll sideways when there are many areas)
  h += '<div class="wa-chips co-areas" role="group" aria-label="' + esc(tr('વિસ્તાર પ્રમાણે જુઓ', 'Show by area')) + '">' +
    '<button aria-pressed="' + (af === '') + '" data-act="co-area" data-a="">' + tr('બધા', 'All') + ' · ' + L.length + '</button>' +
    areas.map(k => '<button aria-pressed="' + (af === k) + '" data-act="co-area" data-a="' + esc(k) + '">' +
      esc(coAreaT(k)) + ' · ' + L.filter(c => c.area === k).length + '</button>').join('') + '</div>';
  // Total line
  h += '<div class="co-total">' + (af ? tr(esc(coAreaT(af)) + ' માં બાકી ', 'Due in ' + esc(coAreaT(af)) + ' ') : TX.total_due + ' ') +
    '<b>' + inr(sum(LL)) + '</b> · ' + coCust(LL.length) + coUpd() + '</div>';

  // One chat row per client: total in the "time" spot, number of jobs, area and address as the last line.
  // A round Call button sits at the right end of the row (48 px).
  const row = c => '<div class="co-rw" data-q="' + esc((c.name + ' ' + String(c.phone).replace(/\D/g, '').slice(-10)).toLowerCase()) + '">' +
    WA.row({
      name: c.name, time: inr(c.balance), timeHot: true,
      preview: (coNoWa(c) ? '<span class="dr-nowa">' + esc(TX.no_wa) + '</span> ' : '') +
        (c.jobs.length > 1 ? '<b class="co-njobs">' + esc(coJobsT(c.jobs.length)) + '</b> · ' : '') +
        esc(coAreaT(c.area) + ' · ' + c.address),
      act: 'co-open', data: { phone: c.phone }
    }) +
    '<a class="co-call" href="' + telUrl(c.phone) + '" aria-label="' + esc(tr(c.name + ' ને ફોન કરો', 'Call ' + c.name)) + '">' + WA.icons.call + '</a></div>';

  if (!LL.length) h += '<div class="empty">' + tr('કોઈ બાકી પેમેન્ટ નથી.', 'No payments due.') + '</div>';
  else if (af) h += '<div class="wa-list co-list">' + LL.map(row).join('') + '</div>';
  else h += '<div class="wa-list co-list">' + areas.map(k => {
    const g = L.filter(c => c.area === k);
    return '<div class="co-grp">' + WA.sec(coAreaT(k) + ' · ' + coCust(g.length) + ' · ' + inr(sum(g))) + g.map(row).join('') + '</div>';
  }).join('') + '</div>';
  h += '<div class="empty co-nomatch" hidden>' + tr('આ નામ કે નંબરનું કોઈ નથી.', 'Nobody with this name or number.') + '</div>';
  el.innerHTML = h;
  coFilter();
});
onAct('co-area', btn => { CO.area = btn.dataset.a; renderPhone(); });

// Search: hide the rows that do not match (the box keeps its focus, nothing is redrawn)
function coFilter() {
  const q = CO.q.trim().toLowerCase(), qd = q.replace(/\D/g, '');
  let any = false;
  $$('.co-rw').forEach(r => {
    const t = r.dataset.q || '';
    const hit = !q || t.includes(q) || (qd.length >= 3 && t.includes(qd));
    r.hidden = !hit;
    if (hit) any = true;
  });
  $$('.co-grp').forEach(g => { g.hidden = !g.querySelector('.co-rw:not([hidden])'); });
  const none = $('.co-nomatch');
  if (none) none.hidden = any || !$$('.co-rw').length;
}
onInp('co-q', inp => { CO.q = inp.value; coFilter(); });

/* ==========================================================================
   TAB 2: TODAY'S COLLECTION (chat list of payments)
   ========================================================================== */
// Today's payments, newest first. The parts of one payment split over several jobs
// (same client, time, mode and note) are shown as ONE line with the full amount.
function coTodayGroups(list) {
  const out = [], by = {};
  list.slice().sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0)).forEach(p => {
    const k = [p.phone || p.client_name, p.time, p.mode, p.note || '', p.cancelled ? 1 : 0].join('|');
    if (by[k]) { by[k].amount = coRound(by[k].amount + Number(p.amount || 0)); return; }
    by[k] = Object.assign({}, p, { amount: Number(p.amount || 0) });
    out.push(by[k]);
  });
  return out;
}

registerScreen('collector', 'done', el => {
  if (!coReady(el)) return;
  setTabCount('todo', coClients().length);
  const td = coTodayGroups(CO.data.today_payments || []);
  const live = td.filter(p => !p.cancelled);   // a payment cancelled by the office does not count
  const total = live.reduce((a, p) => a + p.amount, 0);
  let h = '<div class="co-total">' + esc(labT(todayIso())) + tr(' · આજે કુલ મળ્યા ', ' · received today ') + '<b>' + inr(total) + '</b> · ' +
    tr(live.length + ' પેમેન્ટ', live.length + (live.length === 1 ? ' payment' : ' payments')) + coUpd() + '</div>';
  if (live.length) {
    // The cash to hand over at the office, in one big line, then the total per mode (રોકડ ₹X · UPI ₹Y ...)
    const byMode = {};
    live.forEach(p => { const k = CO_MODES.includes(p.mode) ? p.mode : 'other'; byMode[k] = (byMode[k] || 0) + p.amount; });
    h += '<div class="co-cash">' + tr('ઓફિસમાં આપવાની રોકડ', 'Cash to give the office') + ' <b>' + inr(byMode.cash || 0) + '</b></div>';
    h += '<div class="co-modesum" aria-label="' + esc(tr('રીત પ્રમાણે કુલ', 'Total by mode')) + '">' + CO_MODES.filter(k => byMode[k]).map(k =>
      '<span class="co-ms' + (k === 'cash' ? ' cash' : '') + '">' + esc(coModeT(k)) + ' <b>' + inr(byMode[k]) + '</b></span>').join('') + '</div>';
  }
  h += td.length
    ? '<div class="wa-list co-list">' + td.map(p => '<div class="co-rw' + (p.cancelled ? ' co-cx' : '') + '">' + WA.row({
      name: p.client_name, time: inr(p.amount), timeHot: !p.cancelled,
      preview: (p.cancelled ? '<b class="co-cxt">' + tr('ઓફિસે રદ કર્યું', 'Cancelled by the office') + '</b> · ' : '') +
        esc(coModeT(p.mode) + ' · ' + coTime(p.time)) + (p.note ? ' · ' + esc(p.note) : ''),   // the note: e.g. the cheque number and bank
      act: 'co-noop'
    }) + '</div>').join('') + '</div>'
    : '<div class="empty">' + tr('આજે હજી કોઈ કલેક્શન નથી.', 'No collection yet today.') + '</div>';
  el.innerHTML = h;
});

/* ==========================================================================
   THE PAYMENT CHAT
   ========================================================================== */

/* MONEY SAFETY (why the payment box works like this):
   - The amount box starts EMPTY and NO mode is picked, so one careless tap can never
     record a full cash payment. "પૂરી રકમ" fills the box only when tapped.
   - A cheque needs its number and bank in the note (a cheque can bounce).
   - Send opens a confirm sheet ("₹2,000 · UPI · name", and which jobs it pays). Only "હા, સેવ કરો" saves.
   - While saving, and for 1.5 s after "હા, સેવ કરો", every send/confirm button is off,
     so a double tap can never save a second payment.
   - Each confirmed payment gets its own code (ref). If the network fails it is sent
     again by itself with the SAME code, and the server saves each code only once. */
const CO_LOCK_MS = 1500;    // pause after "હા, સેવ કરો" (milliseconds)
const CO_ARM_MS = 600;      // the confirm buttons wake up this long after the sheet opens (a double tap on send cannot hit "હા")
const coLocked = () => CO.busy || Date.now() < CO.lockUntil;

// Note box words: for a cheque the number and bank are needed
const coNotePh = mode => (mode === 'cheque' ? tr('ચેક નંબર અને બેંક (જરૂરી)', 'Cheque no. and bank (needed)') : tr('નોંધ (જરૂરી નથી)', 'Note (optional)'));
const coNeedsNote = c => c.mode === 'cheque' && !String(c.note || '').trim();

// The line under the amount: what is missing or wrong, or full / partial payment.
// Returns {text, bad}: bad = true shows it in red (amount more than the balance).
function coNote(c) {
  const amt = c.amt, bal = c.balance, n = Number(amt);
  if (amt !== '' && n > bal) return { text: tr('રકમ બાકી ' + inr(bal) + ' કરતાં વધારે છે. સાચી રકમ લખો.', 'The amount is more than the balance ' + inr(bal) + '. Enter the right amount.'), bad: true };
  if (!(n > 0)) return { text: tr('કેટલા મળ્યા તે લખો, પછી રીત પસંદ કરો.', 'Enter how much you got, then pick the mode.'), bad: false };
  if (!c.mode) return { text: tr('કઈ રીતે મળ્યા? ઉપર રોકડ / UPI / ચેક… પસંદ કરો.', 'How was it paid? Pick Cash / UPI / Cheque… above.'), bad: false };
  if (coNeedsNote(c)) return { text: tr('ચેક નંબર અને બેંકનું નામ નોંધમાં લખો.', 'Write the cheque number and bank in the note.'), bad: false };
  return { text: n === bal ? tr('પૂરું પેમેન્ટ ✓', 'Full payment ✓') : tr('અધૂરું પેમેન્ટ. બાકી ' + inr(bal - n) + ' હજી લેવાના રહેશે.', 'Part payment. ' + inr(bal - n) + ' still to collect.'), bad: false };
}
const coAmtOk = (amt, bal) => Number(amt) > 0 && Number(amt) <= bal;
// Send can be pressed only with a good amount AND a mode (and a cheque note), when nothing is being saved or retried
const coCanSend = c => !!c && coAmtOk(c.amt, c.balance) && CO_MODES.includes(c.mode) && !coNeedsNote(c) && !coLocked() && !CO.failed && !CO.sending;

// The unpaid jobs, one line each: "સોમ 20 સપ્ટે  ₹1,000" (HTML)
const coJobLines = jobs => '<ul class="co-jobs">' + jobs.map(j => '<li><span>' + esc(coJobDate(j)) + '</span><b>' + inr(j.balance) + '</b></li>').join('') + '</ul>';
// Office message with the new balance (after a payment); with 2+ jobs left, each job's balance too
const coBalBubble = (bal, time, jobs) => WA.bubble('in', (bal > 0 ? tr('બાકી', 'Balance') + ' <b>' + inr(bal) + '</b>' : '<b>' + tr('પૂરું ચૂકવાઈ ગયું ✓', 'Fully paid ✓') + '</b>') +
  (jobs && jobs.length > 1 ? coJobLines(jobs) : ''), time, { who: TX.office });
// "₹1,000 મળ્યા · UPI" with two ticks (like a delivered message)
const coPaidBubble = (amt, mode, note, time) => WA.bubble('out', '<b>' + inr(amt) + '</b> ' + tr('મળ્યા', 'received') + ' · ' + esc(coModeT(mode)) +
  (note ? '<br><span class="sub">' + esc(note) + '</span>' : ''), time, { ticks: 2 });

// The bottom of the chat: payment mode chips, then the message box with the amount and the note
function coComposer() {
  const c = CO.chat;
  const note = coNote(c);
  return '<div class="co-pay">' +
    '<div class="wa-chips co-modes" role="group" aria-label="' + esc(tr('કઈ રીતે મળ્યા?', 'How was it paid?')) + '">' +
    CO_MODES.map(k => '<button aria-pressed="' + (c.mode === k) + '" data-act="co-mode" data-v="' + k + '">' + esc(lbl(MODE[k])) + '</button>').join('') +
    '</div>' +
    '<div class="wa-compose"><div class="box-in co-box">' +
    '<div class="co-amt-line"><span class="co-rs" aria-hidden="true">₹</span>' +
    '<input id="co-amt" inputmode="numeric" autocomplete="off" placeholder="' + esc(tr('કેટલા મળ્યા?', 'Amount received')) + '" aria-label="' + esc(tr('કેટલા મળ્યા? (₹)', 'Amount received (₹)')) + '" aria-describedby="co-note"' +
    (note.bad ? ' aria-invalid="true"' : '') + ' value="' + esc(c.amt) + '" data-inp="co-amt">' +
    '<button class="co-full" data-act="co-full">' + tr('પૂરી રકમ', 'Full amount') + '</button></div>' +
    '<input id="co-note-in" class="co-note-in" autocomplete="off" placeholder="' + esc(coNotePh(c.mode)) + '" aria-label="' + esc(coNotePh(c.mode)) + '" value="' + esc(c.note) + '" data-inp="co-note">' +
    '</div>' +
    '<button class="wa-send" id="co-save" data-act="co-save" aria-label="' + esc(tr('આગળ: રકમ ચકાસો', 'Next: check the amount')) + '"' + (coCanSend(c) ? '' : ' disabled') + '>' + WA.icons.send + '</button></div>' +
    '<div class="co-hint' + (note.bad ? ' co-err' : '') + '" id="co-note" role="status">' + esc(note.text) + '</div></div>';
}

// When the client has paid everything, the message box is replaced by one "back" button
const coDoneBottom = () => WA.quick([{ label: TX.back_to_list, act: 'co-back', cls: 'pri full' }]);
// While a payment that failed on the network is being sent again: no message box, only this line
// (ONE way to retry: the payment itself is sent again; the collector never types it twice)
function coRetryBottom(f) {
  const mine = CO.chat && f && CO.chat.phone === f.phone;
  return '<div class="co-pay co-wait co-retrying" role="status">' + (mine ? tr('ફરી પ્રયત્ન થાય છે…', 'Retrying…')
    : tr('પહેલાનું પેમેન્ટ (' + f.name + ' ' + inr(f.amt) + ') ફરી મોકલાય છે…', 'The previous payment (' + f.name + ' ' + inr(f.amt) + ') is being sent again…')) + '</div>';
}
// The right bottom for the open chat: retry line, waiting line, message box or back button
function coBottom() {
  const c = CO.chat;
  if (CO.failed) return coRetryBottom(CO.failed);
  if (CO.sending) return coWaitBottom();
  return c.balance > 0 ? coComposer() : coDoneBottom();
}

function coOpenChat(cl) {
  // Payments already taken today from this client (oldest first; parts of one split payment as one)
  const paidToday = coTodayGroups((CO.data.today_payments || []).filter(p => !p.cancelled && String(p.phone) === String(cl.phone))).reverse();
  const before = cl.balance + paidToday.reduce((a, p) => a + p.amount, 0);
  CO.chat = { phone: cl.phone, name: cl.name, address: cl.address, area: cl.area, balance: cl.balance,
    jobs: cl.jobs.map(j => Object.assign({}, j)),
    amt: '', mode: '', note: '', noWa: coNoWa(cl) };   // EMPTY box and no mode: the collector must type and pick (money safety)
  CO.ask = null;

  // Back and Call: 48 px round buttons (co-ib), with Gujarati screen-reader words
  const call = '<a class="wa-ib co-ib" href="' + telUrl(cl.phone) + '" aria-label="' + esc(TX.call_aria) + '">' + WA.icons.call + '</a>';
  const head = WA.chatHead({ title: cl.name, sub: coAreaT(cl.area), back: 'co-back', right: call })
    .replace('class="wa-ib" data-act="co-back" aria-label="Back"', 'class="wa-ib co-ib" data-act="co-back" aria-label="' + esc(tr('પાછા', 'Back')) + '"');

  // First message: from the office, what is due and where
  let msgs = WA.day(TX.today) + WA.bubble('in',
    tr('બાકી રકમ', 'Balance due') + ' <b class="co-big">' + inr(before) + '</b>' +
    '<dl class="kv"><dt>' + TX.address + '</dt><dd>' + esc(cl.address) + '</dd>' +
    '<dt>' + TX.area + '</dt><dd>' + esc(coAreaT(cl.area)) + '</dd>' +
    '<dt>' + TX.phone + '</dt><dd><a href="' + telUrl(cl.phone) + '">' + esc(phoneText(cl.phone)) + '</a></dd></dl>' +
    (coNoWa(cl) ? '<div class="co-nowa">' + esc(TX.receipt_in_person) + '</div>' : ''), '', { who: TX.office });
  paidToday.forEach(p => { msgs += coPaidBubble(p.amount, p.mode, p.note, coTime(p.time)); });
  if (paidToday.length) msgs += coBalBubble(cl.balance, '', null);
  // The unpaid jobs (date and balance). With 2 or more: the money goes to the oldest job first.
  if (cl.balance > 0) msgs += WA.bubble('in', '<b>' + esc(tr('બાકી કામ', 'Jobs still due')) + ' · ' + esc(coJobsT(cl.jobs.length)) + '</b>' + coJobLines(cl.jobs) +
    (cl.jobs.length > 1 ? '<div class="sub">' + esc(tr('પૈસા પહેલા સૌથી જૂના કામમાં જમા થશે.', 'Money goes to the oldest job first.')) + '</div>' : ''), '', { who: TX.office });
  msgs += WA.sys(tr('રકમ લખો, રીત પસંદ કરો અને મોકલો દબાવો. "હા, સેવ કરો" પછી જ પેમેન્ટ સેવ થશે' +
    (coNoWa(cl) ? '. ગ્રાહકને WhatsApp નથી: રસીદ મોઢે જણાવો.' : ' અને ગ્રાહકને WhatsApp જશે.'),
    'Enter the amount, pick the mode and press send. The payment is saved only after "Yes, save"' +
    (coNoWa(cl) ? '. The customer has no WhatsApp: tell the receipt in person.' : ', and the customer gets a WhatsApp.')));
  // A payment from this client that is still on its way (or being sent again): show it at the end
  const f = CO.failed || CO.sending;
  if (f && f.phone === cl.phone) msgs += coPendBubble(f, CO.failed ? 'fail' : 'wait');

  WA.openChat(head, msgs, coBottom());
  WA.pushBack();   // the phone's back button closes the chat
}

// Close the chat and show the fresh list (a fully paid client is no longer in it)
function coCloseChat() {
  WA.closeChat();
  CO.chat = null; CO.ask = null;
  renderPhone();
}

onAct('co-open', btn => { const cl = coClient(btn.dataset.phone); if (cl) coOpenChat(cl); });
onAct('co-noop', () => {});
// Back arrow in the chat header: go back in history (that closes the chat, see below)
onAct('co-back', () => {
  if (history.state && history.state.chat) history.back();
  else coCloseChat();
});
// Phone back button / back gesture: chat.js has already closed the chat, we redraw the list
window.addEventListener('popstate', () => {
  if (CO.chat && !WA.chatOpen()) { CO.chat = null; CO.ask = null; if (App.session && App.session.role === 'collector') renderPhone(); }
});

// Update the hint and the send button while typing (without redrawing the chat)
let coSyncTimer = 0;
function coSync() {
  const c = CO.chat;
  if (!c || !$('#co-note')) return;
  const n = coNote(c);
  $('#co-note').textContent = n.text;
  $('#co-note').classList.toggle('co-err', n.bad);   // red line when the amount is more than the balance
  if (n.bad) $('#co-amt').setAttribute('aria-invalid', 'true'); else $('#co-amt').removeAttribute('aria-invalid');
  $('#co-save').disabled = !coCanSend(c);
  // Still in the 1.5 s pause after a save: check again when it ends, so the button wakes up by itself
  clearTimeout(coSyncTimer);
  if (Date.now() < CO.lockUntil) coSyncTimer = setTimeout(coSync, CO.lockUntil - Date.now() + 20);
}

onAct('co-full', () => {
  if (!CO.chat) return;
  CO.chat.amt = String(CO.chat.balance);
  $('#co-amt').value = CO.chat.amt;
  coSync();
});
onAct('co-mode', btn => {
  if (!CO.chat) return;
  CO.chat.mode = btn.dataset.v;
  $$('.co-modes button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  // Cheque: the note box asks for the cheque number and bank
  const ni = $('#co-note-in');
  if (ni) { ni.placeholder = coNotePh(CO.chat.mode); ni.setAttribute('aria-label', coNotePh(CO.chat.mode)); }
  coSync();   // a mode is needed before send wakes up
});
onInp('co-amt', inp => {
  if (!CO.chat) return;
  const v = inp.value.replace(/\D/g, '');   // whole rupees only
  if (v !== inp.value) inp.value = v;
  CO.chat.amt = v;
  coSync();
});
onInp('co-note', inp => { if (CO.chat) { CO.chat.note = inp.value; coSync(); } });

/* ---------- sending a payment (shown at once, confirmed by the server later) ----------
   On mobile data the server takes 1-2 seconds, so the "₹X મળ્યા" bubble appears
   IMMEDIATELY with a small clock. When the server says OK, the clock becomes two
   ticks and the office bubble with the new balance appears.

   Weak network: the bubble turns red ("મોકલાયું નહીં · ફરી મોકલો") and the message box
   is replaced by "ફરી પ્રયત્ન થાય છે…". The SAME payment (same code) is sent again
   by itself every few seconds and when the network comes back; tapping the red
   bubble sends it at once. The server saves each code only once, so the money
   can never be recorded twice. Nothing has to be typed again.
   If the server REFUSES the payment (e.g. the balance changed), it was not saved:
   the red message says why and an empty box appears. */

// Small clock = "on its way"
const CO_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2 1.4"/></svg>';

// The outgoing bubble of a payment that is not confirmed yet: state 'wait' (clock) or 'fail' (red, tap to send now)
function coPendBubble(f, state) {
  const fail = state === 'fail';
  return '<div class="bub out co-pend' + (fail ? ' bad co-fail' : '') + '" id="co-pend"' +
    (fail ? ' data-act="co-retry" role="button" tabindex="0" aria-label="' + esc(tr('ફરી મોકલો', 'Send again')) + '"' : '') + '>' +
    '<b>' + inr(f.amt) + '</b> ' + tr('મળ્યા', 'received') + ' · ' + esc(coModeT(f.mode)) +
    (f.note ? '<br><span class="sub">' + esc(f.note) + '</span>' : '') +
    (fail ? '<span class="co-failtxt">' + TX.not_sent_retry + '</span>' : '') +
    '<span class="meta">' + esc(f.time) + (fail ? '' : '<span class="co-clock">' + CO_CLOCK + '</span>') + '</span></div>';
}
// While a payment is on its way, the message box is replaced by a quiet line (no second payment meanwhile)
const coWaitBottom = () => '<div class="co-pay co-wait">' + TX.sending + '</div>';
// Put a new bottom (message box, waiting line or back button) in place of the old one
function coSetBottom(html) {
  const old = $('#ph-chat .co-pay') || $('#ph-chat .wa-qr');
  if (old) old.outerHTML = html;
}

// A new code for one payment, e.g. "c-1696680000000-k3j9"
function coNewRef() { return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }

// Is the open chat the one of payment f, with its bubble on screen?
const coHere = f => !!(CO.chat && CO.chat.phone === f.phone && $('#co-pend'));

// Sends payment f = {phone, name, amt, mode, note, before, time, ref, token}. The bubble is already on screen.
async function coSend(f) {
  CO.busy = true; CO.sending = f;
  let res = null, err = null;
  try {
    // ref = this payment's own code. The server saves each code only once, so a retry can never take the money twice.
    res = await api('payment.add', { phone: f.phone, amount: f.amt, mode: f.mode, note: f.note, ref: f.ref });
  } catch (e) { err = e; }
  CO.busy = false; CO.sending = null;
  if (!App.session || App.session.token !== f.token) return;   // logged out meanwhile
  const c = CO.chat, here = coHere(f);

  if (err) {
    if (err.message === 'AUTH') return;   // already back on the PIN screen
    if (['NETWORK', 'TIMEOUT'].includes(err.code || err.message)) {
      // Not sure it arrived: keep it and send the SAME payment again by itself (same code = never twice)
      CO.failed = f;
      coRetryLater();
      if (here) { $('#co-pend').outerHTML = coPendBubble(f, 'fail'); coSetBottom(coRetryBottom(f)); }
      else if (CO.chat) coSetBottom(coBottom());
      return;
    }
    // The server said no: nothing was saved. Say why, and give an EMPTY box (the balance may have changed).
    CO.failed = null;
    cacheDrop(['ledger.get']);
    if (here) {
      $('#co-pend').remove();
      $('#wa-msgs').insertAdjacentHTML('beforeend', WA.bubble('in', '<b>' + esc(tr('પેમેન્ટ સેવ ન થયું.', 'The payment was not saved.')) + '</b><br>' + esc(guErr(err)), coNowTime(), { who: TX.office, cls: 'bad' }));
      Object.assign(c, { amt: '', mode: '', note: '' });
      coSetBottom(coBottom()); coSync();
    } else {
      toast(guErr(err));
      if (CO.chat) coSetBottom(coBottom());
    }
    coLoad();
    return;
  }

  CO.failed = null; clearTimeout(CO.retryTimer);
  cacheDrop(['ledger.get']);   // the saved list is out of date now
  if (here) {
    // The jobs' new balances: from the server's split (parts), or worked out the same way (a repeated answer has no parts)
    const parts = res.parts || coSplit(c.jobs, f.amt).map(p => ({ order_id: p.order_id, balance: p.left }));
    parts.forEach(p => { const j = c.jobs.find(x => String(x.order_id) === String(p.order_id)); if (j) j.balance = Number(p.balance) || 0; });
    c.jobs = c.jobs.filter(j => j.balance > 0);
    c.balance = Number(res.balance) || 0;
    if (res.whatsapp === 'no') c.noWa = true;   // the server says the thank-you was skipped
    $('#co-pend').outerHTML = coPaidBubble(f.amt, f.mode, f.note, f.time);
    const box = $('#wa-msgs');
    box.insertAdjacentHTML('beforeend', coBalBubble(c.balance, coNowTime(), c.jobs) +
      (res.duplicate ? WA.sys(tr('આ પેમેન્ટ પહેલેથી સેવ થયું હતું.', 'This payment was already saved.')) : ''));
    // No WhatsApp: no thank-you message went out, so say the receipt in person
    if (c.noWa) box.insertAdjacentHTML('beforeend', WA.bubble('in', '<b>' + esc(TX.receipt_in_person) + '</b><div>' + coSayReceipt(f.amt, c.balance) + '</div>', '', { who: TX.office, cls: 'warn' }));
    // Still money due: an EMPTY box with no mode for the next part payment (never refilled with the balance).
    // Paid up: show a back button.
    coAfterSaved(c);
    box.scrollTop = box.scrollHeight;
  } else {
    toast(inr(f.amt) + tr(' મળ્યા ✓', ' received ✓') + ' · ' + f.name);
    if (CO.chat) coSetBottom(coBottom());   // another client's chat: its message box can wake up now
  }
  coLoad();   // refresh the list behind the chat (in the background)
}

// Send a failed payment again after a short wait (and at once when the network comes back)
function coRetryLater() {
  clearTimeout(CO.retryTimer);
  CO.retryTimer = setTimeout(coRetryNow, CO_RETRY_MS);
}
function coRetryNow() {
  const f = CO.failed;
  if (!f || CO.busy) return;
  if (!App.session || App.session.token !== f.token) { CO.failed = null; return; }   // another login: drop it
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { coRetryLater(); return; }   // still offline
  clearTimeout(CO.retryTimer);
  CO.failed = null;
  f.time = coNowTime();
  if (coHere(f)) { $('#co-pend').outerHTML = coPendBubble(f, 'wait'); coSetBottom(coWaitBottom()); }
  coSend(f);   // same f, same ref: the server never saves it twice
}
window.addEventListener('online', () => { if (CO.failed) coRetryNow(); });

// Show the bubble straight away (with a clock), then send
function coStart(f) {
  const box = $('#wa-msgs');
  const old = $('#co-pend');
  if (old) old.remove();
  box.insertAdjacentHTML('beforeend', coPendBubble(f, 'wait'));
  box.scrollTop = box.scrollHeight;
  coSetBottom(coWaitBottom());
  coSend(f);
}

// After a payment is saved: money still due = EMPTY box, no mode (the next part payment
// must be typed and picked again). Paid up = one "back" button.
function coAfterSaved(c) {
  if (c.balance > 0) { Object.assign(c, { amt: '', mode: '', note: '' }); coSetBottom(coComposer()); coSync(); }
  else coSetBottom(coDoneBottom());
}

/* ---------- the confirm sheet ----------
   Send does NOT save. It opens a sheet over the chat with the payment in big text:
     ₹2,000 · UPI
     Smita Parekh
     સોમ 20 સપ્ટે ₹1,000 ✓ / મંગળ 27 સપ્ટે ₹1,000 (બાકી ₹500)   (only with 2+ jobs)
     બાકી રહેશે ₹1,900   (or "પૂરું ચૂકવાઈ જશે")
     [amber] ઓછી રકમ છે, બરાબર છે?   (only when less than half of the balance)
     [ હા, સેવ કરો ]  [ બદલો ]
   Only "હા, સેવ કરો" records the payment. "બદલો" closes the sheet and keeps the typed values. */
function coConfirmHtml(f) {
  const left = f.before - f.amt;
  const small = f.amt < f.before * 0.5;   // less than half of what is due: maybe a typo (200 instead of 2000)
  const jobs = CO.chat ? CO.chat.jobs : [];
  const split = jobs.length > 1 ? coSplit(jobs, f.amt) : [];
  return '<div class="co-cf" id="co-cf" role="dialog" aria-modal="true" aria-labelledby="co-cf-amt">' +
    '<div class="co-cf-card">' +
    '<div class="co-cf-q">' + tr('આ પેમેન્ટ સેવ કરવું છે?', 'Save this payment?') + '</div>' +
    '<div class="co-cf-amt" id="co-cf-amt">' + inr(f.amt) + ' · ' + esc(coModeT(f.mode)) + '</div>' +
    '<div class="co-cf-nm">' + esc(f.name) + '</div>' +
    (f.note ? '<div class="co-cf-note">' + esc(f.note) + '</div>' : '') +
    // Which jobs this money pays (oldest first)
    (split.length ? '<ul class="co-jobs co-cf-split">' + split.map(p => '<li><span>' + esc(coJobDate(p)) + '</span><b>' + inr(p.take) +
      (p.left > 0 ? ' <small>(' + tr('બાકી ', 'due ') + inr(p.left) + ')</small>' : ' ✓') + '</b></li>').join('') + '</ul>' : '') +
    '<div class="co-cf-left' + (left > 0 ? '' : ' full') + '">' + (left > 0 ? tr('બાકી રહેશે', 'Still due') + ' <b>' + inr(left) + '</b>' : '<b>' + tr('પૂરું ચૂકવાઈ જશે ✓', 'Will be fully paid ✓') + '</b>') + '</div>' +
    (small ? '<div class="co-cf-warn" role="alert">' + tr('ઓછી રકમ છે, બરાબર છે?', 'This is a small amount. Is it right?') + '</div>' : '') +
    // No WhatsApp: instead of the thank-you WhatsApp note, the receipt is said in person
    (CO.chat && CO.chat.noWa ? '<div class="co-nowa">' + esc(TX.receipt_in_person) + '<br>' + coSayReceipt(f.amt, left) + '</div>' : '') +
    // Both buttons start switched off for a moment, so the second tap of a double tap on send cannot press them
    '<div class="co-cf-btns">' +
    '<button class="co-cf-no" data-act="co-change" disabled>' + tr('બદલો', 'Change') + '</button>' +
    '<button class="co-cf-yes" id="co-yes" data-act="co-yes" disabled>' + tr('હા, સેવ કરો', 'Yes, save') + '</button>' +
    '</div></div></div>';
}
function coCloseConfirm() {
  CO.ask = null;
  const s = $('#co-cf'); if (s) s.remove();
}

// Send arrow: check the amount and mode, then ask "is this right?"
onAct('co-save', () => {
  const c = CO.chat;
  if (!coCanSend(c) || CO.ask) return;   // nothing valid yet, saving, retrying, in the 1.5 s pause, or the sheet is already open
  const f = { phone: c.phone, name: c.name, amt: Number(c.amt), mode: c.mode, note: c.note.trim(), before: c.balance };
  CO.ask = f;   // what the sheet shows is exactly what will be saved, even if the box changes later
  const a = document.activeElement; if (a && a.blur) a.blur();   // close the phone keyboard so the sheet is fully visible
  $('#ph-chat').insertAdjacentHTML('beforeend', coConfirmHtml(f));
  setTimeout(() => {   // wake the two buttons up after a short moment
    if (CO.ask !== f) return;
    $$('#co-cf button').forEach(b => { b.disabled = coLocked(); });
  }, CO_ARM_MS);
});

// "બદલો": close the sheet, the box keeps what was typed so it can be corrected
onAct('co-change', () => { coCloseConfirm(); coSync(); const i = $('#co-amt'); if (i) i.focus(); });

// "હા, સેવ કરો" = save the payment. The server also sends the customer a thank-you WhatsApp
// (not to a client without WhatsApp: the collector says the receipt in person).
onAct('co-yes', () => {
  const c = CO.chat, f = CO.ask;
  if (!c || !f || coLocked() || CO.failed || CO.sending || f.phone !== c.phone) return;
  // From here on, every send/confirm button is off while saving and for 1.5 s after this tap
  CO.lockUntil = Date.now() + CO_LOCK_MS;
  coCloseConfirm();
  f.time = coNowTime();
  f.ref = coNewRef();                 // this payment's own code, kept for every retry
  f.token = App.session.token;
  coStart(f);
});

// Tap the red bubble: send the same payment again now (same code: never saved twice)
onAct('co-retry', () => {
  if (!CO.failed || coLocked()) return;
  CO.lockUntil = Date.now() + CO_LOCK_MS;   // a double tap on the red bubble does nothing more
  coRetryNow();
});
