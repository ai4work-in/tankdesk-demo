/* ==========================================================================
   collector.js: the PAYMENT COLLECTOR screens (Gujarati), in chat style.
   Staff already know WhatsApp, so the screens work the same way:
     todo ("કલેક્શન લેજર")   a chat list: one row per client who still has to pay
                             tap a row -> a chat opens, money is "sent" from the
                             message box at the bottom
     done ("આજનું કલેક્શન")  a chat list of the payments taken today

   PRIVACY: the collector sees only name, phone, address, area and balance.
   The server sends nothing else, and this file never shows services.

   Uses shared helpers:
     chat.js   WA.row, WA.bubble, WA.openChat ... (the chat look)
     driver.js guErr, telUrl, labGu, Phone.reload (loaded before this file)
     app.js    setTabCount, renderPhone
   Styles: the "collector" section at the end of phone.css.
   ========================================================================== */

const CO = {
  data: null,      // reply of ledger.get: {rows, total, today_payments} (null = not loaded yet)
  loading: false,
  error: '',
  busy: false,     // true while a payment is being saved (stops double taps)
  lockUntil: 0,    // after "હા, સેવ કરો" every send/confirm button stays off until this time (ms), against double taps
  ask: null,       // the payment shown in the confirm sheet, waiting for "હા, સેવ કરો" (null = no sheet open)
  area: '',        // area chip picked on the list ('' = all areas)
  chat: null,      // the open chat: {id, name, phone, address, area, balance, amt, mode, note}
  failed: null,    // the last payment that did not go through (tap the red bubble to retry)
  again: false,    // a reload was asked for while one was already running: run once more after it
  token: ''        // which login the data belongs to
};
const CO_MODES = ['cash', 'upi', 'cheque', 'bank', 'other'];
const CO_OFFICE = 'ઓફિસ';   // name shown on the office's messages

const coArea = r => r.area || 'other';
const coAreaGu = k => { const a = (App.setup.areas || []).find(x => x.key === k); return a ? a.name_gu : GU.other_area; };
const coRow = id => ((CO.data && CO.data.rows) || []).find(r => String(r.order_id) === String(id));
const coTime = t => (t ? fm(mins(t)) : '');   // "14:05" -> "2:05 PM"
const coNowTime = () => fm(nowMin());
const coModeGu = k => (MODE[k] || MODE.other).gu;
// Client without WhatsApp (whatsapp 'no'): no thank-you WhatsApp is sent, the collector says the receipt in person
const coNoWa = r => !!r && String(r.whatsapp || '').toLowerCase() === 'no';
// The receipt words to say: "₹1,000 મળ્યા, આભાર. બાકી ₹500." (same as the payment_thanks template)
const coSayReceipt = (amt, bal) => '«' + inr(amt) + ' મળ્યા, આભાર.' + (bal > 0 ? ' બાકી ' + inr(bal) + '.' : ' પૂરું ચૂકવાઈ ગયું.') + '»';

/* ---------- load the to-collect list ----------
   Speed: apiCached() first draws the copy saved on the phone (instant), then asks
   the server (1-2 seconds on mobile data) and redraws only if something changed.
   While the server is being asked, the total line says "updating…". */
const CO_UPDATING = 'અપડેટ થાય છે…';

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
  if (t && on && !old) t.insertAdjacentHTML('beforeend', '<span class="co-upd"> · ' + CO_UPDATING + '</span>');
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

// The "updating…" mark for the total line while the server is being asked
const coUpd = () => (CO.loading ? '<span class="co-upd"> · ' + CO_UPDATING + '</span>' : '');

