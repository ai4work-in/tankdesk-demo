/* ==========================================================================
   driver.js: the DRIVER screens (Gujarati) + small shared phone helpers.

   Part 1 (PHONE SHARED) is also used by collector.js, which loads after this
   file: Gujarati dates, Gujarati error messages, the refresh button, the
   automatic refresh every 60 seconds, the "install app" button in the drawer
   and the service worker (offline app files) registration.

   Part 2 (DRIVER) looks like WhatsApp, because every driver knows WhatsApp:
     today ("આજના કામ")     a chat list: one row per job of today
     up    ("આવતા કામ")     the same kind of list, grouped by day
     me    ("મારી પ્રોફાઇલ") team, driver name, workers, office hours
   Tapping a job opens it like a chat: the office's job card at the top, then
   one message per thing that happened (reached, late, done...). The buttons
   at the bottom show only what the driver can do next.

   PRIVACY: drivers never see money. The server already removes amount and
   balance from the driver's data, and this file never shows any money field.
   ========================================================================== */

/* ==========================================================================
   PART 1: PHONE SHARED (driver and collector)
   ========================================================================== */

// Dates on the phone screens: labT() in common.js ("ગુરુ 8 ઑક્ટો" or "Thu 8 Oct").
// labGu() (always Gujarati) is used only inside the words said to a customer.

// Turn an error from api() into a short Gujarati message for a toast
// Errors look like "CODE: message"; only the code before the colon matters.
// guCode(e) -> "BAD_STATUS"
const guCode = e => (e && e.code) || String((e && e.message) || '').split(':')[0].trim();
function guErr(e) {
  const c = String((e && e.message) || '');
  const code = c.split(':')[0].trim();
  if (code === 'NETWORK' || code === 'TIMEOUT') return TX.no_network;
  if (code === 'BAD_STATUS') return tr('આ કામની સ્થિતિ બદલાઈ ગઈ છે. યાદી ફરી લોડ કરી.', 'This job has changed. The list was reloaded.');
  if (code === 'FORBIDDEN') return tr('આ કામ તમારી ટીમનું નથી.', 'This job belongs to another team.');
  if (code === 'BAD_INPUT') return c.replace(/^BAD_INPUT:\s*/, '');
  return tr('ભૂલ થઈ (' + code + '). ફરી પ્રયત્ન કરો.', 'Error (' + code + '). Try again.');
}

// "tel:" link for a phone stored as 91XXXXXXXXXX
const telUrl = p => 'tel:+' + String(p || '').replace(/\D/g, '');

// The small row at the top of a phone page: some text on the left, a refresh button on the right
function topRow(text) {
  return '<div class="ph-top"><div class="sub">' + text + '</div>' +
    '<button class="btn sm" data-act="ph-refresh" aria-label="' + esc(TX.refresh) + '">↻ ' + esc(TX.refresh) + '</button></div>';
}

/* ---------- refresh ----------
   Each role file puts its "load the data again" function here:
   Phone.reload.driver = function () {...}. The refresh button and the
   60-second timer call the one for the logged-in role.
   Phone.relang[role] (added 2026-10-08) redraws an open chat after the language
   was switched (app.js switchLang has already redrawn the list). */
const Phone = { reload: {}, relang: {} };

function phoneReload() {
  const s = App.session;
  if (!s || $('#v-phone').hidden) return;
  const fn = Phone.reload[s.role];
  if (fn) fn();
}
onAct('ph-refresh', () => phoneReload());

// Every 60 seconds, while the page is on screen and no form is open, load fresh data
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (!$('#ph-sheet').hidden || !$('#ph-drawer').hidden) return;   // do not disturb an open form or menu
  phoneReload();
}, 60000);
// When the driver comes back to the app (after a call, after the map), load fresh data
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && $('#ph-sheet').hidden) phoneReload();
});

/* ---------- install the app (PWA) ----------
   The "beforeinstallprompt" listener, installPrompt, isStandalone() and the
   'pwa-install' button action live in app.js (shared with the admin footer).
   Here we show "એપ ઇન્સ્ટોલ કરો" in the phone menu.
   iPhones have no such event, so they get a short how-to instead. */
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/* ---------- extra items in the phone menu (drawer) ----------
   app.js builds the menu. We add our items just above "લૉગઆઉટ":
   - driver: "દિવસ પૂર્ણ કરો" (as in the mockup; asks first if it is too early)
   - everyone: the install button, or the iPhone how-to */
const baseOpenDrawer = openDrawer;
openDrawer = function () {
  baseOpenDrawer();
  const out = $('#ph-drawer [data-act="logout"]');
  if (!out) return;
  let extra = '';
  if (App.session && App.session.role === 'driver') extra += '<button class="dn" data-act="dr-dayend">' + TX.day_end + '</button>';
  if (!isStandalone()) {
    if (installPrompt) extra += '<button class="dn install" data-act="pwa-install">⬇ ' + tr('એપ ઇન્સ્ટોલ કરો', 'Install the app') + '</button>';
    else if (isIOS()) extra += '<div class="ios-hint">' + tr('iPhone પર એપ ઇન્સ્ટોલ કરવા: નીચે શેર બટન (⬆) દબાવો, પછી "Add to Home Screen" પસંદ કરો.',
      'To install on iPhone: tap the Share button (⬆) below, then choose "Add to Home Screen".') + '</div>';
  }
  out.insertAdjacentHTML('beforebegin', extra);
};

/* ---------- service worker: keeps the app files on the phone ----------
   Registered once here (app.js does not do it). Not used when the page is
   opened straight from a file (file://), only from a web address. */
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.tdSwRegistered) {
  window.tdSwRegistered = true;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker not registered:', e));
  });
}

/* ---------- "new version ready" notice ----------
   sw.js sends {type:'td-update'} when it saved a changed app file or a new
   version took over. We show one small notice with a button that reloads. */
function showUpdateNotice() {
  if (document.getElementById('td-update')) return;   // only once
  const en = document.documentElement.lang === 'en';  // admin screens are in English
  const d = document.createElement('div');
  d.id = 'td-update';
  d.className = 'toast';
  d.setAttribute('role', 'status');
  d.innerHTML = '<span>' + (en ? 'New version ready' : 'નવું વર્ઝન તૈયાર છે') + '</span>' +
    '<button type="button" class="lnk">' + (en ? 'Reload' : 'ફરી ખોલો') + '</button>';
  d.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.tdSwListening) {
  window.tdSwListening = true;
  navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'td-update') showUpdateNotice(); });
  try { navigator.serviceWorker.startMessages(); } catch (e) { /* older browsers start them on their own */ }
}


/* ==========================================================================
   PART 2: DRIVER
   ========================================================================== */

const DR = {
  orders: null,     // the team's orders from today on (null = not loaded yet)
  loading: false,
  again: false,     // a reload was asked for while one was running: load once more after it
  error: '',        // shown when loading failed
  busy: false,      // true while the end-of-day request is running (stops double taps)
  syncing: false,   // true while fresh data is being fetched ("updating…" in the header)
  seq: 0,           // counts the loads, so an old answer never wipes a newer action
  pending: {},      // order_id -> an action sent but not confirmed yet (see drSend)
  ticks: {},        // order_id -> list of service keys ticked on the checklist
  crew: {},         // order_id -> worker names tapped under "કોણે કામ કર્યું?" (log book)
                    // (tank sizes are READ-ONLY for drivers since 2026-10-08: see drTanksBubble)
  size: {},         // order_id -> a "માપ અલગ છે" report {note, state:'sending'|'failed'} (see drSizeSend)
  finish: {},       // order_id -> true after "આખું કામ પૂર્ણ" on a multi-day job (shows the checklist)
  left: {},         // order_id -> {at, to, eta, late} after "I have left"
  chat: null,       // order_id of the job chat that is open (null = none)
  chatHtml: '',     // what the open chat shows now (to skip redrawing when nothing changed)
  late: null,       // the "I will be late" picker inside the chat: {id, mins, reason}
  sheet: null,      // the open end-of-day sheet: {type:'dayend', items}
  moving: null,     // end-of-day jobs shown as moved before the server confirmed: {items, state, seq}
  undo: null,       // the action waiting in its 5-second "રદ કરો" window (see drHold)
  delayAt: {},      // order_id -> new arrival time ("HH:MM") worked out when "મોડો પડીશ" was sent (to tell a no-WhatsApp customer)
  restored: false,  // true once the work kept on the phone was put back for this login (drWipRestore)
  token: ''         // which login the data belongs to (a new login starts fresh)
};
// Reasons for "I will be late" (orders.gs LATE_REASONS)
const DR_REASONS = ['traffic', 'prev', 'vehicle', 'other'];
// Reasons for moving a job at the end of the day (added 2026-10-08: the customer-side reasons)
const DR_DE_REASONS = ['not_home', 'cust_later', 'time_out', 'not_empty', 'traffic', 'prev', 'vehicle', 'other'];
// Minutes for "I will be late" (up to 3 hours)
const DR_LATE_MINS = [15, 30, 45, 60, 90, 120, 180];
// Small clock, shown on a message that is still being sent (like an unsent WhatsApp message)
const ICON_CLOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>';
// (messages from the office show TX.office as the sender, the customer's replies TX.customer)

// Small icon for the "end the day" row (a moon)
const DR_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';

/* ---------- work in progress kept ON THE PHONE (added 2026-10-08) ----------
   Phones often close the browser in the background (after Call or Map). So, per job,
   we keep on the phone: the ticks, the crew, "આખું કામ પૂર્ણ" opened, and anything not yet
   confirmed by the server (the "outbox": an action being sent or failed, a size report).
   One localStorage entry: 'td-dr-wip' = {team, jobs: {order_id: {ticks, crew, finish, out, size}}}.
   - restored once per login when the job list arrives (drWipRestore)
   - failed sends are tried again then, and whenever the network comes back ('online')
   - cleared as soon as the server said OK
   Every storage access is inside try/catch: in private mode nothing is kept, the app still works. */
const DR_WIP_KEY = 'td-dr-wip';
function drWipRead() {
  try {
    const x = JSON.parse(localStorage.getItem(DR_WIP_KEY) || 'null');
    return x && typeof x === 'object' && x.jobs && typeof x.jobs === 'object' ? x : null;
  } catch (e) { return null; }
}
// Write what is in progress now (or remove the entry when nothing is)
function drWipSave() {
  if (!App.session || App.session.role !== 'driver') return;
  const jobs = {};
  const job = id => jobs[id] || (jobs[id] = {});
  Object.keys(DR.ticks).forEach(id => { if ((DR.ticks[id] || []).length) job(id).ticks = DR.ticks[id]; });
  Object.keys(DR.crew).forEach(id => { if ((DR.crew[id] || []).length) job(id).crew = DR.crew[id]; });
  Object.keys(DR.finish).forEach(id => { if (DR.finish[id]) job(id).finish = true; });
  Object.keys(DR.pending).forEach(id => {
    const p = DR.pending[id];
    // only what has left the undo window and is not confirmed yet
    if (p.state === 'sending' || p.state === 'failed') job(id).out = { kind: p.kind, action: p.action, params: p.params, text: p.text, at: p.at };
  });
  Object.keys(DR.size).forEach(id => { job(id).size = DR.size[id].note; });
  try {
    if (Object.keys(jobs).length) localStorage.setItem(DR_WIP_KEY, JSON.stringify({ team: App.session.team, jobs: jobs }));
    else localStorage.removeItem(DR_WIP_KEY);
  } catch (e) { /* storage full or blocked: nothing is kept */ }
}
// Put the kept work back (once per login, when the list has arrived). Jobs no longer in the
// list are forgotten; unconfirmed actions come back as "not sent" and are tried again at once.
function drWipRestore() {
  const w = drWipRead();
  if (!w) return;
  if (String(w.team) !== String(App.session.team)) { try { localStorage.removeItem(DR_WIP_KEY); } catch (e) { /* ignore */ } return; }
  Object.keys(w.jobs).forEach(id => {
    const j = w.jobs[id] || {}, o = (DR.orders || []).find(x => String(x.order_id) === String(id));
    if (!o) return;
    if (o.status === 'reached' || j.out) {   // ticks and crew only matter while the team is at the site
      if (Array.isArray(j.ticks) && !DR.ticks[id]) DR.ticks[id] = j.ticks.filter(k => (o.services || []).includes(k));
      if (Array.isArray(j.crew) && !DR.crew[id]) DR.crew[id] = j.crew.slice();
      if (j.finish) DR.finish[id] = true;
    }
    if (j.out && j.out.action && !DR.pending[id]) DR.pending[id] = Object.assign({}, j.out, { state: 'failed' });
    if (j.size && !DR.size[id]) DR.size[id] = { note: String(j.size), state: 'failed' };
  });
  drWipSave();
  drRetryAll();
}
// true when something of this job could not be sent (red bar in the chat, red badge on the row)
const drHasFail = id => !!((DR.pending[id] && DR.pending[id].state === 'failed') || (DR.size[id] && DR.size[id].state === 'failed'));
// Send again everything that failed (all jobs). Used on app open and when the network is back.
function drRetryAll() {
  if (!App.session || App.session.role !== 'driver') return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;   // still offline: wait for 'online'
  Object.keys(DR.pending).forEach(id => drRetry(id));
  Object.keys(DR.size).forEach(id => { if (DR.size[id].state === 'failed') drSizeSend(id); });
}
window.addEventListener('online', () => drRetryAll());