// Common start of every collector page: loading / error / data
function coReady(el) {
  if (CO.token !== App.session.token) Object.assign(CO, { data: null, error: '', chat: null, failed: null, area: '', token: App.session.token });
  if (!WA.chatOpen()) CO.chat = null;   // the chat was closed some other way (menu, tab)
  if (!CO.data && !CO.loading && !CO.error) coLoad();   // draws the saved copy at once if there is one
  if (CO.data) return true;
  if (CO.error) el.innerHTML = '<div class="co-pad"><div class="box bad">' + esc(CO.error) + '</div>' +
    '<button class="btn lg" data-act="ph-refresh">' + GU.try_again + '</button></div>';
  else el.innerHTML = '<div class="empty">' + GU.loading + '</div>';
  return false;
}

/* ==========================================================================
   TAB 1: TO COLLECT (chat list)
   ========================================================================== */
registerScreen('collector', 'todo', el => {
  if (!coReady(el)) return;
  const L = (CO.data.rows || []).filter(r => r.balance > 0);
  setTabCount('todo', L.length);
  // Areas that have someone to collect from, in alphabetical order ("other" last)
  const areas = Array.from(new Set(L.map(coArea))).sort((x, y) => (x === 'other') - (y === 'other') || coAreaGu(x).localeCompare(coAreaGu(y)));
  const af = areas.includes(CO.area) ? CO.area : '';
  const LL = af ? L.filter(r => coArea(r) === af) : L;
  const sum = list => list.reduce((a, r) => a + r.balance, 0);

  let h = '';
  if (CO.error) h += '<div class="co-pad"><div class="box bad">' + esc(CO.error) + '</div></div>';
  // Area filter chips (scroll sideways when there are many areas)
  h += '<div class="wa-chips co-areas" role="group" aria-label="વિસ્તાર પ્રમાણે જુઓ">' +
    '<button aria-pressed="' + (af === '') + '" data-act="co-area" data-a="">બધા · ' + L.length + '</button>' +
    areas.map(k => '<button aria-pressed="' + (af === k) + '" data-act="co-area" data-a="' + esc(k) + '">' +
      esc(coAreaGu(k)) + ' · ' + L.filter(r => coArea(r) === k).length + '</button>').join('') + '</div>';
  // Total line
  h += '<div class="co-total">' + (af ? esc(coAreaGu(af)) + ' માં બાકી ' : GU.total_due + ' ') +
    '<b>' + inr(sum(LL)) + '</b> · ' + LL.length + ' ગ્રાહક' + coUpd() + '</div>';

  // One chat row per client: balance in the "time" spot, area and address as the last line
  const row = r => WA.row({
    name: r.client_name, time: inr(r.balance), timeHot: true,
    preview: (coNoWa(r) ? '<span class="dr-nowa">' + esc(GU.no_wa) + '</span> ' : '') + esc(coAreaGu(coArea(r)) + ' · ' + (r.address || '')),
    act: 'co-open', data: { id: r.order_id }
  });

  if (!LL.length) h += '<div class="empty">કોઈ બાકી પેમેન્ટ નથી.</div>';
  else if (af) h += '<div class="wa-list co-list">' + LL.map(row).join('') + '</div>';
  else h += '<div class="wa-list co-list">' + areas.map(k => {
    const g = L.filter(r => coArea(r) === k);
    return WA.sec(coAreaGu(k) + ' · ' + g.length + ' ગ્રાહક · ' + inr(sum(g))) + g.map(row).join('');
  }).join('') + '</div>';
  el.innerHTML = h;
});
onAct('co-area', btn => { CO.area = btn.dataset.a; renderPhone(); });

/* ==========================================================================
   TAB 2: TODAY'S COLLECTION (chat list of payments)
   ========================================================================== */