/* ---------- lookups in setup ----------
   svcT / typeT / areaT: the name in the chosen language (name_gu or name_en), for the screen.
   svcGu / svcEn: always Gujarati / English, for the words said to a customer and their meaning. */
const svcRow = k => (App.setup.services || []).find(x => x.key === k);
const svcGu = k => { const s = svcRow(k); return s ? s.name_gu : k; };
const svcEn = k => { const s = svcRow(k); return s ? (s.name_en || s.name_gu) : k; };
const svcT = k => { const s = svcRow(k); return s ? nameOf(s) : k; };
const typeT = k => { const t = (App.setup.client_types || []).find(x => x.key === k); return t ? nameOf(t) : ''; };
const areaT = k => { const a = (App.setup.areas || []).find(x => x.key === k); return a ? nameOf(a) : TX.other_area; };
// "3 કામ" / "3 jobs"
const jobsN = n => tr(n + ' કામ', n + (n === 1 ? ' job' : ' jobs'));
// The orders as the driver should see them: the server's data, plus the
// actions that were tapped but are not confirmed yet (so the screen reacts at once)
const drList = () => (DR.orders || []).map(drPatch);
const drOrder = id => drList().find(o => String(o.order_id) === String(id));
const timeOf = o => fm(mins(o.sched_time));
const drSvcs = o => (o.services || []).map(svcT).join(', ');
// "today" or the date
const drDay = d => d === todayIso() ? TX.today : labT(d);

/* ---------- jobs over several days (added 2026-10-08) ----------
   A job can last several days (days 1-10). It shows on every day of its span, and
   an unfinished one keeps showing until it is done (jobOnDate in common.js).
   Each day: "હું પહોંચી ગયો", then either "આજનું કામ પૂર્ણ" (we come back tomorrow,
   status 'ongoing') or, on the last day, "આખું કામ પૂર્ણ" (the normal done step).
   The customer gets a WhatsApp only on the first day's reach and at the very end. */
const DR_OPEN = ['assigned', 'delayed', 'ongoing'];   // the team still has to go there
const drMulti = o => jobDays(o) > 1;
// "દિવસ 2 / 3" for date d (d before the start: "3 દિવસનું કામ")
function drDayLabel(o, d) {
  const n = jobDays(o), k = jobDayNo(o, d || todayIso());
  if (k < 1) return tr(n + ' દિવસનું કામ', n + '-day job');
  return k > n ? tr('દિવસ ' + k + ' (' + n + ' દિવસનું કામ)', 'Day ' + k + ' (' + n + '-day job)') : TX.day_of(k, n);
}
// Today's work on a multi-day job is finished ("આજનું કામ પૂર્ણ" tapped today): nothing more today
const drDoneToday = o => o.status === 'done' || (o.status === 'ongoing' && workDays(o).some(w => w.date === todayIso() && w.left));
// Small chips on a row / in the chat: "દિવસ 2 / 3" and "AMC 2/4" (the AMC label never has money)
const drChips = (o, d) => (drMulti(o) ? '<span class="dr-day">' + esc(drDayLabel(o, d)) + '</span> ' : '') +
  (o.amc_label ? '<span class="dr-amc">' + esc(o.amc_label) + '</span> ' : '');

/* ---------- customers WITHOUT WhatsApp ----------
   The office marks a client "no WhatsApp" (order field whatsapp = 'no'; blank = yes).
   Then the server sends that customer NOTHING. Wherever this screen would say
   "the customer got a WhatsApp", it says "call the customer and tell them" instead,
   with the exact words to say and a big call button. After the work the driver asks
   the customer in person and taps "ગ્રાહક સંમત ✓" / "ગ્રાહક અસંમત ✗" (order.confirm). */
const drNoWa = o => !!o && String(o.whatsapp || '').toLowerCase() === 'no';
// The badge on the job row and in the chat: "WhatsApp નથી · ફોન કરો"
const drNoWaBadge = () => '<span class="dr-nowa">' + esc(TX.no_wa) + '</span>';
// A big green call button for one customer: "ફોન કરો 98250 41041"
const drCallBtn = o => '<a class="dr-call" href="' + esc(telUrl(o.phone)) + '">' + WA.icons.call +
  '<span>' + esc(TX.call) + ' · ' + esc(phoneText(o.phone)) + '</span></a>';
// Office message: "call the customer and tell them: «words»" + call button.
// title is optional (default "ગ્રાહકને ફોન કરીને જણાવો"); words is HTML (escape it yourself).
// The words are always Gujarati (what the customer hears); wordsEn = their meaning, shown under them in English mode.
function drCallBubble(o, words, title, wordsEn) {
  return WA.bubble('in', '<b>' + esc(title || TX.call_tell) + '</b>' +
    (words ? '<div class="dr-say">«' + guText(words) + '»' + enMean(wordsEn) + '</div>' : '') + drCallBtn(o), '', { who: TX.office, cls: 'dr-callb' });
}
// The words to say, the same as the WhatsApp templates (apps-script/whatsapp.gs)
const drSayDelay = (m, r, time) => 'માફ કરજો, અમારી ટીમ લગભગ ' + m + ' મિનિટ મોડી પહોંચશે. કારણ: ' + esc(reasonCust(r)) + '.' +
  (time ? ' અમે લગભગ <b>' + fm(mins(time)) + '</b> સુધીમાં પહોંચી જઈશું.' : '');
const drSayEta = time => 'અમે લગભગ <b>' + fm(mins(time)) + '</b> સુધીમાં પહોંચી જઈશું.';
const drSayDone = o => 'કામ પૂર્ણ થયું: ' + esc((o.done_checklist || []).map(svcGu).join(', ') || '-') + '.' +
  ((o.not_done || []).length ? ' બાકી: ' + esc(o.not_done.map(svcGu).join(', ')) + '.' : '') + ' કામ બરાબર થયું?';
// The same words in English (only for the "In English: …" line; the customer hears Gujarati)
const drSayDelayEn = (m, r, time) => esc(CUST_EN.delay(m, reasonCustEn(r), time ? fm(mins(time)) : ''));
const drSayEtaEn = time => esc(CUST_EN.eta(fm(mins(time))));
const drSayDoneEn = o => esc(CUST_EN.done((o.done_checklist || []).map(svcEn).join(', ') || '-', (o.not_done || []).map(svcEn).join(', ')));
// New arrival time after "I will be late" (same rule as the server, orders.gs delayArrival_):
// the later of now and the booked time, plus the minutes, rounded UP to 5 minutes. -> "HH:MM"
function drLateEta(o, m) {
  const now = nowMin(), booked = mins(o.sched_time);
  const base = booked !== null && (o.sched_date > todayIso() || (o.sched_date === todayIso() && booked > now)) ? booked : now;
  return hhmm((Math.ceil((base + m) / 5) * 5) % (24 * 60));
}

/* ---------- load the team's orders ----------
   apiCached draws the copy saved on the phone at once, then asks the server
   and draws again only if something changed. While it asks, the header says
   "updating…" quietly instead of showing a blank screen. */
async function drLoad() {
  if (DR.loading) { DR.again = true; return; }   // one is already running: load again right after it
  DR.loading = true;
  const seq = ++DR.seq;
  const tok = App.session && App.session.token;
  drSync(true);
  try {
    await apiCached('order.list', { from: todayIso() }, (data, fresh) => {
      if (!App.session || App.session.token !== tok) return;   // logged out meanwhile
      DR.orders = data.orders || [];
      DR.token = tok;
      if (fresh) { DR.error = ''; drClearSent(seq); }
      // First list of this login: put back the work kept on the phone (ticks, crew, unsent actions)
      if (!DR.restored) { DR.restored = true; drWipRestore(); }
      drShow('auto');
    });
    DR.error = '';
    drClearSent(seq);
  } catch (e) {
    DR.loading = false; drSync(false);
    if (guCode(e) === 'AUTH') return;
    DR.error = guErr(e);
    drShow('auto');
    return;
  }
  DR.loading = false;
  if (DR.again) { DR.again = false; return drLoad(); }
  drSync(false);
  drShow('auto');
}

// Draw the list again (and the open chat), if the driver is still on a driver page
function drShow(how) {
  if (!App.session || App.session.role !== 'driver' || $('#v-phone').hidden) return;
  drRedraw();
  if (DR.chat != null && WA.chatOpen()) drShowChat(DR.chat, how || 'auto');
}

// "updating…" after the team name in the blue header while fresh data loads
function drSync(on) {
  DR.syncing = on;
  const sub = $('#ph-head .wa-head .t span');
  if (!sub) return;
  const old = sub.querySelector('.dr-upd');
  if (old) old.remove();
  if (on && App.session && App.session.role === 'driver') sub.insertAdjacentHTML('beforeend', '<i class="dr-upd"> · ' + TX.updating + '</i>');
}
Phone.reload.driver = drLoad;
// Language switched: the open job chat and the undo bar in the new words
Phone.relang.driver = () => {
  if (DR.chat != null && WA.chatOpen()) drShowChat(DR.chat, 'keep');
  drUndoRelang();
};

// Draw the open page (the list behind the chat) again, keeping the scroll position
function drRedraw() {
  const el = $('#ph-body'), top = el.scrollTop;
  renderPhone();
  el.scrollTop = top;
  drSync(DR.syncing);   // renderPhone redrew the header: put "updating…" back if needed
}

// Common start of every driver page: loading / error / data
function drReady(el) {
  el.classList.remove('pad');   // lists go edge to edge, like WhatsApp
  // Someone else logged in on this phone: forget the old data and close an old chat
  if (DR.token !== App.session.token) {
    drUndoClear();   // an old login's waiting action is dropped, never sent with the new login
    Object.assign(DR, { orders: null, error: '', ticks: {}, crew: {}, size: {}, finish: {}, left: {}, pending: {}, chat: null, chatHtml: '', late: null,
      sheet: null, moving: null, restored: false, token: App.session.token });
    WA.closeChat();
  }
  if (DR.orders) return true;
  if (DR.error) el.innerHTML = '<div class="dr-pad"><div class="box bad">' + esc(DR.error) + '</div><button class="btn lg" data-act="ph-refresh">' + TX.try_again + '</button></div>';
  else { el.innerHTML = '<div class="dr-pad"><div class="empty">' + TX.loading + '</div></div>'; drLoad(); }
  return false;
}

// Today's jobs: unfinished ones by time first, then the finished ones
function drToday() {
  const t = todayIso(), byTime = (a, b) => mins(a.sched_time) - mins(b.sched_time);
  const list = drList().filter(o => jobOnDate(o, t));   // a multi-day job is on every day of its span
  return list.filter(o => !drDoneToday(o)).sort(byTime).concat(list.filter(drDoneToday).sort(byTime));
}
// The small number on the "today" tab = jobs left today
function drCount() {
  if (DR.orders) setTabCount('today', drToday().filter(o => !drDoneToday(o)).length);
}

/* ---------- travel and next job ---------- */
// A number from the Settings tab (null when it is missing)
const drSet = k => { const v = Number((App.setup.settings || {})[k]); return isFinite(v) && (App.setup.settings || {})[k] !== '' ? v : null; };

// Travel minutes between two areas: the same rule as the server (eta.gs), for the
// "next job" preview only. Returns null if a setting is missing (then no minutes are shown).
function drTravel(a, b) {
  const A = (App.setup.areas || []).find(x => x.key === a), B = (App.setup.areas || []).find(x => x.key === b);
  if (!a || !b || !A || !B) return drSet('unknown_area_min');   // an area is missing or unknown
  if (a === b) return drSet('same_area_min');                    // both jobs in the same area
  const perKm = drSet('min_per_km'), buf = drSet('buffer_min');
  if (perKm === null || buf === null) return null;
  return Math.round(Math.hypot(A.x - B.x, A.y - B.y) * perKm) + buf;
}

// The next job after this finished one (only for the latest finished job of today)
function drNextStop(o) {
  const t = todayIso();
  if (!jobOnDate(o, t) || o.status !== 'done') return null;
  const os = drList().filter(x => jobOnDate(x, t));
  // done_at is compared as text ("2026-10-07T11:20:00"), the same way as the server
  if (os.some(x => x.status === 'done' && x.order_id !== o.order_id && String(x.done_at) > String(o.done_at))) return null;
  return os.filter(x => DR_OPEN.includes(x.status) && !drDoneToday(x)).sort((a, b) => mins(a.sched_time) - mins(b.sched_time))[0] || null;
}

/* ---------- the short status line of a job (for the chat list) ----------
   Returns {text, cls}. cls colours it: ok (done), warn (late), bad (problem). */