registerScreen('collector', 'done', el => {
  if (!coReady(el)) return;
  setTabCount('todo', (CO.data.rows || []).filter(r => r.balance > 0).length);
  const td = (CO.data.today_payments || []).slice().sort((a, b) => (a.time < b.time ? 1 : -1));   // newest first
  const total = td.reduce((a, p) => a + Number(p.amount || 0), 0);
  let h = '<div class="co-total">' + esc(labGu(todayIso())) + ' · આજે કુલ મળ્યા <b>' + inr(total) + '</b> · ' + td.length + ' પેમેન્ટ' + coUpd() + '</div>';
  // Total per payment mode (રોકડ ₹X · UPI ₹Y ...), so the cash hand-over at the office is easy to check
  if (td.length) {
    const byMode = {};
    td.forEach(p => { const k = CO_MODES.includes(p.mode) ? p.mode : 'other'; byMode[k] = (byMode[k] || 0) + Number(p.amount || 0); });
    h += '<div class="co-modesum" aria-label="રીત પ્રમાણે કુલ">' + CO_MODES.filter(k => byMode[k]).map(k =>
      '<span class="co-ms' + (k === 'cash' ? ' cash' : '') + '">' + esc(coModeGu(k)) + ' <b>' + inr(byMode[k]) + '</b></span>').join('') + '</div>';
  }
  h += td.length
    ? '<div class="wa-list co-list">' + td.map(p => WA.row({
      name: p.client_name, time: inr(p.amount), timeHot: true,
      preview: esc(coModeGu(p.mode) + ' · ' + coTime(p.time)), act: 'co-noop'
    })).join('') + '</div>'
    : '<div class="empty">આજે હજી કોઈ કલેક્શન નથી.</div>';
  el.innerHTML = h;
});

/* ==========================================================================
   THE PAYMENT CHAT
   ========================================================================== */

/* MONEY SAFETY (why the payment box works like this):
   - The amount box starts EMPTY and NO mode is picked, so one careless tap can never
     record a full cash payment. "પૂરી રકમ" fills the box only when tapped.
   - Send opens a confirm sheet ("₹2,000 · UPI · name"). Only "હા, સેવ કરો" saves.
   - While saving, and for 1.5 s after "હા, સેવ કરો", every send/confirm button is off,
     so a double tap can never save a second payment. */
const CO_LOCK_MS = 1500;    // pause after "હા, સેવ કરો" (milliseconds)
const CO_ARM_MS = 600;      // the confirm buttons wake up this long after the sheet opens (a double tap on send cannot hit "હા")
const coLocked = () => CO.busy || Date.now() < CO.lockUntil;

// The line under the amount: what is missing or wrong, or full / partial payment.
// Returns {text, bad}: bad = true shows it in red (amount more than the balance).
function coNote(amt, bal, mode) {
  const n = Number(amt);
  if (amt !== '' && n > bal) return { text: 'રકમ બાકી ' + inr(bal) + ' કરતાં વધારે છે. સાચી રકમ લખો.', bad: true };
  if (!(n > 0)) return { text: 'કેટલા મળ્યા તે લખો, પછી રીત પસંદ કરો.', bad: false };
  if (!mode) return { text: 'કઈ રીતે મળ્યા? ઉપર રોકડ / UPI / ચેક… પસંદ કરો.', bad: false };
  return { text: n === bal ? 'પૂરું પેમેન્ટ ✓' : 'અધૂરું પેમેન્ટ. બાકી ' + inr(bal - n) + ' આગળ જમા રહેશે.', bad: false };
}
const coAmtOk = (amt, bal) => Number(amt) > 0 && Number(amt) <= bal;
// Send can be pressed only with a good amount AND a mode, and when nothing is being saved
const coCanSend = c => !!c && coAmtOk(c.amt, c.balance) && CO_MODES.includes(c.mode) && !coLocked();

// Office message with the new balance (after a payment)
const coBalBubble = (bal, time) => WA.bubble('in', bal > 0 ? 'બાકી <b>' + inr(bal) + '</b>' : '<b>પૂરું ચૂકવાઈ ગયું ✓</b>', time, { who: CO_OFFICE });
// "₹1,000 મળ્યા · UPI" with two ticks (like a delivered message)
const coPaidBubble = (amt, mode, note, time) => WA.bubble('out', '<b>' + inr(amt) + '</b> મળ્યા · ' + esc(coModeGu(mode)) +
  (note ? '<br><span class="sub">' + esc(note) + '</span>' : ''), time, { ticks: 2 });

// The bottom of the chat: payment mode chips, then the message box with the amount
function coComposer() {
  const c = CO.chat;
  const note = coNote(c.amt, c.balance, c.mode);
  return '<div class="co-pay">' +
    '<div class="wa-chips co-modes" role="group" aria-label="કઈ રીતે મળ્યા?">' +
    CO_MODES.map(k => '<button aria-pressed="' + (c.mode === k) + '" data-act="co-mode" data-v="' + k + '">' + esc(MODE[k].gu) + '</button>').join('') +
    '</div>' +
    '<div class="wa-compose"><div class="box-in co-box">' +
    '<div class="co-amt-line"><span class="co-rs" aria-hidden="true">₹</span>' +
    '<input id="co-amt" inputmode="numeric" autocomplete="off" placeholder="કેટલા મળ્યા?" aria-label="કેટલા મળ્યા? (₹)" aria-describedby="co-note"' +
    (note.bad ? ' aria-invalid="true"' : '') + ' value="' + esc(c.amt) + '" data-inp="co-amt">' +
    '<button class="co-full" data-act="co-full">પૂરી રકમ</button></div>' +
    '<input id="co-note-in" class="co-note-in" autocomplete="off" placeholder="નોંધ (જરૂરી નથી)" aria-label="નોંધ (જરૂરી નથી)" value="' + esc(c.note) + '" data-inp="co-note">' +
    '</div>' +
    '<button class="wa-send" id="co-save" data-act="co-save" aria-label="આગળ: રકમ ચકાસો"' + (coCanSend(c) ? '' : ' disabled') + '>' + WA.icons.send + '</button></div>' +
    '<div class="co-hint' + (note.bad ? ' co-err' : '') + '" id="co-note" role="status">' + esc(note.text) + '</div></div>';
}

// When the client has paid everything, the message box is replaced by one "back" button
const coDoneBottom = () => WA.quick([{ label: 'યાદી પર પાછા જાઓ', act: 'co-back', cls: 'pri full' }]);

function coOpenChat(r) {
  // Payments already taken today for this order (oldest first)
  const paidToday = (CO.data.today_payments || []).filter(p => String(p.order_id) === String(r.order_id))
    .slice().sort((a, b) => (a.time < b.time ? -1 : 1));
  const before = r.balance + paidToday.reduce((a, p) => a + Number(p.amount || 0), 0);
  CO.chat = { id: r.order_id, name: r.client_name, phone: r.phone, address: r.address, area: coArea(r),
    balance: r.balance, amt: '', mode: '', note: '', noWa: coNoWa(r) };   // EMPTY box and no mode: the collector must type and pick (money safety)
  CO.ask = null;

  const call = '<a class="wa-ib" href="' + telUrl(r.phone) + '" aria-label="કૉલ કરો">' + WA.icons.call + '</a>';
  const head = WA.chatHead({ title: r.client_name, sub: coAreaGu(coArea(r)), back: 'co-back', right: call });

  // First message: from the office, what is due and where
  let msgs = WA.day('આજે') + WA.bubble('in',
    'બાકી રકમ <b class="co-big">' + inr(before) + '</b>' +
    '<dl class="kv"><dt>સરનામું</dt><dd>' + esc(r.address || '') + '</dd>' +
    '<dt>વિસ્તાર</dt><dd>' + esc(coAreaGu(coArea(r))) + '</dd>' +
    '<dt>ફોન</dt><dd><a href="' + telUrl(r.phone) + '">' + esc(phoneText(r.phone)) + '</a></dd></dl>' +
    (coNoWa(r) ? '<div class="co-nowa">' + esc(GU.receipt_in_person) + '</div>' : ''), '', { who: CO_OFFICE });
  paidToday.forEach(p => { msgs += coPaidBubble(p.amount, p.mode, '', coTime(p.time)); });
  if (paidToday.length) msgs += coBalBubble(r.balance, '');
  msgs += WA.sys('રકમ લખો, રીત પસંદ કરો અને મોકલો દબાવો. "હા, સેવ કરો" પછી જ પેમેન્ટ સેવ થશે' +
    (coNoWa(r) ? '. ગ્રાહકને WhatsApp નથી: રસીદ મોઢે જણાવો.' : ' અને ગ્રાહકને WhatsApp જશે.'));

  WA.openChat(head, msgs, r.balance > 0 ? coComposer() : coDoneBottom());
  WA.pushBack();   // the phone's back button closes the chat
}