function drStatus(o) {
  const lateBy = nowMin() - mins(o.sched_time);
  if (o.dispute || o.customer_confirm === 'no') return { text: tr('ગ્રાહકે ના કહી', 'Customer said no'), cls: 'bad' };
  if (o.status === 'done' && drNoWa(o) && !o.customer_confirm) return { text: tr('✓✓ કામ પૂર્ણ · ગ્રાહકને પૂછો', '✓✓ Done · ask the customer'), cls: 'warn' };
  if (o.status === 'done') return { text: tr('✓✓ કામ પૂર્ણ', '✓✓ Done') + ((o.not_done || []).length ? tr(' · થોડું બાકી', ' · some work left') : ''), cls: (o.not_done || []).length ? 'warn' : 'ok' };
  if (o.status === 'reached') return { text: tr('પહોંચ્યા · કામ ચાલુ', 'Reached · working'), cls: 'ok' };
  if (o.status === 'ongoing') return drDoneToday(o) ? { text: '✓ ' + TX.day_done + tr(' · કાલે ફરી', ' · again tomorrow'), cls: 'ok' } : { text: TX.ongoing + tr(' · આજે ફરી જવાનું', ' · go again today'), cls: '' };
  if (o.status === 'delayed' && o.delay_min > 0) return { text: tr('મોડું ' + durGu(o.delay_min), 'Late ' + dur(o.delay_min)), cls: 'warn' };
  if (o.sched_date === todayIso() && lateBy > 10) return { text: tr('સમય કરતાં ' + durGu(lateBy) + ' મોડા', dur(lateBy) + ' behind time'), cls: 'bad' };
  if (o.eta_sent) return { text: tr('સમય મોકલ્યો ', 'Time sent ') + fm(mins(o.eta_sent)), cls: '' };
  if (o.moved_from) return { text: tr(labGu(o.moved_from) + ' થી ખસેડેલું', 'Moved from ' + lab(o.moved_from)), cls: '' };
  return { text: TX.status[o.status] || o.status, cls: '' };
}

// One chat-list row for a job. next = true for the job to do now.
function drRow(o, next) {
  const s = drStatus(o);
  const bad = s.cls === 'bad' && (o.dispute || o.customer_confirm === 'no');
  const fail = drHasFail(o.order_id);   // something of this job could not be sent: small red badge
  return WA.row({
    name: o.client_name,
    time: timeOf(o),
    timeHot: next,
    // status first (it matters most), then area and services
    preview: (drNoWa(o) ? drNoWaBadge() + ' ' : '') + drChips(o, o.sched_date > todayIso() ? o.sched_date : todayIso()) +
      '<span class="dr-st ' + s.cls + '">' + esc(s.text) + '</span> · ' + esc(areaT(o.area)) + ' · ' + esc(drSvcs(o)),
    badge: fail ? '⚠' : bad ? '!' : next ? tr('હવે', 'Now') : '',
    badgeCls: fail || bad ? 'bad' : '',
    current: next,
    act: 'dr-open',
    data: { id: o.order_id },
    avatarColor: WA.colorFor(o.client_name)
  });
}

/* ---------- page: today (chat list) ---------- */
registerScreen('driver', 'today', el => {
  if (!drReady(el)) return;
  const today = drToday();
  const pend = today.filter(o => !drDoneToday(o));
  const nextId = pend.length ? pend[0].order_id : null;   // the job to do now
  setTabCount('today', pend.length);
  const moved = drMoved();
  let h = WA.sec(labT(todayIso()) + ' · ' + TX.team + ' ' + App.session.team + ' · ' + jobsN(today.length));
  if (DR.error) h += '<div class="dr-pad"><div class="box bad">' + esc(DR.error) + '</div></div>';
  if (!today.length && !moved.length) h += '<div class="dr-pad"><div class="empty">' + tr('આજે કોઈ કામ નથી.', 'No jobs today.') + '</div></div>';
  // Nothing left for today (all done or moved): the honest count of the day, on top
  if (!pend.length && (today.length || moved.length)) h += drSummaryHtml();
  h += '<div class="wa-list">' + today.map(o => drRow(o, o.order_id === nextId)).join('') + '</div>';
  // Jobs moved away from today stay visible, with their new date
  if (moved.length) h += WA.sec(tr('ખસેડેલા', 'Moved')) + '<div class="wa-list dr-moved">' + moved.map(drMovedRow).join('') + '</div>';
  // Very last: end the day (moves unfinished jobs to another date). Never at the top.
  if (pend.length) {
    h += '<div class="wa-list dr-endrow">' + WA.row({ name: TX.day_end, preview: esc(tr(pend.length + ' કામ બાકી · નવી તારીખ નક્કી કરો', jobsN(pend.length) + ' left · pick a new date')), act: 'dr-dayend',
      avatarIcon: DR_MOON, avatarColor: 'var(--muted)' }) + '</div>';
  }
  el.innerHTML = h;
});

/* ---------- moved jobs and the honest day summary ---------- */
// Jobs that were booked for today but moved to a later date
function drMoved() {
  const t = todayIso();
  return drList().filter(o => o.moved_from === t && o.sched_date > t)
    .sort((a, b) => a.sched_date === b.sched_date ? mins(a.sched_time) - mins(b.sched_time) : (a.sched_date < b.sched_date ? -1 : 1));
}
// One row in the "ખસેડેલા" (moved) section: new date first
function drMovedRow(o) {
  return WA.row({
    name: o.client_name,
    time: timeOf(o),
    preview: (drNoWa(o) ? drNoWaBadge() + ' ' : '') + '<span class="dr-st warn">→ ' + esc(labT(o.sched_date)) + '</span>' +
      (o.delay_reason && REASON[o.delay_reason] ? ' · ' + esc(lbl(REASON[o.delay_reason])) : ''),
    act: 'dr-open', data: { id: o.order_id }, avatarColor: WA.colorFor(o.client_name)
  });
}
// The truth about today: "આજે: 2 પૂર્ણ · 1 થોડું બાકી · 1 ખસેડ્યું".
// "શાબાશ!" only when every job was fully done (nothing partial, nothing moved).
function drSummaryHtml() {
  const t = todayIso(), today = drList().filter(o => jobOnDate(o, t) && drDoneToday(o));
  const part = today.filter(o => (o.not_done || []).length).length;
  const full = today.length - part, moved = drMoved().length;
  const bits = [];
  if (full) bits.push(full + tr(' પૂર્ણ', ' done'));
  if (part) bits.push(part + tr(' થોડું બાકી', ' partly done'));
  if (moved) bits.push(moved + tr(' ખસેડ્યું', ' moved'));
  const great = full > 0 && !part && !moved;
  // Moved customers WITHOUT WhatsApp got no message: "આ ગ્રાહકોને ફોન કરો" with a call button each
  const calls = drMoved().filter(drNoWa);
  return '<div class="dr-sum ' + (great ? 'ok' : 'warn') + '" role="status"><b>' + tr('આજે: ', 'Today: ') + esc(bits.join(' · ')) + '</b>' +
    (great ? '<span>' + tr('શાબાશ!', 'Well done!') + '</span>' : '') + '</div>' +
    (calls.length ? '<div class="dr-calls"><b>' + esc(TX.call_these) + '</b>' + calls.map(o =>
      '<div class="dr-calls-r"><span><b>' + esc(o.client_name) + '</b><span class="sub">→ ' + esc(labT(o.sched_date)) + ' · ' + timeOf(o) +
      (o.delay_reason && REASON[o.delay_reason] ? ' · ' + esc(lbl(REASON[o.delay_reason])) : '') + '</span></span>' + drCallBtn(o) + '</div>').join('') + '</div>' : '');
}

/* ---------- page: upcoming (chat list grouped by day) ---------- */
registerScreen('driver', 'up', el => {
  if (!drReady(el)) return;
  drCount();
  const t = todayIso();
  const up = drList().filter(o => o.sched_date > t && o.status !== 'done')
    .sort((a, b) => a.sched_date === b.sched_date ? mins(a.sched_time) - mins(b.sched_time) : (a.sched_date < b.sched_date ? -1 : 1));
  if (!up.length) { el.innerHTML = '<div class="dr-pad"><div class="empty">' + tr('હજી કોઈ કામ સોંપાયું નથી.', 'No jobs given yet.') + '</div></div>'; return; }
  let h = '', lastDate = '';
  up.forEach(o => {
    if (o.sched_date !== lastDate) {
      if (lastDate) h += '</div>';
      lastDate = o.sched_date;
      h += WA.sec(labT(o.sched_date)) + '<div class="wa-list">';
    }
    h += drRow(o, false);
  });
  el.innerHTML = h + '</div>';
});

/* ---------- page: profile (a simple padded page) ---------- */
registerScreen('driver', 'me', el => {
  el.classList.add('pad');
  drCount();
  const tm = (App.setup.teams || []).find(x => x.team === App.session.team) || {};
  const st = App.setup.settings || {};
  const w = Number(tm.workers) || 0;
  const name = tm.driver_name || App.session.name;
  el.innerHTML = '<div class="dr-me">' + WA.avatar(App.session.team, { color: teamColor(App.session.team, (App.setup.teams || []).map(x => x.team)) }) +
    '<div><b>' + TX.team + ' ' + esc(App.session.team) + '</b><span>' + esc(TX.driver) + ': ' + esc(name) + '</span></div></div>' +
    '<dl class="dr-kv">' +
    '<dt>' + esc(TX.driver) + '</dt><dd>' + esc(name) + '</dd>' +
    (w ? '<dt>' + tr('કારીગર', 'Workers') + '</dt><dd>' + tr('સાથે ' + w + ' કારીગર', w + ' workers with you') + '</dd>' : '') +
    (st.office_start && st.office_end ? '<dt>' + tr('ઓફિસ સમય', 'Office hours') + '</dt><dd>' + fm(mins(st.office_start)) + tr(' થી ', ' to ') + fm(mins(st.office_end)) + '</dd>' : '') +
    '</dl>' +
    (st.office_start && st.office_end ? '<div class="box warn">' + tr('ઓફિસ સમય પછીનો સમય ઓવરટાઇમ ગણાશે.', 'Time after office hours counts as overtime.') + '</div>' : '');
});

/* ==========================================================================
   THE JOB CHAT
   Built fresh from the order every time, oldest message first.
   ========================================================================== */

// The office's job card (the first message)
function drCardBubble(o) {
  const kv = (k, v) => v ? '<dt>' + k + '</dt><dd>' + v + '</dd>' : '';
  const html = '<b>' + esc(o.client_name) + '</b>' +
    '<ul class="dr-svc">' + (o.services || []).map(k => '<li>' + esc(svcT(k)) + '</li>').join('') + '</ul>' +
    '<dl class="kv">' +
    kv(TX.time, esc(drDay(o.sched_date) + ' · ' + timeOf(o))) +
    (drMulti(o) ? kv(tr('દિવસ', 'Days'), esc(tr(jobDays(o) + ' દિવસનું કામ · ' + labGu(o.sched_date) + ' થી ' + labGu(jobEnd(o)),
      jobDays(o) + '-day job · ' + lab(o.sched_date) + ' to ' + lab(jobEnd(o))))) : '') +
    (o.amc_label ? kv(TX.type, '<span class="dr-amc">' + esc(o.amc_label) + '</span> ' + tr('વાર્ષિક કરાર (AMC)', 'Annual contract (AMC)')) : '') +
    kv(TX.address, esc(o.address)) +
    kv(TX.area, esc(areaT(o.area))) +
    kv(TX.type, esc(typeT(o.client_type))) +
    kv(TX.phone, '<a href="' + telUrl(o.phone) + '">' + esc(phoneText(o.phone)) + '</a>') +
    '</dl>';
  let h = WA.bubble('in', html, '', { who: TX.office });
  // No WhatsApp: say so at the top of the chat. (The call button is in ONE call card at the
  // end of the chat, with the latest words to say: see drChatParts. Also Call in the header.)
  if (drNoWa(o)) {
    h += WA.bubble('in', drNoWaBadge() + '<div class="dr-nowa-t">' + tr('આ ગ્રાહકને WhatsApp મેસેજ જતા નથી. દરેક વાત ફોન કરીને જણાવો.', 'This customer gets no WhatsApp messages. Tell them everything by phone.') + '</div>',
      '', { who: TX.office, cls: 'dr-callb' });
  }
  if (o.notes) h += WA.bubble('in', '<b>' + TX.note + ':</b> ' + esc(o.notes), '', { who: TX.office, cls: 'warn' });
  if (o.moved_from) h += WA.sys(tr(labGu(o.moved_from) + ' થી ખસેડેલું કામ', 'Job moved from ' + lab(o.moved_from)) + (o.delay_reason && REASON[o.delay_reason] ? ' · ' + lbl(REASON[o.delay_reason]) : ''));
  return h;
}

// The customer's reply (yes / no / waiting), shown after the last event
function drReply(o) {
  if (o.dispute || o.customer_confirm === 'no') {
    return WA.bubble('in', tr('ગ્રાહકનો જવાબ: <b>ના</b><br>ગ્રાહકે ના કહી. માલિકને જાણ કરી છે.', "Customer's answer: <b>No</b><br>The customer said no. The owner has been told."), '', { who: TX.customer, cls: 'bad' });
  }
  if (o.customer_confirm === 'yes') return WA.bubble('in', tr('ગ્રાહકનો જવાબ: <b>હા</b> ✓', "Customer's answer: <b>Yes</b> ✓"), '', { who: TX.customer });
  return WA.sys(tr('ગ્રાહકનો જવાબ બાકી', "Waiting for the customer's answer"));
}

// The "I will be late" picker: minutes and reason chips, then a send button.
// NOTHING is chosen at the start, so one hurried tap can never send a wrong message.
// The send button stays off until both minutes and reason are chosen.
function drLateBubble(o) {
  const L = DR.late;
  const chip = (k, v, label, on) => '<button aria-pressed="' + on + '" data-act="dr-late-pick" data-k="' + k + '" data-v="' + v + '">' + esc(label) + '</button>';
  const ready = !!(L.mins && L.reason);
  // Preview: the same words as the "delay" WhatsApp template (apps-script/whatsapp.gs).
  // New arrival time, same rule as the server (drLateEta).
  // No WhatsApp: nothing is sent, so the words are what the driver says on the phone.
  const noWa = drNoWa(o);
  // The customer's words stay Gujarati; in English mode their meaning shows under them (enMean).
  let prev = '<div class="dr-prev muted">' + tr('મિનિટ અને કારણ બંને પસંદ કરો.', 'Pick both the minutes and the reason.') + '</div>';
  if (L.mins) {
    const eta = drLateEta(o, L.mins);
    const etaLine = 'અમે લગભગ ' + fm(mins(eta)) + ' સુધીમાં પહોંચી જઈશું.';
    prev = '<div class="dr-prev"><span class="dr-lbl">' + (noWa ? tr('ગ્રાહકને ફોન કરીને આ કહો:', 'Call the customer and say this:') : tr('ગ્રાહકને આ મેસેજ જશે:', 'The customer will get this message:')) + '</span>' +
      (L.reason
        ? guText('«માફ કરજો, અમારી ટીમ લગભગ ' + L.mins + ' મિનિટ મોડી પહોંચશે. કારણ: ' + esc(reasonCust(L.reason)) + '. <b>' + etaLine + '</b>»') +
          enMean(drSayDelayEn(L.mins, L.reason, eta))
        : '<b class="dr-eta">' + guText(etaLine) + '</b>' + enMean(drSayEtaEn(eta)) +
          '<span class="muted">' + tr('હવે કારણ પસંદ કરો.', 'Now pick the reason.') + '</span>') + '</div>';
  }
  return WA.bubble('in',
    '<b>' + tr('મોડા છો? ગ્રાહકને જણાવો', 'Running late? Tell the customer') + '</b>' + (noWa ? '<div>' + drNoWaBadge() + '</div>' : '') +
    '<span class="dr-lbl">' + tr('કેટલી મિનિટ મોડા?', 'How many minutes late?') + '</span><div class="wa-chips">' +
    DR_LATE_MINS.map(m => chip('mins', m, m <= 60 ? m + ' ' + TX.minutes : durT(m), L.mins === m)).join('') + '</div>' +
    '<span class="dr-lbl">' + tr('કારણ', 'Reason') + '</span><div class="wa-chips">' +
    DR_REASONS.map(r => chip('reason', r, lbl(REASON[r]), L.reason === r)).join('') + '</div>' +
    prev +
    // No WhatsApp: "save" is an OUTLINE button, so it never looks like the green Call button under it
    '<button class="dr-send' + (noWa ? ' dr-send-ol' : '') + '" data-act="dr-delay-send" data-id="' + o.order_id + '"' + (ready ? '' : ' disabled') + '>' + WA.icons.send +
    '<span>' + (noWa ? tr('મોડાની નોંધ કરો', 'Save the delay') : tr('ગ્રાહકને WhatsApp મોકલો', 'Send WhatsApp to the customer')) + '</span></button>' +
    (noWa ? drCallBtn(o) : ''),
    '', { who: TX.office, cls: 'dr-late' });
}

/* ---------- no WhatsApp: the customer's answer, asked in person ----------
   After the work the driver shows the customer what was done and asks.
   Two buttons inside the message; the answer goes to the server (order.confirm).
   "ના" = a dispute and an alert to the owner, the same as a "No" on WhatsApp. */
function drConfirmPart(o) {
  const p = DR.pending[o.order_id];
  // An answer tapped, still in its undo window or on its way: show it with a clock
  if (p && p.kind === 'confirm' && drBusyState(p)) {
    return drOut(o, 'confirm', p.params.answer === 'yes' ? TX.cf_yes : TX.cf_no, fm(p.at), p.params.answer === 'yes' ? '' : 'bad');
  }
  if (o.customer_confirm === 'yes') return WA.bubble('out', '<b>' + TX.cf_yes + '</b><br><span class="sub">' + tr('ગ્રાહકે રૂબરૂ હા કહી', 'The customer said yes in person') + '</span>', '', { ticks: 2 });
  if (o.customer_confirm === 'no' || o.dispute) {
    return WA.bubble('out', '<b>' + TX.cf_no + '</b>', '', { ticks: 2, cls: 'bad' }) +
      WA.bubble('in', tr('ગ્રાહકે ના કહી. માલિકને જાણ કરી છે.', 'The customer said no. The owner has been told.'), '', { who: TX.office, cls: 'bad' });
  }
  const off = drSending(o.order_id) ? ' disabled' : '';
  return WA.bubble('in', '<b>' + tr('ગ્રાહકને કામ બતાવો અને પૂછો', 'Show the customer the work and ask') + '</b>' +
    '<div class="dr-say">«' + guText(drSayDone(o)) + '»' + enMean(drSayDoneEn(o)) + '</div>' +
    '<span class="dr-lbl">' + tr('ગ્રાહકનો જવાબ:', "Customer's answer:") + '</span>' +
    '<div class="dr-cf">' +
    '<button class="dr-cf-yes" data-act="dr-confirm" data-id="' + o.order_id + '" data-v="yes"' + off + '>' + TX.cf_yes + '</button>' +
    '<button class="dr-cf-no" data-act="dr-confirm" data-id="' + o.order_id + '" data-v="no"' + off + '>' + TX.cf_no + '</button></div>' +
    '<div class="sub">' + tr('ગ્રાહક ત્યાં ન હોય તો ફોન કરીને પૂછો.', 'If the customer is not there, call and ask.') + '</div>' + drCallBtn(o),
    '', { who: TX.office, cls: 'dr-callb' });
}

// The service checklist after reaching: tap a service to tick it
function drCheckBubble(o) {
  // A task without a checklist (possible when the "orders" add-on is off): nothing to tick
  if (!(o.services || []).length) return '';
  const ticks = DR.ticks[o.order_id] || [];
  const not = (o.services || []).filter(k => !ticks.includes(k));
  return WA.bubble('in',
    '<b>' + tr('કયા કયા કામ થયા? ટિક કરો', 'Which work was done? Tick it') + '</b>' +
    '<div class="dr-cks">' + (o.services || []).map(k => '<button class="dr-ck" aria-pressed="' + ticks.includes(k) + '" data-act="dr-tick" data-id="' + o.order_id + '" data-k="' + esc(k) + '">' +
      '<i aria-hidden="true">' + WA.icons.tick + '</i><span>' + esc(svcT(k)) + '</span></button>').join('') + '</div>' +
    (ticks.length && not.length ? '<div class="box warn">' + tr('બાકી: ', 'Not done: ') + not.map(k => esc(svcT(k))).join(', ') + tr('. માલિકને જાણ કરવામાં આવશે.', '. The owner will be told.') + '</div>' : ''),
    '', { who: TX.office, cls: 'dr-ckb' });   // dr-ckb: the chat scrolls here after "reached" (drScrollCk)
}

/* ---------- log book: who did the work ----------
   Shown under the checklist while the team is at the site, sent with "કામ પૂર્ણ થયું".
   "કોણે કામ કર્યું?": one chip per worker of the team (Teams tab worker_names), tap to pick.
   Tank sizes are NOT typed by drivers any more (decision 2026-10-08): they are shown
   read-only near the top of the job (drTanksBubble), with a "માપ અલગ છે" button. */
// The worker names of the driver's own team (setup.get sends only the own team's)
function drWorkers() {
  const t = ((App.setup && App.setup.teams) || []).find(x => x.team === App.session.team);
  return (t && t.worker_names) || [];
}
// The bubble with the crew chips (nothing when the team has no worker names)
function drLogBubble(o) {
  const id = o.order_id, workers = drWorkers(), crew = DR.crew[id] || [];
  if (!workers.length) return '';
  return WA.bubble('in', '<b>' + tr('કોણે કામ કર્યું?', 'Who did the work?') + '</b>' +
    '<div class="wa-chips dr-crew">' + workers.map(w => '<button type="button" data-act="dr-crew" data-id="' + id + '" data-n="' + esc(w) + '" aria-pressed="' + crew.includes(w) + '">' + esc(w) + '</button>').join('') + '</div>',
    '', { who: TX.office, cls: 'dr-log' });
}

/* ---------- tank sizes, READ-ONLY (added 2026-10-08) ----------
   The sizes come from the office (New order / Edit) or the supervisor's survey. The driver
   only reads them. If the tanks at the site are different, "માપ અલગ છે" opens a small sheet
   (drSizeSheet) and the office gets an alert (order.sizeIssue). Nothing about money. */
// Small ruler icon for the "માપ અલગ છે" button
const DR_RULER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17 17 3l4 4L7 21z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/></svg>';
function drTanksBubble(o, canReport) {
  const tk = o.tanks || [], s = DR.size[o.order_id];
  const list = tk.length
    ? '<div class="dr-tkro">' + tk.map(t => '<span class="dr-tkline">' + esc(tankTextT(t)) + '</span>').join('') +
      (tk.length > 1 ? '<span class="dr-tkline"><b>' + tr('કુલ ', 'Total ') + litresText(tanksTotal(tk)) + ' ' + TX.litres + '</b></span>' : '') + '</div>'
    : '<div class="dr-tknone">' + tr('ટાંકીનું માપ સેવ નથી', 'No tank sizes saved') + '</div>';
  // A report on its way, or not sent (the red bar at the bottom sends it again)
  const sent = s ? '<div class="dr-sizeq' + (s.state === 'failed' ? ' bad' : '') + '">' + esc(TX.size_diff) + ': ' + esc(s.note) + ' · ' +
    (s.state === 'failed' ? tr('મોકલાયું નહીં', 'Not sent') : TX.sending) + '</div>' : '';
  // Measured by the supervisor (job from a survey quotation): the sizes are final, no "size is different"
  // button (added 2026-10-09). Sizes the office took from the customer on the phone can still be reported.
  const measured = o.measured === true && tk.length;
  return WA.bubble('in', '<b>' + TX.tank_sizes + '</b>' + list + sent +
    (measured ? '<div class="dr-tkok">✓ ' + tr('સર્વેયરે માપેલું', 'Measured by the surveyor') + '</div>'
      : canReport && !s ? '<button type="button" class="dr-sizebtn" data-act="dr-size" data-id="' + o.order_id + '">' + DR_RULER + '<span>' + esc(TX.size_diff) + '</span></button>' : ''),
    '', { who: TX.office, cls: 'dr-tks' });
}

/* ---------- messages the driver sends (WhatsApp style) ----------
   A tapped action shows at once with a small clock. When the server says OK
   the clock becomes ✓✓. If it fails, the message turns red with "send again". */
const drDelayHtml = (m, r) => tr('<b>' + m + ' મિનિટ</b> મોડો પડીશ', '<b>' + m + ' min</b> late') + '<br>' + esc(lbl(REASON[r] || REASON.other));
// the crew (log book) is shown under the services when it was saved
// (tank sizes are not repeated here: they are shown read-only at the top of the job)
const drDoneHtml = (done, not, crew) => '<b>' + tr('કામ પૂર્ણ', 'Work done') + '</b><div class="dr-done">' +
  done.map(k => '<span class="ok">✓ ' + esc(svcT(k)) + '</span>').join('') +
  not.map(k => '<span class="no">✗ ' + esc(svcT(k)) + '</span>').join('') + '</div>' +
  ((crew || []).length ? '<div class="dr-crewl"><span class="dr-lbl">' + tr('કામ કરનાર', 'Worked by') + '</span>' + esc(crew.join(', ')) + '</div>' : '');
// true while an action waits in its undo window ('wait') or is on its way ('sending')
const drBusyState = p => !!(p && (p.state === 'wait' || p.state === 'sending'));
const drSending = id => drBusyState(DR.pending[id]);

// One outgoing message: ✓✓ when confirmed, a clock while it waits or is being sent
function drOut(o, kind, html, time, cls) {
  const p = DR.pending[o.order_id];
  const b = WA.bubble('out', html, time, { ticks: 2, cls: cls });
  return (p && p.kind === kind && drBusyState(p))
    ? b.replace(WA.icons.ticks, '<i class="dr-clock" aria-label="' + esc(TX.sending) + '">' + ICON_CLOCK + '</i>') : b;
}
// The red "not sent" message (the "send again" button is the red bar at the bottom, drFailBar)
function drFailed(o) {
  const p = DR.pending[o.order_id];
  if (!p || p.state !== 'failed') return '';
  return WA.bubble('out', p.text + '<span class="dr-failtxt">⚠ ' + tr('મોકલાયું નહીં', 'Not sent') + '</span>', fm(p.at), { cls: 'bad dr-fail' });
}
// The fixed red bar above the bottom buttons while something of this job could not be sent:
// "મોકલાયું નહીં · ફરી મોકલો" (one big button: sends the failed action and/or size report again)
function drFailBar(o) {
  if (!drHasFail(o.order_id)) return '';
  return '<div class="dr-failbar" role="alert"><button type="button" data-act="dr-retry" data-id="' + o.order_id + '">⚠ ' + TX.not_sent_retry + '</button></div>';
}