// Close the chat and show the fresh list (a fully paid client is no longer in it)
function coCloseChat() {
  WA.closeChat();
  CO.chat = null; CO.ask = null;
  renderPhone();
}

onAct('co-open', btn => { const r = coRow(btn.dataset.id); if (r) coOpenChat(r); });
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
  const n = coNote(c.amt, c.balance, c.mode);
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
  coSync();   // a mode is needed before send wakes up
});
onInp('co-amt', inp => {
  if (!CO.chat) return;
  const v = inp.value.replace(/\D/g, '');   // whole rupees only
  if (v !== inp.value) inp.value = v;
  CO.chat.amt = v;
  coSync();
});
onInp('co-note', inp => { if (CO.chat) CO.chat.note = inp.value; });

/* ---------- sending a payment (shown at once, confirmed by the server later) ----------
   On mobile data the server takes 1-2 seconds, so the "₹X મળ્યા" bubble appears
   IMMEDIATELY with a small clock. When the server says OK, the clock becomes two
   ticks and the office bubble with the new balance appears.
   If it fails, the bubble turns red: "મોકલાયું નહીં · ફરી મોકલો" (tap to send again).

   Never twice: only one payment can be on its way at a time (CO.busy). And if a
   payment failed because of the network, the server may still have saved it, so
   before sending again we first look at the ledger to see if it is already there. */

// Small clock = "on its way"
const CO_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2 1.4"/></svg>';

// The outgoing bubble of a payment that is not confirmed yet: state 'wait' (clock) or 'fail' (red, tap to retry)
function coPendBubble(f, state) {
  const fail = state === 'fail';
  return '<div class="bub out co-pend' + (fail ? ' bad co-fail' : '') + '" id="co-pend"' +
    (fail ? ' data-act="co-retry" role="button" tabindex="0" aria-label="ફરી મોકલો"' : '') + '>' +
    '<b>' + inr(f.amt) + '</b> મળ્યા · ' + esc(coModeGu(f.mode)) +
    (f.note ? '<br><span class="sub">' + esc(f.note) + '</span>' : '') +
    (fail ? '<span class="co-failtxt">મોકલાયું નહીં · ફરી મોકલો</span>' : '') +
    '<span class="meta">' + esc(f.time) + (fail ? '' : '<span class="co-clock">' + CO_CLOCK + '</span>') + '</span></div>';
}
// While a payment is on its way, the message box is replaced by a quiet line (no second payment meanwhile)
const coWaitBottom = () => '<div class="co-pay co-wait">મોકલાય છે…</div>';
// Put a new bottom (message box, waiting line or back button) in place of the old one
function coSetBottom(html) {
  const old = $('#ph-chat .co-pay') || $('#ph-chat .wa-qr');
  if (old) old.outerHTML = html;
}

// Did a payment that "failed" on the network actually reach the server? Looks at the fresh ledger.
async function coAlreadySaved(f) {
  const d = await api('ledger.get', {});
  const row = (d.rows || []).find(r => String(r.order_id) === String(f.id));
  const now = row ? row.balance : 0;
  const match = (d.today_payments || []).some(p => String(p.order_id) === String(f.id) && Number(p.amount) === f.amt && p.mode === f.mode);
  return match && Math.abs(now - (f.before - f.amt)) < 0.01 ? { balance: now } : null;
}

// A new code for one payment, e.g. "c-1696680000000-k3j9"
function coNewRef() { return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); }