// The order with a not-yet-confirmed action already applied (only while it is being sent or just sent)
function drPatch(o) {
  const p = DR.pending[o.order_id];
  // End of day tapped, not confirmed yet: show the job as already moved
  const mv = DR.moving && DR.moving.items.find(it => String(it.order_id) === String(o.order_id));
  if (mv && o.sched_date === todayIso() && o.status !== 'done') {
    return Object.assign({}, o, { sched_date: mv.new_date, moved_from: todayIso(), status: 'assigned', delay_reason: mv.reason, delay_min: null });
  }
  if (!p || p.state === 'failed' || p.kind === 'leave') return o;
  const x = Object.assign({}, o), at = todayIso() + 'T' + hhmm(p.at) + ':00';
  const open = DR_OPEN.includes(o.status);
  // multi-day: close today's open day entry (dayDone / final done)
  const closeDay = () => { x.work_days = workDays(o).map(w => w.left ? w : Object.assign({}, w, { left: at })); };
  if (p.kind === 'confirm' && o.status === 'done' && !o.customer_confirm) {
    x.customer_confirm = p.params.answer;
    if (p.params.answer === 'no') x.dispute = true;
  }
  if (p.kind === 'reach' && open) {
    x.status = 'reached';
    if (!o.reached_at) x.reached_at = at;   // a multi-day job keeps the first day's time
    if (drMulti(o)) x.work_days = workDays(o).filter(w => w.left).concat([{ date: todayIso(), reached: at, left: '', overtime_min: 0 }]);
  }
  if (p.kind === 'daydone' && o.status === 'reached') { x.status = 'ongoing'; closeDay(); }
  if (p.kind === 'delay' && open) { x.status = 'delayed'; x.delay_min = p.params.mins; x.delay_reason = p.params.reason; }
  if (p.kind === 'done' && o.status === 'reached') {
    x.status = 'done'; x.done_at = at; x.done_checklist = p.params.done;
    x.not_done = (o.services || []).filter(k => !p.params.done.includes(k));
    if (p.params.crew) x.crew = p.params.crew;
    if (drMulti(o)) closeDay();
  }
  return x;
}
// Fresh data from a load that started after the action was confirmed already contains it
function drClearSent(seq) {
  Object.keys(DR.pending).forEach(id => { const p = DR.pending[id]; if (p.state === 'sent' && p.seq < seq) delete DR.pending[id]; });
  if (DR.moving && DR.moving.state === 'sent' && DR.moving.seq < seq) DR.moving = null;
}

/* The days of a multi-day job, oldest first: for each day worked, "હું પહોંચી ગયો" and
   "આજનું કામ પૂર્ણ" (with the day's overtime); today's reach with a clock while it is sent.
   The customer's WhatsApp answer belongs to the first day only.
   cc = {html}: the no-WhatsApp call card is put there (not in the messages), see drChatParts. */
function drDaysPart(o, cc) {
  const t = todayIso(), n = jobDays(o), noWa = drNoWa(o), wd = workDays(o);
  const closed = wd.filter(w => w.left), openE = wd.find(w => !w.left);
  let m = '';
  closed.forEach((w, i) => {
    const lastOfJob = o.status === 'done' && i === closed.length - 1;   // the final day: the "કામ પૂર્ણ" message follows
    if (w.date !== o.sched_date) m += WA.day(drDay(w.date));
    m += WA.bubble('out', TX.reached + ' <span class="dr-day">' + esc(TX.day_of(i + 1, n)) + '</span>', fm(mins(w.reached)), { ticks: 2 });
    if (!lastOfJob) {
      const html = '<b>' + TX.day_done + '</b> <span class="sub">(' + esc(TX.day_of(i + 1, n)) + ')</span>';
      m += i === closed.length - 1 ? drOut(o, 'daydone', html, fm(mins(w.left))) : WA.bubble('out', html, fm(mins(w.left)), { ticks: 2 });
      if (Number(w.overtime_min) > 0) m += WA.sys(tr('ઓવરટાઇમ: ', 'Overtime: ') + durT(Number(w.overtime_min)));
    }
  });
  if (openE) {
    if (openE.date !== o.sched_date) m += WA.day(drDay(openE.date));
    m += drOut(o, 'reach', TX.reached + ' <span class="dr-day">' + esc(TX.day_of(closed.length + 1, n)) + '</span>', fm(mins(openE.reached)));
    // the first day only: the customer's answer (or the call, without WhatsApp)
    if (!closed.length && o.status === 'reached') {
      if (noWa) cc.html = drCallBubble(o, 'અમારી ટીમ પહોંચી ગઈ છે.', drTellTitle(), esc(CUST_EN.reached));
      else m += drReply(o);
    }
  } else if (o.status === 'ongoing' && !drDoneToday(o) && jobOnDate(o, t)) {
    m += WA.day(drDay(t)) + WA.sys(drDayLabel(o, t) + tr(': પહોંચો ત્યારે «' + TX.reached + '» દબાવો.', ': press «' + TX.reached + '» when you get there.'));
  }
  return m;
}

// "Arrival time 11:05 AM sent to Hiren Patel ✓"
const drEtaSent = (name, eta) => tr(esc(name) + ' ને અંદાજિત સમય <b>' + fm(mins(eta)) + '</b> મોકલ્યો ✓',
  'Arrival time <b>' + fm(mins(eta)) + '</b> sent to ' + esc(name) + ' ✓');
// Title of the "tell the customer that the team has reached" call message
const drTellTitle = () => tr('ગ્રાહકને ફોન કરીને અથવા રૂબરૂ જણાવો', 'Tell the customer by phone or in person');

/**
 * Builds the whole chat for one job: {head, msgs, bottom}.
 * Read-only (upcoming jobs): no action buttons, only Call and Map in the header.
 */
function drChatParts(o) {
  const t = todayIso();
  const readOnly = !jobOnDate(o, t);   // a multi-day job is "today" on every day of its span
  const open = DR_OPEN.includes(o.status) && !drDoneToday(o);
  const multi = drMulti(o), n = jobDays(o);
  const lateBy = o.sched_date === t ? nowMin() - mins(o.sched_time) : 0;

  // Header: back arrow, client, area · day · time, Call and Map
  const head = WA.chatHead({
    title: o.client_name,
    sub: areaT(o.area) + ' · ' + (multi && o.sched_date <= t ? drDayLabel(o, t) : drDay(o.sched_date)) + ' · ' + timeOf(o),
    back: 'dr-back',
    avatarColor: WA.colorFor(o.client_name),
    // Call and Map with words under the icons (icons alone are hard to read in the sun)
    // No WhatsApp: the Call button is green, so it stands out
    right: '<a class="wa-ib dr-hb' + (drNoWa(o) ? ' dr-hot' : '') + '" href="' + esc(telUrl(o.phone)) + '" aria-label="' + esc(TX.call_aria) + '">' + WA.icons.call + '<span>' + TX.call_short + '</span></a>' +
      '<a class="wa-ib dr-hb" href="' + esc(mapUrl(o)) + '" target="_blank" rel="noopener" aria-label="' + esc(tr('નકશો ખોલો', 'Open map')) + '">' + WA.icons.map + '<span>' + TX.map_short + '</span></a>'
  }).replace('aria-label="Back"', 'aria-label="' + esc(tr('પાછા', 'Back')) + '"');   // chat.js writes "Back": Gujarati for the driver

  // Messages, oldest first
  const noWa = drNoWa(o);
  // Customer WITHOUT WhatsApp: ONE call card with the LATEST words to say (added 2026-10-08).
  // Each step below puts its words in cc.html (a later step replaces an earlier one); the card is
  // added once, at the end of the chat. (Before, up to four call buttons with different words.)
  const cc = { html: '' };
  let m = WA.day(drDay(o.sched_date)) + drCardBubble(o);
  // Tank sizes, read-only, near the top; "માપ અલગ છે" only for a job of today
  m += drTanksBubble(o, !readOnly);
  // Moved off today by the end-of-day: a no-WhatsApp customer must be called with the new date
  if (noWa && readOnly && o.moved_from === t && o.sched_date > t) {
    cc.html = drCallBubble(o, 'તમારું કામ <b>' + esc(labGu(o.sched_date)) + ' · ' + timeOf(o) + '</b> પર ખસેડ્યું છે.' +
      (o.delay_reason && REASON[o.delay_reason] ? ' કારણ: ' + esc(reasonCust(o.delay_reason)) + '.' : ''), '',
      esc(CUST_EN.moved(lab(o.sched_date) + ' · ' + timeOf(o), o.delay_reason && REASON[o.delay_reason] ? reasonCustEn(o.delay_reason) : '')));
  }
  if (o.eta_sent) {
    if (!noWa) m += WA.bubble('out', tr('ગ્રાહકને અંદાજિત સમય મોકલ્યો: ', 'Arrival time sent to the customer: ') + '<b>' + fm(mins(o.eta_sent)) + '</b>', '', { ticks: 2 });
    else if (open) cc.html = drCallBubble(o, drSayEta(o.eta_sent), tr('અંદાજિત સમય ', 'Arrival time ') + fm(mins(o.eta_sent)) + ' · ' + TX.call_tell, drSayEtaEn(o.eta_sent));
    else m += WA.sys(tr('અંદાજિત સમય ', 'Arrival time ') + fm(mins(o.eta_sent)));
  }
  if (o.delay_min > 0) {
    m += drOut(o, 'delay', drDelayHtml(o.delay_min, o.delay_reason), '');
    // No WhatsApp: the late message was NOT sent, the driver calls with these words
    if (noWa && open) cc.html = drCallBubble(o, drSayDelay(o.delay_min, o.delay_reason, DR.delayAt[o.order_id]), '',
      drSayDelayEn(o.delay_min, o.delay_reason, DR.delayAt[o.order_id]));
  }
  if (open && !readOnly && lateBy > 10) {
    m += WA.sys(tr('સમય કરતાં ' + durGu(lateBy) + ' મોડા.', dur(lateBy) + ' behind time.') + (o.delay_min > 0 ? '' : tr(' ગ્રાહકને મોડાની જાણ કરો.', ' Tell the customer you are late.')));
  }
  if (multi) m += drDaysPart(o, cc);   // one block per day worked (multi-day job)
  else if (o.reached_at) {
    m += drOut(o, 'reach', TX.reached, fm(mins(o.reached_at)));
    if (o.status === 'reached') {
      if (noWa) cc.html = drCallBubble(o, 'અમારી ટીમ પહોંચી ગઈ છે.', drTellTitle(), esc(CUST_EN.reached));
      else m += drReply(o);
    }
  }
  if (o.status === 'done') {
    const done = o.done_checklist || [], not = o.not_done || [];
    m += drOut(o, 'done', drDoneHtml(done, not, o.crew), o.done_at ? fm(mins(o.done_at)) : '', not.length ? 'warn' : '');
    if (o.overtime_min > 0) m += WA.sys(tr('ઓવરટાઇમ: ', 'Overtime: ') + durT(o.overtime_min));
    // No WhatsApp: "ask the customer" (with its own call button) is the latest card
    if (noWa) { m += drConfirmPart(o); cc.html = ''; } else m += drReply(o);
  }
  // The late picker has its own call button (no WhatsApp): then no extra call card
  const picking = DR.late && String(DR.late.id) === String(o.order_id) && open && !readOnly;
  if (cc.html && !picking) m += cc.html;

  m += drFailed(o);   // an action that could not be sent (the red bar at the bottom sends it again)

  // What the driver can do now (the buttons at the bottom).
  // While an action is on its way, the buttons wait (wait = true).
  const wait = drSending(o.order_id);
  let bottom = '';
  if (readOnly) {
    m += WA.sys(tr('આ કામ ' + labGu(o.sched_date) + ' નું છે.', 'This job is on ' + lab(o.sched_date) + '.'));
  } else if (open) {
    if (picking) {
      m += drLateBubble(o);
      bottom = WA.quick([{ label: TX.close, act: 'dr-late-cancel', cls: 'full' }]);
    } else {
      bottom = WA.quick([
        { label: TX.reached, act: 'dr-reach', data: { id: o.order_id }, cls: 'pri', disabled: wait },
        { label: TX.will_be_late, act: 'dr-delay', data: { id: o.order_id }, disabled: wait }
      ]);
    }
  } else if (o.status === 'reached' && multi && !DR.finish[o.order_id]) {
    // A multi-day job at the site: today's work done (come back tomorrow), or the whole job done.
    // Two clearly different buttons, one under the other: outline moon vs filled tick.
    m += WA.bubble('in', tr('<b>આ કામ ' + n + ' દિવસનું છે</b><br>આજનું કામ પૂરું થાય ત્યારે <b>«' + TX.day_done_btn + '»</b> દબાવો. ' +
      'આખું કામ પૂરું થાય ત્યારે <b>«' + TX.job_done_btn + '»</b> દબાવો.',
      '<b>This is a ' + n + '-day job</b><br>When today\'s work is finished, press <b>«' + TX.day_done_btn + '»</b>. ' +
      'When the whole job is finished, press <b>«' + TX.job_done_btn + '»</b>.'), '', { who: TX.office });
    bottom = WA.quick([
      { label: TX.day_done_btn, act: 'dr-daydone', data: { id: o.order_id }, cls: 'full dr-ol', disabled: wait },
      { label: TX.job_done_btn, act: 'dr-finish', data: { id: o.order_id }, cls: 'pri full', disabled: wait }
    ]);
  } else if (o.status === 'reached') {
    m += drCheckBubble(o);
    m += drLogBubble(o);   // log book: who did the work
    // No tick yet: the button is not greyed out with no reason. It says "tick the work above
    // first ↑" and a tap scrolls up to the checklist (dr-tickfirst).
    const noTick = !(DR.ticks[o.order_id] || []).length && (o.services || []).length > 0;
    bottom = WA.quick([noTick
      ? { label: TX.tick_first, act: 'dr-tickfirst', data: { id: o.order_id }, cls: 'full dr-dim', disabled: wait }
      : { label: multi ? TX.job_done_btn : TX.work_done, act: 'dr-done', data: { id: o.order_id }, cls: 'pri full', disabled: wait }].concat(multi
      ? [{ label: TX.day_done_btn, act: 'dr-daydone', data: { id: o.order_id }, cls: 'full dr-ol', disabled: wait }] : []));
  } else if (o.status === 'ongoing' && !readOnly) {
    // Today's work was done ("આજનું કામ પૂર્ણ"): nothing more today
    m += WA.sys(tr('આજનું કામ પૂર્ણ. આવતીકાલે ફરી આ કામ પર જવાનું છે.', "Today's work is done. Come back to this job tomorrow."));
    bottom = WA.quick([{ label: TX.back_to_list, act: 'dr-back', cls: 'full', disabled: wait }]);
  } else if (o.status === 'done') {
    const L = DR.left[o.order_id], nx = drNextStop(o), pl = DR.pending[o.order_id];
    const nxNoWa = nx && drNoWa(nx);
    // Big "open the next job" button, so "I have left" is never a dead end
    const nextBtn = j => WA.quick([{ label: tr('આગળનું કામ ખોલો: ', 'Open next job: ') + j.client_name, act: 'dr-open', data: { id: j.order_id }, cls: 'pri full' }]);
    // Last job of the day finished: a clear way back to the list
    const backBtn = WA.quick([{ label: TX.back_to_list, act: 'dr-back', cls: 'full', disabled: wait }]);
    if (pl && pl.kind === 'leave' && drBusyState(pl)) {
      // "I have left" tapped: shown at once with a clock until the server answers
      m += drOut(o, 'leave', TX.i_left, fm(pl.at));
    } else if (L) {
      // "I have left" was tapped on this phone: show it and the server's answer
      m += WA.bubble('out', TX.i_left, fm(L.at), { ticks: 2 });
      const j = (L.next != null && drOrder(L.next)) || nx;
      m += L.told === false
        ? WA.bubble('in', esc(L.to) + tr(': સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું.<br>ઓફિસને જાણ કરી, ઓફિસ ગ્રાહકને ફોન કરશે.',
          ': about ' + dur(L.late) + ' behind time.<br>The office has been told and will call the customer.'), '', { who: TX.office, cls: 'warn' })
        // The next customer has no WhatsApp: nothing was sent, the driver calls them with the time
        : L.wa === false && j ? drCallBubble(j, drSayEta(L.eta) + (L.late > 10 ? ' (સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું)' : ''), TX.call_tell + ': ' + L.to,
          drSayEtaEn(L.eta) + (L.late > 10 ? ' (about ' + dur(L.late) + ' late)' : ''))
        : WA.bubble('in', drEtaSent(L.to, L.eta) +
          (L.late > 10 ? tr('<br>સમય કરતાં લગભગ ' + durGu(L.late) + ' મોડું. ગ્રાહકને જાણ કરી.', '<br>About ' + dur(L.late) + ' behind time. The customer has been told.') : ''), '', { who: TX.office });
      bottom = j && j.sched_date === t && j.status !== 'done' ? nextBtn(j) : backBtn;
    } else if (nx && nx.eta_sent) {
      m += nxNoWa ? drCallBubble(nx, drSayEta(nx.eta_sent), TX.call_tell + ': ' + nx.client_name, drSayEtaEn(nx.eta_sent))
        : WA.bubble('in', drEtaSent(nx.client_name, nx.eta_sent), '', { who: TX.office });
      bottom = nextBtn(nx);
    } else if (nx) {
      m += WA.bubble('in', tr('આગળનું કામ: ', 'Next job: ') + '<b>' + esc(nx.client_name) + '</b><br>' + esc(areaT(nx.area)) + ' · ' + timeOf(nx) +
        (drTravel(o.area, nx.area) !== null ? tr(' · રસ્તો લગભગ ' + drTravel(o.area, nx.area) + ' મિનિટ', ' · about ' + drTravel(o.area, nx.area) + ' min drive') : '') +
        (nxNoWa ? '<br>' + drNoWaBadge() : ''), '', { who: TX.office, cls: 'dr-next' });
      bottom = WA.quick([{ label: TX.i_left, act: 'dr-leave', data: { id: o.order_id }, cls: 'pri full', disabled: wait }]);
    } else {
      bottom = backBtn;
    }
  }
  // Something could not be sent: the red "send again" bar sits right above the buttons
  return { head: head, msgs: m, bottom: drFailBar(o) + bottom };
}