// Sends payment f = {id, amt, mode, note, before, time, ref}. The bubble is already on screen.
async function coSend(f) {
  CO.busy = true;
  const c = CO.chat;
  let res = null, err = null;
  try {
    // A network failure earlier may have been saved after all: check first, never save twice
    if (f.unsure) res = await coAlreadySaved(f);
    // ref = this payment's own code. The server saves each code only once, so a retry can never take the money twice.
    if (!res) res = await api('payment.add', { order_id: Number(f.id), amount: f.amt, mode: f.mode, note: f.note, ref: f.ref });
  } catch (e) { err = e; }
  CO.busy = false;
  const here = CO.chat === c && c && String(c.id) === String(f.id) && $('#co-pend');

  if (err) {
    if (err.message === 'AUTH') return;   // already back on the PIN screen
    // Network / timeout: the server may or may not have saved it. Other errors: it was not saved.
    f.unsure = f.unsure || ['NETWORK', 'TIMEOUT'].includes(err.code || err.message);
    CO.failed = f;
    if (here) {
      $('#co-pend').outerHTML = coPendBubble(f, 'fail');
      Object.assign(c, { amt: String(f.amt), mode: f.mode, note: f.note });   // put the same values back in the box
      coSetBottom(coComposer());
      coSync();
    } else {
      toast(guErr(err));   // the chat is closed: tell them with a pop-up instead of the red bubble
    }
    return;
  }

  CO.failed = null;
  cacheDrop(['ledger.get']);   // the saved list is out of date now
  if (here) {
    c.balance = Number(res.balance) || 0;
    if (res.whatsapp === 'no') c.noWa = true;   // the server says the thank-you was skipped
    $('#co-pend').outerHTML = coPaidBubble(f.amt, f.mode, f.note, f.time);
    const box = $('#wa-msgs');
    box.insertAdjacentHTML('beforeend', coBalBubble(c.balance, coNowTime()));
    // No WhatsApp: no thank-you message went out, so say the receipt in person
    if (c.noWa) box.insertAdjacentHTML('beforeend', WA.bubble('in', '<b>' + esc(GU.receipt_in_person) + '</b><div>' + esc(coSayReceipt(f.amt, c.balance)) + '</div>', '', { who: CO_OFFICE, cls: 'warn' }));
    // Still money due: an EMPTY box with no mode for the next part payment (never refilled with the balance).
    // Paid up: show a back button.
    coAfterSaved(c);
    box.scrollTop = box.scrollHeight;
  } else {
    toast(inr(f.amt) + ' મળ્યા ✓');
  }
  coLoad();   // refresh the list behind the chat (in the background)
}

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
     બાકી રહેશે ₹1,900   (or "પૂરું ચૂકવાઈ જશે")
     [amber] ઓછી રકમ છે, બરાબર છે?   (only when less than half of the balance)
     [ હા, સેવ કરો ]  [ બદલો ]
   Only "હા, સેવ કરો" records the payment. "બદલો" closes the sheet and keeps the typed values. */