/**
 * Shows (or re-draws) the chat of one job.
 * how = 'open'  first open, newest message at the bottom
 *       'force' after an action: redraw and go to the newest message
 *       'keep'  after a tick or chip tap: redraw, stay where the driver is (or at the bottom)
 *       'auto'  the 60-second refresh: only redraw if something changed
 */
function drShowChat(id, how) {
  const o = drOrder(id);
  if (!o) {
    // The job is gone (moved to another team, or cancelled)
    if (WA.chatOpen()) { drCloseChat(); toast(tr('આ કામ હવે તમારી યાદીમાં નથી.', 'This job is no longer in your list.')); }
    return;
  }
  const p = drChatParts(o);
  const html = p.head + p.msgs + p.bottom;
  if (how === 'auto' && html === DR.chatHtml) return;   // nothing new
  // The 60-second refresh never redraws while the driver is typing a tank size (the keyboard would close)
  const f = document.activeElement;
  if (how === 'auto' && f && f.tagName === 'INPUT' && f.closest && f.closest('#ph-chat')) return;
  const old = $('#wa-msgs');
  const top = old ? old.scrollTop : 0;
  const atBottom = old ? old.scrollHeight - old.scrollTop - old.clientHeight < 40 : true;
  WA.openChat(p.head, p.msgs, p.bottom);   // this scrolls to the newest message
  DR.chat = o.order_id;
  DR.chatHtml = html;
  const box = $('#wa-msgs');
  // 'keep' and 'auto': stay where the driver was, unless they were already at the newest message
  if (box && (how === 'keep' || how === 'auto') && !atBottom) box.scrollTop = top;
  // At the site (after "reached", or opening such a job): show the checklist from its top,
  // not the bottom of the chat, so the driver sees at once what to tick (added 2026-10-08)
  if (how === 'open' || how === 'force') drScrollCk();
}
// Scroll the open chat so the checklist starts at the top of the screen. false = no checklist.
function drScrollCk() {
  const box = $('#wa-msgs'), ck = box && box.querySelector('.dr-ckb');
  if (!ck) return false;
  box.scrollTop += ck.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  return true;
}
// "પહેલા ઉપર કામ ટિક કરો ↑" (the work-done button before anything is ticked): go to the checklist
onAct('dr-tickfirst', () => {
  if (!drScrollCk()) return;
  const ck = $('#wa-msgs .dr-ckb');
  ck.classList.remove('dr-flash'); void ck.offsetWidth; ck.classList.add('dr-flash');   // a short highlight
});

function drCloseChat() {
  drFlush();   // leaving the chat: an action still in its undo window is sent now, never lost
  WA.closeChat();
  DR.chat = null; DR.chatHtml = ''; DR.late = null;
}

// Tap a job row (or "આગળનું કામ ખોલો"): open its chat. The phone's back button will close it.
onAct('dr-open', btn => {
  drFlush();   // opening another job = leaving this one: send what is waiting
  DR.late = null;
  drShowChat(btn.dataset.id, 'open');
  if (WA.chatOpen()) WA.pushBack();   // once per open chat; redraws after an action do not call it
});
// Back arrow in the chat header. WA.closeChat also removes the back step added by WA.pushBack.
onAct('dr-back', () => drCloseChat());
// After the phone's back button closed the chat (chat.js), forget which chat was open
window.addEventListener('popstate', () => {
  if (!WA.chatOpen()) { drFlush(); DR.chat = null; DR.chatHtml = ''; DR.late = null; }
});


/* ==========================================================================
   5-SECOND "રદ કરો" (UNDO) WINDOW
   Every tap that sends the customer a WhatsApp (reached, late, done, I have
   left, end of day) shows on screen at once, but is sent only after 5 seconds.
   A big bar at the bottom says "રદ કરો · 5" and counts down. Tapping it puts
   everything back exactly as it was, and nothing is sent.
   - Only one action waits at a time: a new one sends the waiting one first.
   - Leaving the chat, switching tab, logging out or hiding the app (phone
     locked, another app opened) sends the waiting action at once, so it is
     never lost. (sendBeacon cannot carry our login well, so we just send.)
   ========================================================================== */
const DR_UNDO_SEC = 5;

/**
 * Starts the undo window.
 * commit() = really send it (runs after 5 seconds, or at once on leave/hide)
 * revert() = put the screen back (runs only when "રદ કરો" is tapped)
 * saveOnly = true when nothing goes to a customer (no WhatsApp, or the in-person answer):
 *            the bar then says "will be saved" instead of "will be sent to the customer"
 */
function drHold(commit, revert, saveOnly) {
  drFlush();   // only one at a time: the older one goes now
  DR.undo = { commit: commit, revert: revert, end: Date.now() + DR_UNDO_SEC * 1000, saveOnly: !!saveOnly,
    timer: setInterval(drUndoTick, 200) };
  drUndoBar();
}
// Every 0.2 s: update the number; at 0, send
function drUndoTick() {
  const u = DR.undo;
  if (!u) return;
  if (Date.now() >= u.end) drFlush(); else drUndoBar();
}
// Stop the countdown and remove the bar (nothing is sent)
function drUndoClear() {
  const u = DR.undo;
  DR.undo = null;
  if (u) clearInterval(u.timer);
  drUndoBar();
  return u;
}
// Send the waiting action now (if there is one)
function drFlush() {
  const u = drUndoClear();
  if (u) u.commit();
}
// "રદ કરો": cancel the waiting action. No API call is made.
onAct('dr-undo', () => {
  const u = drUndoClear();
  if (u) u.revert();
});

// The big bar at the bottom of the phone. Built once; only the number changes,
// so a tap on it is never lost while it counts down.
function drUndoBar() {
  let bar = document.getElementById('dr-undo');
  const u = DR.undo;
  if (!u) { if (bar) bar.remove(); return; }
  const left = Math.max(1, Math.ceil((u.end - Date.now()) / 1000));
  const words = n => u.saveOnly ? tr(n + ' સેકન્ડમાં સેવ થશે', 'Saving in ' + n + ' s') : tr(n + ' સેકન્ડમાં ગ્રાહકને મોકલાશે', 'Sending to the customer in ' + n + ' s');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'dr-undo';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="dr-undo-t">' + words(left) + '</span>' +
      '<button type="button" data-act="dr-undo">' + tr('રદ કરો', 'Undo') + ' · <b>' + left + '</b></button>';
    ($('#v-phone') || document.body).appendChild(bar);
  } else {
    const n = bar.querySelector('b'), t = bar.querySelector('.dr-undo-t');
    if (n.textContent !== String(left)) {
      n.textContent = left;
      t.textContent = words(left);
    }
  }
}

// After a language switch: build the bar again in the new words (the countdown goes on)
function drUndoRelang() {
  const bar = document.getElementById('dr-undo');
  if (bar) { bar.remove(); drUndoBar(); }
}

// Page hidden (phone locked, call, another app) or closing: send at once
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') drFlush(); });
window.addEventListener('pagehide', () => drFlush());

// Switching tab or logging out also sends the waiting action first.
// (The buttons are handled in app.js; we wrap them here.)
const drBasePage = App.actions.page, drBaseLogout = App.actions.logout;
onAct('page', (el, e) => { drFlush(); drBasePage(el, e); });
onAct('logout', (el, e) => {
  // Driver (added 2026-10-08): ask first, right there in the menu: "ખરેખર લૉગઆઉટ? ના / હા"
  if (App.session && App.session.role === 'driver' && el && !el.dataset.sure && el.closest && el.closest('#ph-drawer')) {
    el.outerHTML = '<div class="dr-lo" role="group"><b>' + tr('ખરેખર લૉગઆઉટ કરવું છે?', 'Log out now?') + '</b><div class="row2">' +
      '<button type="button" class="btn lg" data-act="dr-logout-no">' + tr('ના', 'No') + '</button>' +
      '<button type="button" class="btn pri lg" data-act="logout" data-sure="1">' + tr('હા, લૉગઆઉટ', 'Yes, log out') + '</button></div></div>';
    return;
  }
  drFlush();
  App.phonePage = '';   // the next login opens on the first tab ("આજના કામ" for a driver)
  drBaseLogout(el, e);
});
onAct('dr-logout-no', el => {
  const box = el.closest('.dr-lo');
  if (box) box.outerHTML = '<button class="dn" data-act="logout">' + TX.logout + '</button>';
});

/* ---------- "driver" class on the phone, for the bigger driver styles in phone.css ---------- */
const drBaseRenderPhone = renderPhone;
renderPhone = function () {
  // the supervisor gets the same big buttons (also measuring tanks on site)
  $('#v-phone').classList.toggle('dr-on', !!(App.session && (App.session.role === 'driver' || App.session.role === 'supervisor')));
  drBaseRenderPhone();
};

/* ==========================================================================
   DRIVER ACTIONS (buttons)
   ========================================================================== */

/**
 * One driver action, WITHOUT making the driver wait:
 *  1. the screen changes at once (message with a clock, next buttons)
 *  2. the 5-second "રદ કરો" window (drHold). Undo = back as it was, nothing sent.
 *  3. then the server is asked (drPost).
 *     OK: clock -> ✓✓. Failed: red message "send again", the job goes back to how it was.
 * kind = reach | delay | done | leave, text = the message text, ok(reply) runs after success,
 * undo() = extra things to put back when "રદ કરો" is tapped (e.g. reopen the late picker).
 */
function drSend(kind, id, action, params, text, ok, undo) {
  if (drSending(id)) return;   // already waiting or on its way (stops double taps)
  const p = DR.pending[id] = { kind: kind, action: action, params: params, text: text, ok: ok, at: nowMin(), state: 'wait' };
  // Nothing goes to a customer: the in-person answer, or a customer without WhatsApp
  // ("I have left" messages the NEXT customer, so that one counts)
  const o = drOrder(id), nx = kind === 'leave' && o ? drNextStop(o) : null;
  // (a multi-day job: no WhatsApp after the first day's reach, and none for "today's work done")
  const saveOnly = kind === 'confirm' || kind === 'daydone' || (kind === 'reach' && o && drMulti(o) && !!o.reached_at) ||
    (kind === 'leave' ? !nx || drNoWa(nx) : drNoWa(o));
  drShow('force');
  drHold(() => drPost(id, p), () => {
    if (DR.pending[id] === p) delete DR.pending[id];
    if (undo) undo();
    drShow('force');
  }, saveOnly);
}

// Really sends one action to the server (after the undo window)
async function drPost(id, p) {
  if (DR.pending[id] !== p) return;
  p.state = 'sending';
  drWipSave();   // kept on the phone until the server says OK (the app may be closed meanwhile)
  try {
    const r = await api(p.action, p.params);
    if (DR.pending[id] !== p) return;
    p.state = 'sent'; p.seq = DR.seq;
    // Work done / today's work done: the ticks, crew and "whole job" step are finished with
    // (here, not only in p.ok: an action put back from the phone's storage has no p.ok)
    if (p.kind === 'done') { delete DR.ticks[id]; delete DR.crew[id]; delete DR.finish[id]; }
    if (p.kind === 'daydone') delete DR.finish[id];
    if (p.ok) p.ok(r);
    if (p.kind === 'leave') delete DR.pending[id];   // its answer is kept in DR.left
  } catch (e) {
    if (guCode(e) === 'AUTH') return;              // back to the PIN screen already
    if (DR.pending[id] !== p) return;
    if (guCode(e) === 'BAD_STATUS') { delete DR.pending[id]; toast(guErr(e)); }   // the job changed: sending again will not help
    else { p.state = 'failed'; if (!WA.chatOpen()) toast(guErr(e)); }
  }
  drWipSave();
  if (!App.session) return;   // logged out meanwhile (the action was still sent)
  drShow('force');
  // The saved list is out of date now: forget it and load fresh data in the background
  cacheDrop(['order.list']);
  drLoad();
}

// Send one job's failed action again (no second undo window). Keeps the original time.
function drRetry(id) {
  const p = DR.pending[id];
  if (!p || p.state !== 'failed') return;
  const np = DR.pending[id] = Object.assign({}, p, { state: 'sending' });
  drShow('keep');
  drPost(id, np);
}
// "મોકલાયું નહીં · ફરી મોકલો" (the red bar): the failed action and/or size report of this job
onAct('dr-retry', btn => {
  const id = btn.dataset.id;
  drRetry(id);
  if (DR.size[id] && DR.size[id].state === 'failed') drSizeSend(id);
});

// A short "sent ✓" message. Inside a chat the new bubble already shows it, so no pop-up there.
const drToast = msg => { if (!WA.chatOpen()) toast(msg); };

// "હું પહોંચી ગયો": mark reached; the customer gets a WhatsApp to confirm
onAct('dr-reach', btn => {
  const o0 = drOrder(btn.dataset.id), later = !!(o0 && drMulti(o0) && o0.reached_at);   // day 2+ of a multi-day job: no WhatsApp
  drSend('reach', btn.dataset.id, 'order.reached', { order_id: Number(btn.dataset.id) }, TX.reached,
    () => drToast(later || drNoWa(drOrder(btn.dataset.id)) ? TX.saved_ok : tr('ગ્રાહકને WhatsApp મોકલ્યો ✓', 'WhatsApp sent to the customer ✓')));
});

// No WhatsApp: the customer's answer, asked in person ("ગ્રાહક સંમત ✓" / "ગ્રાહક અસંમત ✗")
onAct('dr-confirm', btn => {
  const id = btn.dataset.id, v = btn.dataset.v === 'no' ? 'no' : 'yes';
  drSend('confirm', id, 'order.confirm', { order_id: Number(id), answer: v }, v === 'yes' ? TX.cf_yes : TX.cf_no,
    () => drToast(v === 'yes' ? TX.saved_ok : tr('માલિકને જાણ કરી.', 'The owner has been told.')));
});

// Checklist tick / untick (kept on the phone until "કામ પૂર્ણ થયું")
onAct('dr-tick', btn => {
  const id = btn.dataset.id, k = btn.dataset.k;
  const list = DR.ticks[id] || (DR.ticks[id] = []);
  const i = list.indexOf(k);
  if (i < 0) list.push(k); else list.splice(i, 1);
  drWipSave();   // kept on the phone (the browser may close after a call)
  drShowChat(id, 'keep');
});

// Log book: tap a worker's name (crew)
onAct('dr-crew', btn => {
  const id = btn.dataset.id, nm = btn.dataset.n, list = DR.crew[id] || (DR.crew[id] = []);
  const i = list.indexOf(nm);
  if (i < 0) list.push(nm); else list.splice(i, 1);
  drWipSave();
  drShowChat(id, 'keep');
});

// "કામ પૂર્ણ થયું": send the ticked services (the ticks are kept until the server says OK,
// so "રદ કરો" brings the checklist back with the same ticks)
onAct('dr-done', btn => {
  const id = btn.dataset.id, o = drOrder(id), done = (DR.ticks[id] || []).slice();
  if (!o || (!done.length && (o.services || []).length)) return;   // a task without a checklist needs no ticks
  const not = (o.services || []).filter(k => !done.includes(k));
  // Log book: who did the work. (No tank sizes: drivers do not send them, since 2026-10-08.)
  const crew = (DR.crew[id] || []).slice();
  drSend('done', id, 'order.done', { order_id: Number(id), done: done, crew: crew }, drDoneHtml(done, not, crew), r => {
    drToast((drNoWa(o) ? tr('કામ પૂર્ણ. ગ્રાહકને પૂછો ✓', 'Work done. Ask the customer ✓') : tr('કામ પૂર્ણ. ગ્રાહકને WhatsApp મોકલ્યો ✓', 'Work done. WhatsApp sent to the customer ✓')) +
      (r && r.overtime_min > 0 ? tr(' · ઓવરટાઇમ ', ' · overtime ') + durT(r.overtime_min) : ''));
  });
});

// Multi-day job: "આજનું કામ પૂર્ણ" = today's work is done, the team comes back tomorrow
// (order.dayDone; nothing is sent to the customer, so the undo bar says "will be saved")
onAct('dr-daydone', btn => {
  const id = btn.dataset.id;
  drSend('daydone', id, 'order.dayDone', { order_id: Number(id) }, '<b>' + TX.day_done + '</b>',
    () => drToast(TX.day_done + ' ✓ ' + TX.saved_ok));
});
// Multi-day job: "આખું કામ પૂરું" opens the normal done step (checklist, crew)
onAct('dr-finish', btn => { DR.finish[btn.dataset.id] = true; drWipSave(); drShowChat(btn.dataset.id, 'force'); });

/* ---------- "માપ અલગ છે" (Size is different), added 2026-10-08 ----------
   A small sheet: quick reasons as chips (more tanks / fewer tanks / bigger / smaller / other)
   and an optional note. Sends order.sizeIssue: the office gets an alert and checks the sizes
   and the price. Nothing on the order changes. If it cannot be sent it is kept on the phone and
   the red bar "મોકલાયું નહીં · ફરી મોકલો" sends it again (also automatically when online). */
// [key, words in the note to the office (English: admin screens are English), chip label on screen]
const DR_SIZE_CHIPS = [
  // Clear words (9 Oct): the NUMBER of tanks or the SIZE of a tank, compared with the list on the job
  ['more', 'More tanks than listed', () => tr('લખેલી કરતાં વધુ ટાંકીઓ છે', 'More tanks than listed')],
  ['fewer', 'Fewer tanks than listed', () => tr('લખેલી કરતાં ઓછી ટાંકીઓ છે', 'Fewer tanks than listed')],
  ['bigger', 'A tank is bigger than listed', () => tr('ટાંકીનું માપ લખેલા કરતાં મોટું છે', 'A tank is bigger than listed')],
  ['smaller', 'A tank is smaller than listed', () => tr('ટાંકીનું માપ લખેલા કરતાં નાનું છે', 'A tank is smaller than listed')],
  ['other', 'Something else', () => tr('બીજું કંઈ અલગ છે', 'Something else is different')]   // not "બીજું" alone: it also means "second"
];
function drSizeSheet() {
  const z = DR.sizeSheet, o = z && drOrder(z.id);
  if (!o) return;
  openSheet('<h3>' + esc(TX.size_diff) + '</h3>' +
    '<div class="sub">' + esc(o.client_name) + ' · ' + tr('શું અલગ છે? ઓફિસને જાણ થશે, ઓફિસ માપ અને ભાવ તપાસશે.',
      'What is different? The office will be told and will check the sizes and the price.') + '</div>' +
    '<div class="wa-chips dr-szc">' + DR_SIZE_CHIPS.map(c => '<button type="button" data-act="dr-size-pick" data-k="' + c[0] + '" aria-pressed="' +
      z.picks.includes(c[0]) + '">' + esc(c[2]()) + '</button>').join('') + '</div>' +
    '<label class="sv-note"><span class="dr-lbl">' + tr('નોંધ (જરૂરી નથી)', 'Note (optional)') + '</span>' +
    '<textarea id="dr-size-note" maxlength="200" data-inp="dr-size-note" placeholder="' + esc(tr('દા.ત. ઉપર 3 ટાંકી છે, 2 નહીં', 'e.g. 3 tanks on the roof, not 2')) + '">' +
    esc(z.text) + '</textarea></label>' +
    '<button class="btn pri lg" data-act="dr-size-send"' + (drSizeNote() ? '' : ' disabled') + '>' + tr('ઓફિસને જણાવો', 'Tell the office') + '</button>' +
    '<button class="btn lg" data-act="close">' + TX.close + '</button>');
}
// The note sent to the office: the chips in English + the driver's own words. '' = nothing chosen yet.
function drSizeNote() {
  const z = DR.sizeSheet;
  if (!z) return '';
  const words = DR_SIZE_CHIPS.filter(c => z.picks.includes(c[0])).map(c => c[1]).join(', ');
  const text = String(z.text || '').trim();
  return (words && text ? words + ': ' + text : words || text).slice(0, 300);
}
onAct('dr-size', btn => { DR.sizeSheet = { id: btn.dataset.id, picks: [], text: '' }; drSizeSheet(); });
onAct('dr-size-pick', btn => {
  const z = DR.sizeSheet;
  if (!z) return;
  const i = z.picks.indexOf(btn.dataset.k);
  if (i < 0) z.picks.push(btn.dataset.k); else z.picks.splice(i, 1);
  btn.setAttribute('aria-pressed', String(i < 0));   // change the chip in place (the typed note stays)
  const b = $('#ph-sheet [data-act="dr-size-send"]');
  if (b) b.disabled = !drSizeNote();
});
onInp('dr-size-note', el => {
  if (!DR.sizeSheet) return;
  DR.sizeSheet.text = el.value;
  const b = $('#ph-sheet [data-act="dr-size-send"]');
  if (b) b.disabled = !drSizeNote();
});
onAct('dr-size-send', () => {
  const z = DR.sizeSheet, note = drSizeNote();
  if (!z || !note) return;
  DR.sizeSheet = null;
  closeOverlays();
  DR.size[z.id] = { note: note, state: 'failed' };   // drSizeSend sends it ('failed' = not sent yet)
  drSizeSend(z.id);
});
// Send (or send again) the size report of one job
async function drSizeSend(id) {
  const s = DR.size[id];
  if (!s || s.state === 'sending') return;
  s.state = 'sending';
  drWipSave();
  drShow('keep');
  try {
    await api('order.sizeIssue', { order_id: Number(id), note: s.note });
    if (DR.size[id] === s) delete DR.size[id];
    toast(TX.office_informed);
  } catch (e) {
    if (guCode(e) === 'AUTH') return;
    if (DR.size[id] !== s) return;
    const c = guCode(e);
    // The job is cancelled / not ours / the note was refused: sending again will not help
    if (c === 'BAD_STATUS' || c === 'FORBIDDEN' || c === 'BAD_INPUT' || c === 'NOT_FOUND') { delete DR.size[id]; toast(guErr(e)); }
    else { s.state = 'failed'; if (!WA.chatOpen()) toast(guErr(e)); }
  }
  drWipSave();
  if (App.session) drShow('keep');
}