function coConfirmHtml(f) {
  const left = f.before - f.amt;
  const small = f.amt < f.before * 0.5;   // less than half of what is due: maybe a typo (200 instead of 2000)
  return '<div class="co-cf" id="co-cf" role="dialog" aria-modal="true" aria-labelledby="co-cf-amt">' +
    '<div class="co-cf-card">' +
    '<div class="co-cf-q">આ પેમેન્ટ સેવ કરવું છે?</div>' +
    '<div class="co-cf-amt" id="co-cf-amt">' + inr(f.amt) + ' · ' + esc(coModeGu(f.mode)) + '</div>' +
    '<div class="co-cf-nm">' + esc(CO.chat ? CO.chat.name : '') + '</div>' +
    (f.note ? '<div class="co-cf-note">' + esc(f.note) + '</div>' : '') +
    '<div class="co-cf-left' + (left > 0 ? '' : ' full') + '">' + (left > 0 ? 'બાકી રહેશે <b>' + inr(left) + '</b>' : '<b>પૂરું ચૂકવાઈ જશે ✓</b>') + '</div>' +
    (small ? '<div class="co-cf-warn" role="alert">ઓછી રકમ છે, બરાબર છે?</div>' : '') +
    // No WhatsApp: instead of the thank-you WhatsApp note, the receipt is said in person
    (CO.chat && CO.chat.noWa ? '<div class="co-nowa">' + esc(GU.receipt_in_person) + '<br>' + esc(coSayReceipt(f.amt, left)) + '</div>' : '') +
    // Both buttons start switched off for a moment, so the second tap of a double tap on send cannot press them
    '<div class="co-cf-btns">' +
    '<button class="co-cf-no" data-act="co-change" disabled>બદલો</button>' +
    '<button class="co-cf-yes" id="co-yes" data-act="co-yes" disabled>હા, સેવ કરો</button>' +
    '</div></div></div>';
}
function coCloseConfirm() {
  CO.ask = null;
  const s = $('#co-cf'); if (s) s.remove();
}

// Send arrow: check the amount and mode, then ask "is this right?"
onAct('co-save', () => {
  const c = CO.chat;
  if (!coCanSend(c) || CO.ask) return;   // nothing valid yet, saving, in the 1.5 s pause, or the sheet is already open
  const f = { id: c.id, amt: Number(c.amt), mode: c.mode, note: c.note.trim(), before: c.balance };
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

onAct('co-yes', async () => {
  const c = CO.chat, f = CO.ask;
  if (!c || !f || coLocked() || String(f.id) !== String(c.id)) return;
  // From here on, every send/confirm button is off while saving and for 1.5 s after this tap
  CO.lockUntil = Date.now() + CO_LOCK_MS;
  coCloseConfirm();
  f.time = coNowTime();
  // An earlier payment failed on the network and was not retried: make sure it was not saved after all
  const prev = CO.failed;
  // Same order, amount, mode and note as the failed one = the same payment sent again: keep its code
  const same = prev && String(prev.id) === String(f.id) && prev.amt === f.amt && prev.mode === f.mode && prev.note === f.note;
  f.ref = same ? prev.ref : coNewRef();
  if (prev && prev.unsure && String(prev.id) === String(c.id)) {
    CO.busy = true;
    coSetBottom(coWaitBottom());   // no box and no send arrow while we check
    let saved = null;
    try { saved = await coAlreadySaved(prev); } catch (e) {
      CO.busy = false; coSetBottom(coComposer()); coSync(); toast(guErr(e)); return;
    }
    CO.busy = false;
    if (CO.chat !== c) return;   // the chat was closed meanwhile
    if (saved) {   // it was saved: show it as done instead of taking the money a second time
      CO.failed = null;
      const pend = $('#co-pend'), done = coPaidBubble(prev.amt, prev.mode, prev.note, prev.time);
      if (pend) pend.outerHTML = done; else $('#wa-msgs').insertAdjacentHTML('beforeend', done);
      c.balance = saved.balance;
      $('#wa-msgs').insertAdjacentHTML('beforeend', coBalBubble(c.balance, coNowTime()) + WA.sys('આ પેમેન્ટ પહેલેથી સેવ થયું હતું.'));
      coAfterSaved(c);
      cacheDrop(['ledger.get']); coLoad();
      return;
    }
  }
  CO.failed = null;
  coStart(f);
});

// Tap the red bubble: send the same payment again (it was already confirmed once)
onAct('co-retry', () => {
  const f = CO.failed;
  if (!f || coLocked() || CO.ask || !CO.chat || String(CO.chat.id) !== String(f.id)) return;
  CO.lockUntil = Date.now() + CO_LOCK_MS;   // a double tap on the red bubble does nothing more
  CO.failed = null;
  f.time = coNowTime();   // f keeps its ref, so the server will not save it twice
  coStart(f);
});