// "હું નીકળ્યો, ગ્રાહકને જણાવો": the server works out the arrival time and tells the next customer
onAct('dr-leave', btn => {
  const id = btn.dataset.id, o = drOrder(id), nx = o && drNextStop(o);
  const at = nowMin();
  drSend('leave', id, 'order.leave', { order_id: Number(id) }, TX.i_left, r => {
    if (!r || !r.next_order_id) { toast(tr('આજે બીજું કોઈ કામ બાકી નથી.', 'No more jobs left today.')); return; }
    const next = drOrder(r.next_order_id) || nx || {};
    const told = r.customer_told !== false;   // false = too late, the office will call the customer instead
    // false = the next customer has no WhatsApp: nothing was sent, the driver calls (server: next_whatsapp 'no')
    const wa = r.next_whatsapp ? r.next_whatsapp !== 'no' : !drNoWa(next);
    DR.left[id] = { at: at, to: next.client_name || '', eta: r.eta, late: r.late_min || 0, told: told, wa: wa, next: r.next_order_id };
    drToast(!told ? tr('ઘણું મોડું છે. ઓફિસને જાણ કરી, ઓફિસ ગ્રાહકને ફોન કરશે.', 'Very late. The office has been told and will call the customer.')
      : !wa ? (next.client_name || '') + ': ' + TX.call_tell + ' · ' + fm(mins(r.eta))
      : tr((next.client_name || '') + ' ને અંદાજિત સમય ' + fm(mins(r.eta)) + ' મોકલ્યો ✓', 'Arrival time ' + fm(mins(r.eta)) + ' sent to ' + (next.client_name || '') + ' ✓'));
  });
});

/* ---------- "મોડો પડીશ": minutes + reason chips inside the chat ---------- */
// Opens with NOTHING chosen: the driver must pick minutes and a reason
onAct('dr-delay', btn => {
  DR.late = { id: btn.dataset.id, mins: null, reason: null };
  drShowChat(btn.dataset.id, 'force');
});
onAct('dr-late-pick', btn => {
  if (!DR.late) return;
  DR.late[btn.dataset.k] = btn.dataset.k === 'mins' ? Number(btn.dataset.v) : btn.dataset.v;
  drShowChat(DR.late.id, 'keep');
});
onAct('dr-late-cancel', () => {
  const id = DR.late && DR.late.id;
  DR.late = null;
  if (id != null) drShowChat(id, 'force');
});
onAct('dr-delay-send', () => {
  const L = DR.late;
  if (!L || !L.mins || !L.reason) return;   // both must be chosen
  DR.late = null;   // close the chips at once; the message shows with a clock
  const o = drOrder(L.id);
  if (o) DR.delayAt[L.id] = drLateEta(o, L.mins);   // the time to tell a no-WhatsApp customer on the phone
  drSend('delay', L.id, 'order.delay', { order_id: Number(L.id), mins: L.mins, reason: L.reason }, drDelayHtml(L.mins, L.reason),
    () => drToast(drNoWa(o) ? TX.saved_ok + ' ' + TX.call_tell : tr('ગ્રાહકને મોડાની જાણ કરી ✓', 'Customer told you are late ✓')),
    () => { DR.late = L; });   // "રદ કરો": the picker comes back with the same choices
});

/* ---------- "દિવસ પૂર્ણ કરો": reason + new date for each unfinished job ---------- */
const drDeHead = () => '<div class="dr-de-hd">' + WA.avatar(TX.day_end, { small: true, icon: DR_MOON, color: 'var(--muted)' }) + '<h3>' + TX.day_end + '</h3></div>';
// true when every listed job has both a reason and a new date
const drDeReady = () => !!(DR.sheet && DR.sheet.items.length && DR.sheet.items.every(it => it.reason && it.new_date));

/* The sheet: one block per unfinished job, with BIG CHIPS (no dropdowns, changed 2026-10-08):
   - reason chips: customer not home, customer asked for later, time ran out, tank not emptied,
     traffic, earlier job took longer, vehicle problem, some other reason
   - date chips: tomorrow, the day after, "+ another date" (opens a date box)
   Nothing is pre-selected. The save button works only when every job has both. */
function drDayEndSheet() {
  const sh = DR.sheet, t = todayIso();
  let h = drDeHead();
  if (!sh.items.length) {
    // Nothing left to move: the honest count of the day (not always "well done")
    h += drSummaryHtml() + '<button class="btn lg" data-act="close">' + TX.close + '</button>';
  } else {
    const chip = (act, i, v, label, on) => '<button type="button" data-act="' + act + '" data-i="' + i + '" data-v="' + esc(v) + '" aria-pressed="' + !!on + '">' + esc(label) + '</button>';
    h += '<div class="sub">' + tr('આ કામ આજે પૂર્ણ થયા નથી. દરેક કામ માટે કારણ અને નવી તારીખ પસંદ કરો. ગ્રાહકને મેસેજ જશે.',
      'These jobs were not finished today. Pick a reason and a new date for each job. The customer will get a message.') + '</div>' +
      sh.items.map((it, i) => {
        const o = drOrder(it.order_id) || {};
        const d1 = addD(t, 1), d2 = addD(t, 2);
        const other = it.new_date && it.new_date !== d1 && it.new_date !== d2;   // a date picked in the date box
        return '<div class="dr-de">' + WA.avatar(o.client_name, { small: true }) +
          '<div class="dr-de-mid"><b>' + esc(o.client_name) + '</b><span class="sub">' + timeOf(o) + ' · ' + esc(areaT(o.area)) + '</span>' +
          // No WhatsApp: this customer gets no message, the driver calls with the new date
          (drNoWa(o) ? '<span>' + drNoWaBadge() + '</span>' : '') +
          '<span class="dr-lbl">' + tr('કારણ', 'Reason') + '</span>' +
          '<div class="wa-chips dr-de-ch" role="group" aria-label="' + esc(tr('કારણ', 'Reason')) + '">' +
          DR_DE_REASONS.map(r => chip('dr-de-r', i, r, lbl(REASON[r]), it.reason === r)).join('') + '</div>' +
          '<span class="dr-lbl">' + tr('નવી તારીખ', 'New date') + '</span>' +
          '<div class="wa-chips dr-de-ch" role="group" aria-label="' + esc(tr('નવી તારીખ', 'New date')) + '">' +
          chip('dr-de-d', i, d1, tr('કાલે', 'Tomorrow') + ' · ' + labT(d1), it.new_date === d1) +
          chip('dr-de-d', i, d2, tr('પરમ દિવસે', 'Day after') + ' · ' + labT(d2), it.new_date === d2) +
          chip('dr-de-pick', i, '', other ? labT(it.new_date) : tr('+ તારીખ પસંદ કરો', '+ Pick a date'), other) + '</div>' +
          (it.pick || other ? '<input type="date" class="fsel dr-de-date" data-chg="dr-de-date" data-i="' + i + '" min="' + d1 + '" value="' + esc(other ? it.new_date : '') +
            '" aria-label="' + esc(tr('નવી તારીખ પસંદ કરો', 'Pick a new date')) + '">' : '') +
          '</div></div>';
      }).join('') +
      '<div class="dr-de-hint"' + (drDeReady() ? ' hidden' : '') + '>' + tr('દરેક કામ માટે કારણ અને તારીખ પસંદ કરો.', 'Pick a reason and a date for every job.') + '</div>' +
      '<button class="btn pri lg" data-act="dr-dayend-send"' + (drDeReady() ? '' : ' disabled') + '>' + tr('ગ્રાહકોને મેસેજ મોકલો અને દિવસ પૂર્ણ કરો', 'Message the customers and end the day') + '</button>' +
      '<button class="btn lg" data-act="close">' + TX.close + '</button>';
  }
  openSheet(h);
}
// Draw the sheet again after a chip tap, keeping its scroll position
function drDeRedraw() {
  const sc = $('#ph-sheet .sheet'), top = sc ? sc.scrollTop : 0;
  drDayEndSheet();
  const sc2 = $('#ph-sheet .sheet');
  if (sc2) sc2.scrollTop = top;
}
// After each choice: switch the save button on only when everything is chosen
function drDeCheck() {
  const ok = drDeReady();
  const b = $('#ph-sheet [data-act="dr-dayend-send"]'), hint = $('#ph-sheet .dr-de-hint');
  if (b) b.disabled = !ok;
  if (hint) hint.hidden = ok;
}

// "દિવસ પૂર્ણ કરો" (row at the bottom of the list, or the menu).
// Before the last job's booked time it asks first: ending early moves customers to another day.
onAct('dr-dayend', btn => {
  if (!DR.orders) { closeOverlays(); return; }
  const t = todayIso();
  // A multi-day job that has started is not moved: it simply continues tomorrow
  const pend = drList().filter(o => o.sched_date === t && !drDoneToday(o) && !(drMulti(o) && (o.reached_at || o.status === 'ongoing')))
    .sort((a, b) => mins(a.sched_time) - mins(b.sched_time));
  closeOverlays();
  const lastTime = pend.length ? mins(pend[pend.length - 1].sched_time) : 0;
  if (pend.length && nowMin() < lastTime && !(btn && btn.dataset && btn.dataset.sure)) {
    openSheet(drDeHead() +
      '<p class="dr-ask">' + tr('હજુ ' + pend.length + ' કામ બાકી છે. ખરેખર દિવસ પૂર્ણ કરવો છે?', 'Still ' + jobsN(pend.length) + ' left. End the day anyway?') + '</p>' +
      '<div class="row2"><button class="btn lg" data-act="close">' + tr('ના', 'No') + '</button>' +
      '<button class="btn pri lg" data-act="dr-dayend" data-sure="1">' + tr('હા', 'Yes') + '</button></div>');
    return;
  }
  DR.sheet = { type: 'dayend', items: pend.map(o => ({ order_id: o.order_id, reason: '', new_date: '' })) };
  drDayEndSheet();
});
// Chip taps: reason, tomorrow / day after, "+ another date" (shows the date box), the date box
const drDeItem = el => DR.sheet && DR.sheet.items[+el.dataset.i];
onAct('dr-de-r', b => { const it = drDeItem(b); if (it) { it.reason = b.dataset.v; drDeRedraw(); } });
onAct('dr-de-d', b => { const it = drDeItem(b); if (it) { it.new_date = b.dataset.v; it.pick = false; drDeRedraw(); } });
onAct('dr-de-pick', b => {
  const it = drDeItem(b);
  if (!it) return;
  it.pick = true;
  drDeRedraw();
  const box = $('#ph-sheet .dr-de-date[data-i="' + b.dataset.i + '"]');
  if (box) { box.focus(); try { if (box.showPicker) box.showPicker(); } catch (e) { /* some browsers need a real tap */ } }
});
onChg('dr-de-date', el => {
  const it = drDeItem(el);
  if (!it) return;
  it.new_date = el.value > todayIso() ? el.value : '';   // only a later day
  drDeRedraw();
});

// Save: the jobs move on screen at once, then the 5-second "રદ કરો" window, then the server.
onAct('dr-dayend-send', () => {
  const sh = DR.sheet;
  if (!sh || !drDeReady() || DR.busy) return;
  const items = sh.items.map(it => ({ order_id: it.order_id, reason: it.reason, new_date: it.new_date }));
  DR.sheet = null; closeOverlays();
  const mv = DR.moving = { items: items, state: 'wait' };
  drShow('force');
  drHold(() => drDayEndPost(mv), () => {
    // "રદ કરો": the jobs come back to today and the sheet opens again with the same choices
    if (DR.moving === mv) DR.moving = null;
    DR.sheet = { type: 'dayend', items: items };
    drShow('force');
    drDayEndSheet();
  });
});
async function drDayEndPost(mv) {
  if (DR.moving !== mv) return;
  DR.busy = true; mv.state = 'sending';
  try {
    const r = await api('order.reschedule', { items: mv.items });
    mv.state = 'sent'; mv.seq = DR.seq;
    // Customers without WhatsApp got nothing: the driver must call them (shown in the moved list)
    const calls = mv.items.filter(it => drNoWa(drOrder(it.order_id))).length;
    const sent = ((r && r.moved) || 0) - calls;
    toast((sent > 0 ? tr(sent + ' ગ્રાહકોને WhatsApp પર જાણ કરી ✓', sent + ' customer(s) told on WhatsApp ✓') : TX.saved_ok) +
      (calls ? tr(' · ' + calls + ' ગ્રાહકને ફોન કરો', ' · call ' + calls + ' customer(s)') : ''));
    // Customers without WhatsApp were told nothing: show the day's summary with a call button each
    if (calls && App.session && !WA.chatOpen() && $('#ph-sheet').hidden) {
      openSheet(drDeHead() + drSummaryHtml() + '<button class="btn lg" data-act="close">' + TX.close + '</button>');
    }

  } catch (e) {
    DR.busy = false;
    if (DR.moving === mv) DR.moving = null;
    drShow('force');
    if (guCode(e) === 'AUTH') return;
    toast(guErr(e));
    // Not sent: open the sheet again with the same choices, so the driver can try again
    DR.sheet = { type: 'dayend', items: mv.items };
    if (!WA.chatOpen()) drDayEndSheet();
    return;
  }
  DR.busy = false;
  if (!App.session) return;   // logged out meanwhile (the moves were still sent)
  drShow('force');
  cacheDrop(['order.list']);
  drLoad();   // in the background
}
